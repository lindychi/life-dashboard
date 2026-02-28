// PostgreSQL 기반 태스크 큐잉 시스템
// 우선순위 + FIFO 순 디큐, 동시 실행 제한(concurrency group), 타임아웃 관리

import { query, queryOne } from "./db";

// ─── 타입 정의 ────────────────────────────────────────────

export type TaskStatus = "pending" | "queued" | "running" | "completed" | "failed" | "dead_letter";

export interface Task {
  id: string;
  title: string;
  type: string;
  payload: Record<string, unknown>;
  priority: number;
  status: TaskStatus;
  concurrencyGroup: string;
  assignedAgent: string | null;
  maxRetries: number;
  retryCount: number;
  error: string | null;
  retryErrors: Array<{ error: string; timestamp: string; attempt: number }>;
  result: Record<string, unknown> | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  timeoutSeconds: number;
  dependsOn: string[];
}

export interface EnqueueParams {
  title: string;
  type?: string;
  payload?: Record<string, unknown>;
  priority?: number;
  concurrencyGroup?: string;
  assignedAgent?: string;
  maxRetries?: number;
  timeoutSeconds?: number;
  dependsOn?: string[];
}

export interface ConcurrencyConfig {
  concurrencyGroup: string;
  maxConcurrent: number;
  updatedAt: string;
}

export interface QueueStats {
  pending: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  deadLetter: number;
  total: number;
}

// ─── DB 행 → Task 변환 ───────────────────────────────────

interface TaskRow {
  id: string;
  title: string;
  type: string;
  payload: Record<string, unknown>;
  priority: number;
  status: string;
  concurrency_group: string;
  assigned_agent: string | null;
  max_retries: number;
  retry_count: number;
  error: string | null;
  retry_errors: Array<{ error: string; timestamp: string; attempt: number }>;
  result: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  timeout_seconds: number;
  depends_on: string[];
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    payload: row.payload,
    priority: row.priority,
    status: row.status as TaskStatus,
    concurrencyGroup: row.concurrency_group,
    assignedAgent: row.assigned_agent,
    maxRetries: row.max_retries,
    retryCount: row.retry_count,
    error: row.error,
    retryErrors: row.retry_errors || [],
    result: row.result,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    timeoutSeconds: row.timeout_seconds,
    dependsOn: row.depends_on || [],
  };
}

const SELECT_FIELDS = `
  id, title, type, payload, priority, status,
  concurrency_group, assigned_agent,
  max_retries, retry_count, error, retry_errors, result,
  created_at, started_at, completed_at, timeout_seconds,
  depends_on
`;

// ─── 핵심 함수 ───────────────────────────────────────────

/**
 * 태스크를 큐에 추가
 */
export async function enqueueTask(params: EnqueueParams): Promise<Task> {
  const timeoutSeconds = params.timeoutSeconds ?? 300;
  if (timeoutSeconds < 1 || timeoutSeconds > 3600) {
    throw new Error("timeoutSeconds must be between 1 and 3600");
  }

  const maxRetries = params.maxRetries ?? 3;
  if (maxRetries < 0 || maxRetries > 50) {
    throw new Error("maxRetries must be between 0 and 50");
  }

  const dependsOn = params.dependsOn ?? [];

  // 의존성 ID 유효성 검증
  if (dependsOn.length > 0) {
    const existing = await query<{ id: string }>(
      `SELECT id FROM task_queue WHERE id = ANY($1)`,
      [dependsOn]
    );
    const existingIds = new Set(existing.map((r) => r.id));
    const missing = dependsOn.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      throw new Error(`Dependency tasks not found: ${missing.join(", ")}`);
    }
  }

  const row = await queryOne<TaskRow>(
    `INSERT INTO task_queue (title, type, payload, priority, concurrency_group, assigned_agent, max_retries, timeout_seconds, depends_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${SELECT_FIELDS}`,
    [
      params.title,
      params.type || "generic",
      JSON.stringify(params.payload || {}),
      params.priority ?? 0,
      params.concurrencyGroup || "default",
      params.assignedAgent || null,
      maxRetries,
      timeoutSeconds,
      dependsOn,
    ]
  );

  if (!row) {
    throw new Error("Failed to enqueue task");
  }

  return rowToTask(row);
}

/**
 * 특정 concurrency_group에서 실행 중인 태스크 수 조회
 */
