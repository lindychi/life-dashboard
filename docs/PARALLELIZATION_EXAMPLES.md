# Task Queue 병렬 처리 - 실행 예제 및 테스트 시나리오

**작성일**: 2025-02-27

---

## 1. 기본 Task Queue 사용법

### 1.1 Simple Task Enqueue

```typescript
import { enqueueTask, getTask, dequeueNext, completeTask } from "@/lib/task-queue";

// 1. Task 추가 (pending 상태)
const task = await enqueueTask({
  title: "Process data export",
  type: "export",
  payload: { format: "csv", limit: 1000 },
  priority: 5,
  concurrencyGroup: "default",
  timeoutSeconds: 600  // 10분
});

console.log(`Enqueued: ${task.id} (status=${task.status})`);
// Output: Enqueued: 550e8400-e29b-41d4-a716-446655440000 (status=pending)

// 2. Task 조회
const retrieved = await getTask(task.id);
console.log(retrieved);
// {
//   id: "550e8400...",
//   title: "Process data export",
//   status: "pending",
//   priority: 5,
//   concurrencyGroup: "default",
//   ...
// }

// 3. Orchestrator가 5초마다 dispatchTasks() 호출
// → status='pending' → 'running'

// 4. Task 완료 처리 (Gateway에서 호출)
const completed = await completeTask(task.id, {
  recordsProcessed: 1000,
  filename: "export_2025-02-27.csv"
});

console.log(`Completed: ${completed.status}`);
// Output: Completed: completed
```

---

## 2. Concurrency Group 제어

### 2.1 여러 Group으로 격리

```typescript
import { enqueueTask, setConcurrencyLimit, getCapacity, getQueueStats } from "@/lib/task-queue";

// Setup: 3개의 concurrency group 생성 및 제한 설정
const setupGroups = async () => {
  // 1. Urgent: 최대 5개 동시 실행
  await setConcurrencyLimit("urgent", 5);

  // 2. Default: 최대 3개 동시 실행
  await setConcurrencyLimit("default", 3);

  // 3. Batch: 최대 1개 (sequential)
  await setConcurrencyLimit("batch", 1);
};

// Usage: 우선순위에 따라 다른 group에 배치
const enqueueTasks = async () => {
  // Urgent job - 즉시 처리 필요
  await enqueueTask({
    title: "Critical bug fix",
    priority: 10,
    concurrencyGroup: "urgent",  // ← 별도 group, 빠른 처리
    timeoutSeconds: 300
  });

  // Normal job
  await enqueueTask({
    title: "Feature implementation",
    priority: 5,
    concurrencyGroup: "default",
    timeoutSeconds: 1800
  });

  // Batch job - 저녁에만 실행하고 싶으면
  await enqueueTask({
    title: "Daily data sync",
    priority: 1,
    concurrencyGroup: "batch",  // ← Sequential
    timeoutSeconds: 3600
  });
};

// Monitor capacity
const monitorCapacity = async () => {
  const urgentCapacity = await getCapacity("urgent");
  const defaultCapacity = await getCapacity("default");
  const batchCapacity = await getCapacity("batch");

  console.log(`
    Urgent: ${urgentCapacity} slots available
    Default: ${defaultCapacity} slots available
    Batch: ${batchCapacity} slots available
  `);

  // Get queue stats
  const stats = await getQueueStats("default");
  console.log(`Default Group Stats:
    pending: ${stats.pending}
    running: ${stats.running}
    completed: ${stats.completed}
    failed: ${stats.failed}
  `);
};
```

### 2.2 동적 Capacity 조정

