/**
 * Permission Approval Data Access Layer
 *
 * Manages approval requests for sensitive file operations.
 */

import { query, queryOne } from "./db";
import type {
  ApprovalRequest,
  CreateApprovalRequest,
  ApprovalStatus,
  PermissionAction,
} from "./permissions";
import { getApprovalExpiration } from "./permissions";

// ─── Create Approval Request ──────────────────────────────

export async function createApprovalRequest(
  params: CreateApprovalRequest,
  timeoutMs?: number
): Promise<ApprovalRequest> {
  const expiresAt = getApprovalExpiration(timeoutMs);

  const result = await queryOne<{
    id: string;
    agent_id: string;
    gateway_id: string;
    command_id: string;
    path: string;
    action: string;
    reason: string;
    status: string;
    requested_at: string;
    responded_at: string | null;
    responded_by: string | null;
    expires_at: string;
    metadata: Record<string, unknown>;
  }>(
    `INSERT INTO permission_approvals (agent_id, gateway_id, command_id, path, action, reason, expires_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, agent_id, gateway_id, command_id, path, action, reason, status,
               requested_at, responded_at, responded_by, expires_at, metadata`,
    [
      params.agentId,
      params.gatewayId,
      params.commandId,
      params.path,
      params.action,
      params.reason,
      expiresAt,
      JSON.stringify(params.metadata || {}),
    ]
  );

  if (!result) {
    throw new Error("Failed to create approval request");
  }

  return {
    id: result.id,
    agentId: result.agent_id,
    gatewayId: result.gateway_id,
    commandId: result.command_id,
    path: result.path,
    action: result.action as PermissionAction,
    reason: result.reason,
    status: result.status as ApprovalStatus,
    requestedAt: result.requested_at,
    respondedAt: result.responded_at || undefined,
    respondedBy: result.responded_by || undefined,
    expiresAt: result.expires_at,
    metadata: result.metadata,
  };
}

// ─── Get Approval Request ─────────────────────────────────

export async function getApprovalRequest(id: string): Promise<ApprovalRequest | null> {
  const result = await queryOne<{
    id: string;
    agent_id: string;
    gateway_id: string;
    command_id: string;
    path: string;
    action: string;
    reason: string;
    status: string;
    requested_at: string;
    responded_at: string | null;
    responded_by: string | null;
    expires_at: string;
    metadata: Record<string, unknown>;
  }>(
    `SELECT id, agent_id, gateway_id, command_id, path, action, reason, status,
            requested_at, responded_at, responded_by, expires_at, metadata
     FROM permission_approvals
     WHERE id = $1`,
    [id]
  );

  if (!result) return null;

  return {
    id: result.id,
    agentId: result.agent_id,
    gatewayId: result.gateway_id,
    commandId: result.command_id,
    path: result.path,
    action: result.action as PermissionAction,
    reason: result.reason,
    status: result.status as ApprovalStatus,
    requestedAt: result.requested_at,
    respondedAt: result.responded_at || undefined,
    respondedBy: result.responded_by || undefined,
    expiresAt: result.expires_at,
    metadata: result.metadata,
  };
}

// ─── Update Approval Status ───────────────────────────────

export async function respondToApproval(
  id: string,
  status: "approved" | "denied",
  respondedBy: string
): Promise<ApprovalRequest | null> {
  const result = await queryOne<{
    id: string;
    agent_id: string;
    gateway_id: string;
    command_id: string;
    path: string;
    action: string;
    reason: string;
    status: string;
    requested_at: string;
    responded_at: string | null;
    responded_by: string | null;
    expires_at: string;
    metadata: Record<string, unknown>;
  }>(
    `UPDATE permission_approvals
     SET status = $2, responded_at = NOW(), responded_by = $3
     WHERE id = $1 AND status = 'pending'
     RETURNING id, agent_id, gateway_id, command_id, path, action, reason, status,
               requested_at, responded_at, responded_by, expires_at, metadata`,
    [id, status, respondedBy]
  );

  if (!result) return null;

  return {
    id: result.id,
    agentId: result.agent_id,
    gatewayId: result.gateway_id,
    commandId: result.command_id,
    path: result.path,
    action: result.action as PermissionAction,
    reason: result.reason,
    status: result.status as ApprovalStatus,
    requestedAt: result.requested_at,
    respondedAt: result.responded_at || undefined,
    respondedBy: result.responded_by || undefined,
    expiresAt: result.expires_at,
    metadata: result.metadata,
  };
}

