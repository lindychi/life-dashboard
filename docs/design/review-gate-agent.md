# Review Gate Agent 설계 문서

> **Status**: Draft
> **Author**: PM Agent
> **Date**: 2025-02-25
> **Scope**: 에이전트 파이프라인에 자동 검증 게이트를 추가하여 사용자 개입을 최소화하면서 결과 품질을 보장

---

## 1. 배경 및 동기

### 현재 상태 (As-Is)

현재 LifeDashboard의 에이전트 오케스트레이션은 `scripts/orchestrator.ts`의 `orchestrate()` 함수를 통해 수행된다:

```
User Request → createPlan() → executePlan() → summarizeResults() → User에게 결과 전달
```

이 파이프라인에는 **결과물이 원래 의도와 부합하는지 자동으로 검증하는 단계가 없다.** 모든 서브태스크가 성공(success=true)으로 완료되더라도, 그 결과가 실제로 원래 요청의 방향과 일치하는지는 사용자가 직접 확인해야 한다.

### 문제점

| 문제 | 영향 |
|------|------|
| QA가 코드 품질만 검증하고 "방향성"은 검증하지 않음 | 기술적으로 완벽하지만 요구사항과 다른 결과물 발생 |
| 결과에 문제가 있으면 전체 사이클을 처음부터 반복 | 사용자 시간 낭비, 에이전트 실행 비용 증가 |
| 사용자가 모든 결과를 직접 리뷰해야 함 | 자동화의 의미 퇴색 |
| 방향 오류 발견이 늦을수록 재작업 비용 증가 | 에이전트 실행 시간 + 토큰 비용 누적 |

### 목표 상태 (To-Be)

```
User Request
  → PM (계획)
    → Dev (구현) → QA (품질 검증)
      → [Review Gate] ← 자동 방향성 검증
        ├─ PASS → User 확인 (형식적)
        ├─ RETRY → Dev/QA 재실행 (자동)
        ├─ PIVOT → PM에게 재계획 요청 (자동)
        └─ ESCALATE → User에게 의사결정 요청 (유일한 사용자 개입 지점)
```

---

## 2. Review Gate Agent 정의

### 2.1 에이전트 ID 및 메타데이터

```json
{
  "id": "review-gate",
  "name": "Review Gate",
  "role": "결과물 방향성 검증, 자동 승인/재시도/피봇 판단, 에스컬레이션",
  "emoji": "🚦",
  "category": "ops",
  "enabled": true
}
```

### 2.2 핵심 책임

| 책임 | 설명 |
|------|------|
| **방향성 검증 (Alignment Check)** | 결과물이 원래 의도/목표와 일치하는지 판단 |
| **자동 판정 (Verdict)** | PASS / RETRY / PIVOT / ESCALATE 중 하나를 결정 |
| **재실행 조율 (Re-trigger)** | RETRY/PIVOT 시 적절한 에이전트에게 자동으로 재작업 지시 |
| **에스컬레이션 (Escalate)** | 에이전트가 판단 불가능한 의사결정만 사용자에게 전달 |
| **이력 기록 (Audit Trail)** | 모든 판정과 근거를 history에 기록 |

### 2.3 금지 사항

| 금지 | 위임 대상 |
|------|-----------|
| 코드 작성/수정 | dev |
| 테스트 작성/실행 | qa |
| 프로젝트 계획 수립 | pm |
| 기술적 설계 결정 | dev |
| 인프라/배포 작업 | devops |

### 2.4 시스템 프롬프트