```typescript
import { setConcurrencyLimit } from "@/lib/task-queue";

// Scenario: 야간 배치 처리 시간이므로 용량 증가
const increaseCapacityForNightBatch = async () => {
  // 11pm - 6am: batch group의 max_concurrent를 10으로 증가
  await setConcurrencyLimit("batch", 10);
  console.log("Night batch mode: increased batch concurrent to 10");
};

// Scenario: 낮 시간 피크, 용량 감소
const decreaseCapacityForPeakHours = async () => {
  // 9am - 5pm: 리소스 아껴야 함
  await setConcurrencyLimit("batch", 1);
  console.log("Peak hours: reduced batch concurrent to 1");
};

// Cron job 예 (node-cron 사용)
import cron from "node-cron";

const setupAutoScaling = () => {
  // Every day at 11 PM
  cron.schedule("0 23 * * *", increaseCapacityForNightBatch);

  // Every day at 6 AM
  cron.schedule("0 6 * * *", decreaseCapacityForPeakHours);

  // Every day at 9 AM (peak hours start)
  cron.schedule("0 9 * * *", decreaseCapacityForPeakHours);

  // Every day at 5 PM (peak hours end)
  cron.schedule("0 17 * * *", increaseCapacityForNightBatch);
};

// API endpoint 예
export async function PATCH(req: Request) {
  const { concurrencyGroup, maxConcurrent } = await req.json();

  const result = await setConcurrencyLimit(concurrencyGroup, maxConcurrent);

  return Response.json({
    message: "Updated",
    config: result
  });
}

// Usage:
// PATCH /api/admin/concurrency
// {
//   "concurrencyGroup": "batch",
//   "maxConcurrent": 10
// }
```

---

## 3. 우선순위 및 FIFO

### 3.1 Priority 기반 Task Ordering

```typescript
import { enqueueTask, getTasks } from "@/lib/task-queue";

// Scenario: 다양한 우선순위로 task 추가
const enqueueVariousTasks = async () => {
  const tasks = [
    { title: "Low priority task", priority: 1 },
    { title: "Medium priority task", priority: 5 },
    { title: "High priority task (critical)", priority: 10 },
    { title: "Another medium task", priority: 5 },  // Same priority as above
  ];

  for (const taskDef of tasks) {
    await enqueueTask({
      ...taskDef,
      concurrencyGroup: "default",
      timeoutSeconds: 300
    });
  }
};

// View queue order
const inspectQueueOrder = async () => {
  const pendingTasks = await getTasks({
    status: "pending",
    concurrencyGroup: "default",
    limit: 10
  });

  console.log("Queue order (as dequeueNext would process):");
  pendingTasks.forEach((task, idx) => {
    console.log(
      `${idx + 1}. ${task.title} (priority=${task.priority}, created=${task.createdAt})`
    );
  });

  // Output (5초 후, 일부 실행):
  // Queue order (as dequeueNext would process):
  // 1. High priority task (critical) (priority=10, created=10:00:01)
  // 2. Medium priority task (priority=5, created=10:00:02)
  // 3. Another medium task (priority=5, created=10:00:03)
  // 4. Low priority task (priority=1, created=10:00:04)
};

// ⚠️ FIFO fairness: 같은 priority는 생성 순서
const fairnessExample = async () => {
  // t=0s: Priority=5인 작업들 여러 개 추가
  for (let i = 0; i < 5; i++) {
    await enqueueTask({
      title: `Batch task ${i + 1}`,
      priority: 5,
      concurrencyGroup: "default",
      timeoutSeconds: 300
    });
  }

  // t=5s: dispatchTasks() 호출
  // Dequeue order: Batch task 1 → Batch task 2 → Batch task 3 → ...
  // (생성 순서대로, FIFO)
  // → starvation 방지, 공정성 보장
};
```

### 3.2 Priority Inversion 회피

