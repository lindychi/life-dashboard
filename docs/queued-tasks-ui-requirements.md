# 큐잉된 태스크 UI 표시 요구사항 문서

## 1. 현황 분석

### 1.1 현재 구현된 큐잉 시스템

Life Dashboard에는 **두 가지 독립적인 큐잉 시스템**이 존재합니다:

#### A. Relay System (Instructions Queue)
- **위치**: `src/lib/relay.ts`
- **목적**: 실행 중인 에이전트에게 후속 작업을 큐잉
- **상태**: `queued` (relay_commands 테이블)
- **데이터 구조**:
  ```typescript
  interface QueuedInstruction {
    id: string;
    agentId: string;
    content: string;
    createdAt: string;
    position: number; // 에이전트별 큐 내 순서
  }
  ```
- **동작 방식**:
  - 에이전트가 `running` 상태일 때 새 작업 요청이 들어오면 `queueInstruction()` 호출
  - `relay_commands` 테이블에 `status = 'queued'` 로 저장
  - 에이전트가 `idle` 상태가 되면 `drainQueueForIdleAgents()` 가 자동으로 큐에서 가져와 실행

#### B. Task Queue System (Priority Queue)
- **위치**: `src/lib/task-queue.ts`
- **목적**: 복잡한 우선순위 기반 태스크 스케줄링 (의존성, concurrency group 지원)
- **상태**: `pending` → `queued` → `running` → `completed`/`failed`/`dead_letter`
- **데이터 구조**:
  ```typescript
  interface Task {
    id: string;
    title: string;
    type: string;
    priority: number; // 1-100, 높을수록 우선
    status: TaskStatus;
    concurrencyGroup: string;
    assignedAgent: string | null;
    dependsOn: string[];
    // ... 기타 필드
  }
  ```
- **동작 방식**:
  - `enqueueTask()` → `status = 'pending'`
  - Orchestrator가 `dequeueReadyTask()` 호출 → 의존성 충족 + concurrency 제한 체크 → `status = 'running'`
  - 완료 시 `completeTask()` → `status = 'completed'`

### 1.2 현재 UI 표시 상태

#### 대시보드 헤더 (page.tsx:418-421)
```tsx
<span className="text-green-400">{runningCount}</span> 실행
· <span className="text-blue-400">{totalStacked}</span> 대기
```
- **`runningCount`**: `agents.filter(a => a.status === "running").length`
- **`totalStacked`**: `agents.reduce((sum, a) => sum + a.stack.length, 0)`
- ❌ **문제**: `totalStacked`는 **로컬 UI 전용 스택**으로, 실제 DB에 저장된 큐와 무관

#### AgentDashboard Props (AgentDashboard.tsx:41-44)
```tsx
pendingInstructions: Record<string, Array<{...}>>;
pendingCount: number;
queuedCommands: Record<string, Array<{...}>>;
queuedCommandsCount: number;
```
- ✅ **`pendingInstructions`**: relay system의 `queued` instructions (에이전트별 그룹)
- ✅ **`queuedCommands`**: relay system의 `pending` commands (에이전트별 그룹)
- ❌ **문제**: **컴포넌트에 전달되지만 UI에 렌더링되지 않음**

#### Status API (src/app/api/relay/status/route.ts)
```typescript
return NextResponse.json({
  pendingInstructions: instructionsByAgent, // 에이전트별로 그룹화된 queued instructions
  pendingCount: pendingInstructions.length,
  queuedCommands: commandsByAgent,         // 에이전트별로 그룹화된 pending commands
  queuedCommandsCount: pendingCmds.length,
  // ...
});
```
- ✅ 데이터는 정상적으로 제공됨
- ❌ 프론트엔드에서 활용하지 않음

---

## 2. 문제 정의

### 2.1 핵심 문제
1. **데이터는 백엔드에서 정상적으로 제공되지만, 프론트엔드에서 렌더링되지 않음**
2. **두 가지 큐잉 시스템이 혼재**하여 혼란 초래:
   - Relay System (instructions/commands) ← 현재 사용 중
   - Task Queue System (priority queue) ← 사용되지 않음
3. **용어 혼란**:
   - `pendingInstructions` = "queued" 상태 (에이전트가 busy일 때 대기)
   - `queuedCommands` = "pending" 상태 (gateway가 아직 poll하지 않음)
   - `totalStacked` = 로컬 UI 전용 스택 (DB와 무관)

