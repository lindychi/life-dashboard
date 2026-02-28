/**
 * Delegation Category System
 *
 * Categorizes tasks by nature (quick, writing, visual-engineering, ultrabrain, artistry)
 * and maps each category to model tier, temperature, thinking budget, and timeout.
 */

import type { ModelTier } from "./model-router";

export type DelegationCategory =
  | "quick"               // 단순 조회, 상태 확인
  | "writing"             // 문서 작성, 리포트
  | "visual-engineering"  // UI/UX, 프론트엔드
  | "ultrabrain"          // 복잡한 추론, 아키텍처, 디버깅
  | "artistry";           // 창의적 솔루션, 브레인스토밍

export interface CategoryConfig {
  modelTier: ModelTier;
  temperature: number;
  thinkingBudget: "low" | "medium" | "high" | "max";
  maxOutputTokens?: number;
  staleTimeoutMultiplier: number;  // 기본 staleTimeout에 대한 배수
}

export const CATEGORY_CONFIGS: Record<DelegationCategory, CategoryConfig> = {
  quick: {
    modelTier: "haiku",
    temperature: 0.1,
    thinkingBudget: "low",
    maxOutputTokens: 2000,
    staleTimeoutMultiplier: 0.5,  // 빠른 타임아웃 (2.5분)
  },
  writing: {
    modelTier: "sonnet",
    temperature: 0.5,
    thinkingBudget: "medium",
    maxOutputTokens: 8000,
    staleTimeoutMultiplier: 1.0,
  },
  "visual-engineering": {
    modelTier: "sonnet",
    temperature: 0.7,
    thinkingBudget: "high",
    staleTimeoutMultiplier: 1.5,
  },
  ultrabrain: {
    modelTier: "opus",
    temperature: 0.3,
    thinkingBudget: "max",
    staleTimeoutMultiplier: 2.0,  // 긴 타임아웃 (10분)
  },
  artistry: {
    modelTier: "sonnet",
    temperature: 0.9,
    thinkingBudget: "medium",
    staleTimeoutMultiplier: 1.0,
  },
};

/**
 * Category detection patterns
 */
const CATEGORY_PATTERNS: Array<{
  category: DelegationCategory;
  patterns: RegExp[];
  agentIds?: string[];
}> = [
  {
    category: "quick",
    patterns: [
      /상태|status|확인|check|조회|lookup|목록|list|what is|어떻게/i,
      /간단한|simple|quick|빠르게/i,
    ],
    agentIds: ["assistant"],
  },
  {
    category: "writing",
    patterns: [
      /문서|document|작성|write|리포트|report|릴리스|release|블로그|blog/i,
      /요약|summarize|정리|브리핑|briefing/i,
    ],
    agentIds: ["growth"],
  },
  {
    category: "visual-engineering",
    patterns: [
      /UI|UX|디자인|design|스타일|style|컴포넌트|component|레이아웃|layout/i,
      /반응형|responsive|접근성|accessibility|a11y|animation/i,
    ],
    agentIds: ["designer"],
  },
  {
    category: "ultrabrain",
    patterns: [
      /아키텍처|architect|설계|리팩토링|refactor|보안|security|디버그|debug/i,
      /race condition|메모리|memory|성능|performance|최적화|optimize/i,
      /마이그레이션|migration|complex|복잡/i,
    ],
  },
  {
    category: "artistry",
    patterns: [
      /아이디어|idea|브레인스토밍|brainstorm|창의|creative|새로운 방법|novel/i,
    ],
  },
];

/**
 * Detect delegation category from task content and agent ID
 * Priority: explicit > agent-based default > keyword matching > "writing" fallback
 */
export function detectCategory(
  task: string,
  agentId: string,
  explicitCategory?: DelegationCategory,
): DelegationCategory {
  // 1. Explicit override
  if (explicitCategory) return explicitCategory;

  // 2. Agent-based default (certain agents have fixed categories)
  for (const rule of CATEGORY_PATTERNS) {
    if (rule.agentIds?.includes(agentId)) {
      return rule.category;
    }
  }

  // 3. Task keyword matching (highest match count wins)
  let bestMatch: { category: DelegationCategory; matchCount: number } | null = null;
  for (const rule of CATEGORY_PATTERNS) {
    const matchCount = rule.patterns.filter(p => p.test(task)).length;
    if (matchCount > 0 && (!bestMatch || matchCount > bestMatch.matchCount)) {
      bestMatch = { category: rule.category, matchCount };
    }
  }

  // 4. Fallback: "writing" (balanced default)
  return bestMatch?.category || "writing";
}

/**
 * Get the effective staleTimeout for a given category
 */
export function getCategoryStaleTimeout(
  category: DelegationCategory,
  baseTimeout: number = 300000,
): number {
  const config = CATEGORY_CONFIGS[category];
  return Math.round(baseTimeout * config.staleTimeoutMultiplier);
}

/**
 * Get the recommended model tier from category config
 */
export function getCategoryModelTier(category: DelegationCategory): ModelTier {
  return CATEGORY_CONFIGS[category].modelTier;
}
