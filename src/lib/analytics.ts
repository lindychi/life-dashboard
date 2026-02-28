// 히스토리 데이터 패턴 분석: 에이전트별 성과, 태스크 유형별 성공률, 시간 분석
// PostgreSQL 기반 분석 쿼리

import { query } from "./db";

// ─── 타입 정의 ────────────────────────────────────────────

export interface AgentPerformance {
  agentId: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  inProgressTasks: number;
  completionRate: number; // 0-100%
  failureRate: number; // 0-100%
  avgCompletionTimeMinutes: number | null;
  medianCompletionTimeMinutes: number | null;
}

export interface TaskTypeAnalysis {
  taskType: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  inProgressCount: number;
  successRate: number; // 0-100%
  avgDurationMinutes: number | null;
  medianDurationMinutes: number | null;
  mostFrequentAgent: string | null;
}

export interface TimePattern {
  hour: number; // 0-23
  dayOfWeek: number; // 0-6 (0=Sunday)
  taskCount: number;
  completionRate: number;
}

export interface FailurePattern {
  errorKeyword: string;
  occurrenceCount: number;
  affectedAgents: string[];
  firstSeen: string;
  lastSeen: string;
  sampleErrors: string[];
}

export interface AnalyticsSummary {
  overview: {
    totalTasks: number;
    totalAgents: number;
    overallCompletionRate: number;
    overallFailureRate: number;
    avgTaskDurationMinutes: number | null;
  };
  agentPerformance: AgentPerformance[];
  taskTypeAnalysis: TaskTypeAnalysis[];
  timePatterns: TimePattern[];
  failurePatterns: FailurePattern[];
  recommendations: string[];
}

// ─── 에이전트별 성과 분석 ─────────────────────────────────

/**
 * 에이전트별 완료율, 실패율, 평균 소요 시간 분석
 */
export async function analyzeAgentPerformance(
  options?: {
    days?: number;
    minTasks?: number; // 최소 태스크 수 (통계적 유의성)
  }
): Promise<AgentPerformance[]> {
  const days = options?.days || 30;
  const minTasks = options?.minTasks || 3;

  const rows = await query<{
    agent_id: string;
    total_tasks: string;
    completed_tasks: string;
    failed_tasks: string;
    in_progress_tasks: string;
    avg_completion_minutes: string | null;
    median_completion_minutes: string | null;
  }>(
    `
    WITH task_events AS (
      SELECT
        agent_id,
        request_group_id,
        MIN(CASE WHEN type = 'task_started' THEN created_at END) as started_at,
        MAX(CASE WHEN type = 'task_completed' THEN created_at END) as completed_at,
        MAX(CASE WHEN type = 'task_failed' THEN created_at END) as failed_at
      FROM agent_history
      WHERE created_at >= NOW() - INTERVAL '$1 days'
        AND type IN ('task_started', 'task_completed', 'task_failed')
        AND request_group_id IS NOT NULL
      GROUP BY agent_id, request_group_id
    ),
    agent_stats AS (
      SELECT
        agent_id,
        COUNT(*) as total_tasks,
        COUNT(completed_at) as completed_tasks,
        COUNT(failed_at) as failed_tasks,
        COUNT(*) - COUNT(completed_at) - COUNT(failed_at) as in_progress_tasks,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60) as avg_completion_minutes,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) / 60) as median_completion_minutes
      FROM task_events
      WHERE started_at IS NOT NULL
      GROUP BY agent_id
      HAVING COUNT(*) >= $2
    )
    SELECT
      agent_id,
      total_tasks,
      completed_tasks,
      failed_tasks,
      in_progress_tasks,
      avg_completion_minutes,
      median_completion_minutes
    FROM agent_stats
    ORDER BY total_tasks DESC, completed_tasks DESC
    `,
    [days, minTasks]
  );

  return rows.map((row) => {
    const total = parseInt(row.total_tasks, 10);
    const completed = parseInt(row.completed_tasks, 10);
    const failed = parseInt(row.failed_tasks, 10);
    const inProgress = parseInt(row.in_progress_tasks, 10);

    return {
      agentId: row.agent_id,
      totalTasks: total,
      completedTasks: completed,
      failedTasks: failed,
      inProgressTasks: inProgress,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      failureRate: total > 0 ? Math.round((failed / total) * 100) : 0,
      avgCompletionTimeMinutes: row.avg_completion_minutes
        ? Math.round(parseFloat(row.avg_completion_minutes))
        : null,
      medianCompletionTimeMinutes: row.median_completion_minutes
        ? Math.round(parseFloat(row.median_completion_minutes))
        : null,
    };
  });
}

