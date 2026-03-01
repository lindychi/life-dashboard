// PostgreSQL-backed relay system

import { query, queryOne, isDbConnectionError } from "./db";
import { randomUUID } from "crypto";
import * as fs from "fs";
import type {
  GatewayConnection,
  RelayCommand,
  RelayCommandType,
  RelayCommandStatus,
  AgentStatus,
  AgentStatusValue,
  QueuedInstruction,
  PendingCommand,
} from "./types";

// Re-export types for backwards compatibility
export type {
  GatewayConnection,
  RelayCommand,
  RelayCommandType,
  RelayCommandStatus,
  AgentStatus,
  AgentStatusValue,
  QueuedInstruction,
  PendingCommand,
};

// Queue size limits to prevent memory leaks
export const MAX_COMMANDS_PER_GATEWAY = 100;
export const MAX_GATEWAYS_IN_MEMORY = 50;
export const COMMAND_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_LIVE_OUTPUT_ENTRIES = 200;
export const MAX_RECENT_EVENTS_PER_AGENT = 50;
export const MAX_LAST_CHUNK_CHARS = 10_000;
export const LIVE_OUTPUT_TTL_MS = 10 * 60 * 1000; // 10 minutes

let _relayApiKey: string | null = null;

function getRelayApiKey(): string {
  if (_relayApiKey) return _relayApiKey;
  const key = process.env.RELAY_API_KEY;
  if (!key && process.env.NODE_ENV === "production") {
    throw new Error("RELAY_API_KEY environment variable is required in production");
  }
  _relayApiKey = key || "dev-relay-key";
  return _relayApiKey;
}

// In-memory fallback when DB is unavailable
const inMemoryCommands = new Map<string, RelayCommand[]>();
let dbAvailable = true;
let autoCleanupInterval: ReturnType<typeof setInterval> | null = null;

// Backup file for persisting in-memory commands across server restarts
const IN_MEMORY_BACKUP_PATH = "/tmp/relay-commands-backup.json";

// On module load: restore in-memory commands from backup if it exists
(function restoreInMemoryBackup() {
  try {
    if (fs.existsSync(IN_MEMORY_BACKUP_PATH)) {
      const raw = fs.readFileSync(IN_MEMORY_BACKUP_PATH, "utf-8");
      const entries: [string, RelayCommand[]][] = JSON.parse(raw);
      const now = Date.now();
      for (const [gatewayId, commands] of entries) {
        // Filter out expired commands during restore
        const fresh = commands.filter(
          (c) => now - new Date(c.createdAt).getTime() < COMMAND_TTL_MS
        );
        if (fresh.length > 0) {
          inMemoryCommands.set(gatewayId, fresh);
        }
      }
      fs.unlinkSync(IN_MEMORY_BACKUP_PATH);
      if (inMemoryCommands.size > 0) {
        console.log(`[relay] Restored in-memory commands from backup: ${inMemoryCommands.size} gateway(s)`);
      }
    }
  } catch {
    // Best-effort — don't block startup
  }
})();

// On shutdown: persist in-memory commands so they survive a server restart
function persistInMemoryBackup() {
  try {
    if (inMemoryCommands.size === 0) return;
    const entries = [...inMemoryCommands.entries()];
    fs.writeFileSync(IN_MEMORY_BACKUP_PATH, JSON.stringify(entries), "utf-8");
    console.log(`[relay] Persisted in-memory commands to backup: ${inMemoryCommands.size} gateway(s)`);
  } catch {
    // Best-effort
  }
}

// Register once — guard against multiple imports re-registering
if (!(globalThis as Record<string, unknown>).__relayShutdownRegistered) {
  (globalThis as Record<string, unknown>).__relayShutdownRegistered = true;
  process.on("SIGTERM", persistInMemoryBackup);
  process.on("beforeExit", persistInMemoryBackup);
}

// In-memory cache for live output (too frequent for DB writes)
const liveOutputCache = new Map<
  string,
  {
    lastChunk: string;
    totalChars: number;
    lastActivityAt: string;
    chunksReceived: number;
    recentEvents?: Array<{
      type: "tool_use" | "text" | "health" | "warning" | "stderr";
      timestamp: string;
      tool?: string;
      target?: string;
      content?: string;
    }>;
    cachedAt: number;
  }
>();

export function validateRelayKey(key: string): boolean {
  return key === getRelayApiKey();
}

export function isDbAvailable(): boolean {
  return dbAvailable;
}

