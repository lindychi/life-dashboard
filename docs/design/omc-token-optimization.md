# OMC Token Optimization - Life Dashboard Agent System Integration

## Technical Design Document

**Version**: 1.0
**Date**: 2025-02-25
**Status**: Draft

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture Analysis](#2-current-architecture-analysis)
3. [Design 1: Smart Model Routing](#3-design-1-smart-model-routing)
4. [Design 2: Delegation Category System](#4-design-2-delegation-category-system)
5. [Design 3: Ecomode Integration](#5-design-3-ecomode-integration)
6. [Design 4: Prompt Optimization](#6-design-4-prompt-optimization)
7. [Data Flow & Architecture](#7-data-flow--architecture)
8. [Database Schema Changes](#8-database-schema-changes)
9. [Implementation Plan](#9-implementation-plan)
10. [Expected Impact](#10-expected-impact)

---

## 1. Executive Summary

현재 Life Dashboard 에이전트 시스템은 모든 작업에 동일한 Claude CLI 설정을 사용합니다. 작업 복잡도에 관계없이 동일한 모델, 동일한 프롬프트 길이, 동일한 리소스를 소비합니다.

OMC(oh-my-claudecode)의 토큰 최적화 패턴을 통합하면:

| 최적화 영역 | 예상 토큰 절감 | 구현 난이도 |
|---|---|---|
| Smart Model Routing | 30-40% | Medium |
| Delegation Categories | 10-15% | Low |
| Ecomode Integration | 20-30% | Medium |
| Prompt Optimization | 15-25% | Low |
| **총 예상 절감** | **45-60%** | - |

> 복합 절감률은 개별 절감률의 곱으로 계산 (겹치는 부분 제외)

---

## 2. Current Architecture Analysis

### 2.1 Current Data Flow

```
Dashboard UI → /api/relay/command (POST)
    → queueCommand() → relay_commands table (status: pending)
        → gateway-connector.ts pollLoop()
            → executeCommand()
                → executeLlmTaskWithRetry()
                    → executeClaudeTask()
                        → spawn("claude", [...args])
```

### 2.2 Current Pain Points

1. **모델 선택 불가**: `claude` CLI는 기본 모델만 사용. `--model` 플래그 미활용
2. **프롬프트 비효율**: 모든 에이전트가 전체 시스템 프롬프트(평균 500-800 토큰)를 매번 전송
3. **작업 분류 없음**: 단순 조회와 복잡한 분석이 동일한 리소스 소비
4. **오케스트레이션 오버헤드**: 계획(planner)과 요약(summarizer)에도 도구 포함 모드 사용
5. **staleTimeout 일괄 적용**: 복잡도 판단이 단순 regex에만 의존

### 2.3 Key Integration Points

| Component | File | Integration Method |
|---|---|---|
| CLI Executor | `scripts/claude-executor.ts` | `--model` flag 추가, 프롬프트 최적화 |
| Gateway Connector | `scripts/gateway-connector.ts` | spawn 커맨드에 model/category 파라미터 |
| Orchestrator | `scripts/orchestrator.ts` | 계획/요약 시 haiku, 실행 시 sonnet/opus |
| Relay API | `src/app/api/relay/command/route.ts` | payload에 model/category 필드 지원 |
| MCP Server | `scripts/mcp-server.ts` | send_command에 model/category 파라미터 |
| Types | `src/lib/types.ts` | 새 타입 정의 추가 |
| Agent Config | `agents.json` | 에이전트별 기본 모델/카테고리 추가 |

---

## 3. Design 1: Smart Model Routing

### 3.1 Overview

작업의 복잡도를 자동으로 판단하여 적절한 모델을 선택합니다.

```
작업 입력 → ComplexityAnalyzer → ModelSelector → claude --model <selected>
```

### 3.2 Complexity Scoring Algorithm

```typescript
// scripts/model-router.ts (NEW FILE)

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
 * 복잡도 판단 기준 (가중치 합산 방식)
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

  // Medium complexity indicators (→ sonnet)
  { name: "implement", pattern: /구현|implement|추가|add feature|create/i, weight: 10, target: "task" },
  { name: "fix_bug", pattern: /버그|bug|fix|수정|patch/i, weight: 10, target: "task" },
  { name: "test_write", pattern: /테스트|test|QA|검증/i, weight: 10, target: "task" },
  { name: "review", pattern: /검토|review|리뷰/i, weight: 10, target: "task" },
  { name: "document", pattern: /문서|document|README|릴리스 노트/i, weight: 5, target: "task" },

  // Low complexity indicators (→ haiku, negative weight)
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

const TIER_THRESHOLDS = {
  opus: 50,    // score >= 50 → opus
  sonnet: 15,  // score >= 15 → sonnet
  // score < 15 → haiku
};

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

  return {
    score,
    tier,
    reasoning: `Score ${score}: ${factors.filter(f => f.matched).map(f => f.name).join(", ")}`,
    factors,
  };
}

/**
 * Select model with explicit override support
 * Priority: explicit > agent config > complexity analysis
 */
export function selectModel(
  task: string,
  agentId: string,
  explicitModel?: ModelTier,
  agentDefaultModel?: ModelTier,
  ecomode?: boolean,
): { model: ModelTier; source: "explicit" | "agent_config" | "analysis" | "ecomode_cap" } {
  // 1. Explicit model override (from command payload)
  if (explicitModel) {
    return { model: explicitModel, source: "explicit" };
  }

  // 2. Ecomode: cap at sonnet, prefer haiku
  if (ecomode) {
    const analysis = analyzeComplexity(task, agentId);
    const cappedTier = analysis.tier === "opus" ? "sonnet" : analysis.tier;
    return { model: cappedTier, source: "ecomode_cap" };
  }

  // 3. Agent default model from config
  if (agentDefaultModel) {
    return { model: agentDefaultModel, source: "agent_config" };
  }

  // 4. Auto-analysis
  const analysis = analyzeComplexity(task, agentId);
  return { model: analysis.tier, source: "analysis" };
}
```

### 3.3 Claude CLI Integration

현재 `claude` CLI는 `--model` 플래그를 지원합니다. `executeClaudeTask`에 통합:

```typescript
// claude-executor.ts 변경사항

export interface ClaudeExecutorOptions {
  // ... existing fields ...
  model?: "haiku" | "sonnet" | "opus";  // NEW: Target model
}

// executeClaudeTask() 내부 args 구성 변경:
if (options.model) {
  args.push("--model", `claude-${options.model}-4-20250514`);
  // 또는 Claude CLI의 alias를 사용: --model haiku, --model sonnet, --model opus
}
```

### 3.4 Gateway Connector Integration

```typescript
// gateway-connector.ts spawn 핸들러 변경:

case "spawn": {
  const {
    agentId, task, systemPrompt,
    model: explicitModel,           // NEW
    delegationCategory,             // NEW
    ecomode,                        // NEW
    // ... existing fields
  } = command.payload;

  // Smart Model Selection
  const { model, source } = selectModel(
    task, agentId,
    explicitModel,
    agentConfig?.defaultModel,
    ecomode,
  );

  console.log(`   🧠 Model: ${model} (${source})`);

  executeLlmTaskWithRetry({
    // ... existing options ...
    model,                          // Pass to executor
  });
}
```

### 3.5 Agent Config Extension

```json
// agents.json 확장 (각 에이전트에 추가)
{
  "id": "dev",
  "name": "Developer",
  "defaultModel": "sonnet",     // NEW: 기본 모델
  "maxModel": "opus",           // NEW: 최대 허용 모델
  "delegationCategory": null,   // NEW: null = auto-detect
  // ... existing fields
}
```

**에이전트별 기본 모델 권장:**

| Agent | Default Model | Max Model | Rationale |
|---|---|---|---|
| pm | sonnet | opus | 분석적이지만 코드 미작성 |
| dev | sonnet | opus | 코드 구현에 sonnet 최적 |
| designer | sonnet | opus | 디자인은 sonnet으로 충분 |
| qa | sonnet | opus | 리뷰는 sonnet, 심층 보안은 opus |
| devops | haiku | sonnet | 대부분 상태 확인, 설정 텍스트 |
| growth | haiku | sonnet | 콘텐츠 작성에 haiku 충분 |
| finance | haiku | sonnet | 숫자 처리, 정형화된 보고서 |
| researcher | sonnet | opus | 조사는 sonnet, 심층 분석은 opus |
| analyst | sonnet | opus | 데이터 분석에 sonnet 최적 |
| assistant | haiku | sonnet | 브리핑, 요약은 haiku로 충분 |
| learner | sonnet | opus | 패턴 분석에 sonnet 적절 |

---

## 4. Design 2: Delegation Category System

### 4.1 Category Definitions

```typescript
// scripts/delegation-category.ts (NEW FILE)

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
    staleTimeoutMultiplier: 0.5,  // 빠른 타임아웃
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
    staleTimeoutMultiplier: 2.0,  // 긴 타임아웃
  },
  artistry: {
    modelTier: "sonnet",
    temperature: 0.9,
    thinkingBudget: "medium",
    staleTimeoutMultiplier: 1.0,
  },
};
```

### 4.2 Auto-Detection Logic

```typescript
// Category auto-detection from task keywords
const CATEGORY_PATTERNS: Array<{
  category: DelegationCategory;
  patterns: RegExp[];
  agentIds?: string[];  // 에이전트 기반 추가 감지
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

export function detectCategory(
  task: string,
  agentId: string,
  explicitCategory?: DelegationCategory,
): DelegationCategory {
  if (explicitCategory) return explicitCategory;

  // Agent-based default
  for (const rule of CATEGORY_PATTERNS) {
    if (rule.agentIds?.includes(agentId)) {
      return rule.category;
    }
  }

  // Task keyword matching (highest match wins)
  let bestMatch: { category: DelegationCategory; matchCount: number } | null = null;
  for (const rule of CATEGORY_PATTERNS) {
    const matchCount = rule.patterns.filter(p => p.test(task)).length;
    if (matchCount > 0 && (!bestMatch || matchCount > bestMatch.matchCount)) {
      bestMatch = { category: rule.category, matchCount };
    }
  }

  return bestMatch?.category || "writing";  // default: writing (balanced)
}
```

### 4.3 Integration with Executor

Category config가 executor options를 결정:

```typescript
// gateway-connector.ts에서 category → executor options 변환

const category = detectCategory(task, agentId, explicitCategory);
const config = CATEGORY_CONFIGS[category];

// Category config로 executor options 결정
const staleTimeout = baseStaleTimeout * config.staleTimeoutMultiplier;
const model = explicitModel || config.modelTier;

// CLI args에 temperature 추가 (Claude CLI 지원 시)
// 현재 claude CLI는 temperature 직접 설정 미지원이나
// --system-prompt에 지시 포함 가능
```

### 4.4 Relay Command Extension

```typescript
// payload에 새 필드 추가
interface SpawnPayload {
  agentId: string;
  task: string;
  systemPrompt?: string;
  // NEW FIELDS:
  model?: ModelTier;
  delegationCategory?: DelegationCategory;
  ecomode?: boolean;
  maxOutputTokens?: number;
}
```

---

## 5. Design 3: Ecomode Integration

### 5.1 Overview

Ecomode는 토큰 예산 제한 모드입니다. 활성화되면:

1. **모델 다운그레이드**: opus → sonnet, sonnet → haiku (가능한 경우)
2. **프롬프트 슬림화**: 시스템 프롬프트에서 불필요한 컨텍스트 제거
3. **출력 제한**: maxOutputTokens 강제 적용
4. **오케스트레이션 최적화**: 플래너에 haiku, 실행에 sonnet

### 5.2 Ecomode Activation

```typescript
// scripts/ecomode.ts (NEW FILE)

export interface EcomodeConfig {
  enabled: boolean;
  modelCap: ModelTier;           // 최대 허용 모델 (default: sonnet)
  promptSlimming: boolean;       // 프롬프트 최적화 활성화
  maxOutputTokens: number;       // 출력 토큰 제한
  useSlimSystemPrompt: boolean;  // 축약 시스템 프롬프트 사용
}

export const DEFAULT_ECOMODE: EcomodeConfig = {
  enabled: false,
  modelCap: "sonnet",
  promptSlimming: true,
  maxOutputTokens: 4000,
  useSlimSystemPrompt: true,
};

/**
 * Ecomode model cap: opus → sonnet, others unchanged
 */
export function applyEcomodeCap(
  model: ModelTier,
  ecoConfig: EcomodeConfig,
): ModelTier {
  if (!ecoConfig.enabled) return model;

  const TIER_ORDER: Record<ModelTier, number> = { haiku: 0, sonnet: 1, opus: 2 };
  const capOrder = TIER_ORDER[ecoConfig.modelCap];
  const modelOrder = TIER_ORDER[model];

  return modelOrder > capOrder ? ecoConfig.modelCap : model;
}
```

### 5.3 Activation via Command

```typescript
// MCP: dashboard_send_command의 spawn payload에 ecomode 추가
{
  "type": "spawn",
  "payload": {
    "agentId": "dev",
    "task": "Fix the login bug",
    "ecomode": true
  }
}

// 또는 orchestrate에 적용:
{
  "type": "orchestrate",
  "payload": {
    "task": "Review all error handling",
    "ecomode": true
  }
}
```

### 5.4 Orchestration Ecomode

오케스트레이션에서의 ecomode 최적화:

```
기존:
  Planner (sonnet, full prompt) → Agent1 (sonnet) → Agent2 (sonnet) → Summarizer (sonnet)

Ecomode:
  Planner (haiku, slim prompt) → Agent1 (haiku/sonnet) → Agent2 (haiku/sonnet) → Summarizer (haiku, slim prompt)
```

```typescript
// orchestrator.ts에서의 ecomode 적용

export async function createPlan(
  task: string,
  agents: AgentInfo[],
  ecomode?: boolean,   // NEW
): Promise<OrchestrationPlan> {
  const options: ClaudeExecutorOptions = {
    agentId: "planner",
    task: prompt,
    systemPrompt,
    disableTools: true,
    model: ecomode ? "haiku" : undefined,  // Ecomode: planner에 haiku
  };
  // ...
}

export async function summarizeResults(
  task: string,
  results: SubTaskResult[],
  ecomode?: boolean,   // NEW
): Promise<string> {
  const options: ClaudeExecutorOptions = {
    agentId: "summarizer",
    task: prompt,
    systemPrompt: "You are a results summarizer. Create concise summaries.",
    disableTools: true,
    model: ecomode ? "haiku" : undefined,  // Ecomode: summarizer에 haiku
  };
  // ...
}
```

### 5.5 Escalation Logic

Ecomode에서도 특정 조건에서 자동 에스컬레이션:

```typescript
/**
 * Ecomode escalation: 특정 조건에서 상위 모델로 자동 업그레이드
 */
export function shouldEscalate(
  model: ModelTier,
  result: ExecutionResult,
): boolean {
  // 실패 시 에스컬레이션
  if (!result.success && result.exitCode !== -2) {
    return true;
  }
  // 출력이 비어있거나 너무 짧으면 에스컬레이션
  if (result.output && result.output.length < 50) {
    return true;
  }
  return false;
}

export function escalateModel(current: ModelTier): ModelTier | null {
  if (current === "haiku") return "sonnet";
  if (current === "sonnet") return "opus";
  return null;  // opus는 더 이상 올릴 수 없음
}
```

---

## 6. Design 4: Prompt Optimization

### 6.1 System Prompt Slimming

현재 시스템 프롬프트가 500-800 토큰으로 모든 호출에 포함됩니다. 최적화 방안:

#### A. 핵심 프롬프트 / 전체 프롬프트 이중 체계

```typescript
// agents.json 확장
{
  "id": "dev",
  "systemPrompt": "당신은 1인 회사의 풀스택 개발자입니다...(전체 800토큰)",
  "slimPrompt": "풀스택 개발자. TypeScript/Next.js/React/PostgreSQL. 코드 구현, 버그 수정, 리팩토링 담당. 코드 리뷰→qa, UI→designer, 배포→devops 위임.", // ~80토큰
}
```

**슬림 프롬프트 사용 조건:**
- Ecomode 활성화 시
- haiku 모델 사용 시
- 단순 작업 (quick category) 시

#### B. 도구 제약 프롬프트 최적화

현재 `toolNotice`가 매번 추가됩니다 (~100 토큰):

```typescript
// 현재 (비효율)
const toolNotice = `\n\n## 시스템 제약 (필수 준수)\n사용 가능한 도구: ${ALLOWED_TOOLS}\n위 목록에 없는 도구(특히 Bash/터미널/쉘 명령)는 절대 사용하지 마세요...`;

// 최적화: 핵심만 유지 (~30 토큰)
const slimToolNotice = `\n\n도구: ${ALLOWED_TOOLS} 만 사용. Bash 금지.`;
```

#### C. 작업별 컨텍스트 최적화

```typescript
export function buildOptimizedPrompt(
  agentConfig: AgentConfig,
  task: string,
  options: {
    ecomode?: boolean;
    model?: ModelTier;
    category?: DelegationCategory;
  }
): string {
  const useSlim = options.ecomode || options.model === "haiku";

  // Base prompt
  const basePrompt = useSlim
    ? agentConfig.slimPrompt || agentConfig.systemPrompt
    : agentConfig.systemPrompt;

  // Tool notice
  const toolNotice = useSlim
    ? `\n도구: ${ALLOWED_TOOLS} 만 사용. Bash 금지.`
    : fullToolNotice;

  // Category-specific suffix
  const categorySuffix = options.category === "quick"
    ? "\n간결하게 핵심만 답하세요."
    : options.category === "ultrabrain"
      ? "\n깊이 있게 분석하고 근거를 제시하세요."
      : "";

  return basePrompt + toolNotice + categorySuffix;
}
```

### 6.2 Token Estimation

```
현재 프롬프트 비용 (에이전트당 호출):
  systemPrompt: ~600 tokens
  toolNotice: ~100 tokens
  task: ~200 tokens (variable)
  Total input overhead: ~900 tokens/call

최적화 후 (haiku + ecomode):
  slimPrompt: ~80 tokens
  slimToolNotice: ~30 tokens
  task: ~200 tokens
  Total input overhead: ~310 tokens/call

절감: ~65% input token 감소 (haiku 모드)
```

### 6.3 Context Persistence via `<remember>` Tags

오케스트레이션에서 에이전트 간 context 재사용:

```typescript
// 오케스트레이션 내 서브태스크 실행 시
// 이전 서브태스크의 핵심 결과를 다음 서브태스크에 요약 전달

const contextFromPrevious = previousResults
  .filter(r => r.success)
  .map(r => `[${r.agentId}] ${(r.output || "").slice(0, 200)}`)
  .join("\n");

const taskWithContext = contextFromPrevious
  ? `이전 작업 결과 요약:\n${contextFromPrevious}\n\n현재 작업:\n${subtask.task}`
  : subtask.task;
```

---

## 7. Data Flow & Architecture

### 7.1 Updated Data Flow

```
Dashboard UI / MCP Tool
    │
    ├── model?: "haiku" | "sonnet" | "opus"  (explicit override)
    ├── delegationCategory?: "quick" | "writing" | ...
    ├── ecomode?: boolean
    │
    ▼
/api/relay/command (POST)
    │
    ├── Validate new fields
    ├── Store in relay_commands (with model/category in payload)
    │
    ▼
gateway-connector.ts → executeCommand()
    │
    ├── Model Resolution:
    │   1. Explicit model from payload
    │   2. Ecomode cap
    │   3. Agent default model from agents.json
    │   4. Auto-analysis via ComplexityAnalyzer
    │
    ├── Category Resolution:
    │   1. Explicit from payload
    │   2. Agent default from agents.json
    │   3. Auto-detect from task keywords
    │
    ├── Prompt Optimization:
    │   1. Select full/slim prompt based on model+ecomode
    │   2. Append appropriate tool notice
    │   3. Add category-specific suffix
    │
    ▼
executeLlmTaskWithRetry()
    │
    ├── Pass --model flag to claude CLI
    ├── Use optimized system prompt
    ├── Set staleTimeout from category config
    │
    ▼
Claude API (haiku/sonnet/opus)
    │
    ├── If ecomode + failure → escalate model + retry
    │
    ▼
Result + Token Usage Tracking
```

### 7.2 Module Dependency

```
model-router.ts (NEW)
    ├── ComplexityAnalyzer
    └── ModelSelector

delegation-category.ts (NEW)
    ├── CategoryConfig
    ├── detectCategory()
    └── CATEGORY_CONFIGS

ecomode.ts (NEW)
    ├── EcomodeConfig
    ├── applyEcomodeCap()
    └── shouldEscalate()

prompt-optimizer.ts (NEW)
    ├── buildOptimizedPrompt()
    └── slimPrompt generation

claude-executor.ts (MODIFY)
    ├── Add `model` to options
    └── Add `--model` flag to CLI args

gateway-connector.ts (MODIFY)
    ├── Import model-router, delegation-category, ecomode
    ├── Resolve model/category/ecomode in spawn handler
    └── Pass optimized options to executor

orchestrator.ts (MODIFY)
    ├── Accept ecomode parameter
    ├── Use haiku for planner/summarizer in ecomode
    └── Pass model to executor

agents.json (MODIFY)
    ├── Add defaultModel per agent
    ├── Add maxModel per agent
    └── Add slimPrompt per agent

mcp-server.ts (MODIFY)
    └── Add model/category/ecomode to send_command schema
```

---

## 8. Database Schema Changes

### 8.1 No Required Schema Changes

현재 `relay_commands.payload`는 JSONB이므로 새 필드(model, delegationCategory, ecomode)를 저장하는 데 스키마 변경이 필요 없습니다.

### 8.2 Optional: Token Usage Tracking

향후 토큰 사용량 분석을 위한 선택적 테이블:

```sql
-- sql/005_token_usage.sql (OPTIONAL - Phase 3)
CREATE TABLE IF NOT EXISTS token_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  command_id UUID REFERENCES relay_commands(id) ON DELETE SET NULL,
  model TEXT NOT NULL,           -- 'haiku', 'sonnet', 'opus'
  delegation_category TEXT,
  ecomode BOOLEAN DEFAULT false,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_cost_usd NUMERIC(10, 6),
  elapsed_ms INTEGER,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_token_usage_agent ON token_usage(agent_id, created_at DESC);
CREATE INDEX idx_token_usage_model ON token_usage(model, created_at DESC);
```

---

## 9. Implementation Plan

### Phase 1: Smart Model Routing (Priority: HIGH, Effort: 3-4일)

**예상 절감: 30-40%**

| Step | Task | Files | Est. |
|---|---|---|---|
| 1.1 | `model-router.ts` 신규 작성 | `scripts/model-router.ts` | 4h |
| 1.2 | `claude-executor.ts`에 `model` 옵션 추가 | `scripts/claude-executor.ts` | 2h |
| 1.3 | `gateway-connector.ts` spawn 핸들러에 모델 라우팅 통합 | `scripts/gateway-connector.ts` | 3h |
| 1.4 | `agents.json`에 `defaultModel`/`maxModel` 추가 | `agents.json` | 1h |
| 1.5 | `orchestrator.ts` planner/summarizer에 haiku 적용 | `scripts/orchestrator.ts` | 2h |
| 1.6 | MCP 스키마 확장 (model 파라미터) | `scripts/mcp-server.ts` | 2h |
| 1.7 | Unit tests | `scripts/__tests__/model-router.test.ts` | 3h |

### Phase 2: Prompt Optimization (Priority: HIGH, Effort: 2-3일)

**예상 절감: 15-25%**

| Step | Task | Files | Est. |
|---|---|---|---|
| 2.1 | `prompt-optimizer.ts` 신규 작성 | `scripts/prompt-optimizer.ts` | 3h |
| 2.2 | `agents.json`에 `slimPrompt` 추가 (10개 에이전트) | `agents.json` | 3h |
| 2.3 | `claude-executor.ts` toolNotice 최적화 | `scripts/claude-executor.ts` | 2h |
| 2.4 | `gateway-connector.ts`에 프롬프트 빌더 통합 | `scripts/gateway-connector.ts` | 2h |
| 2.5 | Unit tests | `scripts/__tests__/prompt-optimizer.test.ts` | 2h |

### Phase 3: Delegation Categories (Priority: MEDIUM, Effort: 2일)

**예상 절감: 10-15%**

| Step | Task | Files | Est. |
|---|---|---|---|
| 3.1 | `delegation-category.ts` 신규 작성 | `scripts/delegation-category.ts` | 3h |
| 3.2 | Category config → staleTimeout 연동 | `scripts/gateway-connector.ts` | 2h |
| 3.3 | MCP 스키마 확장 (delegationCategory) | `scripts/mcp-server.ts` | 1h |
| 3.4 | Types 확장 | `src/lib/types.ts` | 1h |
| 3.5 | Unit tests | `scripts/__tests__/delegation-category.test.ts` | 2h |

### Phase 4: Ecomode Integration (Priority: MEDIUM, Effort: 3일)

**예상 절감: 20-30%**

| Step | Task | Files | Est. |
|---|---|---|---|
| 4.1 | `ecomode.ts` 신규 작성 | `scripts/ecomode.ts` | 3h |
| 4.2 | Ecomode → model cap + prompt slim 연동 | `scripts/gateway-connector.ts` | 3h |
| 4.3 | Orchestrator ecomode 지원 | `scripts/orchestrator.ts` | 3h |
| 4.4 | Escalation 로직 (실패 시 모델 업그레이드) | `scripts/ecomode.ts` | 3h |
| 4.5 | MCP 스키마 확장 (ecomode) | `scripts/mcp-server.ts` | 1h |
| 4.6 | Unit tests | `scripts/__tests__/ecomode.test.ts` | 3h |

### Phase 5: Observability (Priority: LOW, Effort: 2일)

| Step | Task | Files | Est. |
|---|---|---|---|
| 5.1 | Token usage DB 테이블 생성 | `sql/005_token_usage.sql` | 1h |
| 5.2 | Usage tracking in executor | `scripts/claude-executor.ts` | 3h |
| 5.3 | Dashboard UI에 토큰 사용량 차트 | `src/app/page.tsx` | 4h |
| 5.4 | History metadata에 model/category 기록 | `scripts/gateway-connector.ts` | 2h |

### Total Timeline

```
Week 1: Phase 1 (Model Routing) + Phase 2 (Prompt Optimization)
Week 2: Phase 3 (Categories) + Phase 4 (Ecomode)
Week 3: Phase 5 (Observability) + Testing + Tuning
```

---

## 10. Expected Impact

### 10.1 Token Cost Savings by Scenario

| Scenario | Current | After Optimization | Savings |
|---|---|---|---|
| Simple query (assistant) | ~1500 tokens (sonnet) | ~400 tokens (haiku + slim) | **73%** |
| Code implementation (dev) | ~3000 tokens (sonnet) | ~2500 tokens (sonnet + optimized prompt) | **17%** |
| Complex analysis (analyst) | ~5000 tokens (sonnet) | ~5000 tokens (opus, but fewer retries) | **0%** (quality up) |
| Orchestration (4 agents) | ~12000 tokens | ~7000 tokens (mixed models) | **42%** |
| Ecomode orchestration | ~12000 tokens | ~4500 tokens (haiku-heavy) | **63%** |

### 10.2 Performance Impact

| Metric | Current | Expected | Change |
|---|---|---|---|
| Avg response time (simple) | 15-30s | 5-10s (haiku) | **-50~67%** |
| Avg response time (complex) | 30-60s | 30-60s (opus) | No change |
| Orchestration total time | 3-5 min | 2-3 min (haiku planner) | **-30~40%** |
| Hung detection accuracy | Medium | High (category-tuned timeouts) | Improved |

### 10.3 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Haiku quality too low | Medium | Medium | Escalation logic + 에이전트별 minModel |
| Model flag not supported by CLI version | Low | High | Feature detection, graceful fallback |
| Complexity scorer inaccurate | Medium | Low | Manual override always available |
| Ecomode false economy (retries negate savings) | Low | Medium | Track retry rate per model, auto-disable if >30% |

### 10.4 Monthly Cost Projection

Assuming 500 agent tasks/month:

```
Current:  500 × 3000 tokens avg × $3/1M tokens (sonnet) = $4.50/month
After:    300 × 500 tokens (haiku) + 150 × 2500 tokens (sonnet) + 50 × 5000 tokens (opus)
        = 300 × $0.25/1M + 150 × $3/1M + 50 × $15/1M
        = $0.04 + $1.13 + $3.75 = $4.92/month

Wait — opus is expensive. Actual savings come from:
- Reducing opus calls (only when truly needed)
- Haiku for planner/summarizer (50%+ of orchestration calls)
- Slim prompts (15-25% fewer input tokens across all)
- Fewer retries (better-tuned timeouts)

Net expected savings: 35-50% of total API cost
```

---

## Appendix A: Claude CLI Model Flags

```bash
# Claude CLI v1.x model selection
claude --model claude-3-5-haiku-latest --print "task"
claude --model claude-sonnet-4-20250514 --print "task"
claude --model claude-opus-4-20250514 --print "task"

# 또는 간단한 alias (CLI 버전에 따라)
claude --model haiku --print "task"
claude --model sonnet --print "task"
claude --model opus --print "task"
```

> **Note**: Claude CLI의 정확한 `--model` 플래그 값은 설치된 버전에 따라 다를 수 있습니다. 구현 시 `claude --help`를 확인하여 정확한 모델 식별자를 사용해야 합니다.

## Appendix B: File Change Summary

| File | Action | LOC (Est.) |
|---|---|---|
| `scripts/model-router.ts` | NEW | ~150 |
| `scripts/delegation-category.ts` | NEW | ~120 |
| `scripts/ecomode.ts` | NEW | ~100 |
| `scripts/prompt-optimizer.ts` | NEW | ~80 |
| `scripts/claude-executor.ts` | MODIFY | +20 |
| `scripts/gateway-connector.ts` | MODIFY | +50 |
| `scripts/orchestrator.ts` | MODIFY | +30 |
| `scripts/mcp-server.ts` | MODIFY | +30 |
| `agents.json` | MODIFY | +40 |
| `src/lib/types.ts` | MODIFY | +15 |
| `sql/005_token_usage.sql` | NEW (optional) | ~20 |
| Tests (4 files) | NEW | ~400 |
| **Total** | | **~1055** |
