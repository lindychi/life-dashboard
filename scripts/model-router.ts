/**
 * Smart Model Router
 *
 * Analyzes task complexity and selects the optimal Claude model tier.
 * Priority chain: explicit override > ecomode cap > agent config > auto-analysis
 */

export type ModelTier = "haiku" | "sonnet" | "opus";

export interface ComplexityScore {
  score: number;        // 0-100
  tier: ModelTier;
  reasoning: string;
  factors: ComplexityFactor[];
}

export interface ComplexityFactor {
  name: string;
  weight: number;
  matched: boolean;
  contribution: number;
}

/**
 * Complexity scoring rules (weighted sum approach)
 */
const COMPLEXITY_RULES: Array<{
  name: string;
  pattern: RegExp;
  weight: number;
  target: "task" | "agentId" | "both";
}> = [
  // High complexity indicators (→ opus)
  { name: "architecture", pattern: /아키텍처|architect|설계|design system/i, weight: 25, target: "task" },
  { name: "refactor", pattern: /리팩토링|refactor|restructur/i, weight: 25, target: "task" },
  { name: "security_review", pattern: /보안|security|vulnerab|취약점/i, weight: 20, target: "task" },
  { name: "deep_analysis", pattern: /분석|analyze|심층|deep|comprehensive|전체/i, weight: 20, target: "task" },
  { name: "debug_complex", pattern: /debug|디버그|race condition|메모리 누수|memory leak/i, weight: 25, target: "task" },
  { name: "migration", pattern: /마이그레이션|migration|migrate/i, weight: 20, target: "task" },
  { name: "multi_file", pattern: /전체|across|여러 파일|multi.?file|codebase.?wide/i, weight: 15, target: "task" },

  // QW-1: Expanded complex task patterns (high complexity indicators)
  { name: "qa_testing", pattern: /QA|테스트 작성|test.*write|검증 시나리오|verify.*scenario/i, weight: 20, target: "task" },
  { name: "deployment", pattern: /배포|deploy|릴리스|release|publish/i, weight: 20, target: "task" },
  { name: "planning", pattern: /계획|plan|설계|design|roadmap/i, weight: 15, target: "task" },
  { name: "performance", pattern: /성능|performance|최적화|optimiz|병목|bottleneck/i, weight: 20, target: "task" },

  // Medium complexity indicators (→ sonnet)
  { name: "implement", pattern: /구현|implement|추가|add feature|create/i, weight: 10, target: "task" },
  { name: "fix_bug", pattern: /버그|bug|fix|수정|patch/i, weight: 10, target: "task" },
  { name: "test_check", pattern: /테스트 실행|run.*test|테스트 확인|check.*test/i, weight: 8, target: "task" },  // 단순 테스트 실행은 medium
  { name: "review", pattern: /검토|review|리뷰/i, weight: 10, target: "task" },
  { name: "document", pattern: /문서|document|README|릴리스 노트/i, weight: 5, target: "task" },

  // Low complexity indicators (→ haiku, negative weight reduces score)
  { name: "simple_query", pattern: /조회|확인|what is|어떻게|상태|status/i, weight: -10, target: "task" },
  { name: "lookup", pattern: /찾아|find|search|어디에|where/i, weight: -10, target: "task" },
  { name: "summarize", pattern: /요약|summarize|정리|brief/i, weight: -5, target: "task" },
  { name: "list", pattern: /목록|list|나열/i, weight: -10, target: "task" },

  // Agent-based complexity boost
  { name: "agent_pm", pattern: /^pm$/i, weight: 10, target: "agentId" },
  { name: "agent_analyst", pattern: /^analyst$/i, weight: 10, target: "agentId" },
  { name: "agent_qa", pattern: /^qa$/i, weight: 10, target: "agentId" },
  { name: "agent_researcher", pattern: /^researcher$/i, weight: 5, target: "agentId" },
  { name: "agent_assistant", pattern: /^assistant$/i, weight: -5, target: "agentId" },
  { name: "agent_finance", pattern: /^finance$/i, weight: -5, target: "agentId" },
];

// QW-2: Adjusted thresholds to reduce over-promotion to opus
const TIER_THRESHOLDS = {
  opus: 60,    // score >= 60 → opus (increased from 50)
  sonnet: 20,  // score >= 20 → sonnet (increased from 15)
  // score < 20 → haiku
};

/**
 * Analyze task complexity and return a score + recommended model tier
 */
