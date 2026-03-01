/**
 * agent-intelligence.ts
 *
 * Agent Auto-Promotion system (A-2).
 *
 * Tracks per-agent task success/failure history in PostgreSQL and recommends
 * model tier promotions when an agent's failure rate exceeds 30% over the
 * last N tasks (default window: 20).
 *
 * Model promotion chain:  haiku → sonnet → opus
 * Cooldown:               1 hour between promotions per agent
 * Minimum sample size:    5 tasks (avoid noisy decisions on sparse history)
 *
 * Tables (see sql/026_agent_intelligence.sql):
 *   agent_task_results      — per-task outcome records
 *   agent_model_promotions  — promotion audit log
 */

import { query, queryOne } from "@/lib/db";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_SIZE = 20;
const FAILURE_RATE_THRESHOLD = 0.3; // > 30% → promote
const MIN_SAMPLE_SIZE = 5;          // need at least 5 tasks before promoting
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

/** Ordered promotion chain (lowest → highest). */
const MODEL_CHAIN: readonly string[] = ["haiku", "sonnet", "opus"] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentStats {
  total: number;
  failures: number;
  successRate: number;
}

// ---------------------------------------------------------------------------
// recordTaskResult
// ---------------------------------------------------------------------------

/**
 * Record the outcome of a single task execution for the given agent.
 *
 * @param agentId   Logical agent identifier
 * @param status    "success" | "failure"
 * @param model     Optional model that was used for this task
 */
export async function recordTaskResult(
  agentId: string,
  status: "success" | "failure",
  model?: string
): Promise<void> {
  await query(
    `INSERT INTO agent_task_results (agent_id, status, model_used)
     VALUES ($1, $2, $3)`,
    [agentId, status, model ?? null]
  );
}

// ---------------------------------------------------------------------------
// getAgentStats
// ---------------------------------------------------------------------------

/**
 * Return success/failure statistics for an agent over the most recent
 * `windowSize` tasks.
 *
 * @param agentId    Logical agent identifier
 * @param windowSize Number of most-recent tasks to consider (default 20)
 */
export async function getAgentStats(
  agentId: string,
  windowSize: number = DEFAULT_WINDOW_SIZE
): Promise<AgentStats> {
  // Subquery limits to the most recent `windowSize` rows, then aggregates.
  const row = await queryOne<{ total: string; failures: string }>(
    `SELECT
       COUNT(*)                                     AS total,
       COUNT(*) FILTER (WHERE status = 'failure')  AS failures
     FROM (
       SELECT status
       FROM   agent_task_results
       WHERE  agent_id = $1
       ORDER BY created_at DESC
       LIMIT  $2
     ) AS window`,
    [agentId, windowSize]
  );

  if (!row) {
    return { total: 0, failures: 0, successRate: 1.0 };
  }

  const total = parseInt(row.total, 10) || 0;
  const failures = parseInt(row.failures, 10) || 0;
  const successRate = total === 0 ? 1.0 : (total - failures) / total;

  return { total, failures, successRate };
}

// ---------------------------------------------------------------------------
// shouldPromoteModel
// ---------------------------------------------------------------------------

/**
 * Returns true if the agent's recent failure rate exceeds the 30% threshold
 * AND the sample is large enough to act on.
 */
export async function shouldPromoteModel(agentId: string): Promise<boolean> {
  const stats = await getAgentStats(agentId);

  if (stats.total < MIN_SAMPLE_SIZE) return false;

  const failureRate = stats.total > 0 ? stats.failures / stats.total : 0;
  return failureRate > FAILURE_RATE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// recordPromotion
// ---------------------------------------------------------------------------

/**
 * Write a model promotion audit row.
 */
export async function recordPromotion(
  agentId: string,
  fromModel: string,
  toModel: string,
  reason: string
): Promise<void> {
  await query(
    `INSERT INTO agent_model_promotions (agent_id, from_model, to_model, reason)
     VALUES ($1, $2, $3, $4)`,
    [agentId, fromModel, toModel, reason]
  );
}

// ---------------------------------------------------------------------------
// getRecommendedModel
// ---------------------------------------------------------------------------

/**
 * Check whether the agent should be promoted and, if so, return the next
 * model in the chain. Respects the 1-hour cooldown between promotions.
 *
 * @param agentId       Logical agent identifier
 * @param defaultModel  The model currently assigned to the agent
 * @returns             Promoted model string, or `defaultModel` unchanged
 */
export async function getRecommendedModel(
  agentId: string,
  defaultModel: string
): Promise<string> {
  // 1. Determine the next tier (if any).
  const currentIdx = MODEL_CHAIN.indexOf(defaultModel);
  if (currentIdx === -1 || currentIdx === MODEL_CHAIN.length - 1) {
    // Unknown model or already at max — cannot promote.
    return defaultModel;
  }
  const nextModel = MODEL_CHAIN[currentIdx + 1];

  // 2. Check if promotion is warranted.
  const promote = await shouldPromoteModel(agentId);
  if (!promote) return defaultModel;

  // 3. Enforce cooldown: skip promotion if one occurred within the last hour.
  const recentPromotion = await queryOne<{ promoted_at: string }>(
    `SELECT promoted_at
     FROM   agent_model_promotions
     WHERE  agent_id = $1
     ORDER  BY promoted_at DESC
     LIMIT  1`,
    [agentId]
  );

  if (recentPromotion) {
    const elapsed = Date.now() - new Date(recentPromotion.promoted_at).getTime();
    if (elapsed < COOLDOWN_MS) {
      // Still within cooldown window — do not promote.
      return defaultModel;
    }
  }

  return nextModel;
}