export async function registerGateway(
  gatewayId: string
): Promise<GatewayConnection> {
  const result = await queryOne<{
    id: string;
    connected_at: string;
    last_heartbeat: string;
    status: string;
  }>(
    `
    INSERT INTO gateway_connections (id, status, connected_at, last_heartbeat)
    VALUES ($1, 'connected', NOW(), NOW())
    ON CONFLICT (id) DO UPDATE
    SET status = 'connected', last_heartbeat = NOW()
    RETURNING id, connected_at, last_heartbeat, status
  `,
    [gatewayId]
  );

  if (!result) {
    throw new Error(`Failed to register gateway: ${gatewayId}`);
  }

  // Reset all previous agent statuses to 'idle' on re-registration
  // This clears stale "running" statuses from previous sessions
  await query(
    `UPDATE agent_statuses SET status = 'idle', current_task = NULL WHERE gateway_id = $1 AND status = 'running'`,
    [gatewayId]
  );

  // Reset orphaned 'processing' commands back to 'pending' for re-pickup.
  // Exclude commands already tracked in task_executions (those will be recovered
  // by taskStateManager via the interrupted task recovery flow).
  // Wrapped in try-catch: task_executions table may not exist yet.
  try {
    const resetResult = await query<{ id: string }>(
      `UPDATE relay_commands
       SET status = 'pending'
       WHERE gateway_id = $1 AND status = 'processing'
         AND id::text NOT IN (
           SELECT command_id FROM task_executions
           WHERE command_id IS NOT NULL AND gateway_id = $1
             AND status IN ('running', 'interrupted')
         )
       RETURNING id`,
      [gatewayId]
    );

    if (resetResult.length > 0) {
      console.log(`[relay] Reset ${resetResult.length} orphaned processing command(s) to pending for gateway ${gatewayId}`);
    }
  } catch (error) {
    // Fallback: if task_executions table doesn't exist, reset ALL processing commands
    console.warn(`[relay] Orphan recovery query failed (task_executions may not exist), using simple reset:`, error);
    try {
      await query(
        `UPDATE relay_commands SET status = 'pending' WHERE gateway_id = $1 AND status = 'processing'`,
        [gatewayId]
      );
    } catch {
      // Best-effort — don't block registration
    }
  }

  return {
    id: result.id,
    connectedAt: result.connected_at,
    lastHeartbeat: result.last_heartbeat,
    status: result.status as "connected" | "disconnected",
  };
}

export async function updateHeartbeat(gatewayId: string): Promise<boolean> {
  const result = await queryOne<{ id: string }>(
    `
    UPDATE gateway_connections
    SET last_heartbeat = NOW(), status = 'connected'
    WHERE id = $1
    RETURNING id
  `,
    [gatewayId]
  );

  return result !== null;
}

export async function getConnectedGateways(): Promise<GatewayConnection[]> {
  try {
    const results = await query<{
      id: string;
      connected_at: string;
      last_heartbeat: string;
      status: string;
    }>(
      `
      SELECT
        id,
        connected_at,
        last_heartbeat,
        CASE
          WHEN last_heartbeat > NOW() - INTERVAL '30 seconds' THEN 'connected'
          ELSE 'disconnected'
        END as status
      FROM gateway_connections
      ORDER BY last_heartbeat DESC
    `,
      []
    );

    dbAvailable = true;
    return results.map((r) => ({
      id: r.id,
      connectedAt: r.connected_at,
      lastHeartbeat: r.last_heartbeat,
      status: r.status as "connected" | "disconnected",
    }));
  } catch (error) {
    if (isDbConnectionError(error)) {
      dbAvailable = false;
      return [];
    }
    throw error;
  }
}

