# Task Queue 시스템 병렬 처리 로직 분석

**작성일**: 2025-02-27
**대상 시스템**: Life Dashboard Task Queue & Orchestrator
**범위**: Concurrency Group 동시 실행, Task Selection Algorithm, Gateway 작업 분배

---

## 1. 개요 (Executive Summary)

Life Dashboard의 task_queue 시스템은 **PostgreSQL 기반 우선순위 큐**로, 다음 3가지 핵심 메커니즘을 통해 병렬 처리를 제어합니다:

| 메커니즘 | 역할 | 제어 단위 |
|---------|------|---------|
| **Concurrency Group** | 그룹별 동시 실행 제한 | `concurrency_config` 테이블 |
| **Task Selection** | 우선순위 + FIFO 순서 | `dequeueNext()` SQL 쿼리 |
| **Gateway Distribution** | 단일 오케스트레이터 + 로드 분산 | Advisory Lock + Relay 시스템 |

---

## 2. Concurrency Group: 동시 실행 제한 메커니즘

### 2.1 아키텍처

**두 개의 테이블이 함께 동작:**

```sql
-- 1. task_queue: 모든 태스크 저장
CREATE TABLE task_queue (
  id UUID PRIMARY KEY,
  concurrency_group TEXT NOT NULL DEFAULT 'default',  -- 그룹 지정
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  -- ... 기타 필드
);

-- 2. concurrency_config: 그룹별 제한 설정
CREATE TABLE concurrency_config (
  concurrency_group TEXT PRIMARY KEY,
  max_concurrent INTEGER NOT NULL DEFAULT 3,  -- 동시 실행 제한
  updated_at TIMESTAMPTZ
);
```

### 2.2 용량 계산 로직

**`getCapacity(concurrencyGroup)` 함수:**

```typescript
export async function getCapacity(concurrencyGroup: string): Promise<number> {
  const row = await queryOne<{ capacity: string }>(
    `SELECT GREATEST(0, cc.max_concurrent - COUNT(tq.id)) as capacity
     FROM concurrency_config cc
     LEFT JOIN task_queue tq
       ON tq.concurrency_group = cc.concurrency_group
       AND tq.status = 'running'
     WHERE cc.concurrency_group = $1
     GROUP BY cc.max_concurrent`,
    [concurrencyGroup]
  );

  // 설정이 없으면 기본값 3으로 계산
  if (!row) {
    const running = await getRunningCount(concurrencyGroup);
    return Math.max(0, 3 - running);
  }

  return parseInt(row.capacity, 10);
}
```

**동작 원리:**

1. `concurrency_config`에서 `max_concurrent` 값 조회 (기본값: 3)
2. `task_queue`에서 **해당 그룹의 `running` 상태 태스크 개수** 계산
3. **여력(capacity) = `max_concurrent` - `running_count`** 계산
4. 여력이 0 이하면 새 태스크 디스패치 불가

**예시:**
```
max_concurrent = 5
running_count = 3
capacity = 5 - 3 = 2  → 2개 태스크 디스패치 가능
```

---

## 3. Task Selection Algorithm: 우선순위 + FIFO 순서

### 3.1 디큐 알고리즘 (`dequeueNext`)

**핵심 쿼리:**

```sql
UPDATE task_queue
SET status = 'running',
    assigned_agent = COALESCE($2, assigned_agent),
    started_at = NOW()
WHERE id = (
  SELECT id FROM task_queue
  WHERE concurrency_group = $1
    AND status IN ('pending', 'queued')
    AND are_dependencies_met(id)  -- 의존성 확인
  ORDER BY priority DESC,         -- 1순위: 우선순위 높을수록 먼저
           created_at ASC         -- 2순위: 생성 시각 이른순(FIFO)
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
```

**정렬 기준 (2단계):**

| 순위 | 조건 | 의미 | 예시 |
|-----|------|------|------|
| **1순위** | `priority DESC` | 우선순위 높을수록 먼저 | priority=10이 priority=1보다 먼저 실행 |
| **2순위** | `created_at ASC` | 같은 우선순위 내에서 생성 순서대로 | 같은 우선순위면 먼저 들어온 것이 먼저 실행(FIFO) |

### 3.2 예시 시나리오

