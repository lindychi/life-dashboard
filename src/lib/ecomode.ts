// Ecomode: cost-efficient model tier selection and plan cost estimation

export type ModelTier = "low" | "medium" | "high";

/** Model name resolved for each tier */
const TIER_TO_MODEL: Record<ModelTier, string> = {
  low: "haiku",
  medium: "sonnet",
  high: "opus",
};

/**
 * Approximate cost per minute for each tier (USD).
 * haiku: $0.001/min, sonnet: $0.005/min, opus: $0.025/min
 */
const TIER_COST_PER_MINUTE: Record<ModelTier, number> = {
  low: 0.001,
  medium: 0.005,
  high: 0.025,
};

/**
 * Resolve the model name for a given tier.
 * When tier is undefined, returns the provided defaultModel or "sonnet" as fallback.
 */
export function resolveModelForTier(
  tier?: ModelTier,
  defaultModel?: string
): string {
  if (tier === undefined) {
    return defaultModel ?? "sonnet";
  }
  return TIER_TO_MODEL[tier];
}

/**
 * Estimate the cost of a single task given its model tier and estimated duration.
 * @param tier - model tier ("low" | "medium" | "high")
 * @param estimatedDurationSec - estimated task duration in seconds
 * @returns estimated cost in USD
 */
export function estimateTaskCost(
  tier: ModelTier,
  estimatedDurationSec: number
): number {
  const costPerMin = TIER_COST_PER_MINUTE[tier];
  const minutes = estimatedDurationSec / 60;
  return costPerMin * minutes;
}

/**
 * Estimate the total cost of a plan (list of subtasks).
 * Tasks with undefined modelTier are treated as "medium".
 * Tasks with undefined estimatedDurationSec are treated as 0.
 */
export function estimatePlanCost(
  tasks: Array<{ modelTier?: ModelTier; estimatedDurationSec?: number }>
): number {
  return tasks.reduce((sum, task) => {
    const tier: ModelTier = task.modelTier ?? "medium";
    const duration = task.estimatedDurationSec ?? 0;
    return sum + estimateTaskCost(tier, duration);
  }, 0);
}

export interface TierDowngradeSuggestion {
  index: number;
  currentTier: ModelTier;
  suggestedTier: ModelTier;
}

/** Map each tier to the next cheaper tier (or undefined if already cheapest) */
const DOWNGRADE_MAP: Partial<Record<ModelTier, ModelTier>> = {
  high: "medium",
  medium: "low",
};

/**
 * Advisory-only suggestion of tier downgrades when a plan exceeds the budget.
 * Prioritises downgrading high-tier tasks first, then medium-tier tasks.
 * Does NOT mutate the original tasks array.
 *
 * @param tasks - list of tasks with optional modelTier and estimatedDurationSec
 * @param budgetUsd - maximum acceptable total cost in USD
 * @returns list of suggested downgrades (index into tasks, current and suggested tier)
 */
export function suggestTierDowngrades(
  tasks: Array<{ modelTier?: ModelTier; estimatedDurationSec?: number }>,
  budgetUsd: number
): TierDowngradeSuggestion[] {
  const currentTotal = estimatePlanCost(tasks);
  if (currentTotal <= budgetUsd) {
    return [];
  }

  const suggestions: TierDowngradeSuggestion[] = [];

  // Work from most expensive to least expensive tier
  const tierOrder: ModelTier[] = ["high", "medium"];

  for (const tier of tierOrder) {
    for (let i = 0; i < tasks.length; i++) {
      const taskTier: ModelTier = tasks[i].modelTier ?? "medium";
      if (taskTier === tier) {
        const downgradedTier = DOWNGRADE_MAP[taskTier];
        if (downgradedTier) {
          suggestions.push({
            index: i,
            currentTier: taskTier,
            suggestedTier: downgradedTier,
          });
        }
      }
    }
  }

  return suggestions;
}