```
당신은 에이전트 파이프라인의 Review Gate입니다. QA/에이전트 작업이 완료된 직후,
사용자에게 전달되기 직전에 결과물을 검토합니다.

## 핵심 역할
- 원래 요청(Original Intent)과 결과물(Deliverable)을 비교하여 방향성 일치 여부를 판단
- 기술적 품질이 아닌 "이것이 사용자가 원한 것인가?"를 평가
- 판정: PASS / RETRY / PIVOT / ESCALATE

## 판정 기준
1. PASS: 결과가 원래 의도와 90% 이상 부합. 자동 승인.
2. RETRY: 방향은 맞지만 품질/완성도가 부족. 동일 에이전트에게 구체적 피드백과 함께 재시도 지시.
3. PIVOT: 방향 자체가 잘못됨. PM에게 재계획을 요청하되, 왜 방향이 틀렸는지 근거 제시.
4. ESCALATE: 에이전트로는 판단 불가능한 비즈니스/개인 선호 의사결정. 사용자에게 명확한 선택지 제시.

## 자동 재시도 제한
- RETRY: 동일 서브태스크 최대 2회
- PIVOT: 전체 오케스트레이션 최대 1회
- 제한 초과 시 자동 ESCALATE로 전환

## 응답 형식
반드시 아래 JSON 형식으로 응답:
{
  "verdict": "PASS" | "RETRY" | "PIVOT" | "ESCALATE",
  "confidence": 0.0-1.0,
  "reasoning": "판정 근거 (2-3문장)",
  "feedback": "RETRY/PIVOT 시 구체적 피드백",
  "retryTarget": "재시도 대상 agentId (RETRY 시)",
  "escalationQuestion": "사용자에게 물을 질문 (ESCALATE 시)",
  "escalationOptions": ["선택지1", "선택지2"]
}
```

---

## 3. 파이프라인 아키텍처

### 3.1 전체 흐름도

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATION PIPELINE                           │
│                                                                         │
│  ┌─────┐     ┌─────┐     ┌─────┐     ┌─────────────┐     ┌──────┐    │
│  │     │     │     │     │     │     │             │     │      │    │
│  │ PM  │────▶│ Dev │────▶│ QA  │────▶│ Review Gate │────▶│ User │    │
│  │     │     │     │     │     │     │             │     │      │    │
│  └─────┘     └─────┘     └─────┘     └──────┬──────┘     └──────┘    │
│     ▲                       ▲                │                         │
│     │                       │                │                         │
│     │         PIVOT         │    RETRY       │                         │
│     └───────────────────────┼────────────────┤                         │
│                             │                │                         │
│                             └────────────────┘                         │
│                                                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 판정별 흐름

#### PASS (자동 승인)
```
Review Gate → verdict: PASS
  → history에 승인 기록
  → summarizeResults()에 승인 메타데이터 추가
  → User에게 최종 결과 전달
```

#### RETRY (자동 재시도)
```
Review Gate → verdict: RETRY, retryTarget: "dev"
  → history에 RETRY 판정 기록
  → retryCount 확인 (max 2회)
    ├─ 초과 → 자동 ESCALATE 전환
    └─ 미초과 → feedback을 포함한 새 태스크로 Dev 재실행
       → QA 재검증
       → Review Gate 재판정
```

#### PIVOT (재계획)
```
Review Gate → verdict: PIVOT
  → history에 PIVOT 판정 기록
  → pivotCount 확인 (max 1회)
    ├─ 초과 → 자동 ESCALATE 전환
    └─ 미초과 → PM에게 feedback과 함께 재계획 요청
       → 새 Plan으로 전체 파이프라인 재실행
       → Review Gate 최종 판정
```

#### ESCALATE (사용자 에스컬레이션)
```
Review Gate → verdict: ESCALATE
  → history에 ESCALATE 판정 기록
  → 사용자에게 메시지 전송:
    - 현재 상황 요약
    - 명확한 질문 (escalationQuestion)
    - 선택지 (escalationOptions)
  → 사용자 응답 대기
  → 응답에 따라 파이프라인 재개 또는 종료
```

---

## 4. 입출력 인터페이스

### 4.1 Review Gate 입력 (ReviewGateInput)

