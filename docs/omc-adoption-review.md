# OMC 스킬셋 → Life Dashboard 에이전트 시스템 채용 검토

> 검토일: 2025-02 | 검토자: learner agent
> 대상: oh-my-claudecode (OMC) v3.4 스킬셋 중 Life Dashboard 에이전트 시스템 적용 가능 항목

---

## 1. 현재 시스템 아키텍처 요약

### 에이전트 구성 (11개, agents.json)

| ID | 역할 | 카테고리 |
|----|------|----------|
| pm | 프로젝트 관리 | business |
| dev | 풀스택 개발 | dev |
| designer | UI/UX | dev |
| qa | 코드 리뷰/테스트 | dev |
| devops | CI/CD/인프라 | ops |
| growth | 마케팅/콘텐츠 | business |
| finance | 재무 관리 | business |
| researcher | 시장/기술 조사 | business |
| analyst | 데이터 분석 | business |
| assistant | 개인 비서 | ops |
| learner | 시스템 학습/최적화 | ops |

### 실행 경로

```
Dashboard UI → Relay API (PostgreSQL) → Gateway Connector (polling)
                                         ├→ spawn: executeLlmTaskWithRetry → Claude/Codex CLI
                                         └→ orchestrate: createPlan → executePlan (priority-parallel) → summarize
```

### 핵심 모듈

- `scripts/claude-executor.ts`: Claude/Codex CLI 실행, stream-json 파싱, 3-layer hung detection (stdout silence → lsof network → absolute cap)
- `scripts/gateway-connector.ts`: Relay 폴링, spawn/orchestrate 명령 실행, 재시도, task state persist, attachment 다운로드
- `scripts/orchestrator.ts`: 태스크 분해(createPlan) → 우선순위별 병렬 실행(executePlan) → 결과 요약(summarizeResults)
- `scripts/task-state-manager.ts`: PostgreSQL 기반 태스크 상태 추적, 5초 batch flush, 재시작 복구
- `src/lib/relay.ts`: PostgreSQL-backed 명령 큐, 에이전트 상태, in-memory fallback, instruction queue

### 이미 적용된 OMC 유사 패턴

| OMC 패턴 | Life Dashboard 대응 | 상태 |
|---------|---------------------|------|
| Background Execution | .then() 비동기 실행, poll loop 비블로킹 | ✅ 적용 |
| Retry with escalation | executeLlmTaskWithRetry: staleTimeout 2x 증가 | ✅ 적용 |
| Priority-based parallel | orchestrator priority 그룹 내 Promise.allSettled | ✅ 적용 |
| Task state persistence | task-state-manager → PostgreSQL | ✅ 적용 |
| Rate limit fallback | Claude → Codex 자동 폴백 | ✅ 적용 |
| Auto-recovery | error 상태 5분 후 자동 idle 복구 | ✅ 적용 |

---

## 2. 채용 추천 OMC 기능 (6개)

### 2.1 Smart Model Routing — 즉시 적용 가능

**OMC 원리**: 작업 복잡도에 따라 haiku/sonnet/opus 자동 선택

**현재 상태**: Claude CLI 기본 모델만 사용 (모델 선택 없음)

**적용 방법**: `ClaudeExecutorOptions`에 `model` 파라미터 추가, `executeClaudeTask`에서 `--model` 인자 전달

**복잡도 분류 기준**:
- **simple (haiku)**: 파일 조회, 단순 질문, 상태 확인, 요약
- **standard (sonnet)**: 기능 구현, 버그 수정, 코드 리뷰, 문서 작성
- **complex (opus)**: 아키텍처 설계, 보안 분석, 복잡 디버깅, 시스템 최적화

**에이전트별 기본 모델 매핑**:

| 에이전트 | 기본 모델 | 이유 |
|---------|----------|------|
| assistant | haiku | 브리핑, 일정 관리 (단순 정리) |
| growth | sonnet | 콘텐츠 작성은 창의성 필요 |
| finance | haiku | 수치 정리, 보고서 양식 작성 |
| dev | sonnet | 코드 구현이 주 업무 |
| designer | sonnet | UI 스타일링, 디자인 판단 |
| qa | sonnet | 코드 리뷰, 테스트 작성 |
| pm | sonnet | 작업 분해, 계획 수립 |
| researcher | sonnet | 조사, 비교 분석 |
| analyst | sonnet | 데이터 분석 |
| devops | sonnet | 인프라 진단 |
| learner | opus | 패턴 분석, 시스템 최적화 (복잡 추론) |
| planner (orchestrator 내부) | sonnet | 태스크 분해 |
| summarizer (orchestrator 내부) | haiku | 결과 요약은 haiku로 충분 |

**구현 변경점**:
1. `agents.json`에 `defaultModel` 필드 추가
2. `ClaudeExecutorOptions`에 `model?: string` 추가
3. `executeClaudeTask`에서 `args.push("--model", options.model)` 추가
4. `gateway-connector.ts`에서 agent config의 defaultModel 참조