export async function queueCommand(
  gatewayId: string,
  command: Omit<RelayCommand, "id" | "createdAt" | "status">
): Promise<RelayCommand> {
  // Try DB first
  try {
    const result = await queryOne<{
      id: string;
      gateway_id: string;
      type: string;
      payload: Record<string, unknown>;
      status: string;
      result: unknown;
      created_at: string;
    }>(
      `
      INSERT INTO relay_commands (gateway_id, type, payload, status)
      VALUES ($1, $2, $3, 'pending')
      RETURNING id, gateway_id, type, payload, status, result, created_at
    `,
      [gatewayId, command.type, JSON.stringify(command.payload)]
    );

    if (!result) {
      throw new Error(`Failed to queue command for gateway ${gatewayId}, type: ${command.type}`);
    }

    dbAvailable = true;
    return {
      id: result.id,
      type: result.type as RelayCommand["type"],
      payload: result.payload,
      createdAt: result.created_at,
      status: result.status as RelayCommand["status"],
      result: result.result,
    };
  } catch (error) {
    if (isDbConnectionError(error)) {
      // Fallback: in-memory queue
      dbAvailable = false;
      const cmd: RelayCommand = {
        id: randomUUID(),
        type: command.type as RelayCommand["type"],
        payload: command.payload,
        createdAt: new Date().toISOString(),
        status: "pending",
      };
      const queue = inMemoryCommands.get(gatewayId) || [];

      // Purge expired commands before adding new one
      const now = Date.now();
      const freshQueue = queue.filter(
        (c) => now - new Date(c.createdAt).getTime() < COMMAND_TTL_MS
      );

      freshQueue.push(cmd);

      // FIFO eviction: keep only latest MAX_COMMANDS_PER_GATEWAY
      if (freshQueue.length > MAX_COMMANDS_PER_GATEWAY) {
        freshQueue.splice(0, freshQueue.length - MAX_COMMANDS_PER_GATEWAY);
      }

      inMemoryCommands.set(gatewayId, freshQueue);

      // Gateway eviction: keep only MAX_GATEWAYS_IN_MEMORY
      if (inMemoryCommands.size > MAX_GATEWAYS_IN_MEMORY) {
        // Evict gateways with oldest commands
        const entries = [...inMemoryCommands.entries()];
        entries.sort((a, b) => {
          const aOldest = a[1][0]?.createdAt || "";
          const bOldest = b[1][0]?.createdAt || "";
          return aOldest.localeCompare(bOldest);
        });
        while (inMemoryCommands.size > MAX_GATEWAYS_IN_MEMORY) {
          const oldest = entries.shift();
          if (oldest) inMemoryCommands.delete(oldest[0]);
        }
      }

      return cmd;
    }
    throw error;
  }
}

export async function getAndClearCommands(
  gatewayId: string
): Promise<RelayCommand[]> {
  // Try DB first
  try {
    const results = await query<{
      id: string;
      type: string;
      payload: Record<string, unknown>;
      status: string;
      result: unknown;
      created_at: string;
    }>(
      `
      UPDATE relay_commands
      SET status = 'processing'
      WHERE gateway_id = $1 AND status = 'pending'
      RETURNING id, type, payload, status, result, created_at
    `,
      [gatewayId]
    );

    dbAvailable = true;
    // Also drain any in-memory commands that accumulated during outage
    const inMemQueue = inMemoryCommands.get(gatewayId) || [];
    inMemoryCommands.delete(gatewayId);

    return [
      ...results.map((r) => ({
        id: r.id,
        type: r.type as RelayCommand["type"],
        payload: r.payload,
        createdAt: r.created_at,
        status: r.status as RelayCommand["status"],
        result: r.result,
      })),
      ...inMemQueue,
    ];
  } catch (error) {
    if (isDbConnectionError(error)) {
      dbAvailable = false;
      // Return in-memory commands only, filtering expired
      const now = Date.now();
      const queue = (inMemoryCommands.get(gatewayId) || []).filter(
        (cmd) => now - new Date(cmd.createdAt).getTime() < COMMAND_TTL_MS
      );
      inMemoryCommands.delete(gatewayId);
      return queue;
    }
    throw error;
  }
}

export async function updateCommandResult(
  gatewayId: string,
  commandId: string,
  status: RelayCommand["status"],
  result?: unknown
): Promise<boolean> {
  const dbResult = await queryOne<{ id: string }>(
    `
    UPDATE relay_commands
    SET status = $1, result = $2, completed_at = NOW()
    WHERE id = $3 AND gateway_id = $4
    RETURNING id
  `,
    [status, result ? JSON.stringify(result) : null, commandId, gatewayId]
  );

  return dbResult !== null;
}