**상황:** concurrency_group='default', max_concurrent=3, 현재 running=1

**Queue 상태:**
```
ID | title    | priority | created_at | depends_on | status
---|----------|----------|------------|------------|--------
1  | TaskA    | 2        | 10:00      | []         | running (현재 실행중)
2  | TaskB    | 5        | 10:01      | []         | pending
3  | TaskC    | 3        | 10:02      | [1]        | pending (TaskA 완료 필요)
4  | TaskD    | 5        | 10:03      | []         | pending
5  | TaskE    | 1        | 10:04      | []         | pending
```

**첫 번째 디스패치 (capacity=2):**
1. TaskB 선택: priority=5, created_at=10:01, 의존성 없음 ✓
2. TaskD 선택: priority=5, created_at=10:03, 의존성 없음 ✓
3. **TaskC는 건너뜀**: TaskA가 아직 running 상태 (의존성 미충족)
4. TaskE는 건너뜀: capacity 초과

**결과:**
```
Running: TaskA, TaskB, TaskD (3개, capacity=3 도달)
Pending: TaskC (TaskA 완료 대기), TaskE
```

**TaskA 완료 후, 다음 사이클:**
1. TaskC 선택: priority=3, 의존성 충족 ✓
2. TaskE는 건너뜀: capacity=1 (TaskC만 추가 가능)

### 3.3 로드밸런싱에 미치는 영향

**장점:**
- ✓ **우선순위 보장**: 중요한 작업이 먼저 실행
- ✓ **공정성(Fairness)**: 같은 우선순위 내에서 FIFO → starvation 방지
- ✓ **의존성 자동 처리**: 선행 태스크 완료까지 대기

**단점(주의사항):**
- ⚠️ **우선순위 역전**: 높은 우선순위 태스크가 낮은 우선순위 태스크를 기다릴 수 없음
  - 예: priority=1 (높음) 태스크가 priority=10 (낮음) 태스크 실행 중인 그룹에서 대기

**최적화 전략:**
```typescript
// 1. 새 concurrency_group 사용 (격리)
enqueueTask({
  title: "Urgent Task",
  concurrencyGroup: "urgent",  // 별도 그룹
  priority: 10
});

// 2. priority=10이 높음 (역순 주의!)
enqueueTask({
  title: "Normal Task",
  concurrencyGroup: "default",
  priority: 1  // 낮은 숫자 = 낮은 우선순위
});
```

---

## 4. Dispatcher: 주기적 디스패치 메커니즘

### 4.1 `dispatchTasks()` 흐름

**`src/lib/task-queue.ts` 및 `src/lib/orchestrator.ts`의 통합 프로세스:**

```typescript
export async function dispatchTasks(): Promise<Task[]> {
  // 1️⃣ 타임아웃된 태스크 정리
  const expired = await expireTimedOutTasks();
  if (expired.length > 0) {
    console.log(`[task-queue] ${expired.length} timed out tasks processed`);
  }

  // 2️⃣ dead_letter 태스크의 의존 태스크 연쇄 실패 처리
  for (const task of expired) {
    if (task.status === "dead_letter") {
      const cascaded = await cascadeFailDependents(task.id);
    }
  }

  // 3️⃣ 대기 중인 concurrency_group 목록 조회
  const groups = await query<{ concurrency_group: string }>(
    `SELECT DISTINCT concurrency_group
     FROM task_queue
     WHERE status IN ('pending', 'queued')`
  );

  const dispatched: Task[] = [];

  // 4️⃣ 각 그룹별로 여력 확인 후 디스패치
  for (const { concurrency_group } of groups) {
    const capacity = await getCapacity(concurrency_group);

    for (let i = 0; i < capacity; i++) {
      const task = await dequeueNext(concurrency_group);
      if (!task) break;  // 더 이상 대기 태스크 없음
      dispatched.push(task);
    }
  }

  return dispatched;
}
```

### 4.2 오케스트레이터 사이클 (`src/lib/orchestrator.ts`)

**주기적 실행:**