// ─── List Pending Approvals ───────────────────────────────

export async function getPendingApprovals(
  gatewayId?: string
): Promise<ApprovalRequest[]> {
  const params: string[] = [];
  let whereClause = "WHERE status = 'pending' AND expires_at > NOW()";

  if (gatewayId) {
    params.push(gatewayId);
    whereClause += ` AND gateway_id = $${params.length}`;
  }

  const results = await query<{
    id: string;
    agent_id: string;
    gateway_id: string;
    command_id: string;
    path: string;
    action: string;
    reason: string;
    status: string;
    requested_at: string;
    responded_at: string | null;
    responded_by: string | null;
    expires_at: string;
    metadata: Record<string, unknown>;
  }>(
    `SELECT id, agent_id, gateway_id, command_id, path, action, reason, status,
            requested_at, responded_at, responded_by, expires_at, metadata
     FROM permission_approvals
     ${whereClause}
     ORDER BY requested_at ASC`,
    params
  );

  return results.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    gatewayId: r.gateway_id,
    commandId: r.command_id,
    path: r.path,
    action: r.action as PermissionAction,
    reason: r.reason,
    status: r.status as ApprovalStatus,
    requestedAt: r.requested_at,
    respondedAt: r.responded_at || undefined,
    respondedBy: r.responded_by || undefined,
    expiresAt: r.expires_at,
    metadata: r.metadata,
  }));
}

// ─── Get Approval History ─────────────────────────────────

export async function getApprovalHistory(
  filters?: {
    agentId?: string;
    gatewayId?: string;
    status?: ApprovalStatus;
    limit?: number;
  }
): Promise<ApprovalRequest[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters?.agentId) {
    conditions.push(`agent_id = $${paramIdx++}`);
    params.push(filters.agentId);
  }

  if (filters?.gatewayId) {
    conditions.push(`gateway_id = $${paramIdx++}`);
    params.push(filters.gatewayId);
  }

  if (filters?.status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(filters.status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters?.limit || 100;

  const results = await query<{
    id: string;
    agent_id: string;
    gateway_id: string;
    command_id: string;
    path: string;
    action: string;
    reason: string;
    status: string;
    requested_at: string;
    responded_at: string | null;
    responded_by: string | null;
    expires_at: string;
    metadata: Record<string, unknown>;
  }>(
    `SELECT id, agent_id, gateway_id, command_id, path, action, reason, status,
            requested_at, responded_at, responded_by, expires_at, metadata
     FROM permission_approvals
     ${whereClause}
     ORDER BY requested_at DESC
     LIMIT $${paramIdx}`,
    [...params, limit]
  );

  return results.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    gatewayId: r.gateway_id,
    commandId: r.command_id,
    path: r.path,
    action: r.action as PermissionAction,
    reason: r.reason,
    status: r.status as ApprovalStatus,
    requestedAt: r.requested_at,
    respondedAt: r.responded_at || undefined,
    respondedBy: r.responded_by || undefined,
    expiresAt: r.expires_at,
    metadata: r.metadata,
  }));
}

// ─── Expire Pending Approvals ─────────────────────────────

export async function expirePendingApprovals(): Promise<number> {
  const result = await queryOne<{ count: number }>(
    `SELECT expire_pending_approvals() as count`
  );

  return result?.count || 0;
}

// ─── Wait for Approval ────────────────────────────────────

/**
 * Poll for approval decision with timeout
 * Returns true if approved, false if denied/expired
 */
export async function waitForApproval(
  approvalId: string,
  options?: {
    pollIntervalMs?: number;
    timeoutMs?: number;
  }
): Promise<{ approved: boolean; status: ApprovalStatus }> {
  const pollInterval = options?.pollIntervalMs || 2000; // 2 seconds
  const timeout = options?.timeoutMs || 5 * 60 * 1000; // 5 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const approval = await getApprovalRequest(approvalId);

    if (!approval) {
      return { approved: false, status: "expired" };
    }

    if (approval.status === "approved") {
      return { approved: true, status: "approved" };
    }

    if (approval.status === "denied") {
      return { approved: false, status: "denied" };
    }

    if (approval.status === "expired") {
      return { approved: false, status: "expired" };
    }

    // Still pending, wait and retry
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timeout reached
  return { approved: false, status: "expired" };
}