export async function updateAgentStatuses(
  gatewayId: string,
  agents: Array<Omit<AgentStatus, "updatedAt"> & {
    liveOutput?: {
      lastChunk: string;
      totalChars: number;
      lastActivityAt: string;
      chunksReceived: number;
      recentEvents?: Array<{
        type: "tool_use" | "text" | "health" | "warning" | "stderr";
        timestamp: string;
        tool?: string;
        target?: string;
        content?: string;
      }>;
    };
  }>
): Promise<void> {
  // Batch UPSERT all agents in a single query using UNNEST
  if (agents.length > 0) {
    const ids = agents.map((a) => a.id);
    const gatewayIds = agents.map(() => gatewayId);
    const names = agents.map((a) => a.name);
    const statuses = agents.map((a) => a.status);
    const tasks = agents.map((a) => a.currentTask || null);
    const sessionKeys = agents.map((a) => a.sessionKey || null);

    await query(
      `INSERT INTO agent_statuses (id, gateway_id, name, status, current_task, session_key, updated_at)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
         AS t(id, gateway_id, name, status, current_task, session_key),
         LATERAL (SELECT NOW()) AS ts(updated_at)
       ON CONFLICT (id, gateway_id) DO UPDATE
       SET name = EXCLUDED.name, status = EXCLUDED.status,
           current_task = EXCLUDED.current_task, session_key = EXCLUDED.session_key,
           updated_at = NOW()`,
      [ids, gatewayIds, names, statuses, tasks, sessionKeys]
    );
  }

  // Cache liveOutput in memory (too frequent for DB)
  for (const agent of agents) {
    const cacheKey = `${gatewayId}:${agent.id}`;
    if (agent.liveOutput) {
      // Truncate recentEvents to prevent unbounded growth
      let recentEvents = agent.liveOutput.recentEvents;
      if (recentEvents && recentEvents.length > MAX_RECENT_EVENTS_PER_AGENT) {
        recentEvents = recentEvents.slice(-MAX_RECENT_EVENTS_PER_AGENT);
      }

      // Truncate lastChunk (keep tail — most recent output is more useful)
      let lastChunk = agent.liveOutput.lastChunk;
      if (lastChunk.length > MAX_LAST_CHUNK_CHARS) {
        lastChunk = lastChunk.slice(-MAX_LAST_CHUNK_CHARS);
      }

      liveOutputCache.set(cacheKey, {
        ...agent.liveOutput,
        lastChunk,
        recentEvents,
        cachedAt: Date.now(),
      });

      // Evict oldest entries if cache exceeds limit
      if (liveOutputCache.size > MAX_LIVE_OUTPUT_ENTRIES) {
        const firstKey = liveOutputCache.keys().next().value;
        if (firstKey) liveOutputCache.delete(firstKey);
      }
    } else if (agent.status !== "running") {
      liveOutputCache.delete(cacheKey);
    }
  }
}

export async function getAgentStatuses(
  gatewayId: string
): Promise<AgentStatus[]> {
  const results = await query<{
    id: string;
    name: string;
    status: string;
    current_task: string | null;
    session_key: string | null;
    updated_at: string;
  }>(
    `
    SELECT id, name, status, current_task, session_key, updated_at
    FROM agent_statuses
    WHERE gateway_id = $1
    ORDER BY updated_at DESC
  `,
    [gatewayId]
  );

  return results.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status as AgentStatus["status"],
    currentTask: r.current_task || undefined,
    sessionKey: r.session_key || undefined,
    updatedAt: r.updated_at,
  }));
}

export async function getAllAgentStatuses(): Promise<
  Record<string, AgentStatus[]>
> {
  try {
    const results = await query<{
      gateway_id: string;
      id: string;
      name: string;
      status: string;
      current_task: string | null;
      session_key: string | null;
      updated_at: string;
      gateway_connected: boolean;
    }>(
      `
      SELECT
        a.gateway_id, a.id, a.name, a.status, a.current_task, a.session_key, a.updated_at,
        (g.last_heartbeat > NOW() - INTERVAL '30 seconds') AS gateway_connected
      FROM agent_statuses a
      LEFT JOIN gateway_connections g ON g.id = a.gateway_id
      ORDER BY a.gateway_id, a.updated_at DESC
    `,
      []
    );

    dbAvailable = true;
    const grouped: Record<string, AgentStatus[]> = {};

    for (const r of results) {
      if (!grouped[r.gateway_id]) {
        grouped[r.gateway_id] = [];
      }

      const cacheKey = `${r.gateway_id}:${r.id}`;
      const cachedLiveOutput = liveOutputCache.get(cacheKey);

      // If gateway is disconnected and agent was "running", mark as "stale"
      const effectiveStatus =
        !r.gateway_connected && r.status === "running"
          ? "stale"
          : r.status;

      grouped[r.gateway_id].push({
        id: r.id,
        name: r.name,
        status: effectiveStatus as AgentStatus["status"],
        currentTask: r.current_task || undefined,
        sessionKey: r.session_key || undefined,
        updatedAt: r.updated_at,
        ...(cachedLiveOutput ? { liveOutput: (() => { const { cachedAt: _cachedAt, ...rest } = cachedLiveOutput; return rest; })() } : {}),
      });
    }

    return grouped;
  } catch (error) {
    if (isDbConnectionError(error)) {
      dbAvailable = false;
      return {};
    }
    throw error;
  }
}