```typescript
export const defaultConfig: OrchestratorConfig = {
  intervalMs: parseInt(process.env.ORCHESTRATOR_INTERVAL_MS || "5000", 10),  // 기본 5초
  enabled: process.env.ORCHESTRATOR_ENABLED !== "false",
};

async function scheduleNextCycle(): Promise<void> {
  if (!isRunning || isShuttingDown) return;

  await runDispatchCycle();  // 한 번 실행

  if (isRunning && !isShuttingDown) {
    timer = setTimeout(scheduleNextCycle, currentConfig.intervalMs);  // 5초 후 다시
  }
}
```

**특징:**
- **Self-rescheduling setTimeout**: 이전 사이클 완료 후 다음 사이클 시작
- **겹침 방지**: 일반 `setInterval`과 달리, 이전 실행 완료 후에만 다음 스케줄링
- **동적 설정 변경**: `updateOrchestratorConfig()`로 실시간 간격 조정 가능

---

## 5. 단일 오케스트레이터 패턴: Advisory Lock

### 5.1 문제: 다중 인스턴스 배포

**Rolling deploy 시나리오:**
```
Node1: running (old version)
    ↓ (deploy)
Node2: starting (new version)
    ↓
→ 둘 다 dispatchTasks() 실행 가능?
→ 같은 태스크를 두 번 실행할 수 있음!
```

### 5.2 해결책: PostgreSQL Advisory Lock

```typescript
const ADVISORY_LOCK_ID = 72696951;  // 고정 ID

async function acquireAdvisoryLock(): Promise<boolean> {
  lockClient = await pool.connect();

  // pg_try_advisory_lock: 한 번에 1개 인스턴스만 획득 가능
  const result = await lockClient.query<{ pg_try_advisory_lock: boolean }>(
    `SELECT pg_try_advisory_lock($1)`,
    [ADVISORY_LOCK_ID]
  );

  const acquired = result.rows[0]?.pg_try_advisory_lock === true;

  if (acquired) {
    console.log(`[orchestrator] Advisory lock acquired (instance: ${instanceId})`);
  } else {
    console.log("[orchestrator] Advisory lock not acquired (another instance running)");
    lockClient.release();
  }

  return acquired;
}
```

**동작:**
- `pg_try_advisory_lock(72696951)` → PostgreSQL 내부 lock 시도
- **한 번에 하나만 성공** → 다른 인스턴스는 false 반환
- 이미 running 중인 인스턴스는 계속 실행, 새로 시작한 인스턴스는 10초 후 재시도

### 5.3 Lock 해제

```typescript
function releaseAdvisoryLock(): void {
  if (lockClient) {
    lockClient.release();  // 커넥션 반환 → lock 자동 해제
  }
}

// Graceful shutdown
export function gracefulShutdown(): void {
  isShuttingDown = true;
  clearTimeout(timer);
  releaseAdvisoryLock();
}
```

---

## 6. Gateway 작업 분배: Relay 시스템

### 6.1 아키텍처: Dashboard ↔ Gateway(로컬 머신) ↔ Claude CLI

```
┌─────────────────────┐
│  LifeDashboard      │
│  (DB 기반 중앙)     │
└──────────┬──────────┘
           │
      REST API (relay)
           │
      ┌────┴────┐
      │          │
   ┌──▼──┐   ┌──▼──┐
   │GW#1 │   │GW#2 │  (로컬 머신들)
   │(Mac)│   │(Linux)
   └──┬──┘   └──┬──┘
      │         │
   Claude   Claude
   CLI      CLI
```

### 6.2 Relay 테이블 스키마

**주요 테이블들:**

```sql
-- 1. Gateway 연결 상태
CREATE TABLE gateway_connections (
  id TEXT PRIMARY KEY,              -- 게이트웨이 ID (hostname)
  status TEXT,                      -- 'connected' or 'disconnected'
  connected_at TIMESTAMPTZ,
  last_heartbeat TIMESTAMPTZ        -- 마지막 하트비트 (30초 이내 = online)
);

-- 2. Relay 명령어 (Dashboard → Gateway)
CREATE TABLE relay_commands (
  id UUID PRIMARY KEY,
  gateway_id TEXT REFERENCES gateway_connections(id),
  type TEXT,                        -- 'spawn', 'send', 'status', 'orchestrate', 'restart'
  payload JSONB,
  status TEXT,                      -- 'pending', 'processing', 'completed', 'failed'
  created_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- 3. 에이전트 상태 (per gateway)
CREATE TABLE agent_statuses (
  id UUID PRIMARY KEY,
  gateway_id TEXT REFERENCES gateway_connections(id),
  agent_id TEXT,                    -- e.g. 'architect', 'executor'
  status TEXT,                      -- 'idle', 'running', 'waiting', 'error'
  current_task TEXT,
  updated_at TIMESTAMPTZ
);
```