// ─── 태스크 유형별 분석 ───────────────────────────────────

/**
 * task_queue의 type 필드 기반 태스크 유형별 성공률 분석
 */
export async function analyzeTaskTypes(
  options?: {
    days?: number;
  }
): Promise<TaskTypeAnalysis[]> {
  const days = options?.days || 30;

  const rows = await query<{
    task_type: string;
    total_count: string;
    completed_count: string;
    failed_count: string;
    in_progress_count: string;
    avg_duration_minutes: string | null;
    median_duration_minutes: string | null;
    most_frequent_agent: string | null;
  }>(
    `
    WITH task_durations AS (
      SELECT
        type as task_type,
        status,
        assigned_agent,
        EXTRACT(EPOCH FROM (completed_at - started_at)) / 60 as duration_minutes
      FROM task_queue
      WHERE created_at >= NOW() - INTERVAL '$1 days'
    )
    SELECT
      task_type,
      COUNT(*) as total_count,
      COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
      COUNT(*) FILTER (WHERE status IN ('failed', 'dead_letter')) as failed_count,
      COUNT(*) FILTER (WHERE status IN ('pending', 'queued', 'running')) as in_progress_count,
      AVG(duration_minutes) FILTER (WHERE status = 'completed') as avg_duration_minutes,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_minutes) FILTER (WHERE status = 'completed') as median_duration_minutes,
      MODE() WITHIN GROUP (ORDER BY assigned_agent) as most_frequent_agent
    FROM task_durations
    GROUP BY task_type
    ORDER BY total_count DESC
    `,
    [days]
  );

  return rows.map((row) => {
    const total = parseInt(row.total_count, 10);
    const completed = parseInt(row.completed_count, 10);
    const failed = parseInt(row.failed_count, 10);
    const finalized = completed + failed;

    return {
      taskType: row.task_type,
      totalCount: total,
      completedCount: completed,
      failedCount: failed,
      inProgressCount: parseInt(row.in_progress_count, 10),
      successRate: finalized > 0 ? Math.round((completed / finalized) * 100) : 0,
      avgDurationMinutes: row.avg_duration_minutes
        ? Math.round(parseFloat(row.avg_duration_minutes))
        : null,
      medianDurationMinutes: row.median_duration_minutes
        ? Math.round(parseFloat(row.median_duration_minutes))
        : null,
      mostFrequentAgent: row.most_frequent_agent,
    };
  });
}

// ─── 시간대별 패턴 분석 ───────────────────────────────────

/**
 * 시간대별(시간, 요일) 태스크 발생 빈도 및 완료율 분석
 */
export async function analyzeTimePatterns(
  options?: {
    days?: number;
  }
): Promise<TimePattern[]> {
  const days = options?.days || 30;

  const rows = await query<{
    hour: number;
    day_of_week: number;
    task_count: string;
    completed_count: string;
  }>(
    `
    WITH task_times AS (
      SELECT
        EXTRACT(HOUR FROM created_at) as hour,
        EXTRACT(DOW FROM created_at) as day_of_week,
        request_group_id,
        type
      FROM agent_history
      WHERE created_at >= NOW() - INTERVAL '$1 days'
        AND type IN ('task_started', 'task_completed')
        AND request_group_id IS NOT NULL
    )
    SELECT
      hour,
      day_of_week,
      COUNT(*) FILTER (WHERE type = 'task_started') as task_count,
      COUNT(*) FILTER (WHERE type = 'task_completed') as completed_count
    FROM task_times
    GROUP BY hour, day_of_week
    HAVING COUNT(*) FILTER (WHERE type = 'task_started') > 0
    ORDER BY day_of_week, hour
    `,
    [days]
  );

  return rows.map((row) => {
    const taskCount = parseInt(row.task_count, 10);
    const completedCount = parseInt(row.completed_count, 10);

    return {
      hour: row.hour,
      dayOfWeek: row.day_of_week,
      taskCount,
      completionRate: taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0,
    };
  });
}

// ─── 실패 패턴 분석 ───────────────────────────────────────

/**
 * 에러 메시지에서 키워드 추출 후 빈도 분석
 */