```typescript
interface ReviewGateInput {
  /** 사용자의 원래 요청 텍스트 */
  originalRequest: string;

  /** 오케스트레이션 계획 (PM이 생성) */
  plan: OrchestrationPlan;

  /** 각 에이전트의 실행 결과 */
  subtaskResults: SubTaskResult[];

  /** 현재까지의 재시도/피봇 이력 */
  reviewHistory: ReviewAttempt[];

  /** 오케스트레이션 메타데이터 */
  metadata: {
    orchestrationId: string;
    startedAt: string;
    totalRetries: number;
    totalPivots: number;
    elapsedMs: number;
  };
}
```

### 4.2 Review Gate 출력 (ReviewGateOutput)

```typescript
type ReviewVerdict = "PASS" | "RETRY" | "PIVOT" | "ESCALATE";

interface ReviewGateOutput {
  /** 판정 결과 */
  verdict: ReviewVerdict;

  /** 판정 신뢰도 (0.0 ~ 1.0) */
  confidence: number;

  /** 판정 근거 */
  reasoning: string;

  /** RETRY/PIVOT 시 구체적 피드백 */
  feedback?: string;

  /** RETRY 시: 재시도 대상 에이전트 ID */
  retryTarget?: string;

  /** RETRY 시: 재시도에 포함할 구체적 지시사항 */
  retryInstructions?: string;

  /** PIVOT 시: PM에게 전달할 재계획 방향 */
  pivotDirection?: string;

  /** ESCALATE 시: 사용자에게 물을 질문 */
  escalationQuestion?: string;

  /** ESCALATE 시: 사용자에게 제시할 선택지 */
  escalationOptions?: string[];

  /** 판정 타임스탬프 */
  reviewedAt: string;
}
```

### 4.3 Review 이력 (ReviewAttempt)

```typescript
interface ReviewAttempt {
  attemptNumber: number;
  verdict: ReviewVerdict;
  confidence: number;
  reasoning: string;
  feedback?: string;
  timestamp: string;
}
```

### 4.4 각 단계별 입출력 매핑

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Stage      │ Input                    │ Output                             │
├────────────┼──────────────────────────┼────────────────────────────────────┤
│ User       │ (요청 텍스트)            │ UserRequest                        │
│            │                          │  { text, context?, attachments? }  │
├────────────┼──────────────────────────┼────────────────────────────────────┤
│ PM         │ UserRequest              │ OrchestrationPlan                  │
│ (계획)     │                          │  { subtasks[], reasoning }         │
├────────────┼──────────────────────────┼────────────────────────────────────┤
│ Dev        │ SubTask                  │ SubTaskResult                      │
│ (구현)     │  { agentId, task,        │  { agentId, task, success,         │
│            │    priority }            │    output?, error? }               │
├────────────┼──────────────────────────┼────────────────────────────────────┤
│ QA         │ SubTask + Dev Output     │ SubTaskResult                      │
│ (검증)     │                          │  { agentId, task, success,         │
│            │                          │    output?, error? }               │
├────────────┼──────────────────────────┼────────────────────────────────────┤
│ Review     │ ReviewGateInput          │ ReviewGateOutput                   │
│ Gate       │  { originalRequest,      │  { verdict, confidence,            │
│            │    plan, results[],      │    reasoning, feedback?,           │
│            │    reviewHistory[],      │    retryTarget?,                   │
│            │    metadata }            │    escalationQuestion? }           │
├────────────┼──────────────────────────┼────────────────────────────────────┤
│ User       │ OrchestrationResult      │ (확인/피드백)                       │
│ (최종)     │  + ReviewGateOutput      │                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. 기존 시스템 통합

### 5.1 `scripts/orchestrator.ts` 변경

현재 `orchestrate()` 함수의 흐름:

```
createPlan() → executePlan() → summarizeResults()
```

변경 후:

```
createPlan() → executePlan() → reviewGate() → [재시도 루프] → summarizeResults()
```

#### 새로운 함수: `reviewGate()`