export async function getRunningCount(concurrencyGroup: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM task_queue
     WHERE concurrency_group = $1 AND status = 'running'`,
    [concurrencyGroup]
  );
  return parseInt(row?.count || "0", 10);
}

/**
 * 특정 concurrency_group의 남은 용량(여력) 조회
 * 설정된 max_concurrent - 현재 running count
 */
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

/**
 * 큐에서 다음 태스크를 꺼내서 running 상태로 전환 (원자적 연산)
 * 우선순위 DESC + 생성시각 ASC (FIFO) 순
 * SELECT ... FOR UPDATE SKIP LOCKED 으로 동시성 안전
 */
export async function dequeueNext(
  concurrencyGroup: string,
  agentId?: string
): Promise<Task | null> {
  const row = await queryOne<TaskRow>(
    `UPDATE task_queue
     SET status = 'running',
         assigned_agent = COALESCE($2, assigned_agent),
         started_at = NOW()
     WHERE id = (
       SELECT id FROM task_queue
       WHERE concurrency_group = $1
         AND status IN ('pending', 'queued')
         AND are_dependencies_met(id)
       ORDER BY priority DESC, created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING ${SELECT_FIELDS}`,
    [concurrencyGroup, agentId || null]
  );

  return row ? rowToTask(row) : null;
}

/**
 * 태스크 완료 처리
 */
export async function completeTask(
  taskId: string,
  result?: Record<string, unknown>
): Promise<Task | null> {
  const row = await queryOne<TaskRow>(
    `UPDATE task_queue
     SET status = 'completed',
         result = $2,
         completed_at = NOW()
     WHERE id = $1 AND status = 'running'
     RETURNING ${SELECT_FIELDS}`,
    [taskId, result ? JSON.stringify(result) : null]
  );

  return row ? rowToTask(row) : null;
}

/**
 * 태스크 실패 처리 (재시도 가능 시 pending으로 복귀)
 */
export async function failTask(
  taskId: string,
  error: string
): Promise<Task | null> {
  const row = await queryOne<TaskRow>(
    `UPDATE task_queue
     SET status = CASE
           WHEN retry_count + 1 < max_retries THEN 'pending'
           ELSE 'dead_letter'
         END,
         retry_count = retry_count + 1,
         error = $2,
         retry_errors = retry_errors || jsonb_build_array(jsonb_build_object(
           'error', $2,
           'timestamp', NOW()::TEXT,
           'attempt', retry_count + 1
         )),
         started_at = CASE
           WHEN retry_count + 1 < max_retries THEN NULL
           ELSE started_at
         END,
         completed_at = CASE
           WHEN retry_count + 1 >= max_retries THEN NOW()
           ELSE NULL
         END
     WHERE id = $1 AND status = 'running'
     RETURNING ${SELECT_FIELDS}`,
    [taskId, error]
  );

  return row ? rowToTask(row) : null;
}

/**
 * 실패한 태스크에 의존하는 모든 태스크를 연쇄 실패 처리
 * (dead_letter 또는 failed 태스크에 의존하는 pending/queued 태스크)
 */
export async function cascadeFailDependents(
  failedTaskId: string,
  reason?: string
): Promise<Task[]> {
  const errorMsg = reason || `Dependency ${failedTaskId} failed`;
  const rows = await query<TaskRow>(
    `UPDATE task_queue
     SET status = 'dead_letter',
         error = $2,
         completed_at = NOW(),
         retry_errors = retry_errors || jsonb_build_array(jsonb_build_object(
           'error', $2,
           'timestamp', NOW()::TEXT,
           'attempt', 0
         ))
     WHERE $1 = ANY(depends_on)
       AND status IN ('pending', 'queued')
     RETURNING ${SELECT_FIELDS}`,
    [failedTaskId, errorMsg]
  );
  const directlyFailed = rows.map(rowToTask);

  // Recursively cascade to tasks depending on the newly failed tasks
  const allFailed = [...directlyFailed];
  for (const task of directlyFailed) {
    const transitive = await cascadeFailDependents(task.id, `Dependency chain: ${failedTaskId} failed`);
    allFailed.push(...transitive);
  }

  return allFailed;
}

/**
 * 특정 태스크에 의존하는 태스크 목록 조회
 */
export async function getDependentTasks(taskId: string): Promise<Task[]> {
  const rows = await query<TaskRow>(
    `SELECT ${SELECT_FIELDS} FROM task_queue
     WHERE $1 = ANY(depends_on)
     ORDER BY priority DESC, created_at ASC`,
    [taskId]
  );
  return rows.map(rowToTask);
}

/**
 * 태스크 상태 조회 (단건)
 */
export async function getTask(taskId: string): Promise<Task | null> {
  const row = await queryOne<TaskRow>(
    `SELECT ${SELECT_FIELDS}
     FROM task_queue
     WHERE id = $1`,
    [taskId]
  );

  return row ? rowToTask(row) : null;
}

/**
 * 태스크 목록 조회 (상태 필터링 가능)
 */
export async function getTasks(options?: {
  status?: TaskStatus;
  concurrencyGroup?: string;
  assignedAgent?: string;
  limit?: number;
}): Promise<Task[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (options?.status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(options.status);
  }
  if (options?.concurrencyGroup) {
    conditions.push(`concurrency_group = $${paramIdx++}`);
    params.push(options.concurrencyGroup);
  }
  if (options?.assignedAgent) {
    conditions.push(`assigned_agent = $${paramIdx++}`);
    params.push(options.assignedAgent);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options?.limit || 100;

  const rows = await query<TaskRow>(
    `SELECT ${SELECT_FIELDS}
     FROM task_queue
     ${where}
     ORDER BY priority DESC, created_at DESC
     LIMIT $${paramIdx}`,
    [...params, limit]
  );

  return rows.map(rowToTask);
}

/**
 * 큐 통계 조회
 */
export async function getQueueStats(concurrencyGroup?: string): Promise<QueueStats> {
  const condition = concurrencyGroup
    ? "WHERE concurrency_group = $1"
    : "";
  const params = concurrencyGroup ? [concurrencyGroup] : [];

  const rows = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*) as count
     FROM task_queue
     ${condition}
     GROUP BY status`,
    params
  );

  const stats: QueueStats = {
    pending: 0,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    deadLetter: 0,
    total: 0,
  };

  for (const row of rows) {
    const count = parseInt(row.count, 10);
    const key = row.status === "dead_letter" ? "deadLetter" : row.status;
    if (key in stats && key !== "total") {
      stats[key as keyof Omit<QueueStats, "total">] = count;
    }
    stats.total += count;
  }

  return stats;
}