### 2.2 사용자 기대 동작
사용자가 "orchest rate" 입력 → orchestrate API 호출 → 큐잉됨 → **UI에서 "큐에 N개 대기 중" 표시 필요**

---

## 3. UX 요구사항

### 3.1 대시보드 헤더 개선
**현재**:
```
🟢 연결됨 · 1 실행 · 3 대기
```

**개선안**:
```
🟢 연결됨 · 1 실행 · 3 대기 · 🕒 5개 큐잉됨
```
- **"대기"**: 로컬 UI 스택 (legacy, 제거 고려)
- **"큐잉됨"**: DB에 저장된 실제 큐 (pendingCount + queuedCommandsCount)

### 3.2 에이전트별 큐 표시
**위치**: AgentDashboard → AgentSection

**표시 방법**: 각 에이전트 카드에 pending instructions/commands 수 표시
```tsx
<div className="agent-card">
  <h3>{agent.name}</h3>
  <span>Status: {agent.status}</span>
  {(pendingInstructions[agent.id]?.length || 0) > 0 && (
    <div className="queued-badge">
      🕒 {pendingInstructions[agent.id].length}개 대기 중
    </div>
  )}
</div>
```

### 3.3 큐 상세 보기 (선택적)
**위치**: 별도 탭 또는 모달

**기능**:
- 에이전트별 큐잉된 작업 목록
- 작업 제목/내용 미리보기
- 큐 내 순서 (position) 표시
- 취소 버튼 (optional)

**예시 UI**:
```
┌─ dev 에이전트 큐 (3개) ───────────────────┐
│ 1. [spawn] 테스트 코드 작성              │
│ 2. [spawn] 빌드 에러 수정                │
│ 3. [spawn] 문서 업데이트                 │
└──────────────────────────────────────────┘
```

### 3.4 실시간 업데이트
- **Polling**: 5초마다 `/api/relay/status` 호출 (현재 구현됨)
- **상태 변화**: 큐 → 실행 → 완료 과정이 실시간으로 반영

---

## 4. 기술 구현 방안

### 4.1 헤더 카운터 수정 (간단)
**파일**: `src/app/page.tsx`

**현재 코드**:
```tsx
const runningCount = agents.filter((a) => a.status === "running").length;
const totalStacked = agents.reduce((sum, a) => sum + a.stack.length, 0);
```

**개선안**:
```tsx
const runningCount = agents.filter((a) => a.status === "running").length;
const totalStacked = agents.reduce((sum, a) => sum + a.stack.length, 0);
const queuedCount = pendingCount + queuedCommandsCount; // ← 추가

// UI
<div className="text-gray-400">
  <span className="text-green-400">{runningCount}</span> 실행
  · <span className="text-blue-400">{totalStacked}</span> 대기
  {queuedCount > 0 && (
    <> · <span className="text-yellow-400">🕒 {queuedCount}</span> 큐잉됨</>
  )}
</div>
```

### 4.2 에이전트별 큐 표시
**파일**: `src/components/AgentSection.tsx` (신규 또는 기존 수정)

**Props 추가**:
```tsx
interface AgentSectionProps {
  // ... 기존 props
  pendingInstructions: Record<string, Array<{...}>>;
  queuedCommands: Record<string, Array<{...}>>;
}
```

**렌더링 로직**:
```tsx
const queuedForAgent = [
  ...(pendingInstructions[agent.id] || []),
  ...(queuedCommands[agent.id] || [])
];

{queuedForAgent.length > 0 && (
  <div className="queued-indicator">
    🕒 {queuedForAgent.length}개 큐잉됨
  </div>
)}
```

### 4.3 큐 상세 모달 (선택적)
**파일**: `src/components/QueueModal.tsx` (신규)

**기능**:
- 에이전트 ID를 prop으로 받아 해당 에이전트의 큐 목록 표시
- `onClick` 핸들러로 상세 내용 확장
- **취소 API** 필요 시 `/api/relay/cancel-command` 구현 필요

---

## 5. 데이터 흐름

### 5.1 현재 데이터 흐름 (정상 작동 중)
```
1. User input → /api/relay/command (POST)
2. queueCommand() → relay_commands table (status='pending')
3. Gateway polls → /api/relay/poll
4. getAndClearCommands() → UPDATE status='processing'
5. Execute task → updateCommandResult() → status='completed'/'failed'
```

### 5.2 UI 폴링 흐름 (정상 작동 중)
```
1. useLiveAgentStatuses() hook → 5초마다 /api/relay/status 호출
2. Status API → getPendingInstructions() + getPendingCommands()
3. Frontend state 업데이트 → pendingInstructions, queuedCommands
4. ❌ UI 렌더링 누락 ← 여기만 추가하면 완료
```

