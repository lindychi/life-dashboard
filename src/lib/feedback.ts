/**
 * Feedback Library
 * PostgreSQL-backed CRUD operations for task feedback, learned preferences,
 * and improvement actions.
 */

import { query, queryOne } from "./db";

// ─── Types ───────────────────────────────────────────────────────────

export interface TaskFeedback {
  id: string;
  taskExecutionId?: string;
  commandId?: string;
  historyEntryId?: string;
  ratedBy: string;
  overallRating: number;
  categories: Record<string, number>;
  comment?: string;
  tags: string[];
  agentId: string;
  taskType?: string;
  modelUsed?: string;
  taskCategory?: string;
  createdAt: string;
}

export interface LearnedPreference {
  id: string;
  scope: string;
  preferenceKey: string;
  preferenceValue: Record<string, unknown>;
  derivedFrom: string[];
  confidence: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImprovementAction {
  id: string;
  reportId?: string;
  feedbackIds: string[];
  actionType: string;
  description: string;
  beforeValue?: Record<string, unknown>;
  afterValue?: Record<string, unknown>;
  status: string;
  approvedBy?: string;
  approvedAt?: string;
  appliedAt?: string;
  impactMetrics?: Record<string, unknown>;
  createdAt: string;
}

export interface FeedbackSummary {
  totalCount: number;
  avgRating: number;
  avgAccuracy: number | null;
  avgCompleteness: number | null;
  avgSpeed: number | null;
  avgStyle: number | null;
  avgUsefulness: number | null;
  positiveCount: number;
  negativeCount: number;
}

export interface FeedbackTrend {
  week: string;
  count: number;
  avgRating: number;
}

// ─── DB row types (snake_case) ───────────────────────────────────────

interface TaskFeedbackRow {
  id: string;
  task_execution_id: string | null;
  command_id: string | null;
  history_entry_id: string | null;
  rated_by: string;
  overall_rating: number;
  categories: Record<string, number>;
  comment: string | null;
  tags: string[];
  agent_id: string;
  task_type: string | null;
  model_used: string | null;
  task_category: string | null;
  created_at: string;
}

interface LearnedPreferenceRow {
  id: string;
  scope: string;
  preference_key: string;
  preference_value: Record<string, unknown>;
  derived_from: string[];
  confidence: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ImprovementActionRow {
  id: string;
  report_id: string | null;
  feedback_ids: string[];
  action_type: string;
  description: string;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  applied_at: string | null;
  impact_metrics: Record<string, unknown> | null;
  created_at: string;
}

interface FeedbackSummaryRow {
  total_count: string;
  avg_rating: string | null;
  avg_accuracy: string | null;
  avg_completeness: string | null;
  avg_speed: string | null;
  avg_style: string | null;
  avg_usefulness: string | null;
  positive_count: string;
  negative_count: string;
}

interface FeedbackTrendRow {
  week: string;
  count: string;
  avg_rating: string;
}

// ─── Row mappers ─────────────────────────────────────────────────────

function mapFeedbackRow(row: TaskFeedbackRow): TaskFeedback {
  return {
    id: row.id,
    taskExecutionId: row.task_execution_id || undefined,
    commandId: row.command_id || undefined,
    historyEntryId: row.history_entry_id || undefined,
    ratedBy: row.rated_by,
    overallRating: row.overall_rating,
    categories: row.categories,
    comment: row.comment || undefined,
    tags: row.tags || [],
    agentId: row.agent_id,
    taskType: row.task_type || undefined,
    modelUsed: row.model_used || undefined,
    taskCategory: row.task_category || undefined,
    createdAt: row.created_at,
  };
}

function mapPreferenceRow(row: LearnedPreferenceRow): LearnedPreference {
  return {
    id: row.id,
    scope: row.scope,
    preferenceKey: row.preference_key,
    preferenceValue: row.preference_value,
    derivedFrom: row.derived_from || [],
    confidence: row.confidence,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapImprovementRow(row: ImprovementActionRow): ImprovementAction {
  return {
    id: row.id,
    reportId: row.report_id || undefined,
    feedbackIds: row.feedback_ids || [],
    actionType: row.action_type,
    description: row.description,
    beforeValue: row.before_value || undefined,
    afterValue: row.after_value || undefined,
    status: row.status,
    approvedBy: row.approved_by || undefined,
    approvedAt: row.approved_at || undefined,
    appliedAt: row.applied_at || undefined,
    impactMetrics: row.impact_metrics || undefined,
    createdAt: row.created_at,
  };
}

// ─── Feedback CRUD ───────────────────────────────────────────────────

export interface SubmitFeedbackInput {
  taskExecutionId?: string;
  commandId?: string;
  historyEntryId?: string;
  ratedBy?: string;
  overallRating: number;
  categories?: Record<string, number>;
  comment?: string;
  tags?: string[];
  agentId: string;
  taskType?: string;
  modelUsed?: string;
  taskCategory?: string;
}

/**
 * Submit feedback for a task
 */
export async function submitFeedback(
  input: SubmitFeedbackInput
): Promise<TaskFeedback> {
  const row = await queryOne<TaskFeedbackRow>(
    `INSERT INTO task_feedback
       (task_execution_id, command_id, history_entry_id, rated_by,
        overall_rating, categories, comment, tags, agent_id,
        task_type, model_used, task_category)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      input.taskExecutionId || null,
      input.commandId || null,
      input.historyEntryId || null,
      input.ratedBy || "user",
      input.overallRating,
      JSON.stringify(input.categories || {}),
      input.comment || null,
      input.tags || [],
      input.agentId,
      input.taskType || null,
      input.modelUsed || null,
      input.taskCategory || null,
    ]
  );

  if (!row) {
    throw new Error("Failed to submit feedback");
  }

  return mapFeedbackRow(row);
}

/**
 * Get feedback with optional filters
 */
export async function getFeedback(options: {
  agentId?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<TaskFeedback[]> {
  const { agentId, limit = 50, offset = 0 } = options;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (agentId) {
    conditions.push(`agent_id = $${paramIndex++}`);
    params.push(agentId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit, offset);

  const rows = await query<TaskFeedbackRow>(
    `SELECT * FROM task_feedback
     ${where}
     ORDER BY created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    params
  );

  return rows.map(mapFeedbackRow);
}

/**
 * Get aggregated feedback summary
 */
export async function getFeedbackSummary(options: {
  agentId?: string;
  days?: number;
} = {}): Promise<FeedbackSummary> {
  const { agentId, days = 30 } = options;
  const conditions: string[] = [`created_at >= NOW() - INTERVAL '${days} days'`];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (agentId) {
    conditions.push(`agent_id = $${paramIndex++}`);
    params.push(agentId);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const row = await queryOne<FeedbackSummaryRow>(
    `SELECT
       COUNT(*)::text AS total_count,
       AVG(overall_rating)::text AS avg_rating,
       AVG((categories->>'accuracy')::numeric)::text AS avg_accuracy,
       AVG((categories->>'completeness')::numeric)::text AS avg_completeness,
       AVG((categories->>'speed')::numeric)::text AS avg_speed,
       AVG((categories->>'style')::numeric)::text AS avg_style,
       AVG((categories->>'usefulness')::numeric)::text AS avg_usefulness,
       COUNT(*) FILTER (WHERE overall_rating >= 4)::text AS positive_count,
       COUNT(*) FILTER (WHERE overall_rating <= 2)::text AS negative_count
     FROM task_feedback
     ${where}`,
    params
  );

  if (!row) {
    return {
      totalCount: 0,
      avgRating: 0,
      avgAccuracy: null,
      avgCompleteness: null,
      avgSpeed: null,
      avgStyle: null,
      avgUsefulness: null,
      positiveCount: 0,
      negativeCount: 0,
    };
  }

  return {
    totalCount: parseInt(row.total_count, 10) || 0,
    avgRating: parseFloat(row.avg_rating || "0") || 0,
    avgAccuracy: row.avg_accuracy ? parseFloat(row.avg_accuracy) : null,
    avgCompleteness: row.avg_completeness ? parseFloat(row.avg_completeness) : null,
    avgSpeed: row.avg_speed ? parseFloat(row.avg_speed) : null,
    avgStyle: row.avg_style ? parseFloat(row.avg_style) : null,
    avgUsefulness: row.avg_usefulness ? parseFloat(row.avg_usefulness) : null,
    positiveCount: parseInt(row.positive_count, 10) || 0,
    negativeCount: parseInt(row.negative_count, 10) || 0,
  };
}

/**
 * Get weekly feedback trends
 */
export async function getFeedbackTrends(options: {
  agentId?: string;
  weeks?: number;
} = {}): Promise<FeedbackTrend[]> {
  const { agentId, weeks = 12 } = options;
  const conditions: string[] = [`created_at >= NOW() - INTERVAL '${weeks} weeks'`];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (agentId) {
    conditions.push(`agent_id = $${paramIndex++}`);
    params.push(agentId);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const rows = await query<FeedbackTrendRow>(
    `SELECT
       DATE_TRUNC('week', created_at)::text AS week,
       COUNT(*)::text AS count,
       AVG(overall_rating)::text AS avg_rating
     FROM task_feedback
     ${where}
     GROUP BY DATE_TRUNC('week', created_at)
     ORDER BY week ASC`,
    params
  );

  return rows.map((row) => ({
    week: row.week,
    count: parseInt(row.count, 10) || 0,
    avgRating: parseFloat(row.avg_rating) || 0,
  }));
}

/**
 * Get recent tasks without feedback
 */
export async function getUnratedTasks(limit: number = 20): Promise<Array<Record<string, unknown>>> {
  const rows = await query<Record<string, unknown>>(
    `SELECT ah.id, ah.agent_id, ah.action, ah.status, ah.created_at
     FROM agent_history ah
     LEFT JOIN task_feedback tf ON tf.history_entry_id = ah.id
     WHERE tf.id IS NULL
       AND ah.status IN ('completed', 'failed')
     ORDER BY ah.created_at DESC
     LIMIT $1`,
    [limit]
  );

  return rows;
}

// ─── Learned Preferences ────────────────────────────────────────────

export interface UpdatePreferenceInput {
  preferenceValue?: Record<string, unknown>;
  confidence?: number;
  status?: string;
}

/**
 * Get active learned preferences
 */
export async function getLearnedPreferences(
  scope?: string
): Promise<LearnedPreference[]> {
  const conditions: string[] = ["status = 'active'"];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (scope) {
    conditions.push(`scope = $${paramIndex++}`);
    params.push(scope);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const rows = await query<LearnedPreferenceRow>(
    `SELECT * FROM learned_preferences
     ${where}
     ORDER BY updated_at DESC`,
    params
  );

  return rows.map(mapPreferenceRow);
}

/**
 * Update a learned preference
 */
export async function updatePreference(
  id: string,
  input: UpdatePreferenceInput
): Promise<LearnedPreference | null> {
  const fields: string[] = ["updated_at = NOW()"];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.preferenceValue !== undefined) {
    fields.push(`preference_value = $${paramIndex++}`);
    values.push(JSON.stringify(input.preferenceValue));
  }
  if (input.confidence !== undefined) {
    fields.push(`confidence = $${paramIndex++}`);
    values.push(input.confidence);
  }
  if (input.status !== undefined) {
    fields.push(`status = $${paramIndex++}`);
    values.push(input.status);
  }

  values.push(id);

  const row = await queryOne<LearnedPreferenceRow>(
    `UPDATE learned_preferences
     SET ${fields.join(", ")}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  return row ? mapPreferenceRow(row) : null;
}

/**
 * Soft-delete a preference (set status to 'rejected')
 */
export async function deletePreference(id: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE learned_preferences
     SET status = 'rejected', updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [id]
  );

  return !!row;
}

// ─── Improvement Actions ────────────────────────────────────────────

/**
 * Get improvement actions with optional status filter
 */
export async function getImprovementActions(
  status?: string
): Promise<ImprovementAction[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await query<ImprovementActionRow>(
    `SELECT * FROM improvement_actions
     ${where}
     ORDER BY created_at DESC`,
    params
  );

  return rows.map(mapImprovementRow);
}

/**
 * Get a single improvement action by ID
 */
export async function getImprovementById(
  id: string
): Promise<ImprovementAction | null> {
  const row = await queryOne<ImprovementActionRow>(
    `SELECT * FROM improvement_actions WHERE id = $1`,
    [id]
  );

  return row ? mapImprovementRow(row) : null;
}

/**
 * Approve an improvement action
 */
export async function approveImprovement(
  id: string,
  approvedBy: string = "user"
): Promise<ImprovementAction | null> {
  const row = await queryOne<ImprovementActionRow>(
    `UPDATE improvement_actions
     SET status = 'approved', approved_by = $2, approved_at = NOW()
     WHERE id = $1 AND status = 'proposed'
     RETURNING *`,
    [id, approvedBy]
  );

  return row ? mapImprovementRow(row) : null;
}

/**
 * Apply an improvement action
 */
export async function applyImprovement(
  id: string
): Promise<ImprovementAction | null> {
  const row = await queryOne<ImprovementActionRow>(
    `UPDATE improvement_actions
     SET status = 'applied', applied_at = NOW()
     WHERE id = $1 AND status = 'approved'
     RETURNING *`,
    [id]
  );

  return row ? mapImprovementRow(row) : null;
}

/**
 * Reject an improvement action
 */
export async function rejectImprovement(
  id: string
): Promise<ImprovementAction | null> {
  const row = await queryOne<ImprovementActionRow>(
    `UPDATE improvement_actions
     SET status = 'rejected'
     WHERE id = $1 AND status IN ('proposed', 'approved')
     RETURNING *`,
    [id]
  );

  return row ? mapImprovementRow(row) : null;
}