// Get pending relay commands (not instructions) that are waiting to be picked up
export async function getPendingCommands(
  gatewayId?: string,
  agentId?: string
): Promise<PendingCommand[]> {
  try {
    let queryStr = `
      SELECT
        id,
        gateway_id,
        type,
        payload,
        status,
        created_at,
        ROW_NUMBER() OVER (
          PARTITION BY payload->>'agentId'
          ORDER BY created_at
        ) as position
      FROM relay_commands
      WHERE status = 'pending' AND type != 'instruction'
    `;
    const params: string[] = [];

    if (gatewayId) {
      params.push(gatewayId);
      queryStr += ` AND gateway_id = $${params.length}`;
    }

    if (agentId) {
      params.push(agentId);
      queryStr += ` AND payload->>'agentId' = $${params.length}`;
    }

    queryStr += ` ORDER BY created_at`;

    const results = await query<{
      id: string;
      gateway_id: string;
      type: string;
      payload: Record<string, unknown>;
      status: string;
      created_at: string;
      position: number;
    }>(queryStr, params);

    dbAvailable = true;
    return results.map((r) => ({
      id: r.id,
      gatewayId: r.gateway_id,
      type: r.type,
      payload: r.payload,
      agentId: (r.payload?.agentId as string) || "unknown",
      createdAt: r.created_at,
      position: Number(r.position),
    }));
  } catch (error) {
    if (isDbConnectionError(error)) {
      dbAvailable = false;
      return [];
    }
    throw error;
  }
}

// Queue a follow-up instruction for an agent that's currently busy
export async function queueInstruction(
  gatewayId: string,
  agentId: string,
  instruction: string,
  metadata?: Record<string, unknown>
): Promise<{ id: string; position: number }> {
  try {
    // Insert with a special 'queued' status to distinguish from regular commands
    const result = await queryOne<{
      id: string;
      created_at: string;
    }>(
      `
      INSERT INTO relay_commands (gateway_id, type, payload, status)
      VALUES ($1, 'instruction', $2, 'queued')
      RETURNING id, created_at
    `,
      [
        gatewayId,
        JSON.stringify({
          agentId,
          content: instruction,
          metadata: metadata || {},
        }),
      ]
    );

    if (!result) {
      throw new Error(`Failed to queue instruction for agent ${agentId} on gateway ${gatewayId}`);
    }

    // Get position in queue for this agent
    const positionResult = await queryOne<{ position: number }>(
      `
      SELECT COUNT(*) as position
      FROM relay_commands
      WHERE gateway_id = $1
        AND status = 'queued'
        AND payload->>'agentId' = $2
        AND created_at <= $3
    `,
      [gatewayId, agentId, result.created_at]
    );

    const position = positionResult?.position || 1;

    dbAvailable = true;
    return {
      id: result.id,
      position: Number(position),
    };
  } catch (error) {
    if (isDbConnectionError(error)) {
      dbAvailable = false;
      throw new Error("Database unavailable, cannot queue instruction");
    }
    throw error;
  }
}

// Get queued instructions for an agent or all agents
export async function getPendingInstructions(
  gatewayId?: string,
  agentId?: string
): Promise<QueuedInstruction[]> {
  try {
    let queryStr = `
      SELECT
        id,
        payload,
        created_at,
        ROW_NUMBER() OVER (
          PARTITION BY payload->>'agentId'
          ORDER BY created_at
        ) as position
      FROM relay_commands
      WHERE status = 'queued'
    `;
    const params: (string | undefined)[] = [];

    if (gatewayId) {
      params.push(gatewayId);
      queryStr += ` AND gateway_id = $${params.length}`;
    }

    if (agentId) {
      params.push(agentId);
      queryStr += ` AND payload->>'agentId' = $${params.length}`;
    }

    queryStr += ` ORDER BY created_at`;

    const results = await query<{
      id: string;
      payload: { agentId: string; content: string };
      created_at: string;
      position: number;
    }>(queryStr, params);

    dbAvailable = true;
    return results.map((r) => ({
      id: r.id,
      agentId: r.payload.agentId,
      content: r.payload.content,
      createdAt: r.created_at,
      position: Number(r.position),
    }));
  } catch (error) {
    if (isDbConnectionError(error)) {
      dbAvailable = false;
      return [];
    }
    throw error;
  }
}