// ─── Concurrency 설정 관리 ────────────────────────────────

/**
 * concurrency 제한 설정/갱신
 */
export async function setConcurrencyLimit(
  concurrencyGroup: string,
  maxConcurrent: number
): Promise<ConcurrencyConfig> {
  const row = await queryOne<{
    concurrency_group: string;
    max_concurrent: number;
    updated_at: string;
  }>(
    `INSERT INTO concurrency_config (concurrency_group, max_concurrent, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (concurrency_group) DO UPDATE
     SET max_concurrent = $2, updated_at = NOW()
     RETURNING concurrency_group, max_concurrent, updated_at`,
    [concurrencyGroup, maxConcurrent]
  );

  if (!row) {
    throw new Error("Failed to set concurrency limit");
  }

  return {
    concurrencyGroup: row.concurrency_group,
    maxConcurrent: row.max_concurrent,
    updatedAt: row.updated_at,
  };
}

/**
 * concurrency 설정 조회
 */
export async function getConcurrencyConfig(
  concurrencyGroup: string
): Promise<ConcurrencyConfig | null> {
  const row = await queryOne<{
    concurrency_group: string;
    max_concurrent: number;
    updated_at: string;
  }>(
    `SELECT concurrency_group, max_concurrent, updated_at
     FROM concurrency_config
     WHERE concurrency_group = $1`,
    [concurrencyGroup]
  );

  if (!row) return null;

  return {
    concurrencyGroup: row.concurrency_group,
    maxConcurrent: row.max_concurrent,
    updatedAt: row.updated_at,
  };
}

/**
 * 전체 concurrency 설정 조회
 */
export async function getAllConcurrencyConfigs(): Promise<ConcurrencyConfig[]> {
  const rows = await query<{
    concurrency_group: string;
    max_concurrent: number;
    updated_at: string;
  }>(
    `SELECT concurrency_group, max_concurrent, updated_at
     FROM concurrency_config
     ORDER BY concurrency_group`
  );

  return rows.map((row) => ({
    concurrencyGroup: row.concurrency_group,
    maxConcurrent: row.max_concurrent,
    updatedAt: row.updated_at,
  }));
}

// ─── 타임아웃 처리 ────────────────────────────────────────

/**
 * 타임아웃된 running 태스크를 실패 처리
 * 오케스트레이터 루프에서 주기적으로 호출
 */