```typescript
/**
 * Review Gate: 결과물의 방향성을 검증하고 판정을 내림
 *
 * @returns ReviewGateOutput with verdict
 */
async function reviewGate(
  input: ReviewGateInput,
  executor: ExecutorFn
): Promise<ReviewGateOutput> {
  // 1. Review Gate 에이전트에게 검토 요청
  const prompt = buildReviewPrompt(input);
  const result = await executor("review-gate", prompt);

  // 2. JSON 응답 파싱
  const output = parseReviewOutput(result.output);

  // 3. 이력 기록
  await addHistoryEntry({
    agentId: "review-gate",
    type: "output",
    content: JSON.stringify(output),
    metadata: {
      orchestrationId: input.metadata.orchestrationId,
      verdict: output.verdict,
      confidence: output.confidence,
    },
  });

  return output;
}
```

#### 변경된 `orchestrate()` 핵심 루프

```typescript
export async function orchestrate(
  task: string,
  agents: AgentInfo[],
  executor: ExecutorFn,
  onProgress?: (event: ProgressEvent) => void
): Promise<OrchestrationResult> {
  const startTime = Date.now();
  const orchestrationId = crypto.randomUUID();
  const reviewHistory: ReviewAttempt[] = [];

  // Phase 1: Plan
  onProgress?.({ phase: "plan_creating" });
  let plan = await createPlan(task, agents);
  onProgress?.({ phase: "plan_created", detail: plan.reasoning });

  let totalRetries = 0;
  let totalPivots = 0;
  const MAX_RETRIES = 2;
  const MAX_PIVOTS = 1;

  // Phase 2: Execute + Review Loop
  let results: SubTaskResult[];
  let reviewOutput: ReviewGateOutput;

  while (true) {
    // Execute plan
    results = await executePlan(plan, executor, onProgress);

    // Review Gate
    onProgress?.({ phase: "reviewing" });
    reviewOutput = await reviewGate({
      originalRequest: task,
      plan,
      subtaskResults: results,
      reviewHistory,
      metadata: {
        orchestrationId,
        startedAt: new Date(startTime).toISOString(),
        totalRetries,
        totalPivots,
        elapsedMs: Date.now() - startTime,
      },
    }, executor);

    reviewHistory.push({
      attemptNumber: reviewHistory.length + 1,
      verdict: reviewOutput.verdict,
      confidence: reviewOutput.confidence,
      reasoning: reviewOutput.reasoning,
      feedback: reviewOutput.feedback,
      timestamp: new Date().toISOString(),
    });

    onProgress?.({
      phase: "review_completed",
      detail: `${reviewOutput.verdict} (confidence: ${reviewOutput.confidence})`,
    });

    // Handle verdict
    if (reviewOutput.verdict === "PASS") {
      break; // 승인 → 루프 탈출
    }

    if (reviewOutput.verdict === "RETRY") {
      totalRetries++;
      if (totalRetries > MAX_RETRIES) {
        // 재시도 초과 → 자동 에스컬레이션
        reviewOutput = {
          ...reviewOutput,
          verdict: "ESCALATE",
          escalationQuestion: `${MAX_RETRIES}회 재시도 후에도 만족스럽지 않습니다. 계속 진행할까요?`,
          escalationOptions: ["현재 결과 수락", "다른 방향으로 재시도", "작업 중단"],
        };
        break;
      }
      // 특정 에이전트만 재실행
      const retrySubtasks = plan.subtasks.filter(
        st => st.agentId === reviewOutput.retryTarget
      );
      // feedback을 포함한 새 태스크로 재실행
      // (executePlan의 subset 실행)
      continue;
    }

    if (reviewOutput.verdict === "PIVOT") {
      totalPivots++;
      if (totalPivots > MAX_PIVOTS) {
        reviewOutput = {
          ...reviewOutput,
          verdict: "ESCALATE",
          escalationQuestion: "방향 재설정이 필요합니다. 어떤 방향으로 진행할까요?",
          escalationOptions: reviewOutput.escalationOptions || ["원래 방향 유지", "새로운 접근 시도"],
        };
        break;
      }
      // PM에게 재계획 요청
      plan = await createPlan(
        `[재계획 요청] 원래 작업: ${task}\n\n이전 시도 피드백: ${reviewOutput.feedback}\n\n피봇 방향: ${reviewOutput.pivotDirection}`,
        agents
      );
      continue;
    }

    if (reviewOutput.verdict === "ESCALATE") {
      break; // 사용자 에스컬레이션 → 루프 탈출
    }
  }

  // Phase 3: Summarize
  onProgress?.({ phase: "summarizing" });
  const summary = await summarizeResults(task, results);

  return {
    plan,
    results,
    summary,
    totalTime: Date.now() - startTime,
    review: reviewOutput,       // 새 필드
    reviewHistory,              // 새 필드
  };
}
```