### 6.3 명령어 흐름 (Poll-based)

**Dashboard → Gateway 작업 분배:**

**Step 1: Dashboard에서 명령 생성**
```typescript
// src/app/api/relay/command/route.ts
POST /api/relay/command
{
  "gatewayId": "macbook-air",
  "type": "spawn",
  "payload": {
    "agentId": "architect",
    "task": "Analyze src/lib/auth.ts",
    "systemPrompt": "..."
  }
}
↓
INSERT INTO relay_commands (gateway_id, type, payload, status)
VALUES ('macbook-air', 'spawn', {...}, 'pending')
```

**Step 2: Gateway Polling (3초 간격)**
```typescript
// scripts/gateway-connector.ts
const POLL_INTERVAL = 3000;  // 3초

setInterval(async () => {
  // 1. 할당된 명령어 조회 (pending → processing 원자적 전환)
  const command = await getPendingCommand(GATEWAY_ID);

  if (command) {
    // 2. Claude CLI 실행
    const result = await executeLlmTaskWithRetry({
      agentId: command.payload.agentId,
      task: command.payload.task,
      systemPrompt: command.payload.systemPrompt,
      // 타임아웃 설정
      staleTimeout: getModelStaleTimeout(command.payload.agentId, 5 * 60 * 1000)
    });

    // 3. 결과 전송 (completed/failed로 갱신)
    await submitResult(command.id, {
      success: result.success,
      output: result.output,
      error: result.error
    });
  }

  // 4. 하트비트 갱신
  await updateHeartbeat(GATEWAY_ID);
}, POLL_INTERVAL);
```

### 6.4 로드 분배 전략

**현재 구현: Simple Sequential**
- 단일 오케스트레이터가 `dispatched` 태스크를 순차적으로 gateway에 할당
- **장점**: 간단, 구현 용이
- **한계**: 여러 gateway 간 부하 분산 최적화 필요

**개선 가능 방향:**

```typescript
// 1. Gateway 용량 고려
async function selectOptimalGateway(
  gateways: GatewayConnection[],
  agentId: string
): Promise<string> {
  const statuses = await getAgentStatusesForAll(gateways);

  // 최소 running 개수인 gateway 선택
  const byLoad = statuses.map(s => ({
    gatewayId: s.gateway_id,
    runningCount: s.filter(ag => ag.status === 'running').length
  })).sort((a, b) => a.runningCount - b.runningCount);

  return byLoad[0].gatewayId;  // 가장 여유 있는 gateway
}

// 2. 에이전트별 선호도 (특정 gateway에만 특정 에이전트 배치)
const AGENT_TO_GATEWAY_AFFINITY: Record<string, string> = {
  'gpu-intensive': 'gpu-server',
  'ml-model': 'ml-server',
  'generic': '*'  // 어느 gateway든
};
```

---

## 7. 병렬 처리 흐름도 (완전한 시스템)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1️⃣ Task Enqueue (언제든지)                                       │
│   → enqueueTask({title, concurrencyGroup, priority, ...})      │
│   → INSERT task_queue (status='pending')                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ 2️⃣ Orchestrator Dispatch (매 5초)                               │
│   → dispatchTasks()                                             │
│   → 각 concurrency_group별:                                    │
│       1. getCapacity() → 여력 계산                             │
│       2. dequeueNext() → priority DESC, created_at ASC        │
│       3. UPDATE status='running'                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ 3️⃣ Relay to Gateway (Poll-based, 3초)                          │
│   → INSERT relay_commands (status='pending')                    │
│   → Gateway polls /api/relay/poll                             │
│   → getPendingCommand() → UPDATE status='processing'          │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ 4️⃣ Local Execution (Gateway)                                    │
│   → spawn child_process: claude <args>                         │
│   → stale timeout: 5분 (default)                              │
│   → hung detection: lsof + network check                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ 5️⃣ Result Submission                                            │
│   → UPDATE relay_commands (status='completed', result=...)    │
│   → UPDATE task_queue (status='completed', result=...)         │
│   → Cascade: 의존 태스크 활성화 (are_dependencies_met)        │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ 6️⃣ Dashboard Polling (5초, message queue)                       │
│   → GET /api/relay/status → 게이트웨이 상태                   │
│   → GET /api/messages → 메시지 조회                           │
│   → 실시간 UI 갱신                                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. 성능 고려사항 & 최적화