```typescript
import { enqueueTask, setConcurrencyLimit } from "@/lib/task-queue";

// ❌ 나쁜 예: priority inversion 발생
const badExample = async () => {
  // 같은 group에 낮은 priority 작업을 먼저 넣음
  await enqueueTask({
    title: "Routine batch processing",
    priority: 1,  // 낮은 우선순위
    concurrencyGroup: "default",
    timeoutSeconds: 3600  // 오래 걸림!
  });

  // 이후 높은 priority 작업 추가
  await enqueueTask({
    title: "Critical alert response",
    priority: 10,  // 높은 우선순위
    concurrencyGroup: "default",
    timeoutSeconds: 60
  });

  // 문제: capacity가 다 차면 Critical alert는 대기
  // (Routine batch가 완료될 때까지)
};

// ✓ 좋은 예: 별도 group 사용
const goodExample = async () => {
  // 미리 group 설정
  await setConcurrencyLimit("batch", 1);
  await setConcurrencyLimit("alerts", 5);

  // Routine batch → 별도 group (느려도 괜찮음)
  await enqueueTask({
    title: "Routine batch processing",
    priority: 1,
    concurrencyGroup: "batch",  // ← 별도!
    timeoutSeconds: 3600
  });

  // Critical alert → 빠른 group (높은 우선순위 + 많은 용량)
  await enqueueTask({
    title: "Critical alert response",
    priority: 10,
    concurrencyGroup: "alerts",  // ← 별도!
    timeoutSeconds: 60
  });

  // 결과: batch가 실행 중이어도, alert는 즉시 처리 가능
};

// ✓ 또 다른 해결책: retry 기반
const retryBasedExample = async () => {
  // 높은 우선순위 작업은 높은 priority 값 사용
  // (priority DESC이므로 숫자가 클수록 먼저 실행)
  await enqueueTask({
    title: "Critical task",
    priority: 1000,  // 매우 높음!
    concurrencyGroup: "default",
    timeoutSeconds: 60
  });

  // 낮은 우선순위
  await enqueueTask({
    title: "Regular task",
    priority: 100,
    concurrencyGroup: "default",
    timeoutSeconds: 600
  });

  // Dequeue order: Critical (1000) → Regular (100)
};
```

---

## 4. Task Dependencies

### 4.1 순차 실행 (Sequential Chain)

```typescript
import { enqueueTask } from "@/lib/task-queue";

// Scenario: ETL 파이프라인
// Step 1: Extract → Step 2: Transform → Step 3: Load

const createETLPipeline = async () => {
  // Step 1: Extract
  const extractTask = await enqueueTask({
    title: "Extract data from API",
    type: "extract",
    payload: { source: "public-api" },
    priority: 5,
    concurrencyGroup: "default",
    timeoutSeconds: 900,  // 15분
    depends_on: []  // 의존성 없음, 최상위
  });

  console.log(`Extract task: ${extractTask.id}`);

  // Step 2: Transform (Step 1 완료 대기)
  const transformTask = await enqueueTask({
    title: "Transform extracted data",
    type: "transform",
    payload: { format: "parquet" },
    priority: 5,
    concurrencyGroup: "default",
    timeoutSeconds: 600,  // 10분
    dependsOn: [extractTask.id]  // ← Step 1 의존
  });

  console.log(`Transform task: ${transformTask.id}`);

  // Step 3: Load (Step 2 완료 대기)
  const loadTask = await enqueueTask({
    title: "Load to data warehouse",
    type: "load",
    payload: { target: "postgres" },
    priority: 5,
    concurrencyGroup: "default",
    timeoutSeconds: 600,  // 10분
    dependsOn: [transformTask.id]  // ← Step 2 의존
  });

  console.log(`Load task: ${loadTask.id}`);

  // Execution timeline:
  // t=0s:     Extract → running
  // t=900s:   Extract → completed
  // t=905s:   Transform → running (Extract 완료 후)
  // t=1505s:  Transform → completed
  // t=1510s:  Load → running (Transform 완료 후)
  // t=2110s:  Load → completed
};
```

### 4.2 병렬 의존성 (DAG - Directed Acyclic Graph)