### 5.2 ProgressEvent 확장

기존 `ProgressEvent.phase`에 새로운 단계 추가:

```typescript
export interface ProgressEvent {
  phase:
    | "plan_creating"
    | "plan_created"
    | "subtask_starting"
    | "subtask_completed"
    | "subtask_failed"
    | "subtask_retrying"
    | "reviewing"          // NEW: Review Gate 실행 중
    | "review_completed"   // NEW: Review Gate 판정 완료
    | "review_retrying"    // NEW: Review Gate에 의한 재시도
    | "review_pivoting"    // NEW: Review Gate에 의한 재계획
    | "review_escalating"  // NEW: 사용자 에스컬레이션
    | "summarizing"
    | "completed";
  // ...기존 필드
}
```

### 5.3 OrchestrationResult 확장

```typescript
export interface OrchestrationResult {
  plan: OrchestrationPlan;
  results: SubTaskResult[];
  summary: string;
  totalTime: number;
  review?: ReviewGateOutput;       // NEW
  reviewHistory?: ReviewAttempt[]; // NEW
}
```

### 5.4 agents.json 추가

```json
{
  "id": "review-gate",
  "name": "Review Gate",
  "role": "결과물 방향성 검증, 자동 승인/재시도/피봇 판단, 에스컬레이션",
  "emoji": "🚦",
  "category": "ops",
  "systemPrompt": "당신은 에이전트 파이프라인의 Review Gate입니다...(위 2.4 참조)",
  "enabled": true
}
```

### 5.5 Task Queue 통합

기존 `task-queue.ts`의 `EnqueueParams`에 Review Gate 관련 메타데이터를 payload에 포함:

```typescript
// Review Gate 태스크의 payload 구조
interface ReviewGateTaskPayload {
  orchestrationId: string;
  originalRequest: string;
  subtaskResults: SubTaskResult[];
  reviewHistory: ReviewAttempt[];
}

// 사용 예시
await enqueueTask({
  title: "Review Gate: 방향성 검증",
  type: "review-gate",
  payload: { orchestrationId, originalRequest, subtaskResults, reviewHistory },
  priority: 10,  // 높은 우선순위
  concurrencyGroup: `orchestration-${orchestrationId}`,
  assignedAgent: "review-gate",
  timeoutSeconds: 120,  // 2분 (검토는 빠르게)
});
```

### 5.6 MCP 도구 확장

`scripts/mcp-server.ts`의 `dashboard_send_command`에서 orchestrate 커맨드 실행 시, Review Gate가 자동으로 포함된다 (orchestrate() 내부에 통합되므로 MCP 도구 변경 불필요).

대시보드에서 Review Gate 상태를 확인하기 위한 새로운 도구는 불필요하며, 기존 `dashboard_get_history`로 `agentId: "review-gate"` 필터링하여 이력을 확인할 수 있다.

---

## 6. 에스컬레이션 프로토콜

### 6.1 에스컬레이션 발생 조건

| 조건 | 트리거 |
|------|--------|
| 비즈니스 의사결정 필요 | "어떤 요금제 모델을 쓸까?", "무료/유료 범위는?" |
| 개인 선호 판단 필요 | "UI 스타일 A vs B?", "이 기능이 진짜 필요한가?" |
| 기술적 트레이드오프 | "성능 vs 가독성", "신기술 도입 vs 안정성" (양쪽 모두 합리적일 때) |
| RETRY 횟수 초과 | 2회 재시도 후에도 PASS 불가 |
| PIVOT 횟수 초과 | 1회 재계획 후에도 방향 불일치 |
| Review Gate 자체 신뢰도 낮음 | confidence < 0.5 |