export function analyzeComplexity(
  task: string,
  agentId: string,
): ComplexityScore {
  let totalScore = 0;
  const factors: ComplexityFactor[] = [];

  for (const rule of COMPLEXITY_RULES) {
    const target = rule.target === "agentId" ? agentId :
                   rule.target === "task" ? task : `${task} ${agentId}`;
    const matched = rule.pattern.test(target);
    const contribution = matched ? rule.weight : 0;
    totalScore += contribution;
    factors.push({ name: rule.name, weight: rule.weight, matched, contribution });
  }

  // Task length as a bonus factor (longer tasks tend to be more complex)
  const lengthBonus = Math.min(10, Math.floor(task.length / 200));
  totalScore += lengthBonus;

  // Clamp to 0-100
  const score = Math.max(0, Math.min(100, totalScore));

  const tier: ModelTier =
    score >= TIER_THRESHOLDS.opus ? "opus" :
    score >= TIER_THRESHOLDS.sonnet ? "sonnet" : "haiku";

  const matchedFactors = factors.filter(f => f.matched).map(f => f.name);

  return {
    score,
    tier,
    reasoning: `Score ${score}: ${matchedFactors.length > 0 ? matchedFactors.join(", ") : "no specific indicators"}`,
    factors,
  };
}

/**
 * Select model with priority chain:
 * 1. Explicit override (from command payload)
 * 2. Ecomode cap (if enabled)
 * 3. Agent default model (from config)
 * 4. Auto-analysis
 */
export function selectModel(
  task: string,
  agentId: string,
  explicitModel?: ModelTier,
  agentDefaultModel?: ModelTier,
  ecomode?: boolean,
): { model: ModelTier; source: "explicit" | "agent_config" | "analysis" | "ecomode_cap"; complexityScore: number } {
  const analysis = analyzeComplexity(task, agentId);

  // 1. Explicit model override
  if (explicitModel) {
    return { model: explicitModel, source: "explicit", complexityScore: analysis.score };
  }

  // 2. Ecomode: cap at sonnet, prefer haiku
  if (ecomode) {
    const cappedTier = analysis.tier === "opus" ? "sonnet" : analysis.tier;
    return { model: cappedTier, source: "ecomode_cap", complexityScore: analysis.score };
  }

  // 3. Agent default model
  if (agentDefaultModel) {
    return { model: agentDefaultModel, source: "agent_config", complexityScore: analysis.score };
  }

  // 4. Auto-analysis
  return { model: analysis.tier, source: "analysis", complexityScore: analysis.score };
}

/**
 * Delegation category settings — maps category to model tier and stale timeout.
 * Used by orchestrator when subtasks include category tags from createPlan.
 *
 * Priority: category override > agent config > auto-analysis
 */
export type DelegationCategory = "quick" | "writing" | "standard" | "visual" | "ultrabrain";

export interface CategorySettings {
  model: ModelTier;
  staleTimeout: number;  // ms
}

const CATEGORY_SETTINGS: Record<DelegationCategory, CategorySettings> = {
  quick:      { model: "haiku",  staleTimeout: 120000 },   // 2 min
  writing:    { model: "sonnet", staleTimeout: 300000 },   // 5 min
  standard:   { model: "sonnet", staleTimeout: 300000 },   // 5 min
  visual:     { model: "sonnet", staleTimeout: 300000 },   // 5 min
  ultrabrain: { model: "opus",   staleTimeout: 600000 },   // 10 min
};

/**
 * Get model tier and timeout from delegation category.
 * Returns undefined if category is not recognized.
 */
export function getCategorySettings(category: DelegationCategory): CategorySettings {
  return CATEGORY_SETTINGS[category];
}

/**
 * Map model tier to actual Claude CLI --model flag value.
 * Falls back to short alias if full model ID fails.
 */
export function getModelFlag(tier: ModelTier): string {
  // Claude CLI supports short aliases
  const MODEL_MAP: Record<ModelTier, string> = {
    haiku: "haiku",
    sonnet: "sonnet",
    opus: "opus",
  };
  return MODEL_MAP[tier];
}

/**
 * Determine staleTimeout based on model tier and complexity
 *
 * Lower-tier models respond faster → shorter timeouts
 * Higher complexity → longer timeouts (regardless of model)
 *
 * QW-3: Increased base timeout to 8 minutes (480s) to reduce hung false positives
 */
export function getModelStaleTimeout(
  tier: ModelTier,
  complexityScore: number,
  baseTimeout: number = 480000, // 8 min default (increased from 5 min)
): number {
  // Model tier multiplier
  const TIER_MULTIPLIERS: Record<ModelTier, number> = {
    haiku: 0.6,    // 4.8 min for simple haiku tasks (increased from 2.5 min)
    sonnet: 1.0,   // 8 min baseline (increased from 5 min)
    opus: 1.5,     // 12 min for complex opus tasks (increased from 7.5 min)
  };

  // Complexity bonus: high complexity tasks get more time regardless of model
  const complexityMultiplier = complexityScore >= 60 ? 1.8 :  // Very high complexity
                               complexityScore >= 50 ? 1.5 :
                               complexityScore >= 30 ? 1.2 : 1.0;

  return Math.round(baseTimeout * TIER_MULTIPLIERS[tier] * complexityMultiplier);
}