// Consume next instruction for an agent (mark as delivered)
export async function consumeInstruction(
  gatewayId: string,
  instructionId: string
): Promise<void> {
  try {
    await query(
      `
      UPDATE relay_commands
      SET status = 'processing'
      WHERE id = $1 AND gateway_id = $2 AND status = 'queued'
    `,
      [instructionId, gatewayId]
    );
    dbAvailable = true;
  } catch (error) {
    if (isDbConnectionError(error)) {
      dbAvailable = false;
      throw new Error("Database unavailable, cannot consume instruction");
    }
    throw error;
  }
}

// Check if an agent is currently busy (has running task)
export async function isAgentBusy(
  gatewayId: string,
  agentId: string
): Promise<boolean> {
  try {
    const result = await queryOne<{ status: string }>(
      `
      SELECT status
      FROM agent_statuses
      WHERE gateway_id = $1 AND id = $2
    `,
      [gatewayId, agentId]
    );

    dbAvailable = true;
    return result?.status === "running";
  } catch (error) {
    if (isDbConnectionError(error)) {
      dbAvailable = false;
      return false; // Assume not busy if DB unavailable
    }
    throw error;
  }
}

// Drain queued instructions for idle agents, returning them as commands
export async function drainQueueForIdleAgents(
  gatewayId: string,
  idleAgentIds: string[]
): Promise<RelayCommand[]> {
  if (idleAgentIds.length === 0) return [];

  const commands: RelayCommand[] = [];
  for (const agentId of idleAgentIds) {
    try {
      // Get oldest queued instruction for this agent
      const instruction = await queryOne<{
        id: string;
        payload: { agentId: string; content: string; metadata?: Record<string, unknown> };
        created_at: string;
      }>(
        `
        UPDATE relay_commands
        SET status = 'processing'
        WHERE id = (
          SELECT id FROM relay_commands
          WHERE type = 'instruction' AND status = 'queued'
            AND gateway_id = $1
            AND payload->>'agentId' = $2
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, payload, created_at
      `,
        [gatewayId, agentId]
      );

      if (instruction) {
        commands.push({
          id: instruction.id,
          type: "spawn",
          payload: {
            agentId,
            task: instruction.payload.content,
            ...((instruction.payload.metadata as Record<string, unknown>) || {}),
          },
          createdAt: instruction.created_at,
          status: "processing",
        });
      }
    } catch (error) {
      console.error(`[relay] Failed to drain instruction queue for agent ${agentId} on gateway ${gatewayId}:`, error);
    }
  }
  return commands;
}

// Link attachments to a command (N:M via command_attachments table)
export async function linkAttachmentsToCommand(
  commandId: string,
  attachmentIds: string[]
): Promise<void> {
  for (const attachmentId of attachmentIds) {
    await query(
      `INSERT INTO command_attachments (command_id, attachment_id)
       VALUES ($1, $2)
       ON CONFLICT (command_id, attachment_id) DO NOTHING`,
      [commandId, attachmentId]
    );
  }
}

// Get attachment ref_keys linked to a command
export async function getCommandAttachments(
  commandId: string
): Promise<Array<{ refKey: string; originalFilename: string; storageKey: string }>> {
  const results = await query<{
    ref_key: string;
    original_filename: string;
    storage_key: string;
  }>(
    `SELECT a.ref_key, a.original_filename, a.storage_key
     FROM command_attachments ca
     JOIN attachments a ON ca.attachment_id = a.id
     WHERE ca.command_id = $1
     ORDER BY ca.created_at`,
    [commandId]
  );
  return results.map((r) => ({
    refKey: r.ref_key,
    originalFilename: r.original_filename,
    storageKey: r.storage_key,
  }));
}

// Get in-memory queue stats
export async function getQueueStats(): Promise<{
  totalCommands: number;
  totalGateways: number;
  liveOutputEntries: number;
}> {
  let totalCommands = 0;
  for (const queue of inMemoryCommands.values()) {
    totalCommands += queue.length;
  }
  return {
    totalCommands,
    totalGateways: inMemoryCommands.size,
    liveOutputEntries: liveOutputCache.size,
  };
}