export async function analyzeFailurePatterns(
  options?: {
    days?: number;
    limit?: number;
  }
): Promise<FailurePattern[]> {
  const days = options?.days || 30;
  const limit = options?.limit || 10;

  // 1. task_queue의 retry_errors에서 에러 키워드 추출
  const rows = await query<{
    error_keyword: string;
    occurrence_count: string;
    affected_agents: string[];
    first_seen: string;
    last_seen: string;
    sample_errors: string[];
  }>(
    `
    WITH error_extracts AS (
      SELECT
        id,
        assigned_agent,
        jsonb_array_elements(retry_errors)->>'error' as error_msg,
        (jsonb_array_elements(retry_errors)->>'timestamp')::TIMESTAMPTZ as error_time
      FROM task_queue
      WHERE status IN ('failed', 'dead_letter')
        AND created_at >= NOW() - INTERVAL '$1 days'
        AND jsonb_array_length(retry_errors) > 0
    ),
    error_keywords AS (
      SELECT
        id,
        assigned_agent,
        error_msg,
        error_time,
        -- Extract first significant word from error (heuristic)
        COALESCE(
          (regexp_match(error_msg, '([A-Z][a-zA-Z]+Error|[A-Z][a-zA-Z]+Exception|timeout|failed|abort|crash)', 'i'))[1],
          split_part(error_msg, ' ', 1)
        ) as keyword
      FROM error_extracts
    )
    SELECT
      keyword as error_keyword,
      COUNT(*) as occurrence_count,
      array_agg(DISTINCT assigned_agent) FILTER (WHERE assigned_agent IS NOT NULL) as affected_agents,
      MIN(error_time) as first_seen,
      MAX(error_time) as last_seen,
      array_agg(DISTINCT error_msg) FILTER (WHERE error_msg IS NOT NULL) as sample_errors
    FROM error_keywords
    WHERE keyword IS NOT NULL AND keyword != ''
    GROUP BY keyword
    ORDER BY occurrence_count DESC
    LIMIT $2
    `,
    [days, limit]
  );

  return rows.map((row) => ({
    errorKeyword: row.error_keyword,
    occurrenceCount: parseInt(row.occurrence_count, 10),
    affectedAgents: row.affected_agents || [],
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    sampleErrors: (row.sample_errors || []).slice(0, 3), // 최대 3개 샘플
  }));
}

// ─── 종합 분석 및 권장사항 ────────────────────────────────

/**
 * 전체 데이터 분석 + AI 기반 개선 제안 생성
 */
