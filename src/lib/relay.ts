// PostgreSQL-backed relay system

import { query, queryOne } from "./db";

export interface GatewayConnection {
  id: string;
  connectedAt: string;
  lastHeartbeat: string;
  status: "connected" | "disconnected";
}

export interface RelayCommand {
  id: string;
  type: "spawn" | "send" | "status" | "message";
  payload: Record<string, unknown>;
  createdAt: string;
  status: "pending" | "processing" | "completed" | "failed";
  result?: unknown;
}

export interface AgentStatus {
  id: string;
  name: string;
  status: "running" | "idle" | "waiting" | "error";
  currentTask?: string;
  sessionKey?: string;
  updatedAt: string;
}

const RELAY_API_KEY = process.env.RELAY_API_KEY || "dev-relay-key";

export function validateRelayKey(key: string): boolean {
  return key === RELAY_API_KEY;
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
    throw new Error("Failed to register gateway");
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

  return results.map((r) => ({
    id: r.id,
    connectedAt: r.connected_at,
    lastHeartbeat: r.last_heartbeat,
    status: r.status as "connected" | "disconnected",
  }));
}

export async function queueCommand(
  gatewayId: string,
  command: Omit<RelayCommand, "id" | "createdAt" | "status">
): Promise<RelayCommand> {
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
    throw new Error("Failed to queue command");
  }

  return {
    id: result.id,
    type: result.type as RelayCommand["type"],
    payload: result.payload,
    createdAt: result.created_at,
    status: result.status as RelayCommand["status"],
    result: result.result,
  };
}

export async function getAndClearCommands(
  gatewayId: string
): Promise<RelayCommand[]> {
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

  return results.map((r) => ({
    id: r.id,
    type: r.type as RelayCommand["type"],
    payload: r.payload,
    createdAt: r.created_at,
    status: r.status as RelayCommand["status"],
    result: r.result,
  }));
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
  agents: Omit<AgentStatus, "updatedAt">[]
): Promise<void> {
  // Use UPSERT for each agent
  for (const agent of agents) {
    await query(
      `
      INSERT INTO agent_statuses (id, gateway_id, name, status, current_task, session_key, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (id, gateway_id) DO UPDATE
      SET name = $3, status = $4, current_task = $5, session_key = $6, updated_at = NOW()
    `,
      [
        agent.id,
        gatewayId,
        agent.name,
        agent.status,
        agent.currentTask || null,
        agent.sessionKey || null,
      ]
    );
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
  const results = await query<{
    gateway_id: string;
    id: string;
    name: string;
    status: string;
    current_task: string | null;
    session_key: string | null;
    updated_at: string;
  }>(
    `
    SELECT gateway_id, id, name, status, current_task, session_key, updated_at
    FROM agent_statuses
    ORDER BY gateway_id, updated_at DESC
  `,
    []
  );

  const grouped: Record<string, AgentStatus[]> = {};

  for (const r of results) {
    if (!grouped[r.gateway_id]) {
      grouped[r.gateway_id] = [];
    }

    grouped[r.gateway_id].push({
      id: r.id,
      name: r.name,
      status: r.status as AgentStatus["status"],
      currentTask: r.current_task || undefined,
      sessionKey: r.session_key || undefined,
      updatedAt: r.updated_at,
    });
  }

  return grouped;
}
