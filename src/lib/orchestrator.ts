// 오케스트레이터: 주기적으로 태스크 큐를 확인하고 디스패치하는 루프
// Self-rescheduling setTimeout + PostgreSQL advisory lock + heartbeat

import { dispatchTasks, getQueueStats } from "./task-queue";
import { queryOne, isDbConnectionError, pool } from "./db";
import { recordMetricsSnapshot } from "./queue-metrics";
import crypto from "crypto";
import type { PoolClient } from "pg";

// ─── 타입 정의 ────────────────────────────────────────────

export interface OrchestratorConfig {
  /** 디스패치 주기 (ms). 기본 5000 (5초) */
  intervalMs: number;
  /** 활성화 여부 */
  enabled: boolean;
}

export interface OrchestratorStatus {
  running: boolean;
  lastDispatchAt: string | null;
  lastDispatchCount: number;
  totalDispatched: number;
  cycleCount: number;
  lastError: string | null;
  config: OrchestratorConfig;
}

// ─── 오케스트레이터 상태 ──────────────────────────────────

const ADVISORY_LOCK_ID = 72696951; // 고정 advisory lock key
const instanceId = crypto.randomUUID();

let timer: ReturnType<typeof setTimeout> | null = null;
let lockClient: PoolClient | null = null;
let isRunning = false;
let isShuttingDown = false;
let lastDispatchAt: string | null = null;
let lastDispatchCount = 0;
let totalDispatched = 0;
let cycleCount = 0;
let lastError: string | null = null;

const defaultConfig: OrchestratorConfig = {
  intervalMs: parseInt(process.env.ORCHESTRATOR_INTERVAL_MS || "5000", 10),
  enabled: process.env.ORCHESTRATOR_ENABLED !== "false",
};

let currentConfig: OrchestratorConfig = { ...defaultConfig };

// ─── Advisory Lock 관리 ──────────────────────────────────

/**
 * PostgreSQL advisory lock 획득 (전용 커넥션 사용)
 * Rolling deploy 시 이중 오케스트레이터 방지
 */
async function acquireAdvisoryLock(): Promise<boolean> {
  try {
    if (lockClient) {
      lockClient.release();
      lockClient = null;
    }

    lockClient = await pool.connect();

    // 전용 커넥션에서 advisory lock 시도
    const result = await lockClient.query<{ pg_try_advisory_lock: boolean }>(
      `SELECT pg_try_advisory_lock($1)`,
      [ADVISORY_LOCK_ID]
    );

    const acquired = result.rows[0]?.pg_try_advisory_lock === true;

    if (!acquired) {
      lockClient.release();
      lockClient = null;
      console.log("[orchestrator] Advisory lock not acquired (another instance running)");
    } else {
      // 커넥션 에러 핸들링: lock이 해제되면 오케스트레이터 중지
      lockClient.on("error", (err) => {
        console.error("[orchestrator] Lock connection lost:", err.message);
        lockClient = null;
        stopOrchestrator();
        // 10초 후 재시도
        setTimeout(() => {
          if (!isShuttingDown) {
            console.log("[orchestrator] Attempting to re-acquire lock...");
            startOrchestrator();
          }
        }, 10_000);
      });
      console.log(`[orchestrator] Advisory lock acquired (instance: ${instanceId.slice(0, 8)})`);
    }

    return acquired;
  } catch (error) {
    console.warn("[orchestrator] Failed to acquire advisory lock:", error);
    if (lockClient) {
      lockClient.release();
      lockClient = null;
    }
    return false;
  }
}

/**
 * Advisory lock 해제
 */
function releaseAdvisoryLock(): void {
  if (lockClient) {
    try {
      lockClient.release();
    } catch {
      // 이미 해제된 경우 무시
    }
    lockClient = null;
  }
}

// ─── 하트비트 ────────────────────────────────────────────

/**
 * 오케스트레이터 하트비트 기록
 */
async function writeHeartbeat(): Promise<void> {
  try {
    await queryOne(
      `UPDATE orchestrator_heartbeat
       SET last_cycle_at = NOW(),
           cycle_count = $1,
           instance_id = $2
       WHERE id = 'singleton'`,
      [cycleCount, instanceId]
    );
  } catch (error) {
    // 하트비트 실패는 디스패치에 영향을 주지 않음
    console.warn("[orchestrator] Heartbeat write failed:", error);
  }
}

// ─── 디스패치 사이클 ──────────────────────────────────────

