// 큐 메트릭 수집 및 조회
// 스냅샷 기록, 평균 대기 시간, 처리량(throughput) 계산

import { query, queryOne } from "./db";

// ─── 타입 정의 ────────────────────────────────────────────

export interface GroupMetrics {
  group: string;
  depth: { pending: number; running: number };
  concurrency: { used: number; max: number; utilization: number };
  avgWaitMs: number | null;
  throughputPerMin: number | null;
}

export interface MetricsSnapshot {
  recordedAt: string;
  groups: GroupMetrics[];
}

export interface MetricsResponse {
  snapshot: MetricsSnapshot;
  totals: {
    pending: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    deadLetter: number;
    total: number;
  };
  orchestrator: {
    running: boolean;
    lastCycleAt: string | null;
    cycleCount: number;
    instanceId: string | null;
  };
}

type WindowInterval = "15 minutes" | "1 hour" | "24 hours";

// ─── 메트릭 수집 ─────────────────────────────────────────

/**
 * 메트릭 스냅샷 기록 (오케스트레이터에서 호출)
 * ~1분 간격으로 throttle, 7일 보관
 */
export async function recordMetricsSnapshot(): Promise<void> {
  try {
    // throttle: 마지막 기록이 55초 이내면 스킵
    const lastRecord = await queryOne<{ recorded_at: string }>(
      `SELECT recorded_at FROM queue_metrics ORDER BY recorded_at DESC LIMIT 1`
    );

    if (lastRecord) {
      const elapsed = Date.now() - new Date(lastRecord.recorded_at).getTime();
      if (elapsed < 55_000) return;
    }

    // 모든 concurrency group 조회 (설정 + 실제 태스크 기준)
    const groups = await query<{ concurrency_group: string; max_concurrent: number }>(
      `SELECT COALESCE(cc.concurrency_group, tq.concurrency_group) AS concurrency_group,
              COALESCE(cc.max_concurrent, 3) AS max_concurrent
       FROM (SELECT DISTINCT concurrency_group FROM task_queue) tq
       FULL OUTER JOIN concurrency_config cc
         ON tq.concurrency_group = cc.concurrency_group
       WHERE COALESCE(cc.concurrency_group, tq.concurrency_group) IS NOT NULL`
    );

    if (groups.length === 0) return;

    // 각 그룹별 메트릭 계산 및 INSERT
    for (const { concurrency_group, max_concurrent } of groups) {
      // 상태별 카운트
      const counts = await queryOne<{
        pending: string;
        running: string;
        completed: string;
        failed: string;
        dead_letter: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('pending', 'queued')) AS pending,
           COUNT(*) FILTER (WHERE status = 'running') AS running,
           COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= NOW() - INTERVAL '1 minute') AS completed,
           COUNT(*) FILTER (WHERE status = 'failed' AND completed_at >= NOW() - INTERVAL '1 minute') AS failed,
           COUNT(*) FILTER (WHERE status = 'dead_letter' AND completed_at >= NOW() - INTERVAL '1 minute') AS dead_letter
         FROM task_queue
         WHERE concurrency_group = $1`,
        [concurrency_group]
      );

      // 평균 대기 시간 (1분 윈도우)
      const waitTime = await queryOne<{ avg_ms: string | null }>(
        `SELECT AVG(EXTRACT(EPOCH FROM (started_at - created_at)) * 1000) AS avg_ms
         FROM task_queue
         WHERE concurrency_group = $1
           AND started_at IS NOT NULL
           AND started_at >= NOW() - INTERVAL '1 minute'`,
        [concurrency_group]
      );

      // 처리량 (1분)
      const throughput = await queryOne<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM task_queue
         WHERE concurrency_group = $1
           AND status = 'completed'
           AND completed_at >= NOW() - INTERVAL '1 minute'`,
        [concurrency_group]
      );

      const slotsUsed = parseInt(counts?.running || "0", 10);

      await query(
        `INSERT INTO queue_metrics
           (concurrency_group, pending_count, running_count, completed_count,
            failed_count, dead_letter_count, avg_wait_ms, throughput_per_min,
            slots_used, slots_max)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          concurrency_group,
          parseInt(counts?.pending || "0", 10),
          slotsUsed,
          parseInt(counts?.completed || "0", 10),
          parseInt(counts?.failed || "0", 10),
          parseInt(counts?.dead_letter || "0", 10),
          waitTime?.avg_ms ? parseFloat(waitTime.avg_ms) : null,
          parseInt(throughput?.count || "0", 10),
          slotsUsed,
          max_concurrent,
        ]
      );
    }

    // 7일 이상 오래된 레코드 정리
    await query(
      `DELETE FROM queue_metrics WHERE recorded_at < NOW() - INTERVAL '7 days'`
    );
  } catch (error) {
    // 메트릭 기록 실패는 디스패치에 영향을 주지 않음
    console.warn("[queue-metrics] Failed to record snapshot:", error);
  }
}

// ─── 메트릭 조회 ─────────────────────────────────────────

function parseWindow(window: string): WindowInterval {
  switch (window) {
    case "1h":
      return "1 hour";
    case "24h":
      return "24 hours";
    case "15m":
    default:
      return "15 minutes";
  }
}

/**
 * 라이브 메트릭 조회
 */
export async function getMetrics(
  window: string = "15m",
  concurrencyGroup?: string
): Promise<MetricsResponse> {
  const interval = parseWindow(window);

  // 그룹별 depth + concurrency
  const groupFilter = concurrencyGroup ? "AND tq.concurrency_group = $1" : "";
  const groupParams = concurrencyGroup ? [concurrencyGroup] : [];

  const groupRows = await query<{
    concurrency_group: string;
    pending: string;
    running: string;
    max_concurrent: string;
  }>(
    `SELECT
       tq.concurrency_group,
       COUNT(*) FILTER (WHERE tq.status IN ('pending', 'queued')) AS pending,
       COUNT(*) FILTER (WHERE tq.status = 'running') AS running,
       COALESCE(cc.max_concurrent, 3) AS max_concurrent
     FROM task_queue tq
     LEFT JOIN concurrency_config cc ON tq.concurrency_group = cc.concurrency_group
     WHERE 1=1 ${groupFilter}
     GROUP BY tq.concurrency_group, cc.max_concurrent`,
    groupParams
  );

  // 그룹별 평균 대기 시간 + 처리량
  const groups: GroupMetrics[] = [];

  for (const row of groupRows) {
    const waitResult = await queryOne<{ avg_ms: string | null }>(
      `SELECT AVG(EXTRACT(EPOCH FROM (started_at - created_at)) * 1000) AS avg_ms
       FROM task_queue
       WHERE concurrency_group = $1
         AND started_at IS NOT NULL
         AND started_at >= NOW() - $2::INTERVAL`,
      [row.concurrency_group, interval]
    );

    const throughputResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM task_queue
       WHERE concurrency_group = $1
         AND status = 'completed'
         AND completed_at >= NOW() - $2::INTERVAL`,
      [row.concurrency_group, interval]
    );

    const pending = parseInt(row.pending, 10);
    const running = parseInt(row.running, 10);
    const maxConcurrent = parseInt(row.max_concurrent, 10);
    const completedCount = parseInt(throughputResult?.count || "0", 10);

    // 윈도우를 분 단위로 변환
    const windowMinutes = interval === "15 minutes" ? 15 : interval === "1 hour" ? 60 : 1440;

    groups.push({
      group: row.concurrency_group,
      depth: { pending, running },
      concurrency: {
        used: running,
        max: maxConcurrent,
        utilization: maxConcurrent > 0 ? Math.round((running / maxConcurrent) * 100) / 100 : 0,
      },
      avgWaitMs: waitResult?.avg_ms ? Math.round(parseFloat(waitResult.avg_ms) * 100) / 100 : null,
      throughputPerMin: completedCount > 0
        ? Math.round((completedCount / windowMinutes) * 100) / 100
        : 0,
    });
  }

  // 전체 통계
  const totalRows = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*) AS count FROM task_queue GROUP BY status`
  );

  const totals = {
    pending: 0, queued: 0, running: 0, completed: 0, failed: 0, deadLetter: 0, total: 0,
  };

  for (const row of totalRows) {
    const count = parseInt(row.count, 10);
    const key = row.status === "dead_letter" ? "deadLetter" : row.status;
    if (key in totals && key !== "total") {
      totals[key as keyof Omit<typeof totals, "total">] = count;
    }
    totals.total += count;
  }

  // 오케스트레이터 상태
  const heartbeat = await queryOne<{
    last_cycle_at: string;
    cycle_count: string;
    instance_id: string | null;
  }>(
    `SELECT last_cycle_at, cycle_count, instance_id
     FROM orchestrator_heartbeat
     WHERE id = 'singleton'`
  );

  return {
    snapshot: {
      recordedAt: new Date().toISOString(),
      groups,
    },
    totals,
    orchestrator: {
      running: heartbeat ? (Date.now() - new Date(heartbeat.last_cycle_at).getTime()) < 30_000 : false,
      lastCycleAt: heartbeat?.last_cycle_at || null,
      cycleCount: heartbeat ? parseInt(heartbeat.cycle_count, 10) : 0,
      instanceId: heartbeat?.instance_id || null,
    },
  };
}

// ─── 헬스체크 ────────────────────────────────────────────

export interface HealthCheck {
  status: "healthy" | "unhealthy";
  checks: {
    database: { status: "up" | "down"; latencyMs?: number; error?: string };
    orchestrator: {
      status: "up" | "stale" | "unknown";
      lastCycleSecondsAgo?: number;
      cycleCount?: number;
      threshold?: number;
    };
    queueBacklog: {
      status: "ok" | "critical";
      pendingCount: number;
      threshold: number;
    };
    cronScheduler: {
      status: "up" | "down" | "unknown";
      running?: boolean;
      instanceId?: string;
      cycleCount?: number;
      lastCheckAt?: string | null;
      lastError?: string | null;
      activeJobs?: number;
    };
  };
  timestamp: string;
}

/**
 * 헬스체크 수행
 */
export async function performHealthCheck(): Promise<HealthCheck> {
  const intervalMs = parseInt(process.env.ORCHESTRATOR_INTERVAL_MS || "5000", 10);
  const orchestratorThreshold = intervalMs * 3; // 3x interval
  const backlogThreshold = parseInt(process.env.QUEUE_BACKLOG_THRESHOLD || "1000", 10);

  const checks: HealthCheck["checks"] = {
    database: { status: "down" },
    orchestrator: { status: "unknown" },
    queueBacklog: { status: "ok", pendingCount: 0, threshold: backlogThreshold },
    cronScheduler: { status: "unknown" },
  };

  // 1. DB 연결 확인
  const dbStart = Date.now();
  try {
    await queryOne<{ ok: number }>(`SELECT 1 AS ok`);
    checks.database = { status: "up", latencyMs: Date.now() - dbStart };
  } catch (error) {
    checks.database = {
      status: "down",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  // 2. 오케스트레이터 하트비트 확인
  if (checks.database.status === "up") {
    try {
      const heartbeat = await queryOne<{
        seconds_ago: string;
        cycle_count: string;
      }>(
        `SELECT
           EXTRACT(EPOCH FROM (NOW() - last_cycle_at))::INTEGER AS seconds_ago,
           cycle_count
         FROM orchestrator_heartbeat
         WHERE id = 'singleton'`
      );

      if (heartbeat) {
        const secondsAgo = parseInt(heartbeat.seconds_ago, 10);
        const thresholdSeconds = Math.ceil(orchestratorThreshold / 1000);
        checks.orchestrator = {
          status: secondsAgo <= thresholdSeconds ? "up" : "stale",
          lastCycleSecondsAgo: secondsAgo,
          cycleCount: parseInt(heartbeat.cycle_count, 10),
          threshold: thresholdSeconds,
        };
      }
    } catch {
      checks.orchestrator = { status: "unknown" };
    }

    // 3. 큐 백로그 확인
    try {
      const backlog = await queryOne<{ count: string }>(
        `SELECT COUNT(*) AS count FROM task_queue WHERE status IN ('pending', 'queued')`
      );
      const pendingCount = parseInt(backlog?.count || "0", 10);
      checks.queueBacklog = {
        status: pendingCount >= backlogThreshold ? "critical" : "ok",
        pendingCount,
        threshold: backlogThreshold,
      };
    } catch {
      // DB 에러 시 기본값 유지
    }
  }

  // 4. 크론 스케줄러 상태 확인
  try {
    const { getCronSchedulerStatus } = await import("./cron-scheduler");
    const cronStatus = getCronSchedulerStatus();
    checks.cronScheduler = {
      status: cronStatus.running ? "up" : "down",
      running: cronStatus.running,
      instanceId: cronStatus.instanceId,
      cycleCount: cronStatus.cycleCount,
      lastCheckAt: cronStatus.lastCheckAt,
      lastError: cronStatus.lastError,
      activeJobs: cronStatus.activeJobs,
    };
  } catch {
    checks.cronScheduler = { status: "unknown" };
  }

  const isHealthy =
    checks.database.status === "up" &&
    checks.orchestrator.status !== "stale" &&
    checks.queueBacklog.status === "ok";
    // cronScheduler "down" 상태는 unhealthy로 판정하지 않음 (advisory lock 경쟁 시 정상)

  return {
    status: isHealthy ? "healthy" : "unhealthy",
    checks,
    timestamp: new Date().toISOString(),
  };
}
