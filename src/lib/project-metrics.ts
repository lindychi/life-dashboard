/**
 * Project Metrics Library
 * 실시간 KPI 연동 시스템: 태스크 실행 데이터 기반 프로젝트 메트릭 자동 계산
 */

import { query, queryOne } from "./db";

export interface ProjectMetric {
  id: string;
  project_id: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  running_tasks: number;
  completion_rate: number;
  success_rate: number;
  avg_task_duration_seconds: number | null;
  total_execution_time_seconds: number;
  last_task_completed_at: string | null;
  last_task_failed_at: string | null;
  snapshot_at: string;
  created_at: string;
}

export interface LatestProjectMetric {
  project_id: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  running_tasks: number;
  completion_rate: number;
  success_rate: number;
  avg_task_duration_seconds: number | null;
  total_execution_time_seconds: number;
  last_task_completed_at: string | null;
  last_task_failed_at: string | null;
  snapshot_at: string;
  project_name: string;
  project_status: string;
  project_progress: number;
}

export interface ProjectTask {
  id: string;
  project_id: string;
  task_execution_id: string | null;
  task_queue_id: string | null;
  task_title: string | null;
  task_status: string | null;
  task_type: string | null;
  created_at: string;
}

export interface CalculatedMetrics {
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  running_tasks: number;
  completion_rate: number;
  success_rate: number;
  avg_task_duration_seconds: number | null;
  total_execution_time_seconds: number;
  last_task_completed_at: string | null;
  last_task_failed_at: string | null;
}

export interface MetricsHistory {
  snapshot_id: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  running_tasks: number;
  completion_rate: number;
  success_rate: number;
  avg_task_duration_seconds: number | null;
  snapshot_at: string;
}

/**
 * 프로젝트-태스크 연결 생성
 */
export async function linkTaskToProject(
  projectId: string,
  taskExecutionId?: string,
  taskQueueId?: string,
  metadata?: {
    task_title?: string;
    task_status?: string;
    task_type?: string;
  }
): Promise<ProjectTask> {
  if (!taskExecutionId && !taskQueueId) {
    throw new Error("Either taskExecutionId or taskQueueId must be provided");
  }

  const result = await queryOne<ProjectTask>(
    `INSERT INTO project_tasks (
      project_id,
      task_execution_id,
      task_queue_id,
      task_title,
      task_status,
      task_type
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    [
      projectId,
      taskExecutionId || null,
      taskQueueId || null,
      metadata?.task_title || null,
      metadata?.task_status || null,
      metadata?.task_type || null,
    ]
  );

  if (!result) {
    throw new Error("Failed to link task to project");
  }

  return result;
}

/**
 * 프로젝트의 현재 메트릭 계산 (실시간)
 */
export async function calculateProjectMetrics(
  projectId: string
): Promise<CalculatedMetrics> {
  const result = await queryOne<CalculatedMetrics>(
    `SELECT * FROM calculate_project_metrics($1)`,
    [projectId]
  );

  if (!result) {
    // 프로젝트에 연결된 태스크가 없는 경우 기본값 반환
    return {
      total_tasks: 0,
      completed_tasks: 0,
      failed_tasks: 0,
      running_tasks: 0,
      completion_rate: 0,
      success_rate: 0,
      avg_task_duration_seconds: null,
      total_execution_time_seconds: 0,
      last_task_completed_at: null,
      last_task_failed_at: null,
    };
  }

  return result;
}

/**
 * 프로젝트 메트릭 스냅샷 생성
 */
export async function snapshotProjectMetrics(
  projectId: string
): Promise<string> {
  const result = await queryOne<{ snapshot_project_metrics: string }>(
    `SELECT snapshot_project_metrics($1) AS snapshot_project_metrics`,
    [projectId]
  );

  if (!result) {
    throw new Error("Failed to create metrics snapshot");
  }

  return result.snapshot_project_metrics;
}

/**
 * 모든 프로젝트의 메트릭 스냅샷 생성
 */
export async function snapshotAllProjectMetrics(): Promise<number> {
  const result = await queryOne<{ snapshot_all_project_metrics: number }>(
    `SELECT snapshot_all_project_metrics() AS snapshot_all_project_metrics`
  );

  return result?.snapshot_all_project_metrics || 0;
}

/**
 * 프로젝트 progress 필드 업데이트
 */
export async function updateProjectProgress(projectId: string): Promise<void> {
  await query(`SELECT update_project_progress($1)`, [projectId]);
}

/**
 * 최신 프로젝트 메트릭 조회 (view 사용)
 */
export async function getLatestProjectMetric(
  projectId: string
): Promise<LatestProjectMetric | null> {
  const result = await queryOne<LatestProjectMetric>(
    `SELECT * FROM latest_project_metrics WHERE project_id = $1`,
    [projectId]
  );

  return result || null;
}

/**
 * 모든 프로젝트의 최신 메트릭 조회
 */
export async function getAllLatestProjectMetrics(): Promise<
  LatestProjectMetric[]
> {
  const result = await query<LatestProjectMetric>(
    `SELECT * FROM latest_project_metrics ORDER BY project_name`
  );

  return result;
}

/**
 * 프로젝트 메트릭 히스토리 조회
 */
export async function getProjectMetricsHistory(
  projectId: string,
  limit = 100
): Promise<MetricsHistory[]> {
  const result = await query<MetricsHistory>(
    `SELECT * FROM get_project_metrics_history($1, $2)`,
    [projectId, limit]
  );

  return result;
}

/**
 * 프로젝트에 연결된 태스크 목록 조회
 */
export async function getProjectTasks(
  projectId: string,
  limit = 50
): Promise<ProjectTask[]> {
  const result = await query<ProjectTask>(
    `SELECT * FROM project_tasks
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [projectId, limit]
  );

  return result;
}

/**
 * 태스크가 속한 프로젝트 찾기
 */
export async function findProjectByTaskExecution(
  taskExecutionId: string
): Promise<string | null> {
  const result = await queryOne<{ project_id: string }>(
    `SELECT project_id FROM project_tasks WHERE task_execution_id = $1`,
    [taskExecutionId]
  );

  return result?.project_id || null;
}

/**
 * 오래된 메트릭 스냅샷 정리 (30일 이상)
 */
export async function cleanupOldMetricsSnapshots(): Promise<number> {
  const result = await queryOne<{ cleanup_old_metrics_snapshots: number }>(
    `SELECT cleanup_old_metrics_snapshots() AS cleanup_old_metrics_snapshots`
  );

  return result?.cleanup_old_metrics_snapshots || 0;
}

/**
 * 프로젝트의 실시간 KPI 요약 (대시보드 표시용)
 */
export async function getProjectKPISummary(projectId: string): Promise<{
  project_id: string;
  metrics: CalculatedMetrics;
  latest_snapshot: LatestProjectMetric | null;
}> {
  const [metrics, latestSnapshot] = await Promise.all([
    calculateProjectMetrics(projectId),
    getLatestProjectMetric(projectId),
  ]);

  return {
    project_id: projectId,
    metrics,
    latest_snapshot: latestSnapshot,
  };
}

/**
 * 대시보드용 전체 프로젝트 KPI 요약
 */
export async function getAllProjectsKPISummary(): Promise<
  {
    project_id: string;
    project_name: string;
    metrics: LatestProjectMetric;
  }[]
> {
  const allMetrics = await getAllLatestProjectMetrics();

  return allMetrics.map((m) => ({
    project_id: m.project_id,
    project_name: m.project_name,
    metrics: m,
  }));
}
