// Token usage tracking for OMC optimization monitoring (PostgreSQL)

import { query, queryOne } from "./db";

export type ModelTier = "haiku" | "sonnet" | "opus";
export type ModelSource = "explicit" | "agent_config" | "analysis" | "ecomode_cap";
export type DelegationCategory = "quick" | "writing" | "visual-engineering" | "ultrabrain" | "artistry";

export interface TokenUsageEntry {
  id: string;
  agentId: string;
  commandId?: string;
  taskExecutionId?: string;
  requestGroupId?: string;

  // Model routing
  model: ModelTier;
  modelSource?: ModelSource;
  complexityScore?: number;
  delegationCategory?: DelegationCategory;
  ecomode: boolean;

  // Cost & tokens (from Claude CLI result event)
  totalCostUsd?: number;
  numTurns?: number;
  durationApiMs?: number;

  // Execution metrics
  elapsedMs?: number;
  toolCallsCount: number;
  success: boolean;
  exitCode?: number;
  isHung: boolean;
  retryCount: number;

  // Provider
  provider: "claude" | "codex";
  fallbackUsed: boolean;

  // Escalation
  wasEscalated: boolean;
  escalatedFrom?: ModelTier;

  // Task info
  taskPreview?: string;
  isComplex: boolean;

  createdAt: string;
}

/**
 * Record a token usage entry after task completion
 */
export async function recordTokenUsage(
  entry: Omit<TokenUsageEntry, "id" | "createdAt">
): Promise<TokenUsageEntry> {
  const rows = await query<TokenUsageEntry>(
    `INSERT INTO token_usage (
      agent_id, command_id, task_execution_id, request_group_id,
      model, model_source, complexity_score, delegation_category, ecomode,
      total_cost_usd, num_turns, duration_api_ms,
      elapsed_ms, tool_calls_count, success, exit_code, is_hung, retry_count,
      provider, fallback_used,
      was_escalated, escalated_from,
      task_preview, is_complex
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8, $9,
      $10, $11, $12,
      $13, $14, $15, $16, $17, $18,
      $19, $20,
      $21, $22,
      $23, $24
    )
    RETURNING
      id, agent_id as "agentId", command_id as "commandId",
      task_execution_id as "taskExecutionId", request_group_id as "requestGroupId",
      model, model_source as "modelSource", complexity_score as "complexityScore",
      delegation_category as "delegationCategory", ecomode,
      total_cost_usd as "totalCostUsd", num_turns as "numTurns",
      duration_api_ms as "durationApiMs",
      elapsed_ms as "elapsedMs", tool_calls_count as "toolCallsCount",
      success, exit_code as "exitCode", is_hung as "isHung", retry_count as "retryCount",
      provider, fallback_used as "fallbackUsed",
      was_escalated as "wasEscalated", escalated_from as "escalatedFrom",
      task_preview as "taskPreview", is_complex as "isComplex",
      created_at as "createdAt"`,
    [
      entry.agentId, entry.commandId || null, entry.taskExecutionId || null,
      entry.requestGroupId || null,
      entry.model, entry.modelSource || null, entry.complexityScore ?? null,
      entry.delegationCategory || null, entry.ecomode,
      entry.totalCostUsd ?? null, entry.numTurns ?? null, entry.durationApiMs ?? null,
      entry.elapsedMs ?? null, entry.toolCallsCount, entry.success,
      entry.exitCode ?? null, entry.isHung, entry.retryCount,
      entry.provider, entry.fallbackUsed,
      entry.wasEscalated, entry.escalatedFrom || null,
      entry.taskPreview || null, entry.isComplex,
    ]
  );
  return rows[0];
}

// --- Query functions for API endpoints ---

export interface DailySummary {
  day: string;
  model: string;
  totalCalls: number;
  successfulCalls: number;
  totalCost: number;
  avgElapsedMs: number;
  avgComplexity: number;
  haikuCalls: number;
  sonnetCalls: number;
  opusCalls: number;
}

/**
 * Get daily token usage summary grouped by model
 */
export async function getDailySummary(days: number = 7): Promise<DailySummary[]> {
  const rows = await query<{
    day: string;
    model: string;
    total_calls: string;
    successful_calls: string;
    total_cost: string;
    avg_elapsed_ms: string;
    avg_complexity: string;
    haiku_calls: string;
    sonnet_calls: string;
    opus_calls: string;
  }>(
    `SELECT * FROM token_usage_daily_summary($1)`,
    [days]
  );

  return rows.map((r) => ({
    day: r.day,
    model: r.model,
    totalCalls: parseInt(r.total_calls, 10),
    successfulCalls: parseInt(r.successful_calls, 10),
    totalCost: parseFloat(r.total_cost),
    avgElapsedMs: parseFloat(r.avg_elapsed_ms),
    avgComplexity: parseFloat(r.avg_complexity),
    haikuCalls: parseInt(r.haiku_calls, 10),
    sonnetCalls: parseInt(r.sonnet_calls, 10),
    opusCalls: parseInt(r.opus_calls, 10),
  }));
}