### 8.1 인덱스 구조 (Query 성능)

**`task_queue` 핵심 인덱스:**

```sql
-- 1. Dequeue 인덱스 (가장 중요)
CREATE INDEX idx_task_queue_dequeue
  ON task_queue (concurrency_group, status, priority DESC, created_at ASC)
  WHERE status IN ('pending', 'queued');
-- → dequeueNext() 쿼리를 O(1) index lookup으로 최적화

-- 2. Running count 조회
CREATE INDEX idx_task_queue_running
  ON task_queue (concurrency_group, status)
  WHERE status = 'running';
-- → getCapacity() 중 running count 계산 최적화

-- 3. Timeout 감지
CREATE INDEX idx_task_queue_timeout
  ON task_queue (status, started_at)
  WHERE status = 'running';
-- → expireTimedOutTasks()의 started_at > now() - timeout 조회 최적화
```

### 8.2 Lock 경합(Contention)

**Advisory Lock의 영향:**
- ✓ **배포 중 안전성**: 다중 인스턴스에서 duplicate execution 방지
- ⚠️ **시작 지연**: 새 인스턴스가 lock 획득까지 10초 기다림 (rolling deploy)

**완화 전략:**
```typescript
// Option 1: Pre-warmup (배포 전)
// 기존 인스턴스를 먼저 gracefully shutdown
systemctl stop life-dashboard
sleep 2  // 2초 대기로 lock 확실히 해제
systemctl start life-dashboard

// Option 2: 선호도 기반 lock 양보 (가능할 경우)
// 새 인스턴스가 이전 인스턴스를 감지하면 자동으로 대기
```

### 8.3 Gateway Polling 오버헤드

**현재: 3초 polling**
- 각 gateway가 3초마다 `/api/relay/poll` 호출
- N gateway × M cycle/hour = API 호출 증가

**최적화:**
```typescript
// 1. Long Polling (HTTP/1.1)
// 대기 시간: timeout=30초, 명령어 수신 시 즉시 반환
GET /api/relay/poll?timeout=30000

// 2. WebSocket (HTTP/1.1 Upgrade)
// 양방향 실시간, API 호출 감소
WS /relay/ws/gateway/{gatewayId}

// 3. Server-Sent Events (SSE)
// 단방향 서버→클라이언트, 구현 간단
GET /api/relay/events/gateway/{gatewayId}
```

### 8.4 메트릭 스냅샷 (Queue Monitoring)

**현재 구현:**
```typescript
// src/lib/orchestrator.ts - recordMetricsSnapshot()
// 1분마다 queue_metrics 테이블에 기록
await recordMetricsSnapshot();
// → pending, running, completed, failed 상태별 카운트
```

**대시보드 용:**
```sql
SELECT concurrency_group, pending_count, running_count, completed_count
FROM queue_metrics
WHERE recorded_at > now() - INTERVAL '1 hour'
ORDER BY recorded_at DESC;
```

---

## 9. 실전 시나리오

### 시나리오 1: 우선순위 기반 실행

**상황:**
```
System has 2 gateways (Mac, Linux)
concurrency_config default: max_concurrent=3
Current: TaskA running (priority=1)
```

**Queue:**
```
| title     | priority | gateway_affinity | created_at |
|-----------|----------|------------------|-----------|
| TaskB_GPU | 10       | gpu-linux        | 10:00     |
| TaskC_CPU | 5        | *                | 10:01     |
| TaskD_CPU | 5        | *                | 10:02     |
```