**예상 토큰 절감**: 30-50% (특히 planner/summarizer haiku 전환, assistant/finance haiku 전환)

---

### 2.2 Delegation Categories — 중기 적용

**OMC 원리**: 작업 유형에 따라 model tier, temperature, thinking budget 자동 설정

**현재 상태**: 모든 태스크가 동일 설정으로 실행

**카테고리 → 설정 매핑**:

| 카테고리 | 모델 | Temperature | Timeout | 용도 |
|---------|------|-------------|---------|------|
| quick | haiku | 0.1 | 2분 | 상태 조회, 단순 읽기 |
| writing | sonnet | 0.5 | 5분 | 문서 작성, 보고서 |
| standard | sonnet | 0.3 | 5분 | 코드 구현, 리뷰 |
| visual | sonnet | 0.7 | 5분 | UI/UX 작업 |
| ultrabrain | opus | 0.3 | 10분 | 아키텍처, 복잡 디버깅 |

**적용 위치**: `orchestrator.ts`의 `SubTask` 인터페이스에 `category` 필드 추가

```typescript
interface SubTask {
  agentId: string;
  task: string;
  priority: number;
  category?: "quick" | "writing" | "standard" | "visual" | "ultrabrain";
}
```

**createPlan 프롬프트 변경**: 각 서브태스크에 category 태깅 요청

**예상 토큰 절감**: 20-30%

---

### 2.3 Verification-Before-Completion — 즉시 적용

**OMC 원리**: 에이전트가 "완료"를 선언하기 전 반드시 검증 증거 제시

**현재 문제**: 에이전트가 "구현했습니다"라고 말해도 실제로 빌드/테스트 실패 가능. exitCode 0이면 무조건 성공으로 처리.

**적용 방법**: 에이전트 시스템 프롬프트에 검증 프로토콜 추가

```
## 완료 프로토콜 (필수)
작업 완료를 선언하기 전 반드시:
1. 변경사항의 증거를 구체적으로 제시할 것 (수정한 파일 경로, 핵심 변경 내용)
2. "should", "probably", "seems to" 등 불확실한 표현 대신 확인된 사실만 기술
3. 실패하거나 미완료된 부분이 있으면 정직하게 보고 (부분 성공도 가치 있음)
4. 다음 단계가 필요한 경우 구체적으로 명시
```

**적용 대상**: dev, qa, devops 에이전트 (코드/인프라 변경 수행)

**예상 효과**: 불필요한 재작업 50% 감소

---

### 2.4 Context Persistence (오케스트레이션 컨텍스트 전달) — 중기 적용

**OMC 원리**: 이전 작업 결과를 다음 작업의 컨텍스트로 전달

**현재 문제**: orchestrator의 각 서브태스크가 독립적으로 실행됨. 이전 에이전트의 출력이 다음 에이전트에 전달되지 않아 중복 탐색 발생.

**예시**: architect가 "React Context 사용 권장" → dev는 이를 모르고 Redux 구현 시작

**적용 방법**: `executePlan`에서 이전 priority 그룹 결과를 다음 그룹의 task 프롬프트에 주입

