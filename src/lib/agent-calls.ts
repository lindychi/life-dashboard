/**
 * Agent Calls Library
 * PostgreSQL-backed CRUD operations for inter-agent call tracking,
 * cycle detection, depth limiting, and permission enforcement.
 */

import { query, queryOne } from "./db";

// ============================================================================
// Types
// ============================================================================

export type AgentCallType =
  | "task"
  | "query"
  | "notification"
  | "delegation"
  | "coordination";

export type AgentCallStatus =
  | "pending"
  | "approved"
  | "denied"
  | "executing"
  | "completed"
  | "failed"
  | "timeout";

export type PermissionStatus =
  | "auto_approved"
  | "awaiting_user"
  | "user_approved"
  | "user_denied"
  | "denied_by_policy";

export type CallPermission = "auto_approve" | "ask_user" | "deny";

export interface AgentCall {
  id: string;
  caller_agent_id: string;
  callee_agent_id: string;
  call_type: AgentCallType;
  call_chain: string[];
  depth: number;
  parent_call_id: string | null;
  status: AgentCallStatus;
  permission_status: PermissionStatus;
  request_payload: Record<string, unknown>;
  response_payload: Record<string, unknown> | null;
  command_id: string | null;
  error_message: string | null;
  timeout_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CallPermissionRecord {
  id: string;
  caller_agent_id: string;
  callee_agent_id: string;
  permission: CallPermission;
  max_depth: number;
  rate_limit_per_hour: number | null;
  allowed_call_types: string[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentCallInput {
  caller_agent_id: string;
  callee_agent_id: string;
  call_type: AgentCallType;
  request_payload: Record<string, unknown>;
  parent_call_id?: string;
  call_chain?: string[];
  timeout_seconds?: number;
  metadata?: Record<string, unknown>;
}

export interface GetAgentCallsFilters {
  status?: AgentCallStatus | AgentCallStatus[];
  caller_agent_id?: string;
  callee_agent_id?: string;
  limit?: number;
  offset?: number;
}

export interface UpdateCallPermissionInput {
  permission: CallPermission;
  max_depth?: number;
  rate_limit_per_hour?: number | null;
  allowed_call_types?: string[] | null;
  notes?: string;
}

// Max call chain depth guard (hard limit regardless of per-permission setting)
const ABSOLUTE_MAX_DEPTH = 10;

// ============================================================================
// Helper: permission and rate-limit checks
// ============================================================================

/**
 * Look up the permission record for a caller→callee pair.
 * Returns null if no explicit record exists (defaults to 'ask_user').
 */
export async function checkCallPermission(
  callerId: string,
  calleeId: string
): Promise<CallPermissionRecord | null> {
  const result = await queryOne<CallPermissionRecord>(
    `SELECT * FROM agent_call_permissions
     WHERE caller_agent_id = $1 AND callee_agent_id = $2`,
    [callerId, calleeId]
  );
  return result || null;
}

/**
 * Count calls made by callerId to calleeId in the last hour (for rate limiting).
 */
async function countCallsLastHour(
  callerId: string,
  calleeId: string
): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count FROM agent_calls
     WHERE caller_agent_id = $1
       AND callee_agent_id = $2
       AND created_at > NOW() - INTERVAL '1 hour'`,
    [callerId, calleeId]
  );
  return parseInt(row?.count ?? "0", 10);
}

// ============================================================================
// Core CRUD
// ============================================================================

/**
 * Create an inter-agent call record.
 * Performs cycle detection, depth check, permission lookup, and rate-limit check.
 * Throws on policy violations so callers can handle them explicitly.
 */
export async function createAgentCall(
  input: CreateAgentCallInput
): Promise<AgentCall> {
  const {
    caller_agent_id,
    callee_agent_id,
    call_type,
    request_payload,
    parent_call_id = null,
    call_chain: providedChain,
    timeout_seconds,
    metadata = {},
  } = input;

  // Build call_chain from parent if not provided
  let call_chain: string[] = providedChain ?? [];
  let depth = call_chain.length;

  if (parent_call_id && call_chain.length === 0) {
    const parent = await getAgentCall(parent_call_id);
    if (parent) {
      call_chain = [...parent.call_chain, parent.caller_agent_id];
      depth = parent.depth + 1;
    }
  }

  // Cycle detection: callee must not already appear in the call chain
  if (call_chain.includes(callee_agent_id)) {
    throw new Error(
      `Cycle detected: ${callee_agent_id} already in call chain [${call_chain.join(" → ")}]`
    );
  }

  // Absolute depth guard
  if (depth >= ABSOLUTE_MAX_DEPTH) {
    throw new Error(
      `Max call depth ${ABSOLUTE_MAX_DEPTH} exceeded (current depth: ${depth})`
    );
  }

  // Permission lookup
  const permRecord = await checkCallPermission(caller_agent_id, callee_agent_id);
  const effectivePermission: CallPermission = permRecord?.permission ?? "ask_user";

  if (effectivePermission === "deny") {
    throw new Error(
      `Call denied by policy: ${caller_agent_id} → ${callee_agent_id}`
    );
  }

  // Per-permission max_depth check
  if (permRecord && depth >= permRecord.max_depth) {
    throw new Error(
      `Max depth ${permRecord.max_depth} for ${caller_agent_id} → ${callee_agent_id} exceeded`
    );
  }

  // Call-type restriction check
  if (
    permRecord?.allowed_call_types &&
    permRecord.allowed_call_types.length > 0 &&
    !permRecord.allowed_call_types.includes(call_type)
  ) {
    throw new Error(
      `Call type '${call_type}' not allowed for ${caller_agent_id} → ${callee_agent_id}`
    );
  }

  // Rate limit check
  if (permRecord?.rate_limit_per_hour != null) {
    const recent = await countCallsLastHour(caller_agent_id, callee_agent_id);
    if (recent >= permRecord.rate_limit_per_hour) {
      throw new Error(
        `Rate limit exceeded: ${caller_agent_id} → ${callee_agent_id} (${recent}/${permRecord.rate_limit_per_hour} per hour)`
      );
    }
  }

  // Map permission to initial permission_status and status
  const permission_status: PermissionStatus =
    effectivePermission === "auto_approve" ? "auto_approved" : "awaiting_user";
  const status: AgentCallStatus =
    effectivePermission === "auto_approve" ? "approved" : "pending";

  const timeout_at = timeout_seconds
    ? new Date(Date.now() + timeout_seconds * 1000).toISOString()
    : null;

  const result = await queryOne<AgentCall>(
    `INSERT INTO agent_calls (
       caller_agent_id, callee_agent_id, call_type, call_chain, depth,
       parent_call_id, status, permission_status, request_payload,
       timeout_at, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      caller_agent_id,
      callee_agent_id,
      call_type,
      call_chain,
      depth,
      parent_call_id,
      status,
      permission_status,
      JSON.stringify(request_payload),
      timeout_at,
      JSON.stringify(metadata),
    ]
  );

  if (!result) {
    throw new Error("Failed to create agent call record");
  }

  return result;
}

/**
 * Get agent calls with optional filters.
 */
export async function getAgentCalls(
  filters: GetAgentCallsFilters = {}
): Promise<AgentCall[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (filters.status !== undefined) {
    if (Array.isArray(filters.status)) {
      conditions.push(`status = ANY($${paramIndex++})`);
      values.push(filters.status);
    } else {
      conditions.push(`status = $${paramIndex++}`);
      values.push(filters.status);
    }
  }

  if (filters.caller_agent_id !== undefined) {
    conditions.push(`caller_agent_id = $${paramIndex++}`);
    values.push(filters.caller_agent_id);
  }

  if (filters.callee_agent_id !== undefined) {
    conditions.push(`callee_agent_id = $${paramIndex++}`);
    values.push(filters.callee_agent_id);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  return query<AgentCall>(
    `SELECT * FROM agent_calls
     ${where}
     ORDER BY created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...values, limit, offset]
  );
}

/**
 * Get a single agent call by ID.
 */
export async function getAgentCall(id: string): Promise<AgentCall | null> {
  const result = await queryOne<AgentCall>(
    `SELECT * FROM agent_calls WHERE id = $1`,
    [id]
  );
  return result || null;
}

/**
 * Approve a pending call (user approval).
 * Sets permission_status → 'user_approved', status → 'approved'.
 */
export async function approveAgentCall(id: string): Promise<AgentCall | null> {
  const result = await queryOne<AgentCall>(
    `UPDATE agent_calls
     SET permission_status = 'user_approved', status = 'approved'
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [id]
  );
  return result || null;
}

/**
 * Deny a pending call.
 * Sets permission_status → 'user_denied', status → 'denied'.
 */
export async function denyAgentCall(id: string): Promise<AgentCall | null> {
  const result = await queryOne<AgentCall>(
    `UPDATE agent_calls
     SET permission_status = 'user_denied', status = 'denied'
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [id]
  );
  return result || null;
}

/**
 * Mark a call as executing and link the command ID.
 */
export async function executeAgentCall(
  id: string,
  commandId: string
): Promise<AgentCall | null> {
  const result = await queryOne<AgentCall>(
    `UPDATE agent_calls
     SET status = 'executing', command_id = $2
     WHERE id = $1 AND status = 'approved'
     RETURNING *`,
    [id, commandId]
  );
  return result || null;
}

/**
 * Mark a call as completed with the response payload.
 */
export async function completeAgentCall(
  id: string,
  response: Record<string, unknown>
): Promise<AgentCall | null> {
  const result = await queryOne<AgentCall>(
    `UPDATE agent_calls
     SET status = 'completed', response_payload = $2, completed_at = NOW()
     WHERE id = $1 AND status = 'executing'
     RETURNING *`,
    [id, JSON.stringify(response)]
  );
  return result || null;
}

/**
 * Mark a call as failed with an error message.
 */
export async function failAgentCall(
  id: string,
  error: string
): Promise<AgentCall | null> {
  const result = await queryOne<AgentCall>(
    `UPDATE agent_calls
     SET status = 'failed', error_message = $2
     WHERE id = $1 AND status IN ('approved', 'executing')
     RETURNING *`,
    [id, error]
  );
  return result || null;
}

/**
 * Reconstruct the full call chain from a parent call ID upward.
 * Returns calls ordered from root to leaf.
 */
export async function getCallChain(parentCallId: string): Promise<AgentCall[]> {
  // Use a recursive CTE to walk up the chain
  const rows = await query<AgentCall>(
    `WITH RECURSIVE chain AS (
       SELECT * FROM agent_calls WHERE id = $1
       UNION ALL
       SELECT ac.* FROM agent_calls ac
       INNER JOIN chain c ON ac.id = c.parent_call_id
     )
     SELECT * FROM chain ORDER BY depth ASC`,
    [parentCallId]
  );
  return rows;
}

/**
 * Bulk-timeout pending/executing calls whose timeout_at has passed.
 * Returns the number of calls timed out.
 */
export async function expireTimedOutCalls(): Promise<number> {
  const rows = await query<{ count: string }>(
    `UPDATE agent_calls
     SET status = 'timeout'
     WHERE status IN ('pending', 'executing')
       AND timeout_at IS NOT NULL
       AND timeout_at <= NOW()
     RETURNING 1 AS count`
  );
  return rows.length;
}

// ============================================================================
// Permission Management
// ============================================================================

/**
 * List all call permission records.
 */
export async function getCallPermissions(): Promise<CallPermissionRecord[]> {
  return query<CallPermissionRecord>(
    `SELECT * FROM agent_call_permissions
     ORDER BY caller_agent_id, callee_agent_id`
  );
}

/**
 * Upsert a call permission record for a caller→callee pair.
 */
export async function updateCallPermission(
  callerId: string,
  calleeId: string,
  input: UpdateCallPermissionInput
): Promise<CallPermissionRecord> {
  const { permission, max_depth = 3, rate_limit_per_hour = null, allowed_call_types = null, notes } = input;

  const result = await queryOne<CallPermissionRecord>(
    `INSERT INTO agent_call_permissions (
       caller_agent_id, callee_agent_id, permission, max_depth,
       rate_limit_per_hour, allowed_call_types, notes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (caller_agent_id, callee_agent_id)
     DO UPDATE SET
       permission           = EXCLUDED.permission,
       max_depth            = EXCLUDED.max_depth,
       rate_limit_per_hour  = EXCLUDED.rate_limit_per_hour,
       allowed_call_types   = EXCLUDED.allowed_call_types,
       notes                = EXCLUDED.notes,
       updated_at           = NOW()
     RETURNING *`,
    [callerId, calleeId, permission, max_depth, rate_limit_per_hour, allowed_call_types, notes ?? null]
  );

  if (!result) {
    throw new Error("Failed to upsert call permission");
  }

  return result;
}