**Orchestrator Cycle (10:05):**
1. `getCapacity('default')` → 2개 (3 - 1 running)
2. `dequeueNext()` 첫 번째:
   - TaskB_GPU: priority=10 (가장 높음) ✓
   - **할당**: mac-linux gateway
3. `dequeueNext()` 두 번째:
   - TaskC_CPU: priority=5, created_at=10:01 (더 이름) ✓
   - **할당**: 최소 부하 gateway

**결과:**
```
Mac:     [TaskA (running), TaskC (running)]  → 2개 태스크
Linux:   [TaskB_GPU (running)]               → 1개 태스크
Pending: [TaskD]                              → 다음 사이클 대기
```

### 시나리오 2: 의존성 체인

**상황:**
```
Concurrency default: capacity=3 (현재 0개 running)
Task 의존성 체인:
  TaskA → TaskB → TaskC
```

**Queue:**
```
| ID  | title | depends_on | priority | status  |
|-----|-------|-----------|----------|---------|
| A   | TaskA | []        | 5        | pending |
| B   | TaskB | [A]       | 5        | pending |
| C   | TaskC | [B]       | 5        | pending |
```

**Cycle 1 (capacity=3):**
- `are_dependencies_met(A)` → true (의존성 없음)
- `are_dependencies_met(B)` → false (A가 pending)
- `are_dependencies_met(C)` → false (B가 pending)
- **Result**: TaskA만 dequeue → running

**Cycle 2 (capacity=2, 이후 TaskA complete):**
- TaskA: completed (제외)
- `are_dependencies_met(B)` → true (A가 completed)
- **Result**: TaskB dequeue → running

**Cycle 3 (capacity=2, 이후 TaskB complete):**
- **Result**: TaskC dequeue → running

---

## 10. 주요 발견사항 (Key Findings)

### ✅ 강점

1. **원자성**: `FOR UPDATE SKIP LOCKED` 사용으로 race condition 방지
2. **의존성 관리**: PostgreSQL 함수 `are_dependencies_met()` 활용
3. **장애 복구**:
   - Timeout된 태스크 자동 retry (dead_letter 후 manual retry)
   - 의존성 체인 실패 시 cascade fail
4. **다중 인스턴스 안전**: Advisory Lock으로 duplicate execution 방지
5. **인덱스 최적화**: 주요 쿼리별 targeted index 설계

### ⚠️ 개선 가능 영역

1. **Gateway 로드 분산**
   - 현재: sequential assignment (최적화 없음)
   - 개선: 에이전트별 affinity + 게이트웨이 부하 고려

2. **Polling 지연**
   - 현재: 3초 polling interval (fixed)
   - 개선: long-polling, WebSocket 도입 (real-time)

3. **Concurrency 설정 동적화**
   - 현재: 정적 설정 (concurrency_config 테이블)
   - 개선: 실시간 시스템 상태 기반 자동 조정 (auto-scaling)

4. **메트릭 활용**
   - 현재: 기록만 함 (queue_metrics)
   - 개선: 병목 분석, alert 설정 (e.g., "pending > 100 for > 5min")

5. **컨텍스트 전달**
   - 현재: priority group별 결과 캐싱 없음
   - 개선: 이전 group 결과를 다음 group에 context 주입 (OMC 패턴 도입 가능)

---

## 11. 결론

Life Dashboard의 task_queue 시스템은 **PostgreSQL 기반의 견고한 우선순위 큐**로, 다음을 통해 병렬 처리를 제어합니다:

| 계층 | 메커니즘 | 제어 단위 |
|-----|---------|---------|
| **Group 격리** | Concurrency Group | 그룹별 `max_concurrent` 설정 |
| **Task 선택** | 우선순위 DESC + FIFO | `dequeueNext()` SQL 쿼리 |
| **Dispatch** | 5초 주기 self-rescheduling | Orchestrator loop |
| **Multi-instance** | Advisory Lock | PostgreSQL session-level |
| **원격 실행** | Relay + Poll | Gateway 3초 간격 |

**추천 다음 단계:**
1. Gateway 로드 분산 최적화 (affinity matrix + capacity-aware selection)
2. Polling을 long-polling/WebSocket으로 업그레이드
3. 메트릭 기반 자동 scaling (concurrency 동적 조정)
4. OMC 패턴 도입: priority group 간 context 전달