export async function generateAnalyticsSummary(
  options?: {
    days?: number;
  }
): Promise<AnalyticsSummary> {
  const days = options?.days || 30;

  // 병렬 실행으로 모든 분석 수행
  const [agentPerf, taskTypes, timePatterns, failurePatterns, overviewData] = await Promise.all([
    analyzeAgentPerformance({ days }),
    analyzeTaskTypes({ days }),
    analyzeTimePatterns({ days }),
    analyzeFailurePatterns({ days }),
    query<{
      total_tasks: string;
      total_agents: string;
      completed_tasks: string;
      failed_tasks: string;
      avg_duration_minutes: string | null;
    }>(
      `
      WITH task_summary AS (
        SELECT
          COUNT(DISTINCT request_group_id) as total_tasks,
          COUNT(DISTINCT agent_id) as total_agents,
          COUNT(*) FILTER (WHERE type = 'task_completed') as completed_tasks,
          COUNT(*) FILTER (WHERE type = 'task_failed') as failed_tasks
        FROM agent_history
        WHERE created_at >= NOW() - INTERVAL '$1 days'
          AND request_group_id IS NOT NULL
          AND type IN ('task_started', 'task_completed', 'task_failed')
      ),
      duration_calc AS (
        SELECT
          AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60) as avg_duration_minutes
        FROM task_queue
        WHERE created_at >= NOW() - INTERVAL '$1 days'
          AND status = 'completed'
          AND started_at IS NOT NULL
          AND completed_at IS NOT NULL
      )
      SELECT
        ts.total_tasks,
        ts.total_agents,
        ts.completed_tasks,
        ts.failed_tasks,
        dc.avg_duration_minutes
      FROM task_summary ts
      CROSS JOIN duration_calc dc
      `,
      [days]
    ),
  ]);

  const overview = overviewData[0] || {
    total_tasks: "0",
    total_agents: "0",
    completed_tasks: "0",
    failed_tasks: "0",
    avg_duration_minutes: null,
  };

  const totalTasks = parseInt(overview.total_tasks, 10);
  const completedTasks = parseInt(overview.completed_tasks, 10);
  const failedTasks = parseInt(overview.failed_tasks, 10);
  const finalizedTasks = completedTasks + failedTasks;

  const overallCompletionRate =
    finalizedTasks > 0 ? Math.round((completedTasks / finalizedTasks) * 100) : 0;
  const overallFailureRate =
    finalizedTasks > 0 ? Math.round((failedTasks / finalizedTasks) * 100) : 0;

  // 권장사항 생성 (데이터 기반 휴리스틱)
  const recommendations: string[] = [];

  // 1. 에이전트별 성과 기반 권장사항
  const poorPerformers = agentPerf.filter((a) => a.completionRate < 50 && a.totalTasks >= 5);
  if (poorPerformers.length > 0) {
    recommendations.push(
      `⚠️ 완료율 50% 미만 에이전트: ${poorPerformers.map((a) => a.agentId).join(", ")}. ` +
        `태스크 할당 전략을 재검토하거나 에이전트 설정을 최적화하세요.`
    );
  }

  const highFailureAgents = agentPerf.filter((a) => a.failureRate > 30 && a.totalTasks >= 5);
  if (highFailureAgents.length > 0) {
    recommendations.push(
      `🔴 실패율 30% 초과 에이전트: ${highFailureAgents.map((a) => a.agentId).join(", ")}. ` +
        `에러 로그를 분석하여 근본 원인을 파악하세요.`
    );
  }

  // 2. 태스크 유형별 분석 기반 권장사항
  const problematicTaskTypes = taskTypes.filter(
    (t) => t.successRate < 60 && t.totalCount >= 5
  );
  if (problematicTaskTypes.length > 0) {
    recommendations.push(
      `⚠️ 성공률 60% 미만 태스크 유형: ${problematicTaskTypes.map((t) => t.taskType).join(", ")}. ` +
        `해당 태스크의 실행 로직이나 전제 조건을 점검하세요.`
    );
  }

  const slowTaskTypes = taskTypes.filter(
    (t) => t.avgDurationMinutes && t.avgDurationMinutes > 30
  );
  if (slowTaskTypes.length > 0) {
    recommendations.push(
      `⏱️ 평균 소요 시간 30분 초과 태스크 유형: ${slowTaskTypes.map((t) => t.taskType).join(", ")}. ` +
        `타임아웃 설정 증가 또는 태스크 분할을 고려하세요.`
    );
  }

  // 3. 실패 패턴 기반 권장사항
  if (failurePatterns.length > 0) {
    const topError = failurePatterns[0];
    if (topError.occurrenceCount > 5) {
      recommendations.push(
        `🔍 가장 빈번한 에러: "${topError.errorKeyword}" (${topError.occurrenceCount}회). ` +
          `영향받은 에이전트: ${topError.affectedAgents.join(", ")}. ` +
          `우선 해결이 필요합니다.`
      );
    }
  }

  // 4. 미완료 태스크 기반 권장사항
  const { getIncompleteTasks } = await import("./history");
  const incompleteSummary = await getIncompleteTasks({ days, status: "abandoned" });
  if (incompleteSummary.abandonedCount > 3) {
    recommendations.push(
      `⏸️ 24시간 이상 방치된 미완료 태스크 ${incompleteSummary.abandonedCount}개 발견. ` +
        `태스크 상태 모니터링 및 자동 타임아웃 정책 강화를 권장합니다.`
    );
  }

  // 5. 전반적 시스템 상태 기반 권장사항
  if (overallFailureRate > 20) {
    recommendations.push(
      `📊 전체 실패율 ${overallFailureRate}%로 높은 편입니다. ` +
        `시스템 전반의 안정성 점검이 필요합니다.`
    );
  }

  if (overallCompletionRate > 85) {
    recommendations.push(
      `✅ 전체 완료율 ${overallCompletionRate}%로 양호합니다. 현재 운영 방식을 유지하세요.`
    );
  }

  // 6. 데이터 부족 시 메시지
  if (totalTasks < 10) {
    recommendations.push(
      `ℹ️ 분석 기간 내 태스크 수(${totalTasks})가 적어 통계적 신뢰도가 낮습니다. ` +
        `더 긴 기간 데이터를 수집한 후 재분석을 권장합니다.`
    );
  }

  return {
    overview: {
      totalTasks,
      totalAgents: parseInt(overview.total_agents, 10),
      overallCompletionRate,
      overallFailureRate,
      avgTaskDurationMinutes: overview.avg_duration_minutes
        ? Math.round(parseFloat(overview.avg_duration_minutes))
        : null,
    },
    agentPerformance: agentPerf,
    taskTypeAnalysis: taskTypes,
    timePatterns,
    failurePatterns,
    recommendations,
  };
}
