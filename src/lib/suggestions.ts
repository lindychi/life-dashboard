/**
 * Suggestions Library
 * PostgreSQL-backed CRUD operations for agent suggestions lifecycle
 */

import { query, queryOne } from "./db";

// ============================================================================
// Types
// ============================================================================

export type SuggestionCategory =
  | "optimization"
  | "bug_fix"
  | "feature"
  | "maintenance"
  | "security"
  | "performance"
  | "data_quality"
  | "other";

export type SuggestionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "failed"
  | "expired";

export type SuggestionUrgency = "low" | "normal" | "high" | "critical";

export type TriggerType =
  | "scheduled"
  | "event_driven"
  | "threshold"
  | "manual"
  | "cascade";

export interface ExecutionPlan {
  steps?: Array<{
    order: number;
    action: string;
    description?: string;
    estimated_duration_seconds?: number;
  }>;
  estimated_total_seconds?: number;
  requires_downtime?: boolean;
  rollback_plan?: string;
  [key: string]: unknown;
}

export interface Suggestion {
  id: string;
  source_agent_id: string;
  category: SuggestionCategory;
  title: string;
  description: string;
  rationale: string | null;
  execution_plan: ExecutionPlan;
  status: SuggestionStatus;
  urgency: SuggestionUrgency;
  priority_score: number;
  trigger_type: TriggerType;
  trigger_context: Record<string, unknown>;
  dedup_key: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  execution_id: string | null;
  completed_at: string | null;
  result_summary: Record<string, unknown> | null;
  error_message: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateSuggestionInput {
  source_agent_id: string;
  category: SuggestionCategory;
  title: string;
  description: string;
  rationale?: string;
  execution_plan?: ExecutionPlan;
  urgency?: SuggestionUrgency;
  priority_score?: number;
  trigger_type?: TriggerType;
  trigger_context?: Record<string, unknown>;
  dedup_key?: string;
  expires_at?: string;
  metadata?: Record<string, unknown>;
}

export interface GetSuggestionsFilters {
  status?: SuggestionStatus | SuggestionStatus[];
  source_agent_id?: string;
  category?: SuggestionCategory;
  urgency?: SuggestionUrgency;
  limit?: number;
  offset?: number;
}

export interface SuggestionStats {
  total: number;
  by_status: Record<SuggestionStatus, number>;
  by_category: Record<SuggestionCategory, number>;
  by_agent: Record<string, number>;
}

// ============================================================================
// CRUD Functions
// ============================================================================

/**
 * Create a new suggestion with optional dedup check.
 * If dedup_key is provided and a pending suggestion with the same key exists,
 * returns the existing suggestion instead of creating a duplicate.
 */
export async function createSuggestion(
  input: CreateSuggestionInput
): Promise<Suggestion> {
  const {
    source_agent_id,
    category,
    title,
    description,
    rationale = null,
    execution_plan = {},
    urgency = "normal",
    priority_score = 0.5,
    trigger_type = "scheduled",
    trigger_context = {},
    dedup_key = null,
    expires_at = null,
    metadata = {},
  } = input;

  // Dedup check: if dedup_key provided, return existing pending suggestion
  if (dedup_key) {
    const existing = await queryOne<Suggestion>(
      `SELECT * FROM agent_suggestions
       WHERE dedup_key = $1 AND status = 'pending'
       LIMIT 1`,
      [dedup_key]
    );
    if (existing) {
      return existing;
    }
  }

  const result = await queryOne<Suggestion>(
    `INSERT INTO agent_suggestions (
       source_agent_id, category, title, description, rationale,
       execution_plan, urgency, priority_score, trigger_type,
       trigger_context, dedup_key, expires_at, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      source_agent_id,
      category,
      title,
      description,
      rationale,
      JSON.stringify(execution_plan),
      urgency,
      priority_score,
      trigger_type,
      JSON.stringify(trigger_context),
      dedup_key,
      expires_at,
      JSON.stringify(metadata),
    ]
  );

  if (!result) {
    throw new Error("Failed to create suggestion");
  }

  return result;
}

/**
 * Get suggestions with optional filters.
 */
export async function getSuggestions(
  filters: GetSuggestionsFilters = {}
): Promise<Suggestion[]> {
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

  if (filters.source_agent_id !== undefined) {
    conditions.push(`source_agent_id = $${paramIndex++}`);
    values.push(filters.source_agent_id);
  }

  if (filters.category !== undefined) {
    conditions.push(`category = $${paramIndex++}`);
    values.push(filters.category);
  }

  if (filters.urgency !== undefined) {
    conditions.push(`urgency = $${paramIndex++}`);
    values.push(filters.urgency);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  return query<Suggestion>(
    `SELECT * FROM agent_suggestions
     ${where}
     ORDER BY priority_score DESC, created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...values, limit, offset]
  );
}