```typescript
import { enqueueTask } from "@/lib/task-queue";

// Scenario: 병렬 분석
//
//        ┌─ Analyze A
//        │
//  Load ─┼─ Analyze B
//        │
//        └─ Analyze C
//              │
//           Merge ← 3개 모두 완료 필요

const createParallelAnalysisPipeline = async () => {
  // Step 0: Load data
  const loadTask = await enqueueTask({
    title: "Load dataset",
    priority: 5,
    concurrencyGroup: "default",
    dependsOn: [],
    timeoutSeconds: 300
  });

  // Step 1: 3개의 병렬 분석 (모두 Load 의존)
  const analyzeATask = await enqueueTask({
    title: "Analyze A - statistical summary",
    priority: 5,
    concurrencyGroup: "analysis",
    dependsOn: [loadTask.id],  // ← Load 대기
    timeoutSeconds: 600
  });

  const analyzeBTask = await enqueueTask({
    title: "Analyze B - trend analysis",
    priority: 5,
    concurrencyGroup: "analysis",
    dependsOn: [loadTask.id],
    timeoutSeconds: 600
  });

  const analyzeCTask = await enqueueTask({
    title: "Analyze C - anomaly detection",
    priority: 5,
    concurrencyGroup: "analysis",
    dependsOn: [loadTask.id],
    timeoutSeconds: 900  // 더 복잡
  });

  // Step 2: Merge (3개 모두 완료 필요)
  const mergeTask = await enqueueTask({
    title: "Merge analysis results",
    priority: 5,
    concurrencyGroup: "default",
    dependsOn: [
      analyzeATask.id,
      analyzeBTask.id,
      analyzeCTask.id  // ← 모두 의존!
    ],
    timeoutSeconds: 300
  });

  console.log(`Pipeline created: ${mergeTask.id}`);

  // Execution timeline:
  // t=0s:      Load → running
  // t=300s:    Load → completed
  // t=305s:    Analyze A/B/C → all running (병렬!)
  //            (min(600, 900) = 600s needed)
  // t=905s:    Analyze A/B → completed
  // t=1205s:   Analyze C → completed
  // t=1210s:   Merge → running (3개 모두 완료 후)
  // t=1510s:   Merge → completed

  // 총 시간: ~1510s (sequential이라면 ~2400s)
  // → 병렬화로 37% 시간 단축!
};

// 주의: Circular dependency는 불가!
const circularDependencyExample = async () => {
  const taskA = await enqueueTask({
    title: "Task A",
    priority: 5,
    dependsOn: []
  });

  const taskB = await enqueueTask({
    title: "Task B",
    priority: 5,
    dependsOn: [taskA.id]
  });

  try {
    const taskC = await enqueueTask({
      title: "Task C",
      priority: 5,
      dependsOn: [taskB.id, taskA.id]  // A → B → C (OK)
    });

    // ❌ 이것은 에러 발생:
    // const circular = await enqueueTask({
    //   title: "Circular",
    //   dependsOn: [taskC.id, taskA.id]  // A → B → C → A (CIRCULAR!)
    // });
    // Error: "Invalid dependency graph"
  } catch (e) {
    console.error("Dependency error:", e.message);
  }
};
```

### 4.3 Cascade Failure (의존 체인 실패)

```typescript
import { failTask, cascadeFailDependents, getDependentTasks } from "@/lib/task-queue";

// Scenario: Step 2 실패 → Step 3도 자동 실패
const cascadeFailureExample = async () => {
  // 체인: A → B → C → D
  const taskA = await enqueueTask({
    title: "Step A",
    priority: 5,
    dependsOn: []
  });

  const taskB = await enqueueTask({
    title: "Step B",
    priority: 5,
    dependsOn: [taskA.id]
  });

  const taskC = await enqueueTask({
    title: "Step C",
    priority: 5,
    dependsOn: [taskB.id]
  });

  const taskD = await enqueueTask({
    title: "Step D",
    priority: 5,
    dependsOn: [taskC.id]
  });

  // 상황: B가 실패
  console.log("\n=== B fails ===");
  await failTask(taskB.id, "Database connection error");

  // B 의존 태스크 조회
  const dependents = await getDependentTasks(taskB.id);
  console.log(`Dependent tasks: ${dependents.map(t => t.title).join(", ")}`);
  // Output: Dependent tasks: Step C

  // 연쇄 실패
  const cascaded = await cascadeFailDependents(taskB.id);
  console.log(`Cascade-failed: ${cascaded.map(t => t.title).join(", ")}`);
  // Output: Cascade-failed: Step C, Step D

  // 최종 상태:
  // A: completed (이미 완료됨)
  // B: dead_letter (원인)
  // C: dead_letter (의존 체인: B 실패)
  // D: dead_letter (의존 체인: C 실패)
};

// Manual recovery
const manualRecovery = async () => {
  import { retryDeadLetterTask } from "@/lib/task-queue";

  // B를 재시도
  const retried = await retryDeadLetterTask(taskB.id, {
    resetRetries: true,
    maxRetries: 3
  });

  console.log(`B retried: status=${retried?.status}`);
  // status=pending (다시 시도 대기)

  // 다음 orchestrator cycle에서:
  // B → running → (hopefully) completed
  // → C becomes eligible (are_dependencies_met(C) = true)
  // → D becomes eligible (after C completes)
};
```