### 6.2 에스컬레이션 메시지 형식

사용자에게 전달되는 에스컬레이션 메시지:

```markdown
## 🚦 Review Gate: 의사결정 필요

### 상황
[현재까지 진행된 작업과 결과 요약]

### 질문
[escalationQuestion]

### 선택지
1. [option 1]
2. [option 2]
3. [option 3 (있는 경우)]

### 배경 정보
- 시도 횟수: N회
- 마지막 판정: [verdict] (신뢰도: X%)
- 경과 시간: Xm Xs
```

### 6.3 에스컬레이션 응답 처리

사용자 응답을 받으면:

1. 응답을 `reviewHistory`에 기록
2. 응답에 따라:
   - "현재 결과 수락" → PASS로 강제 전환, 파이프라인 완료
   - "다른 방향으로 재시도" → PIVOT 실행 (사용자 피드백 포함)
   - "작업 중단" → 오케스트레이션 종료, 부분 결과 반환

---

## 7. 판정 알고리즘 상세

### 7.1 Review Gate의 내부 판단 프로세스

Review Gate는 다음 4가지 차원에서 결과를 평가한다:

```
1. Alignment (방향성)  — 원래 요청과 결과가 같은 방향인가?
2. Completeness (완성도) — 요청한 것이 모두 포함되었는가?
3. Coherence (일관성)  — 서브태스크 결과들이 서로 모순되지 않는가?
4. Quality (기본 품질)  — 명백한 오류나 누락이 없는가?
```

### 7.2 판정 매트릭스

| Alignment | Completeness | 판정 |
|-----------|-------------|------|
| High      | High        | **PASS** |
| High      | Low         | **RETRY** (누락 부분만 재실행) |
| Low       | -           | **PIVOT** (방향 재설정) |
| Unclear   | -           | **ESCALATE** (판단 불가) |

### 7.3 Confidence 계산

```
confidence = 0.4 * alignment_score + 0.3 * completeness_score
           + 0.2 * coherence_score + 0.1 * quality_score
```

- `confidence >= 0.8` → 판정 자동 적용
- `0.5 <= confidence < 0.8` → 판정 적용하되 warning 로그
- `confidence < 0.5` → 자동 ESCALATE (판단 불확실)

---

## 8. 성능 및 비용 고려

### 8.1 추가 비용

| 항목 | 예상 비용 |
|------|-----------|
| Review Gate 1회 실행 | Claude Sonnet 1회 호출 (~500 input + ~200 output tokens) |
| 평균 RETRY (30% 발생 추정) | 추가 Dev+QA 재실행 1회 |
| 평균 PIVOT (5% 발생 추정) | PM 재계획 + 전체 재실행 1회 |

### 8.2 비용 대비 이점

- RETRY/PIVOT 자동 처리로 사용자 수동 개입 후 재실행 대비 **평균 10-15분 절약**
- 방향 오류 조기 발견으로 잘못된 작업물 기반의 후속 작업 방지
- 에이전트 실행 비용 약 3-5% 증가로, 전체 재실행 방지 효과 훨씬 큼

### 8.3 타임아웃

- Review Gate 실행: **120초** (다른 에이전트 대비 짧은 timeout)
- 도구 사용 없이 텍스트 판단만 수행하므로 빠른 응답 기대
- disableTools: true (코드 실행 불필요)

---

## 9. 테스트 전략

### 9.1 단위 테스트