/**
 * Get pending suggestions sorted by priority_score DESC.
 */
export async function getPendingSuggestions(limit = 20): Promise<Suggestion[]> {
  return query<Suggestion>(
    `SELECT * FROM agent_suggestions
     WHERE status = 'pending'
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY priority_score DESC, created_at DESC
     LIMIT $1`,
    [limit]
  );
}

/**
 * Get a single suggestion by ID.
 */
export async function getSuggestion(id: string): Promise<Suggestion | null> {
  const result = await queryOne<Suggestion>(
    `SELECT * FROM agent_suggestions WHERE id = $1`,
    [id]
  );
  return result || null;
}

/**
 * Approve a suggestion (status → 'approved').
 */
export async function approveSuggestion(
  id: string,
  approvedBy: string
): Promise<Suggestion | null> {
  const result = await queryOne<Suggestion>(
    `UPDATE agent_suggestions
     SET status = 'approved', approved_by = $2, approved_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [id, approvedBy]
  );
  return result || null;
}

/**
 * Reject a suggestion (status → 'rejected').
 */
export async function rejectSuggestion(
  id: string,
  reason?: string
): Promise<Suggestion | null> {
  const result = await queryOne<Suggestion>(
    `UPDATE agent_suggestions
     SET status = 'rejected', rejected_at = NOW(), rejection_reason = $2
     WHERE id = $1 AND status IN ('pending', 'approved')
     RETURNING *`,
    [id, reason ?? null]
  );
  return result || null;
}

/**
 * Mark a suggestion as executing and link the execution ID.
 */
export async function executeSuggestion(
  id: string,
  executionId: string
): Promise<Suggestion | null> {
  const result = await queryOne<Suggestion>(
    `UPDATE agent_suggestions
     SET status = 'executing', execution_id = $2
     WHERE id = $1 AND status = 'approved'
     RETURNING *`,
    [id, executionId]
  );
  return result || null;
}

/**
 * Mark a suggestion as completed with optional result summary.
 */
export async function completeSuggestion(
  id: string,
  result?: Record<string, unknown>
): Promise<Suggestion | null> {
  const updated = await queryOne<Suggestion>(
    `UPDATE agent_suggestions
     SET status = 'completed', completed_at = NOW(), result_summary = $2
     WHERE id = $1 AND status = 'executing'
     RETURNING *`,
    [id, result ? JSON.stringify(result) : null]
  );
  return updated || null;
}

/**
 * Mark a suggestion as failed with an error message.
 */
export async function failSuggestion(
  id: string,
  error: string
): Promise<Suggestion | null> {
  const result = await queryOne<Suggestion>(
    `UPDATE agent_suggestions
     SET status = 'failed', error_message = $2
     WHERE id = $1 AND status IN ('approved', 'executing')
     RETURNING *`,
    [id, error]
  );
  return result || null;
}

/**
 * Bulk-expire all pending suggestions whose expires_at is in the past.
 * Returns the number of suggestions expired.
 */
export async function expireOldSuggestions(): Promise<number> {
  const rows = await query<{ count: string }>(
    `UPDATE agent_suggestions
     SET status = 'expired'
     WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= NOW()
     RETURNING 1 AS count`
  );
  return rows.length;
}

/**
 * Get aggregated suggestion counts by status, category, and source agent.
 */
export async function getSuggestionStats(): Promise<SuggestionStats> {
  const [totalRow, byStatus, byCategory, byAgent] = await Promise.all([
    queryOne<{ total: string }>(
      `SELECT COUNT(*) AS total FROM agent_suggestions`
    ),
    query<{ status: SuggestionStatus; count: string }>(
      `SELECT status, COUNT(*) AS count FROM agent_suggestions GROUP BY status`
    ),
    query<{ category: SuggestionCategory; count: string }>(
      `SELECT category, COUNT(*) AS count FROM agent_suggestions GROUP BY category`
    ),
    query<{ source_agent_id: string; count: string }>(
      `SELECT source_agent_id, COUNT(*) AS count FROM agent_suggestions GROUP BY source_agent_id ORDER BY count DESC`
    ),
  ]);

  const statusMap = {} as Record<SuggestionStatus, number>;
  for (const row of byStatus) {
    statusMap[row.status] = parseInt(row.count, 10);
  }

  const categoryMap = {} as Record<SuggestionCategory, number>;
  for (const row of byCategory) {
    categoryMap[row.category] = parseInt(row.count, 10);
  }

  const agentMap: Record<string, number> = {};
  for (const row of byAgent) {
    agentMap[row.source_agent_id] = parseInt(row.count, 10);
  }

  return {
    total: parseInt(totalRow?.total ?? "0", 10),
    by_status: statusMap,
    by_category: categoryMap,
    by_agent: agentMap,
  };
}
