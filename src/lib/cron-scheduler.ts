// Cron Scheduler: cron expression 기반 주기적 작업 스케줄러
// croner 라이브러리로 파싱, PostgreSQL advisory lock으로 단일 인스턴스 보장

import { Cron } from "croner";
import { query, queryOne, isDbConnectionError, pool } from "./db";
import { getCronHandler } from "./cron-handlers";
import crypto from "crypto";
import type { PoolClient } from "pg";

// ─── 타입 정의 ────────────────────────────────────────────

export interface CronJob {
  id: string;
  name: string;
  description: string | null;
  schedule: string;
  handlerType: string;
  handlerConfig: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CronJobRun {
  id: string;
  cronJobId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "failed";
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface CronSchedulerStatus {
  running: boolean;
  instanceId: string;
  cycleCount: number;
  lastCheckAt: string | null;
  lastError: string | null;
  activeJobs: number;
}

interface CronJobRow {
  id: string;
  name: string;
  description: string | null;
  schedule: string;
  handler_type: string;
  handler_config: Record<string, unknown>;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CronJobRunRow {
  id: string;
  cron_job_id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "failed";
  result: Record<string, unknown> | null;
  error: string | null;
}

// ─── Row → Domain 변환 ───────────────────────────────────

function rowToCronJob(row: CronJobRow): CronJob {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    schedule: row.schedule,
    handlerType: row.handler_type,
    handlerConfig: row.handler_config,
    enabled: row.enabled,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCronJobRun(row: CronJobRunRow): CronJobRun {
  return {
    id: row.id,
    cronJobId: row.cron_job_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    result: row.result,
    error: row.error,
  };
}

const CRON_JOB_FIELDS = `
  id, name, description, schedule, handler_type, handler_config,
  enabled, last_run_at, next_run_at, created_at, updated_at
`;

const CRON_RUN_FIELDS = `
  id, cron_job_id, started_at, finished_at, status, result, error
`;

// ─── cron expression 유틸 ─────────────────────────────────

/**
 * cron expression 유효성 검증
 * croner의 Cron 클래스를 사용하여 검증
 */
export function validateCronExpression(expression: string): {
  valid: boolean;
  error?: string;
  nextRun?: string;
} {
  try {
    const job = new Cron(expression, { timezone: "Asia/Seoul" });
    const next = job.nextRun();
    job.stop();
    return {
      valid: true,
      nextRun: next?.toISOString() ?? undefined,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 다음 실행 시각 계산
 */
export function getNextRunTime(expression: string): Date | null {
  try {
    const job = new Cron(expression, { timezone: "Asia/Seoul" });
    const next = job.nextRun();
    job.stop();
    return next;
  } catch {
    return null;
  }
}

// ─── CRUD 함수 ────────────────────────────────────────────

export interface CreateCronJobParams {
  name: string;
  description?: string;
  schedule: string;
  handlerType: string;
  handlerConfig?: Record<string, unknown>;
  enabled?: boolean;
}

export async function createCronJob(
  params: CreateCronJobParams
): Promise<CronJob> {
  // cron expression 검증
  const validation = validateCronExpression(params.schedule);
  if (!validation.valid) {
    throw new Error(`Invalid cron expression: ${validation.error}`);
  }

  const nextRunAt = getNextRunTime(params.schedule);

  const row = await queryOne<CronJobRow>(
    `INSERT INTO cron_jobs (name, description, schedule, handler_type, handler_config, enabled, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${CRON_JOB_FIELDS}`,
    [
      params.name,
      params.description || null,
      params.schedule,
      params.handlerType,
      JSON.stringify(params.handlerConfig || {}),
      params.enabled ?? true,
      nextRunAt?.toISOString() || null,
    ]
  );

  if (!row) {
    throw new Error("Failed to create cron job");
  }

  return rowToCronJob(row);
}

export async function getCronJob(id: string): Promise<CronJob | null> {
  const row = await queryOne<CronJobRow>(
    `SELECT ${CRON_JOB_FIELDS} FROM cron_jobs WHERE id = $1`,
    [id]
  );
  return row ? rowToCronJob(row) : null;
}

export async function listCronJobs(options?: {
  enabled?: boolean;
  limit?: number;
}): Promise<CronJob[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (options?.enabled !== undefined) {
    conditions.push(`enabled = $${paramIdx++}`);
    params.push(options.enabled);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options?.limit || 100;

  const rows = await query<CronJobRow>(
    `SELECT ${CRON_JOB_FIELDS} FROM cron_jobs ${where}
     ORDER BY created_at DESC LIMIT $${paramIdx}`,
    [...params, limit]
  );

  return rows.map(rowToCronJob);
}

export interface UpdateCronJobParams {
  name?: string;
  description?: string;
  schedule?: string;
  handlerType?: string;
  handlerConfig?: Record<string, unknown>;
  enabled?: boolean;
}

export async function updateCronJob(
  id: string,
  params: UpdateCronJobParams
): Promise<CronJob | null> {
  // schedule이 변경되면 검증 + next_run_at 재계산
  if (params.schedule) {
    const validation = validateCronExpression(params.schedule);
    if (!validation.valid) {
      throw new Error(`Invalid cron expression: ${validation.error}`);
    }
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  if (params.name !== undefined) {
    sets.push(`name = $${paramIdx++}`);
    values.push(params.name);
  }
  if (params.description !== undefined) {
    sets.push(`description = $${paramIdx++}`);
    values.push(params.description);
  }
  if (params.schedule !== undefined) {
    sets.push(`schedule = $${paramIdx++}`);
    values.push(params.schedule);
    const nextRun = getNextRunTime(params.schedule);
    sets.push(`next_run_at = $${paramIdx++}`);
    values.push(nextRun?.toISOString() || null);
  }
  if (params.handlerType !== undefined) {
    sets.push(`handler_type = $${paramIdx++}`);
    values.push(params.handlerType);
  }
  if (params.handlerConfig !== undefined) {
    sets.push(`handler_config = $${paramIdx++}`);
    values.push(JSON.stringify(params.handlerConfig));
  }
  if (params.enabled !== undefined) {
    sets.push(`enabled = $${paramIdx++}`);
    values.push(params.enabled);
    // enabled가 변경되면 next_run_at 재계산
    if (params.enabled && !params.schedule) {
      // 현재 schedule을 조회해서 next_run_at 갱신
      const current = await getCronJob(id);
      if (current) {
        const nextRun = getNextRunTime(current.schedule);
        sets.push(`next_run_at = $${paramIdx++}`);
        values.push(nextRun?.toISOString() || null);
      }
    }
  }

  if (sets.length === 0) {
    return getCronJob(id);
  }

  values.push(id);

  const row = await queryOne<CronJobRow>(
    `UPDATE cron_jobs SET ${sets.join(", ")} WHERE id = $${paramIdx}
     RETURNING ${CRON_JOB_FIELDS}`,
    values
  );

  return row ? rowToCronJob(row) : null;
}

export async function deleteCronJob(id: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `DELETE FROM cron_jobs WHERE id = $1 RETURNING id`,
    [id]
  );
  return !!row;
}

// ─── 실행 이력 관리 ──────────────────────────────────────

async function createRun(cronJobId: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO cron_job_runs (cron_job_id) VALUES ($1) RETURNING id`,
    [cronJobId]
  );
  if (!row) throw new Error("Failed to create cron job run");
  return row.id;
}

async function completeRun(
  runId: string,
  result: Record<string, unknown> | null
): Promise<void> {
  await queryOne(
    `UPDATE cron_job_runs
     SET status = 'success', finished_at = NOW(), result = $2
     WHERE id = $1`,
    [runId, result ? JSON.stringify(result) : null]
  );
}

async function failRun(runId: string, error: string): Promise<void> {
  await queryOne(
    `UPDATE cron_job_runs
     SET status = 'failed', finished_at = NOW(), error = $2
     WHERE id = $1`,
    [runId, error]
  );
}

/**
 * Cron job 실패 시 알림 처리
 * - 연속 실패 횟수 추적
 * - N회 연속 실패 시 dashboard 메시지 발송
 * - 선택적 이메일 알림
 */
async function handleCronJobFailure(
  job: CronJob,
  error: string
): Promise<void> {
  try {
    // 최근 연속 실패 횟수 계산
    const recentRuns = await query<{ status: string }>(
      `SELECT status FROM cron_job_runs
       WHERE cron_job_id = $1
       ORDER BY started_at DESC
       LIMIT 10`,
      [job.id]
    );

    let consecutiveFailures = 0;
    for (const run of recentRuns) {
      if (run.status === "failed") {
        consecutiveFailures++;
      } else {
        break;
      }
    }

    const alertThreshold = parseInt(
      process.env.CRON_FAILURE_ALERT_THRESHOLD || "3",
      10
    );

    // 알림 조건: 연속 실패가 threshold에 도달 (정확히 threshold일 때만 발송, 매번 발송 방지)
    if (consecutiveFailures === alertThreshold) {
      // Dashboard 메시지 발송
      const { sendMessage } = await import("./messages");
      await sendMessage({
        from: "system",
        to: "user",
        content: [
          `⚠️ **Cron Job 연속 실패 알림**`,
          ``,
          `**Job:** ${job.name}`,
          `**Schedule:** ${job.schedule}`,
          `**연속 실패 횟수:** ${consecutiveFailures}회`,
          `**최근 에러:** ${error.slice(0, 500)}`,
          ``,
          `확인 후 조치가 필요합니다. 수동 실행: \`POST /api/cron/jobs/${job.id}/run\``,
        ].join("\n"),
        type: "result",
      });

      console.warn(
        `[cron-scheduler] ALERT: ${job.name} failed ${consecutiveFailures} times consecutively`
      );

      // 이메일 알림 (RESEND_API_KEY + CRON_ALERT_EMAIL 설정 시)
      const alertEmail = process.env.CRON_ALERT_EMAIL;
      if (alertEmail && process.env.RESEND_API_KEY) {
        try {
          const { Resend } = await import("resend");
          const resend = new Resend(process.env.RESEND_API_KEY);
          await resend.emails.send({
            from: "LifeDashboard <onboarding@resend.dev>",
            to: alertEmail,
            subject: `⚠️ Cron Job 실패 알림: ${job.name}`,
            html: `
              <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #dc2626;">⚠️ Cron Job 연속 실패</h2>
                <table style="border-collapse: collapse; width: 100%;">
                  <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Job</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${job.name}</td></tr>
                  <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">Schedule</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${job.schedule}</td></tr>
                  <tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">연속 실패</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${consecutiveFailures}회</td></tr>
                  <tr><td style="padding: 8px; font-weight: bold;">에러</td><td style="padding: 8px; color: #dc2626;">${error.slice(0, 300)}</td></tr>
                </table>
                <p style="color: #666; margin-top: 16px; font-size: 14px;">LifeDashboard Cron Monitor</p>
              </div>
            `,
          });
          console.log(`[cron-scheduler] Alert email sent to ${alertEmail}`);
        } catch (emailError) {
          console.error("[cron-scheduler] Failed to send alert email:", emailError);
        }
      }
    }
  } catch (notifyError) {
    // 알림 실패는 메인 로직에 영향을 주지 않음
    console.error("[cron-scheduler] Failed to handle failure notification:", notifyError);
  }
}

export async function getJobRuns(
  cronJobId: string,
  limit: number = 50
): Promise<CronJobRun[]> {
  const rows = await query<CronJobRunRow>(
    `SELECT ${CRON_RUN_FIELDS} FROM cron_job_runs
     WHERE cron_job_id = $1
     ORDER BY started_at DESC LIMIT $2`,
    [cronJobId, limit]
  );
  return rows.map(rowToCronJobRun);
}

// ─── Job 실행 ─────────────────────────────────────────────

/**
 * 특정 cron job을 즉시 실행 (수동 실행 / 스케줄러 호출 공용)
 */
export async function executeCronJob(jobId: string): Promise<CronJobRun> {
  const job = await getCronJob(jobId);
  if (!job) {
    throw new Error(`Cron job not found: ${jobId}`);
  }

  const handler = getCronHandler(job.handlerType);
  if (!handler) {
    throw new Error(`No handler registered for type: ${job.handlerType}`);
  }

  const runId = await createRun(jobId);

  try {
    const result = await handler({
      jobId: job.id,
      jobName: job.name,
      config: job.handlerConfig,
    });

    await completeRun(runId, result as Record<string, unknown>);

    // last_run_at + next_run_at 갱신
    const nextRun = getNextRunTime(job.schedule);
    await queryOne(
      `UPDATE cron_jobs SET last_run_at = NOW(), next_run_at = $2 WHERE id = $1`,
      [jobId, nextRun?.toISOString() || null]
    );

    const run = await queryOne<CronJobRunRow>(
      `SELECT ${CRON_RUN_FIELDS} FROM cron_job_runs WHERE id = $1`,
      [runId]
    );
    return rowToCronJobRun(run!);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await failRun(runId, errorMsg);

    // 실패 알림 처리 (비동기, 메인 로직 차단 안 함)
    await handleCronJobFailure(job, errorMsg);

    // last_run_at은 갱신, next_run_at도 갱신 (실패해도 다음 스케줄은 진행)
    const nextRun = getNextRunTime(job.schedule);
    await queryOne(
      `UPDATE cron_jobs SET last_run_at = NOW(), next_run_at = $2 WHERE id = $1`,
      [jobId, nextRun?.toISOString() || null]
    );

    const run = await queryOne<CronJobRunRow>(
      `SELECT ${CRON_RUN_FIELDS} FROM cron_job_runs WHERE id = $1`,
      [runId]
    );
    return rowToCronJobRun(run!);
  }
}

// ─── 스케줄러 루프 ──────────────────────────────────────

const ADVISORY_LOCK_ID = 72697001; // cron scheduler 전용 advisory lock key
const instanceId = crypto.randomUUID();

let timer: ReturnType<typeof setTimeout> | null = null;
let lockClient: PoolClient | null = null;
let isRunning = false;
let isShuttingDown = false;
let cycleCount = 0;
let lastCheckAt: string | null = null;
let lastError: string | null = null;
let activeJobCount = 0;

/**
 * Advisory lock 획득
 */
async function acquireAdvisoryLock(): Promise<boolean> {
  try {
    if (lockClient) {
      lockClient.release();
      lockClient = null;
    }

    lockClient = await pool.connect();

    const result = await lockClient.query<{ pg_try_advisory_lock: boolean }>(
      `SELECT pg_try_advisory_lock($1)`,
      [ADVISORY_LOCK_ID]
    );

    const acquired = result.rows[0]?.pg_try_advisory_lock === true;

    if (!acquired) {
      lockClient.release();
      lockClient = null;
      console.log(
        "[cron-scheduler] Advisory lock not acquired (another instance running)"
      );
    } else {
      lockClient.on("error", (err) => {
        console.error("[cron-scheduler] Lock connection lost:", err.message);
        lockClient = null;
        stopCronScheduler();
        setTimeout(() => {
          if (!isShuttingDown) {
            console.log("[cron-scheduler] Attempting to re-acquire lock...");
            startCronScheduler();
          }
        }, 10_000);
      });
      console.log(
        `[cron-scheduler] Advisory lock acquired (instance: ${instanceId.slice(0, 8)})`
      );
    }

    return acquired;
  } catch (error) {
    console.warn("[cron-scheduler] Failed to acquire advisory lock:", error);
    if (lockClient) {
      lockClient.release();
      lockClient = null;
    }
    return false;
  }
}

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

// ─── 스케줄 체크 사이클 ─────────────────────────────────

/**
 * 매분 실행: next_run_at이 현재 시각 이전인 enabled job을 실행
 */
async function runCheckCycle(): Promise<void> {
  if (!isRunning || isShuttingDown) return;

  try {
    // next_run_at <= NOW() 인 enabled job을 조회
    const dueJobs = await query<CronJobRow>(
      `SELECT ${CRON_JOB_FIELDS} FROM cron_jobs
       WHERE enabled = TRUE
         AND next_run_at IS NOT NULL
         AND next_run_at <= NOW()
       ORDER BY next_run_at ASC`
    );

    activeJobCount = dueJobs.length;
    lastCheckAt = new Date().toISOString();
    cycleCount++;

    if (dueJobs.length > 0) {
      console.log(
        `[cron-scheduler] Cycle #${cycleCount}: ${dueJobs.length} jobs due`
      );
    }

    // 순차 실행 (각 job은 독립적이지만 동일 인스턴스에서 순차 실행)
    for (const row of dueJobs) {
      const job = rowToCronJob(row);
      try {
        await executeCronJob(job.id);
        console.log(`[cron-scheduler] Executed: ${job.name}`);
      } catch (error) {
        console.error(
          `[cron-scheduler] Failed to execute ${job.name}:`,
          error
        );
      }
    }

    lastError = null;
  } catch (error) {
    if (isDbConnectionError(error)) {
      lastError = "Database connection failed";
      console.warn("[cron-scheduler] DB connection error, skipping cycle");
    } else {
      lastError = error instanceof Error ? error.message : String(error);
      console.error("[cron-scheduler] Check cycle error:", error);
    }
  }
}

/**
 * Self-rescheduling setTimeout (매 60초)
 */
async function scheduleNextCycle(): Promise<void> {
  if (!isRunning || isShuttingDown) return;

  await runCheckCycle();

  if (isRunning && !isShuttingDown) {
    const intervalMs = parseInt(
      process.env.CRON_SCHEDULER_INTERVAL_MS || "60000",
      10
    );
    timer = setTimeout(scheduleNextCycle, intervalMs);
  }
}

// ─── 스케줄러 제어 ──────────────────────────────────────

export async function startCronScheduler(): Promise<void> {
  if (isShuttingDown) return;

  if (timer) {
    console.warn("[cron-scheduler] Already running, stopping first");
    stopCronScheduler();
  }

  const lockAcquired = await acquireAdvisoryLock();
  if (!lockAcquired) {
    console.log("[cron-scheduler] Will retry lock acquisition in 10s...");
    timer = setTimeout(() => {
      if (!isShuttingDown) {
        startCronScheduler();
      }
    }, 10_000);
    return;
  }

  isRunning = true;
  console.log(
    `[cron-scheduler] Started (instance: ${instanceId.slice(0, 8)})`
  );

  scheduleNextCycle();
}

export function stopCronScheduler(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  isRunning = false;
  releaseAdvisoryLock();
  console.log("[cron-scheduler] Stopped");
}

export function gracefulShutdownCron(): void {
  console.log("[cron-scheduler] Graceful shutdown initiated");
  isShuttingDown = true;

  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  isRunning = false;
  releaseAdvisoryLock();
  console.log("[cron-scheduler] Graceful shutdown complete");
}

export function getCronSchedulerStatus(): CronSchedulerStatus {
  return {
    running: isRunning,
    instanceId: instanceId.slice(0, 8),
    cycleCount,
    lastCheckAt,
    lastError,
    activeJobs: activeJobCount,
  };
}