---

## 5. Orchestrator 제어

### 5.1 Orchestrator 시작/중지

```typescript
import { startOrchestrator, stopOrchestrator, getOrchestratorStatus } from "@/lib/orchestrator";

// Application startup (예: app.ts 또는 route handler)
export async function initializeOrchestrator() {
  try {
    await startOrchestrator({
      intervalMs: 5000,  // 5초 주기
      enabled: true
    });

    console.log("✓ Orchestrator started");
  } catch (error) {
    console.error("✗ Failed to start orchestrator:", error);
  }
}

// Status check
export function checkOrchestratorHealth() {
  const status = getOrchestratorStatus();

  console.log(`
    Running: ${status.running}
    Last dispatch: ${status.lastDispatchAt}
    Dispatched this cycle: ${status.lastDispatchCount}
    Total dispatched: ${status.totalDispatched}
    Cycles: ${status.cycleCount}
    Last error: ${status.lastError || "none"}
  `);

  return status;
}

// API endpoint: GET /api/orchestrator/status
export async function GET(req: Request) {
  const status = getOrchestratorStatus();

  return Response.json({
    status,
    healthy: status.running && !status.lastError
  });
}

// Graceful shutdown (deploy)
export async function gracefulShutdown() {
  console.log("Shutting down orchestrator...");
  stopOrchestrator();
  console.log("✓ Orchestrator stopped");
}

// Signal handlers (Node.js process)
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully");
  gracefulShutdown();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully");
  gracefulShutdown();
  process.exit(0);
});
```

### 5.2 Dispatch 간격 조정

```typescript
import { updateOrchestratorConfig, getOrchestratorStatus } from "@/lib/orchestrator";

// Dynamic interval adjustment
const adjustOrchestratorSpeed = async (pendingCount: number) => {
  const stats = await getQueueStats();

  if (stats.pending > 100) {
    // Backpressure: 많은 pending 작업 → 더 자주 dispatch
    updateOrchestratorConfig({ intervalMs: 2000 });  // 2초
    console.log("📈 High pending: increased dispatch frequency");
  } else if (stats.pending < 10) {
    // Low pending: 작업 적음 → 덜 자주 dispatch (리소스 절약)
    updateOrchestratorConfig({ intervalMs: 10000 });  // 10초
    console.log("📉 Low pending: decreased dispatch frequency");
  } else {
    // Normal
    updateOrchestratorConfig({ intervalMs: 5000 });  // 5초 (default)
    console.log("📊 Normal pending: default frequency");
  }
};

// Cron job으로 주기적 조정
import cron from "node-cron";

cron.schedule("*/1 * * * *", async () => {
  // Every minute
  const stats = await getQueueStats();
  await adjustOrchestratorSpeed(stats.pending);
});
```

---

## 6. Gateway Relay 예제

### 6.1 Dashboard에서 Gateway에 명령 전송

```typescript
// src/app/api/relay/command/route.ts

import { registerCommand } from "@/lib/relay";

export async function POST(req: Request) {
  const { gatewayId, agentId, task, systemPrompt } = await req.json();

  // Create relay command
  const command = await registerCommand({
    gatewayId,
    type: "spawn",
    payload: {
      agentId,
      task,
      systemPrompt,
    }
  });

  return Response.json({
    id: command.id,
    status: command.status,
    message: `Command queued for gateway: ${gatewayId}`
  });
}
```

**Client-side usage (Frontend):**

```typescript
// In React component
const executeOnGateway = async () => {
  const response = await fetch("/api/relay/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gatewayId: "mac-m2",
      agentId: "architect",
      task: "Analyze src/lib/auth.ts for security issues",
      systemPrompt: "You are a security architect. Identify vulnerabilities."
    })
  });

  const result = await response.json();
  console.log(`Command ID: ${result.id}`);

  // Poll for result
  const pollResult = async () => {
    const status = await fetch(`/api/relay/command/${result.id}`);
    const data = await status.json();

    if (data.status === "completed") {
      console.log("Result:", data.result);
      return;
    }

    if (data.status === "failed") {
      console.error("Command failed:", data.error);
      return;
    }

    // Still pending/processing
    setTimeout(pollResult, 2000);  // Poll every 2s
  };

  pollResult();
};
```