```typescript
// executePlan 수정 (pseudo-code)
for (const priority of sortedPriorities) {
  const group = priorityGroups.get(priority);

  // 이전 결과를 컨텍스트로 주입
  if (previousResults.length > 0) {
    const contextSummary = previousResults
      .filter(r => r.success)
      .map(r => `[${r.agentId}] ${r.output?.slice(-1000)}`)
      .join("\n---\n");

    for (const { subtask } of group) {
      subtask.task = `## 이전 단계 결과 (참고)\n${contextSummary}\n\n## 당신의 작업\n${subtask.task}`;
    }
  }

  // 실행...
  previousResults.push(...batchResults);
}
```

**예상 토큰 절감**: 15-25% (중복 탐색 감소)

---

### 2.5 Ecomode 오케스트레이션 — 장기 적용

**OMC 원리**: Haiku/Sonnet 에이전트 위주 병렬 실행으로 토큰 절약

**적용 방법**: 오케스트레이션에 비용 최적화 모드 도입

```
Ecomode 오케스트레이션 흐름:
1. createPlan 시 각 서브태스크에 model_tier 지정 (low/medium/high)
2. 총 비용 예산 설정 (예: 전체 태스크에 $1.00 이하)
3. low tier → haiku (staleTimeout 2분)
4. medium tier → sonnet (staleTimeout 5분)
5. high tier → opus (staleTimeout 10분, 정말 필요할 때만)
```

**구현 변경점**:
- `createPlan` 프롬프트에 비용 최적화 지시 추가
- `SubTask`에 `modelTier` 필드 추가
- `gateway-connector.ts`에서 modelTier 기반 모델 선택 로직

**예상 토큰 절감**: 40-60%

---

### 2.6 disableTools 타임아웃 최적화 — 즉시 적용

**현재**: planner와 summarizer가 tool-using 태스크와 동일한 staleTimeout (5분) 사용

**문제**: disableTools=true는 단일 API 호출이므로 5분은 과도함

**개선**: disableTools=true 태스크의 staleTimeout을 120000ms(2분)로 단축

**구현**: `gateway-connector.ts`에서 orchestrate 경로의 planner/summarizer 호출 시:

```typescript
const staleTimeout = options.disableTools ? 120000 : (isComplexTask ? 600000 : 300000);
```

**예상 효과**: hung 탐지 속도 2.5배 향상 (5분 → 2분)

---

## 3. 채용 보류 OMC 기능 (4개)

### 3.1 Ultrapilot/Swarm

**보류 사유**:
- 현재 단일 gateway-connector 환경에서 경합이 없음
- Swarm의 atomic task claiming (SQLite 기반)은 단일 프로세스에서 불필요
- orchestrator의 priority 기반 병렬 실행이 충분
- 추후 다중 gateway 환경으로 확장 시 재검토

### 3.2 Ralph-loop

**보류 사유**:
- `executeLlmTaskWithRetry`가 이미 retry 로직 제공 (maxRetries 2, staleTimeout 2x 증가)
- orchestrator의 `maxSubtaskRetries`도 hung 태스크 재시도 제공
- Ralph의 핵심인 "Architect 검증 → 재시도 루프"는 대화형 세션용
- Life Dashboard의 비동기 fire-and-forget 방식과 구조적으로 맞지 않음

### 3.3 Pipeline

**보류 사유**:
- orchestrator의 priority 기반 실행이 이미 파이프라인 역할 수행
  - priority 1 먼저 → priority 2 → ... (순차)
  - 같은 priority 내 병렬 실행
- Pipeline의 "스테이지 간 데이터 전달"은 Context Persistence(2.4)로 해결
- 별도 파이프라인 인프라 구축의 복잡도 대비 효과가 낮음

### 3.4 Notepad Wisdom System

**보류 사유**:
- Life Dashboard은 이미 PostgreSQL `agent_history` 테이블로 전체 히스토리 보존
- `messages` 테이블로 에이전트 간 지식 교환 가능
- Serena memory / MEMORY.md가 영구 지식 축적 역할 수행
- 파일 기반 .omc/notepads/ 시스템은 기존 인프라와 중복

---

## 4. 단계별 도입 로드맵

### Phase 1: 즉시 적용 (1-2일) — 예상 토큰 절감 ~30%

| # | 기능 | 작업 내용 | 예상 시간 |
|---|------|----------|----------|
| 1 | Smart Model Routing | agents.json에 defaultModel 추가, executor에 --model 전달 | 2시간 |
| 2 | Verification Protocol | dev/qa/devops 시스템 프롬프트에 완료 프로토콜 추가 | 30분 |
| 3 | disableTools Timeout | planner/summarizer staleTimeout 120초로 단축 | 30분 |

### Phase 2: 중기 적용 (1주) — 추가 토큰 절감 ~20%

| # | 기능 | 작업 내용 | 예상 시간 |
|---|------|----------|----------|
| 4 | Delegation Categories | SubTask에 category 필드, createPlan 프롬프트 수정 | 4시간 |
| 5 | Context Persistence | executePlan에 이전 결과 컨텍스트 주입 로직 | 4시간 |

### Phase 3: 장기 적용 (2-4주) — 추가 토큰 절감 ~15%

| # | 기능 | 작업 내용 | 예상 시간 |
|---|------|----------|----------|
| 6 | Ecomode Orchestration | 비용 예산, modelTier 기반 모델 선택 | 1-2일 |

---

## 5. 예상 총 토큰 절감 효과

| 단계 | 적용 기능 | 절감율 | 누적 절감 |
|------|----------|--------|----------|
| Phase 1 | Model Routing + Verification + Timeout | ~30% | 30% |
| Phase 2 | Categories + Context | ~20% | 44% |
| Phase 3 | Ecomode | ~15% | 52% |

> 주의: 절감율은 현재 사용 패턴 기준 추정치. 실제 효과는 태스크 유형 분포에 따라 달라짐.

---

## 6. OMC ↔ Life Dashboard 용어 매핑

| OMC 개념 | Life Dashboard 대응 |
|---------|---------------------|
| Task tool (subagent) | executeLlmTaskWithRetry |
| orchestrate skill | orchestrator.ts (createPlan → executePlan) |
| architect verification | 해당 없음 (Verification Protocol로 대체) |
| ralph-loop | retry + requeue 패턴 |
| ultrawork parallelism | priority 그룹 내 Promise.allSettled |
| Background execution | 비동기 .then() 패턴 (poll loop 비블로킹) |
| Smart Model Routing | Phase 1에서 도입 |
| Delegation Categories | Phase 2에서 도입 |
| ecomode | Phase 3에서 도입 |
| cancel | gateway-connector gracefulShutdown |
| notepad wisdom | PostgreSQL agent_history + messages |