// Recover stale 'processing' commands from disconnected gateways.
// Commands stuck in 'processing' for >10 minutes on a disconnected gateway
// are marked as 'failed' to prevent orphan accumulation.
export async function recoverStaleProcessingCommands(): Promise<number> {
  try {
    const result = await query<{ id: string }>(
      `UPDATE relay_commands
       SET status = 'failed', result = '"stale_processing_timeout"', completed_at = NOW()
       WHERE status = 'processing'
         AND created_at < NOW() - INTERVAL '10 minutes'
         AND gateway_id IN (
           SELECT id FROM gateway_connections
           WHERE last_heartbeat < NOW() - INTERVAL '30 seconds'
         )
       RETURNING id`,
      []
    );

    if (result.length > 0) {
      console.log(`[relay] Recovered ${result.length} stale processing command(s)`);
    }
    return result.length;
  } catch (error) {
    if (isDbConnectionError(error)) {
      return 0;
    }
    throw error;
  }
}

// Recover agents stuck in 'error' state for too long.
// Agents in error state for >30 minutes are automatically reset to 'idle'.
// This provides server-side cleanup complementing the gateway-connector's
// 5-minute local auto-recovery timer.
export const STALE_ERROR_THRESHOLD_MINUTES = 30;

export async function recoverStaleErrorAgents(): Promise<number> {
  try {
    const result = await query<{ id: string; gateway_id: string }>(
      `UPDATE agent_statuses
       SET status = 'idle', current_task = NULL, updated_at = NOW()
       WHERE status = 'error'
         AND updated_at < NOW() - $1::INTEGER * INTERVAL '1 minute'
       RETURNING id, gateway_id`,
      [STALE_ERROR_THRESHOLD_MINUTES]
    );

    if (result.length > 0) {
      console.log(`[relay] Auto-recovered ${result.length} stale error agent(s): ${result.map(r => r.id).join(", ")}`);
    }
    return result.length;
  } catch (error) {
    if (isDbConnectionError(error)) {
      return 0;
    }
    throw error;
  }
}

// Reset a specific agent's status to idle (for manual reset from dashboard)
export async function resetAgentStatus(
  agentId: string,
  gatewayId?: string
): Promise<boolean> {
  try {
    const params: string[] = [agentId];
    let whereClause = `id = $1`;
    if (gatewayId) {
      params.push(gatewayId);
      whereClause += ` AND gateway_id = $2`;
    }

    const result = await queryOne<{ id: string }>(
      `UPDATE agent_statuses
       SET status = 'idle', current_task = NULL, updated_at = NOW()
       WHERE ${whereClause} AND status IN ('error', 'stale')
       RETURNING id`,
      params
    );

    if (result) {
      console.log(`[relay] Manual reset: agent ${agentId} → idle`);
      // Clear live output cache
      if (gatewayId) {
        liveOutputCache.delete(`${gatewayId}:${agentId}`);
      }
    }
    return result !== null;
  } catch (error) {
    if (isDbConnectionError(error)) {
      return false;
    }
    throw error;
  }
}

// Remove expired commands from in-memory queue
export async function cleanupExpiredCommands(): Promise<void> {
  const now = Date.now();
  for (const [gatewayId, queue] of inMemoryCommands.entries()) {
    const filtered = queue.filter((cmd) => {
      const age = now - new Date(cmd.createdAt).getTime();
      return age < COMMAND_TTL_MS;
    });
    if (filtered.length === 0) {
      inMemoryCommands.delete(gatewayId);
    } else {
      inMemoryCommands.set(gatewayId, filtered);
    }
  }
}

// Get live output cache size for monitoring
export function getLiveOutputCacheSize(): number {
  return liveOutputCache.size;
}

// Remove stale entries from liveOutputCache
export function cleanupStaleLiveOutput(): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of liveOutputCache.entries()) {
    const age = now - new Date(entry.lastActivityAt).getTime();
    if (age > LIVE_OUTPUT_TTL_MS) {
      liveOutputCache.delete(key);
      removed++;
    }
  }
  return removed;
}

// Start periodic cleanup of expired in-memory commands and stale live output
export function startAutoCleanup(intervalMs: number = 60_000): void {
  stopAutoCleanup(); // Clear existing interval if any
  autoCleanupInterval = setInterval(() => {
    // Note: cleanupExpiredCommands is async but we don't await it here
    // In tests with fake timers, this needs to complete synchronously
    void cleanupExpiredCommands();
    cleanupStaleLiveOutput();
  }, intervalMs);
  // Don't block process exit
  if (autoCleanupInterval && typeof autoCleanupInterval === 'object' && 'unref' in autoCleanupInterval) {
    autoCleanupInterval.unref();
  }
}