async function runDispatchCycle(): Promise<void> {
  if (!currentConfig.enabled || isShuttingDown) return;

  try {
    const dispatched = await dispatchTasks();

    cycleCount++;
    lastDispatchAt = new Date().toISOString();
    lastDispatchCount = dispatched.length;
    totalDispatched += dispatched.length;
    lastError = null;

    if (dispatched.length > 0) {
      console.log(
        `[orchestrator] Cycle #${cycleCount}: dispatched ${dispatched.length} tasks`
      );
      for (const task of dispatched) {
        console.log(
          `  → [${task.concurrencyGroup}] ${task.title} (priority: ${task.priority}, id: ${task.id})`
        );
      }
    }

    // 하트비트 기록
    await writeHeartbeat();

    // 메트릭 스냅샷 기록 (~1분 throttle)
    await recordMetricsSnapshot();
  } catch (error) {
    if (isDbConnectionError(error)) {
      lastError = "Database connection failed";
      console.warn("[orchestrator] DB connection error, skipping cycle");
    } else {
      lastError = error instanceof Error ? error.message : String(error);
      console.error("[orchestrator] Dispatch cycle error:", error);
    }
  }
}

/**
 * 다음 사이클 스케줄링 (self-rescheduling setTimeout)
 * 이전 사이클이 완료된 후에만 다음 사이클 시작 → 겹침 방지
 */
async function scheduleNextCycle(): Promise<void> {
  if (!isRunning || isShuttingDown) return;

  await runDispatchCycle();

  if (isRunning && !isShuttingDown) {
    timer = setTimeout(scheduleNextCycle, currentConfig.intervalMs);
  }
}

// ─── 오케스트레이터 제어 ──────────────────────────────────

/**
 * 오케스트레이터 시작
 */
export async function startOrchestrator(
  config?: Partial<OrchestratorConfig>
): Promise<void> {
  if (isShuttingDown) return;

  if (timer) {
    console.warn("[orchestrator] Already running, stopping first");
    stopOrchestrator();
  }

  if (config) {
    currentConfig = { ...currentConfig, ...config };
  }

  if (!currentConfig.enabled) {
    console.log("[orchestrator] Disabled via config");
    return;
  }

  // Advisory lock 획득 시도
  const lockAcquired = await acquireAdvisoryLock();
  if (!lockAcquired) {
    console.log("[orchestrator] Will retry lock acquisition in 10s...");
    timer = setTimeout(() => {
      if (!isShuttingDown) {
        startOrchestrator();
      }
    }, 10_000);
    return;
  }

  isRunning = true;
  console.log(
    `[orchestrator] Starting with interval ${currentConfig.intervalMs}ms (instance: ${instanceId.slice(0, 8)})`
  );

  // self-rescheduling setTimeout 시작
  scheduleNextCycle();
}

/**
 * 오케스트레이터 중지
 */
export function stopOrchestrator(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  isRunning = false;
  releaseAdvisoryLock();
  console.log("[orchestrator] Stopped");
}

/**
 * 그레이스풀 셧다운 (SIGTERM/SIGINT)
 * 현재 진행 중인 사이클 완료 후 종료
 */
export function gracefulShutdown(): void {
  console.log("[orchestrator] Graceful shutdown initiated");
  isShuttingDown = true;

  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  isRunning = false;
  releaseAdvisoryLock();
  console.log("[orchestrator] Graceful shutdown complete");
}

/**
 * 오케스트레이터 상태 조회
 */
export function getOrchestratorStatus(): OrchestratorStatus {
  return {
    running: isRunning,
    lastDispatchAt,
    lastDispatchCount,
    totalDispatched,
    cycleCount,
    lastError,
    config: { ...currentConfig },
  };
}

/**
 * 오케스트레이터 설정 변경 (재시작 필요)
 */
export function updateOrchestratorConfig(
  config: Partial<OrchestratorConfig>
): OrchestratorConfig {
  currentConfig = { ...currentConfig, ...config };

  // 실행 중이면 재시작하여 새 설정 적용
  if (isRunning) {
    stopOrchestrator();
    startOrchestrator();
  }

  return { ...currentConfig };
}

/**
 * 수동 디스패치 1회 실행 (API에서 호출)
 */
export async function triggerDispatch(): Promise<{
  dispatched: number;
  expired: number;
  stats: Awaited<ReturnType<typeof getQueueStats>>;
}> {
  const dispatched = await dispatchTasks();
  const stats = await getQueueStats();

  lastDispatchAt = new Date().toISOString();
  lastDispatchCount = dispatched.length;
  totalDispatched += dispatched.length;
  cycleCount++;

  return {
    dispatched: dispatched.length,
    expired: 0,
    stats,
  };
}
