// Cron Job Runs 정리 핸들러
// cron_job_runs 테이블의 오래된 데이터를 주기적으로 삭제하는 retention 정책

import { query, queryOne } from "../db";
import {
  registerCronHandler,
  type CronHandlerContext,
  type CronHandlerResult,
} from "../cron-handlers";

/**
 * cleanup-old-runs 핸들러
 *
 * handler_config 옵션:
 * - retentionDays?: number — 보관 기간 (기본: 30일)
 * - tables?: object — 테이블별 보관 기간 설정
 *   - cronJobRuns?: number — cron_job_runs 보관일 (기본: 30)
 *   - queueMetrics?: number — queue_metrics 보관일 (기본: 7, 이미 자체 정리하지만 안전망)
 *   - agentHistory?: number — agent_history 보관일 (기본: 90)
 */
async function cleanupOldRunsHandler(
  ctx: CronHandlerContext
): Promise<CronHandlerResult> {
  const config = ctx.config;
  const defaultRetention = typeof config.retentionDays === "number" ? config.retentionDays : 30;
  const tables = (config.tables as Record<string, number>) || {};

  const cronJobRunsDays = tables.cronJobRuns ?? defaultRetention;
  const queueMetricsDays = tables.queueMetrics ?? 7;
  const agentHistoryDays = tables.agentHistory ?? 90;

  const results: Record<string, number> = {};

  console.log(`[cleanup-old-runs] Starting cleanup (retention: cron_job_runs=${cronJobRunsDays}d, queue_metrics=${queueMetricsDays}d, agent_history=${agentHistoryDays}d)`);

  // 1. cron_job_runs: 오래된 실행 이력 삭제
  try {
    const cronResult = await queryOne<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM cron_job_runs
         WHERE started_at < NOW() - INTERVAL '1 day' * $1
           AND status != 'running'
         RETURNING id
       ) SELECT COUNT(*) AS count FROM deleted`,
      [cronJobRunsDays]
    );
    results.cronJobRuns = parseInt(cronResult?.count || "0", 10);
    console.log(`[cleanup-old-runs] cron_job_runs: ${results.cronJobRuns} rows deleted`);
  } catch (error) {
    console.error("[cleanup-old-runs] Failed to clean cron_job_runs:", error);
    results.cronJobRuns = -1;
  }

  // 2. queue_metrics: 오래된 메트릭 삭제 (안전망)
  try {
    const metricsResult = await queryOne<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM queue_metrics
         WHERE recorded_at < NOW() - INTERVAL '1 day' * $1
         RETURNING id
       ) SELECT COUNT(*) AS count FROM deleted`,
      [queueMetricsDays]
    );
    results.queueMetrics = parseInt(metricsResult?.count || "0", 10);
    console.log(`[cleanup-old-runs] queue_metrics: ${results.queueMetrics} rows deleted`);
  } catch (error) {
    // queue_metrics 테이블이 없을 수 있음 (자체 정리 로직이 있어 에러 무시)
    console.warn("[cleanup-old-runs] queue_metrics cleanup skipped:", error);
    results.queueMetrics = 0;
  }

  // 3. agent_history: 매우 오래된 히스토리 삭제
  try {
    const historyResult = await queryOne<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM agent_history
         WHERE created_at < NOW() - INTERVAL '1 day' * $1
         RETURNING id
       ) SELECT COUNT(*) AS count FROM deleted`,
      [agentHistoryDays]
    );
    results.agentHistory = parseInt(historyResult?.count || "0", 10);
    console.log(`[cleanup-old-runs] agent_history: ${results.agentHistory} rows deleted`);
  } catch (error) {
    console.error("[cleanup-old-runs] Failed to clean agent_history:", error);
    results.agentHistory = -1;
  }

  // 4. 오래된 running 상태 cron_job_runs를 failed로 전환 (1시간 이상 running 상태)
  try {
    const staleResult = await queryOne<{ count: string }>(
      `WITH updated AS (
         UPDATE cron_job_runs
         SET status = 'failed',
             finished_at = NOW(),
             error = 'Marked as failed: stuck in running state for over 1 hour'
         WHERE status = 'running'
           AND started_at < NOW() - INTERVAL '1 hour'
         RETURNING id
       ) SELECT COUNT(*) AS count FROM updated`,
    );
    results.staleRunsFixed = parseInt(staleResult?.count || "0", 10);
    if (results.staleRunsFixed > 0) {
      console.log(`[cleanup-old-runs] Fixed ${results.staleRunsFixed} stale running jobs`);
    }
  } catch (error) {
    console.error("[cleanup-old-runs] Failed to fix stale runs:", error);
    results.staleRunsFixed = -1;
  }

  const totalDeleted = Object.values(results)
    .filter((v) => v > 0)
    .reduce((a, b) => a + b, 0);

  return {
    message: `Cleanup completed: ${totalDeleted} total rows affected`,
    data: {
      ...results,
      retentionConfig: {
        cronJobRunsDays,
        queueMetricsDays,
        agentHistoryDays,
      },
    },
  };
}

// ─── 핸들러 등록 ──────────────────────────────────────────

registerCronHandler("cleanup-old-runs", cleanupOldRunsHandler);

export { cleanupOldRunsHandler };