// Stop periodic cleanup
export function stopAutoCleanup(): void {
  if (autoCleanupInterval) {
    clearInterval(autoCleanupInterval);
    autoCleanupInterval = null;
  }
}

// Clear all in-memory state (for testing)
export function clearAllInMemoryState(): void {
  inMemoryCommands.clear();
  liveOutputCache.clear();
  stopAutoCleanup();
}

// Get live output for a specific agent (for testing and internal use)
export function getLiveOutputForAgent(
  gatewayId: string,
  agentId: string
): {
  lastChunk: string;
  totalChars: number;
  lastActivityAt: string;
  chunksReceived: number;
  recentEvents?: Array<{
    type: "tool_use" | "text" | "health" | "warning" | "stderr";
    timestamp: string;
    tool?: string;
    target?: string;
    content?: string;
  }>;
} | undefined {
  const cacheKey = `${gatewayId}:${agentId}`;
  const entry = liveOutputCache.get(cacheKey);
  if (!entry) return undefined;
  // Return without cachedAt (internal field)
  const { cachedAt: _cachedAt, ...rest } = entry;
  return rest;
}

// Clean up both expired commands and stale liveOutput entries
export async function cleanupAllInMemory(): Promise<{
  commandsRemoved: number;
  liveOutputRemoved: number;
}> {
  // 1. Clean expired commands
  const statsBefore = await getQueueStats();
  await cleanupExpiredCommands();
  const statsAfter = await getQueueStats();
  const commandsRemoved = statsBefore.totalCommands - statsAfter.totalCommands;

  // 2. Clean stale liveOutput entries (TTL-based, consistent with cleanupStaleLiveOutput)
  const now = Date.now();
  let liveOutputRemoved = 0;
  for (const [key, entry] of liveOutputCache.entries()) {
    if (now - new Date(entry.lastActivityAt).getTime() > LIVE_OUTPUT_TTL_MS) {
      liveOutputCache.delete(key);
      liveOutputRemoved++;
    }
  }

  if (commandsRemoved > 0 || liveOutputRemoved > 0) {
    console.log(
      `[relay] Cleanup: ${commandsRemoved} expired commands, ${liveOutputRemoved} stale liveOutput entries removed`
    );
  }

  return { commandsRemoved, liveOutputRemoved };
}

// Estimate worst-case memory usage based on configured limits
export function getMemoryBoundsEstimate(): {
  maxCommands: number;
  maxLiveOutputEntries: number;
  maxRecentEventsPerAgent: number;
  maxLastChunkChars: number;
  estimatedMaxMemoryBytes: number;
  estimatedMaxMemoryMB: number;
} {
  const maxCommands = MAX_COMMANDS_PER_GATEWAY * MAX_GATEWAYS_IN_MEMORY;
  const maxLiveOutputEntries = MAX_LIVE_OUTPUT_ENTRIES;
  const maxRecentEventsPerAgent = MAX_RECENT_EVENTS_PER_AGENT;
  const maxLastChunkChars = MAX_LAST_CHUNK_CHARS;

  // Estimate per-command: ~500 bytes (UUID + type + small payload + timestamps)
  const commandBytes = maxCommands * 500;

  // Estimate per-liveOutput entry:
  //   lastChunk: MAX_LAST_CHUNK_CHARS * 2 (UTF-16)
  //   recentEvents: MAX_RECENT_EVENTS_PER_AGENT * ~200 bytes each
  //   overhead: ~200 bytes
  const perLiveOutputBytes =
    maxLastChunkChars * 2 +
    maxRecentEventsPerAgent * 200 +
    200;
  const liveOutputBytes = maxLiveOutputEntries * perLiveOutputBytes;

  const estimatedMaxMemoryBytes = commandBytes + liveOutputBytes;
  const estimatedMaxMemoryMB = Math.ceil(estimatedMaxMemoryBytes / (1024 * 1024));

  return {
    maxCommands,
    maxLiveOutputEntries,
    maxRecentEventsPerAgent,
    maxLastChunkChars,
    estimatedMaxMemoryBytes,
    estimatedMaxMemoryMB,
  };
}
