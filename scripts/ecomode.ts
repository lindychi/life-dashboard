/**
 * Ecomode — Token-efficient execution mode
 *
 * When activated:
 * 1. Model cap: opus → sonnet (prevents expensive opus calls)
 * 2. Prompt slimming: use slim system prompts + compact tool notices
 * 3. Output limits: enforce maxOutputTokens
 * 4. Orchestration: use haiku for planner/summarizer
 * 5. Auto-escalation: upgrade model on failure (within cap)
 */

import type { ModelTier } from "./model-router";

export interface EcomodeConfig {
  enabled: boolean;
  modelCap: ModelTier;           // 최대 허용 모델 (default: sonnet)
  promptSlimming: boolean;       // 프롬프트 최적화 활성화
  maxOutputTokens: number;       // 출력 토큰 제한 (0 = unlimited)
  useSlimSystemPrompt: boolean;  // 축약 시스템 프롬프트 사용
}

export const DEFAULT_ECOMODE: EcomodeConfig = {
  enabled: false,
  modelCap: "sonnet",
  promptSlimming: true,
  maxOutputTokens: 4000,
  useSlimSystemPrompt: true,
};

const TIER_ORDER: Record<ModelTier, number> = { haiku: 0, sonnet: 1, opus: 2 };

/**
 * Apply ecomode model cap: if selected model exceeds cap, downgrade
 */
export function applyEcomodeCap(
  model: ModelTier,
  ecoConfig: EcomodeConfig,
): ModelTier {
  if (!ecoConfig.enabled) return model;

  const capOrder = TIER_ORDER[ecoConfig.modelCap];
  const modelOrder = TIER_ORDER[model];

  return modelOrder > capOrder ? ecoConfig.modelCap : model;
}

/**
 * Determine if a failed result warrants model escalation
 *
 * Escalation conditions:
 * - Task failed (not hung — hung retries with same model)
 * - Output too short (model may not have understood task)
 */
export function shouldEscalate(
  model: ModelTier,
  result: { success: boolean; exitCode?: number; output?: string },
): boolean {
  // Don't escalate hung tasks (exitCode -2) — those need timeout adjustment, not model change
  if (result.exitCode === -2) return false;

  // Escalate on failure
  if (!result.success) return true;

  // Escalate if output is suspiciously short (model may not have understood)
  if (result.output && result.output.length < 50) return true;

  return false;
}

/**
 * Get the next model tier up (for escalation)
 * Returns null if already at highest tier
 */
export function escalateModel(current: ModelTier): ModelTier | null {
  if (current === "haiku") return "sonnet";
  if (current === "sonnet") return "opus";
  return null;  // opus는 더 이상 올릴 수 없음
}

/**
 * Build slim tool notice for ecomode (saves ~70 tokens vs full notice)
 */
export function getSlimToolNotice(allowedTools: string, allowBash: boolean): string {
  const tools = allowBash ? `${allowedTools},Bash` : allowedTools;
  return `\n\n도구: ${tools} 만 사용. Bash 금지.`;
}

/**
 * Build full tool notice (current default, ~100 tokens)
 */
export function getFullToolNotice(allowedTools: string, allowBash: boolean, disableTools: boolean): string {
  if (disableTools) {
    return "\n\n## 시스템 제약 (필수 준수)\n당신은 도구 사용이 비활성화되어 있습니다. 분석과 텍스트 응답만 가능합니다. 코드 실행, 파일 수정, 쉘 명령 실행은 절대 시도하지 마세요.";
  }

  const tools = allowBash ? `${allowedTools},Bash` : allowedTools;
  return `\n\n## 시스템 제약 (필수 준수)\n사용 가능한 도구: ${tools}\n위 목록에 없는 도구(특히 Bash/터미널/쉘 명령)는 절대 사용하지 마세요. 승인 프롬프트가 표시되면 프로세스가 중단됩니다.\n실행이 필요한 작업(git, 배포, npm 등)은 직접 실행하지 말고, 필요한 명령어를 텍스트로 제안만 해주세요.`;
}

/**
 * Select appropriate tool notice based on ecomode and model
 */
export function selectToolNotice(
  allowedTools: string,
  options: {
    ecomode: boolean;
    model: ModelTier;
    allowBash: boolean;
    disableTools: boolean;
  },
): string {
  if (options.disableTools) {
    return getFullToolNotice(allowedTools, false, true);
  }

  // Use slim notice for ecomode or haiku models
  if (options.ecomode || options.model === "haiku") {
    return getSlimToolNotice(allowedTools, options.allowBash);
  }

  return getFullToolNotice(allowedTools, options.allowBash, false);
}

/**
 * Build optimized system prompt for ecomode
 * Uses slim prompt when available for ecomode/haiku models
 */
export function buildOptimizedSystemPrompt(
  fullPrompt: string,
  slimPrompt: string | undefined,
  options: {
    ecomode: boolean;
    model: ModelTier;
    category?: string;
  },
): string {
  const useSlim = options.ecomode || options.model === "haiku";

  // Base prompt selection
  const basePrompt = useSlim && slimPrompt ? slimPrompt : fullPrompt;

  // Category-specific suffix
  let categorySuffix = "";
  if (options.category === "quick") {
    categorySuffix = "\n간결하게 핵심만 답하세요.";
  } else if (options.category === "ultrabrain") {
    categorySuffix = "\n깊이 있게 분석하고 근거를 제시하세요.";
  }

  return basePrompt + categorySuffix;
}