export interface AgentSummary {
  agentId: string;
  totalCalls: number;
  successfulCalls: number;
  totalCost: number;
  avgElapsedMs: number;
  primaryModel: string;
  ecomodeCalls: number;
  escalationCount: number;
}

/**
 * Get agent-level cost summary
 */
export async function getAgentSummary(days: number = 30): Promise<AgentSummary[]> {
  const rows = await query<{
    agent_id: string;
    total_calls: string;
    successful_calls: string;
    total_cost: string;
    avg_elapsed_ms: string;
    primary_model: string;
    ecomode_calls: string;
    escalation_count: string;
  }>(
    `SELECT * FROM token_usage_agent_summary($1)`,
    [days]
  );

  return rows.map((r) => ({
    agentId: r.agent_id,
    totalCalls: parseInt(r.total_calls, 10),
    successfulCalls: parseInt(r.successful_calls, 10),
    totalCost: parseFloat(r.total_cost),
    avgElapsedMs: parseFloat(r.avg_elapsed_ms),
    primaryModel: r.primary_model,
    ecomodeCalls: parseInt(r.ecomode_calls, 10),
    escalationCount: parseInt(r.escalation_count, 10),
  }));
}

export interface ModelDistribution {
  model: string;
  count: number;
  percentage: number;
  totalCost: number;
  avgElapsedMs: number;
  successRate: number;
}

/**
 * Get model usage distribution for a given period
 */
export async function getModelDistribution(days: number = 7): Promise<ModelDistribution[]> {
  const rows = await query<{
    model: string;
    count: string;
    total_cost: string;
    avg_elapsed_ms: string;
    success_count: string;
    total_count: string;
  }>(
    `SELECT
      model,
      COUNT(*) as count,
      COALESCE(SUM(total_cost_usd), 0) as total_cost,
      AVG(elapsed_ms)::NUMERIC as avg_elapsed_ms,
      COUNT(*) FILTER (WHERE success) as success_count,
      COUNT(*) as total_count
    FROM token_usage
    WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
    GROUP BY model
    ORDER BY count DESC`,
    [days]
  );

  const total = rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);

  return rows.map((r) => {
    const count = parseInt(r.count, 10);
    const successCount = parseInt(r.success_count, 10);
    return {
      model: r.model,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      totalCost: parseFloat(r.total_cost),
      avgElapsedMs: parseFloat(r.avg_elapsed_ms),
      successRate: count > 0 ? Math.round((successCount / count) * 100) : 0,
    };
  });
}

export interface EcomodeComparison {
  ecomode: boolean;
  totalCalls: number;
  avgCostPerCall: number;
  avgElapsedMs: number;
  successRate: number;
  escalationRate: number;
}

/**
 * Compare ecomode vs normal performance for A/B analysis
 */
export async function getEcomodeComparison(days: number = 30): Promise<EcomodeComparison[]> {
  const rows = await query<{
    ecomode: boolean;
    total_calls: string;
    avg_cost: string;
    avg_elapsed_ms: string;
    success_count: string;
    escalation_count: string;
  }>(
    `SELECT
      ecomode,
      COUNT(*) as total_calls,
      AVG(total_cost_usd)::NUMERIC as avg_cost,
      AVG(elapsed_ms)::NUMERIC as avg_elapsed_ms,
      COUNT(*) FILTER (WHERE success) as success_count,
      COUNT(*) FILTER (WHERE was_escalated) as escalation_count
    FROM token_usage
    WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
    GROUP BY ecomode`,
    [days]
  );

  return rows.map((r) => {
    const totalCalls = parseInt(r.total_calls, 10);
    const successCount = parseInt(r.success_count, 10);
    const escalationCount = parseInt(r.escalation_count, 10);
    return {
      ecomode: r.ecomode,
      totalCalls,
      avgCostPerCall: parseFloat(r.avg_cost) || 0,
      avgElapsedMs: parseFloat(r.avg_elapsed_ms) || 0,
      successRate: totalCalls > 0 ? Math.round((successCount / totalCalls) * 100) : 0,
      escalationRate: totalCalls > 0 ? Math.round((escalationCount / totalCalls) * 100) : 0,
    };
  });
}

/**
 * Get recent token usage entries (for timeline/detail view)
 */