### 6.2 Gateway에서 명령 수신 및 실행

```typescript
// scripts/gateway-connector.ts

async function pollAndExecute() {
  const POLL_INTERVAL = 3000;  // 3초

  setInterval(async () => {
    try {
      // 1. Pending command 조회 (원자적 상태 변경)
      const command = await getPendingCommand(GATEWAY_ID);

      if (!command) {
        console.log("No pending commands");
        return;
      }

      console.log(`📋 Received command: ${command.type}`);

      // 2. Claude CLI 실행
      const result = await executeLlmTaskWithRetry({
        agentId: command.payload.agentId,
        task: command.payload.task,
        systemPrompt: command.payload.systemPrompt,
        staleTimeout: 5 * 60 * 1000,  // 5분
        onOutput: (chunk) => {
          console.log(`  [output] ${chunk}`);
          // 실시간으로 dashboard에 스트림
          updateLiveOutput(command.id, chunk);
        },
        onToolCall: (toolCall) => {
          console.log(`  [tool] ${toolCall.name}`);
        }
      });

      // 3. 결과 제출
      await submitResult(command.id, {
        success: result.success,
        output: result.output,
        error: result.error,
        durationMs: result.elapsedMs,
        toolCalls: result.toolCalls
      });

      console.log(`✓ Command completed: ${command.id}`);

    } catch (error) {
      console.error("Poll/execute error:", error);
    }

    // 4. Heartbeat 갱신
    await updateHeartbeat(GATEWAY_ID);
  }, POLL_INTERVAL);
}
```

---

## 7. 모니터링 및 디버깅

### 7.1 Queue Inspection

```typescript
import { getTasks, getQueueStats, getDeadLetterTasks } from "@/lib/task-queue";

// Entire queue overview
const inspectQueue = async () => {
  const stats = await getQueueStats();

  console.log(`
    📊 Queue Statistics:
    ├─ pending:     ${stats.pending}
    ├─ running:     ${stats.running}
    ├─ completed:   ${stats.completed}
    ├─ failed:      ${stats.failed}
    ├─ dead_letter: ${stats.deadLetter}
    └─ total:       ${stats.total}
  `);
};

// Pending tasks
const viewPendingTasks = async () => {
  const pending = await getTasks({
    status: "pending",
    limit: 20
  });

  console.log("Pending tasks:");
  pending.forEach((task, idx) => {
    console.log(
      `${idx + 1}. ${task.title}` +
      ` (priority=${task.priority}` +
      `, group=${task.concurrencyGroup}` +
      `, created=${task.createdAt})`
    );
  });
};

// Running tasks
const viewRunningTasks = async () => {
  const running = await getTasks({
    status: "running",
    limit: 20
  });

  console.log("Running tasks:");
  running.forEach((task) => {
    const elapsed = task.startedAt
      ? ((Date.now() - new Date(task.startedAt).getTime()) / 1000).toFixed(0)
      : "?";

    console.log(
      `- ${task.title} (running for ${elapsed}s, agent=${task.assignedAgent})`
    );

    if (task.timeoutSeconds && parseInt(elapsed) > task.timeoutSeconds) {
      console.warn(`  ⚠️ TIMEOUT RISK: exceeds ${task.timeoutSeconds}s limit`);
    }
  });
};

// Dead letter queue
const viewDeadLetters = async () => {
  const deadLetters = await getDeadLetterTasks(50);

  console.log(`Dead letter tasks (${deadLetters.length}):`);
  deadLetters.forEach((task) => {
    console.log(
      `- ${task.title}` +
      ` (retries=${task.retryCount}/${task.maxRetries}` +
      `, error=${task.error})`
    );
  });
};

// API endpoint: GET /api/admin/queue/inspect
export async function GET(req: Request) {
  const [stats, pending, running, deadLetters] = await Promise.all([
    getQueueStats(),
    getTasks({ status: "pending", limit: 20 }),
    getTasks({ status: "running", limit: 20 }),
    getDeadLetterTasks(20)
  ]);

  return Response.json({
    stats,
    pending: pending.map(t => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      group: t.concurrencyGroup,
      dependencies: t.dependsOn.length
    })),
    running: running.map(t => ({
      id: t.id,
      title: t.title,
      agent: t.assignedAgent,
      elapsed: t.startedAt
        ? Math.round((Date.now() - new Date(t.startedAt).getTime()) / 1000)
        : null
    })),
    deadLetters: deadLetters.map(t => ({
      id: t.id,
      title: t.title,
      error: t.error,
      retries: `${t.retryCount}/${t.maxRetries}`
    }))
  });
}
```