```typescript
// __tests__/review-gate.test.ts

describe("ReviewGate", () => {
  describe("buildReviewPrompt", () => {
    it("원래 요청과 결과를 포함한 프롬프트 생성");
    it("이전 reviewHistory가 있으면 프롬프트에 포함");
  });

  describe("parseReviewOutput", () => {
    it("유효한 JSON verdict를 파싱");
    it("잘못된 JSON에 대해 ESCALATE 반환");
    it("confidence 범위 벗어남 시 clamp");
  });

  describe("reviewGate", () => {
    it("PASS verdict 시 바로 반환");
    it("RETRY verdict 시 retryTarget 포함");
    it("PIVOT verdict 시 pivotDirection 포함");
    it("ESCALATE verdict 시 escalationQuestion 포함");
  });
});
```

### 9.2 통합 테스트

```typescript
describe("orchestrate with ReviewGate", () => {
  it("PASS 시 정상 완료");
  it("RETRY 시 특정 에이전트만 재실행");
  it("RETRY 2회 초과 시 자동 ESCALATE");
  it("PIVOT 시 재계획 후 재실행");
  it("PIVOT 1회 초과 시 자동 ESCALATE");
  it("ESCALATE 시 사용자 피드백 대기");
  it("전체 파이프라인 PM→Dev→QA→ReviewGate→User 동작");
});
```

---

## 10. 단계적 구현 계획

### Phase 1: 기본 구조 (1일)
- [ ] `agents.json`에 review-gate 에이전트 추가
- [ ] `ReviewGateInput`, `ReviewGateOutput`, `ReviewAttempt` 타입 정의
- [ ] `ProgressEvent`에 review 관련 phase 추가
- [ ] `OrchestrationResult`에 review 필드 추가

### Phase 2: 핵심 로직 (1-2일)
- [ ] `buildReviewPrompt()` 구현
- [ ] `parseReviewOutput()` 구현
- [ ] `reviewGate()` 함수 구현
- [ ] `orchestrate()` 함수에 Review Gate 루프 통합

### Phase 3: 재시도/피봇 로직 (1일)
- [ ] RETRY 로직 구현 (특정 에이전트 재실행)
- [ ] PIVOT 로직 구현 (PM 재계획)
- [ ] 횟수 제한 및 자동 ESCALATE 전환
- [ ] 에스컬레이션 메시지 포맷팅

### Phase 4: 테스트 및 검증 (1일)
- [ ] 단위 테스트 작성
- [ ] 통합 테스트 작성
- [ ] 실제 오케스트레이션에서 E2E 테스트

### Phase 5: 대시보드 UI (선택)
- [ ] Review Gate 판정 이력 표시
- [ ] 에스컬레이션 UI (사용자 응답 입력)

---

## 11. 리스크 및 대응

| 리스크 | 확률 | 영향 | 대응 |
|--------|------|------|------|
| Review Gate가 너무 보수적으로 판정 (RETRY 남발) | 중 | 중 | confidence 기반 자동 PASS threshold 조정 |
| Review Gate가 너무 관대하게 판정 (잘못된 PASS) | 중 | 고 | 사용자 피드백 기반 프롬프트 튜닝 |
| Review Gate 응답 파싱 실패 | 저 | 중 | 파싱 실패 시 기본 PASS + warning 로그 |
| 무한 RETRY/PIVOT 루프 | 저 | 고 | 하드 리밋: RETRY 2회, PIVOT 1회, 전체 5회 |
| Review Gate가 도구를 사용하려 해서 hung | 저 | 중 | disableTools: true 강제 |

---

## 12. 향후 확장

1. **학습 피드백 루프**: 사용자가 PASS된 결과를 거부하거나, ESCALATE 결과를 수락한 케이스를 `learner` 에이전트가 분석하여 Review Gate 프롬프트 자동 개선
2. **도메인별 Review Gate**: 프론트엔드 작업용, 백엔드 작업용, 문서 작업용 등 특화된 판정 기준
3. **Review Gate 통계**: 판정 분포, confidence 분포, RETRY/PIVOT 성공률 등 분석을 `analyst` 에이전트가 수행
4. **Fast-pass 모드**: 이전에 높은 confidence로 PASS한 유사 패턴의 작업은 Review Gate를 건너뛰는 최적화