export async function getRecentUsage(
  options: {
    agentId?: string;
    model?: ModelTier;
    limit?: number;
    cursor?: string;
  } = {}
): Promise<{ entries: TokenUsageEntry[]; nextCursor: string | null }> {
  const limit = options.limit || 50;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (options.agentId) {
    conditions.push(`agent_id = $${paramIndex++}`);
    params.push(options.agentId);
  }

  if (options.model) {
    conditions.push(`model = $${paramIndex++}`);
    params.push(options.model);
  }

  if (options.cursor) {
    conditions.push(`created_at < $${paramIndex++}`);
    params.push(options.cursor);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const entries = await query<TokenUsageEntry>(
    `SELECT
      id, agent_id as "agentId", command_id as "commandId",
      task_execution_id as "taskExecutionId", request_group_id as "requestGroupId",
      model, model_source as "modelSource", complexity_score as "complexityScore",
      delegation_category as "delegationCategory", ecomode,
      total_cost_usd as "totalCostUsd", num_turns as "numTurns",
      duration_api_ms as "durationApiMs",
      elapsed_ms as "elapsedMs", tool_calls_count as "toolCallsCount",
      success, exit_code as "exitCode", is_hung as "isHung", retry_count as "retryCount",
      provider, fallback_used as "fallbackUsed",
      was_escalated as "wasEscalated", escalated_from as "escalatedFrom",
      task_preview as "taskPreview", is_complex as "isComplex",
      created_at as "createdAt"
    FROM token_usage
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIndex}`,
    [...params, limit + 1]
  );

  const hasMore = entries.length > limit;
  const resultEntries = hasMore ? entries.slice(0, limit) : entries;
  const lastEntry = resultEntries[resultEntries.length - 1];
  const nextCursor = hasMore && lastEntry ? lastEntry.createdAt : null;

  return { entries: resultEntries, nextCursor };
}

/**
 * Get aggregate overview metrics for dashboard widget
 */
export async function getOverviewMetrics(days: number = 7): Promise<{
  totalCalls: number;
  totalCost: number;
  avgCostPerCall: number;
  modelDistribution: Record<string, number>;
  categoryDistribution: Record<string, number>;
  successRate: number;
  avgElapsedMs: number;
  ecomodeUsageRate: number;
  escalationRate: number;
}> {
  const row = await queryOne<{
    total_calls: string;
    total_cost: string;
    avg_cost: string;
    haiku_count: string;
    sonnet_count: string;
    opus_count: string;
    success_count: string;
    avg_elapsed_ms: string;
    ecomode_count: string;
    escalation_count: string;
  }>(
    `SELECT
      COUNT(*) as total_calls,
      COALESCE(SUM(total_cost_usd), 0) as total_cost,
      COALESCE(AVG(total_cost_usd), 0) as avg_cost,
      COUNT(*) FILTER (WHERE model = 'haiku') as haiku_count,
      COUNT(*) FILTER (WHERE model = 'sonnet') as sonnet_count,
      COUNT(*) FILTER (WHERE model = 'opus') as opus_count,
      COUNT(*) FILTER (WHERE success) as success_count,
      COALESCE(AVG(elapsed_ms), 0) as avg_elapsed_ms,
      COUNT(*) FILTER (WHERE ecomode) as ecomode_count,
      COUNT(*) FILTER (WHERE was_escalated) as escalation_count
    FROM token_usage
    WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL`,
    [days]
  );

  if (!row) {
    return {
      totalCalls: 0, totalCost: 0, avgCostPerCall: 0,
      modelDistribution: { haiku: 0, sonnet: 0, opus: 0 },
      categoryDistribution: {},
      successRate: 0, avgElapsedMs: 0, ecomodeUsageRate: 0, escalationRate: 0,
    };
  }

  const totalCalls = parseInt(row.total_calls, 10);

  // Category distribution via separate query
  const categoryRows = await query<{ category: string; count: string }>(
    `SELECT delegation_category as category, COUNT(*) as count
     FROM token_usage
     WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
       AND delegation_category IS NOT NULL
     GROUP BY delegation_category`,
    [days]
  );

  const categoryDistribution: Record<string, number> = {};
  for (const cr of categoryRows) {
    categoryDistribution[cr.category] = parseInt(cr.count, 10);
  }

  return {
    totalCalls,
    totalCost: parseFloat(row.total_cost),
    avgCostPerCall: parseFloat(row.avg_cost),
    modelDistribution: {
      haiku: parseInt(row.haiku_count, 10),
      sonnet: parseInt(row.sonnet_count, 10),
      opus: parseInt(row.opus_count, 10),
    },
    categoryDistribution,
    successRate: totalCalls > 0 ? Math.round((parseInt(row.success_count, 10) / totalCalls) * 100) : 0,
    avgElapsedMs: parseFloat(row.avg_elapsed_ms),
    ecomodeUsageRate: totalCalls > 0 ? Math.round((parseInt(row.ecomode_count, 10) / totalCalls) * 100) : 0,
    escalationRate: totalCalls > 0 ? Math.round((parseInt(row.escalation_count, 10) / totalCalls) * 100) : 0,
  };
}