### 7.2 Performance Metrics

```typescript
import { query } from "@/lib/db";

// Throughput analysis
const analyzeThroughput = async (hours: number = 1) => {
  const rows = await query<{
    hour: string;
    completed_count: number;
    duration_avg_ms: number;
  }>(
    `SELECT
      DATE_TRUNC('hour', completed_at)::TEXT as hour,
      COUNT(*) as completed_count,
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::INT as duration_avg_ms
     FROM task_queue
     WHERE status = 'completed'
       AND completed_at > NOW() - INTERVAL '1 hour'
     GROUP BY 1
     ORDER BY 1 DESC`
  );

  console.log("Hourly throughput:");
  rows.forEach(row => {
    console.log(
      `${row.hour}: ${row.completed_count} tasks, avg ${row.duration_avg_ms}ms`
    );
  });
};

// Bottleneck detection
const detectBottlenecks = async () => {
  const slowTasks = await query<{
    title: string;
    duration_sec: number;
    count: number;
  }>(
    `SELECT
      title,
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))::INT as duration_sec,
      COUNT(*) as count
     FROM task_queue
     WHERE status = 'completed'
       AND completed_at > NOW() - INTERVAL '24 hours'
     GROUP BY 1
     ORDER BY duration_sec DESC
     LIMIT 10`
  );

  console.log("Slowest tasks:");
  slowTasks.forEach(task => {
    console.log(
      `- ${task.title}: avg ${task.duration_sec}s (${task.count} times)`
    );
  });
};
```

---

## 8. Test Scenarios

### 8.1 High Load Test

```typescript
import { enqueueTask, getQueueStats } from "@/lib/task-queue";

// Test: 1000 tasks in 10 seconds
const highLoadTest = async () => {
  console.time("Enqueue 1000 tasks");

  const taskIds = [];
  for (let i = 0; i < 1000; i++) {
    const task = await enqueueTask({
      title: `Load test task ${i + 1}`,
      priority: Math.floor(Math.random() * 10),
      concurrencyGroup: `group-${i % 5}`,  // 5개 group 분산
      timeoutSeconds: 300
    });
    taskIds.push(task.id);
  }

  console.timeEnd("Enqueue 1000 tasks");

  // Monitor completion
  let completed = 0;
  const checkCompletion = setInterval(async () => {
    const stats = await getQueueStats();
    console.log(`  Running: ${stats.running}, Completed: ${stats.completed}`);

    if (stats.completed >= 1000) {
      clearInterval(checkCompletion);
      console.log("✓ All tasks completed");
    }
  }, 5000);
};

// Expected: ~3-5 minutes for 1000 tasks with default settings
```

### 8.2 Dependency Chain Test

```typescript
const dependencyChainTest = async () => {
  // Create 100-task dependency chain
  let previousId = "";

  console.time("Create 100-task chain");

  for (let i = 0; i < 100; i++) {
    const task = await enqueueTask({
      title: `Chain task ${i + 1}`,
      priority: 5,
      dependsOn: previousId ? [previousId] : [],
      timeoutSeconds: 30
    });
    previousId = task.id;
  }

  console.timeEnd("Create 100-task chain");

  // Monitor: should execute sequentially
  let previous = null;
  const monitor = setInterval(async () => {
    const stats = await getQueueStats();
    console.log(`  Running: ${stats.running}, Completed: ${stats.completed}`);

    if (stats.completed >= 100) {
      clearInterval(monitor);
      console.log("✓ Chain completed");
    }
  }, 5000);
};
```

---

This completes the practical examples guide!