---

## 6. Task Queue System 활용 (미래 개선안)

현재 Task Queue System (`src/lib/task-queue.ts`)은 **구현되어 있지만 사용되지 않음**.

### 6.1 Task Queue의 장점
- ✅ 우선순위 기반 스케줄링 (1-100 priority)
- ✅ 의존성 관리 (`dependsOn` 필드)
- ✅ Concurrency group 제한 (동시 실행 제어)
- ✅ DLQ (Dead Letter Queue) 지원

### 6.2 통합 방안 (장기 과제)
1. **Orchestrator**가 Task Queue를 사용하도록 전환
2. Relay System은 **전달 계층**으로만 사용
3. UI는 Task Queue 기반으로 표시

**데이터 흐름 (개선안)**:
```
User → Orchestrator → enqueueTask() → task_queue table
Orchestrator → dequeueReadyTask() → assignedAgent 설정
Gateway poll → Task 정보 수신 → 실행
Executor → completeTask() / failTask()
```

---

## 7. 구현 우선순위

### Phase 1 (즉시 구현 가능, 1-2시간)
- [x] 헤더에 "큐잉됨" 카운터 추가
- [x] 에이전트 카드에 pending instructions 수 표시

### Phase 2 (선택적, 3-5시간)
- [ ] 큐 상세 보기 모달
- [ ] 큐잉된 작업 취소 기능
- [ ] 큐 내 순서 재정렬 (drag & drop)

### Phase 3 (장기 개선, 1-2일)
- [ ] Task Queue System 통합
- [ ] Relay System과 Task Queue 역할 분리
- [ ] 의존성/우선순위 기반 스케줄링 UI

---

## 8. 테스트 시나리오

### 8.1 기본 시나리오
1. **에이전트가 idle 상태**
   - 작업 전송 → 즉시 실행
   - 큐 카운터 = 0

2. **에이전트가 running 상태**
   - 작업 전송 → `queueInstruction()` 호출
   - 큐 카운터 += 1
   - 에이전트 카드에 "🕒 1개 큐잉됨" 표시

3. **에이전트가 완료 후**
   - `drainQueueForIdleAgents()` 자동 실행
   - 큐잉된 작업 → 실행 상태로 전환
   - 큐 카운터 -= 1

### 8.2 Edge Cases
- **Multiple agents busy**: 각 에이전트별로 독립적인 큐 관리
- **Gateway 재연결**: 큐 손실 없음 (DB 저장)
- **Orchestrate 중 추가 요청**: 글로벌 큐에 쌓임 (현재 동작)

---

## 9. 용어 정리

| 용어 | 의미 | DB 필드 | UI 표시 |
|------|------|---------|---------|
| **Pending** | Gateway가 아직 poll하지 않음 | `relay_commands.status = 'pending'` | "N개 대기" (잘못됨) |
| **Queued** | 에이전트가 busy하여 대기 중 | `relay_commands.status = 'queued'` | "N개 큐잉됨" (정확) |
| **Processing** | Gateway가 poll하여 실행 중 | `relay_commands.status = 'processing'` | "실행 중" |
| **Stacked** | 로컬 UI 전용 (DB 무관) | `agent.stack[]` | "N개 대기" (legacy) |

---

## 10. 결론

### 현재 상황
- ✅ 백엔드 데이터 제공 정상 (`pendingInstructions`, `queuedCommands`)
- ✅ 폴링 로직 정상 (5초마다 `/api/relay/status`)
- ❌ **프론트엔드 렌더링만 누락**

### 필요한 작업
1. **헤더에 큐 카운터 추가** (5분)
2. **에이전트 카드에 큐 표시** (10분)
3. (선택) **큐 상세 모달** (3-5시간)

### 기대 효과
- 사용자가 "큐에 쌓였는지" 실시간으로 확인 가능
- 에이전트가 "어떤 작업을 대기 중인지" 투명하게 노출
- 시스템 신뢰도 ↑

---

## 참고 자료

- `src/lib/relay.ts`: 큐잉 로직
- `src/app/api/relay/status/route.ts`: 상태 API
- `src/app/page.tsx`: 메인 대시보드
- `src/components/AgentDashboard.tsx`: 에이전트 뷰
- `src/lib/task-queue.ts`: 미사용 Task Queue (미래 통합 대상)