export async function expireTimedOutTasks(): Promise<Task[]> {
  const rows = await query<TaskRow>(
    `UPDATE task_queue
     SET status = CASE
           WHEN retry_count + 1 < max_retries THEN 'pending'
           ELSE 'dead_letter'
         END,
         retry_count = retry_count + 1,
         error = 'Task timed out',
         retry_errors = retry_errors || jsonb_build_array(jsonb_build_object(
           'error', 'Task timed out',
           'timestamp', NOW()::TEXT,
           'attempt', retry_count + 1
         )),
         started_at = CASE
           WHEN retry_count + 1 < max_retries THEN NULL
           ELSE started_at
         END,
         completed_at = CASE
           WHEN retry_count + 1 >= max_retries THEN NOW()
           ELSE NULL
         END
     WHERE status = 'running'
       AND started_at IS NOT NULL
       AND started_at + (timeout_seconds || ' seconds')::INTERVAL < NOW()
     RETURNING ${SELECT_FIELDS}`
  );

  return rows.map(rowToTask);
}

// ─── 디스패치 (오케스트레이터 핵심 로직) ─────────────────

/**
 * 대기 중인 모든 concurrency group을 순회하며
 * 여력이 있는 그룹에서 태스크를 꺼내 running으로 전환
 * 반환값: 이번 사이클에서 디스패치된 태스크 목록
 */
export async function dispatchTasks(): Promise<Task[]> {
  // 0. 게이트웨이 연결 상태 확인 (연결된 게이트웨이가 없으면 디스패치 건너뛰기)
  const { getConnectedGateways } = await import("./relay");
  const connectedGateways = await getConnectedGateways();
  if (connectedGateways.length === 0) {
    // 게이트웨이가 없으면 디스패치 스킵 (silent, 로그 생략)
    return [];
  }

  // 1. 타임아웃된 태스크 정리
  const expired = await expireTimedOutTasks();
  if (expired.length > 0) {
    console.log(`[task-queue] ${expired.length} timed out tasks processed`);
  }

  // 2. dead_letter된 태스크의 의존 태스크 연쇄 실패 처리
  for (const task of expired) {
    if (task.status === "dead_letter") {
      const cascaded = await cascadeFailDependents(task.id);
      if (cascaded.length > 0) {
        console.log(`[task-queue] ${cascaded.length} dependent tasks cascade-failed from ${task.id}`);
      }
    }
  }

  // 3. 대기 중인 태스크가 있는 concurrency group 목록 조회
  const groups = await query<{ concurrency_group: string }>(
    `SELECT DISTINCT concurrency_group
     FROM task_queue
     WHERE status IN ('pending', 'queued')`
  );

  const dispatched: Task[] = [];

  // 4. 각 그룹별로 여력 확인 후 디스패치
  for (const { concurrency_group } of groups) {
    const capacity = await getCapacity(concurrency_group);

    for (let i = 0; i < capacity; i++) {
      const task = await dequeueNext(concurrency_group);
      if (!task) break; // 더 이상 대기 태스크 없음
      dispatched.push(task);
    }
  }

  return dispatched;
}

// ─── 데드레터 큐 관리 ────────────────────────────────────

/**
 * 데드레터 큐 태스크 조회
 */
export async function getDeadLetterTasks(limit: number = 50): Promise<Task[]> {
  const rows = await query<TaskRow>(
    `SELECT ${SELECT_FIELDS}
     FROM task_queue
     WHERE status = 'dead_letter'
     ORDER BY completed_at DESC
     LIMIT $1`,
    [limit]
  );

  return rows.map(rowToTask);
}

/**
 * 데드레터 태스크 재시도
 */
export async function retryDeadLetterTask(
  taskId: string,
  options?: { resetRetries?: boolean; maxRetries?: number }
): Promise<Task | null> {
  const resetRetries = options?.resetRetries ?? true;
  const maxRetriesOverride = options?.maxRetries;

  const row = await queryOne<TaskRow>(
    `UPDATE task_queue
     SET status = 'pending',
         retry_count = CASE WHEN $2 THEN 0 ELSE retry_count END,
         max_retries = COALESCE($3, max_retries),
         started_at = NULL,
         completed_at = NULL,
         error = NULL,
         retry_errors = retry_errors || jsonb_build_array(jsonb_build_object(
           'action', 'manual_retry',
           'timestamp', NOW()::TEXT,
           'by', 'user'
         ))
     WHERE id = $1 AND status = 'dead_letter'
     RETURNING ${SELECT_FIELDS}`,
    [taskId, resetRetries, maxRetriesOverride ?? null]
  );

  return row ? rowToTask(row) : null;
}
