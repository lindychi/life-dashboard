// Task Queue 데이터 분석 스크립트
// 사용자 요청 작업 vs 시스템 재시도 작업 패턴 분석

import { query } from "../src/lib/db";

interface TaskQueueRow {
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
  parent_task_id: string | null;
  created_by: string | null;
}

async function analyzeTasks() {
  console.log("=== Task Queue 데이터 분석 ===\n");

  // 1. 전체 통계
  const stats = await query<{ status: string; count: string }>(
    `SELECT status, COUNT(*) as count
     FROM task_queue
     GROUP BY status
     ORDER BY status`
  );

  console.log("1. 전체 상태별 통계:");
  for (const row of stats) {
    console.log(`   ${row.status}: ${row.count}개`);
  }
  console.log();

  // 2. 재시도 패턴 분석
  const retryStats = await query<{
    retry_count: number;
    count: string;
    avg_priority: string;
  }>(
    `SELECT retry_count,
            COUNT(*) as count,
            ROUND(AVG(priority), 2) as avg_priority
     FROM task_queue
     WHERE status IN ('pending', 'queued', 'running', 'failed', 'dead_letter')
     GROUP BY retry_count
     ORDER BY retry_count`
  );

  console.log("2. 재시도 횟수별 통계:");
  for (const row of retryStats) {
    console.log(
      `   재시도 ${row.retry_count}회: ${row.count}개 (평균 priority: ${row.avg_priority})`
    );
  }
  console.log();

  // 3. created_by 필드 분석 (현재 스키마에는 없지만 확인)
  const hasCreatedBy = await query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'task_queue' AND column_name = 'created_by'`
  );

  if (hasCreatedBy.length > 0) {
    const creatorStats = await query<{ created_by: string | null; count: string }>(
      `SELECT created_by, COUNT(*) as count
       FROM task_queue
       GROUP BY created_by
       ORDER BY count DESC`
    );

    console.log("3. 생성자(created_by)별 통계:");
    for (const row of creatorStats) {
      console.log(
        `   ${row.created_by || "(null/시스템)"}: ${row.count}개`
      );
    }
    console.log();
  } else {
    console.log("3. created_by 필드 없음 (스키마에 미존재)\n");
  }

  // 4. parent_task_id 필드 분석
  const hasParentTaskId = await query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'task_queue' AND column_name = 'parent_task_id'`
  );

  if (hasParentTaskId.length > 0) {
    const parentStats = await query<{
      has_parent: boolean;
      count: string;
      avg_retry_count: string;
    }>(
      `SELECT (parent_task_id IS NOT NULL) as has_parent,
              COUNT(*) as count,
              ROUND(AVG(retry_count), 2) as avg_retry_count
       FROM task_queue
       GROUP BY has_parent
       ORDER BY has_parent`
    );

    console.log("4. Parent Task 존재 여부별 통계:");
    for (const row of parentStats) {
      console.log(
        `   ${row.has_parent ? "자식 작업" : "최상위 작업"}: ${row.count}개 (평균 재시도: ${row.avg_retry_count}회)`
      );
    }
    console.log();
  } else {
    console.log("4. parent_task_id 필드 없음 (스키마에 미존재)\n");
  }

  // 5. 타입별 분석
  const typeStats = await query<{
    type: string;
    count: string;
    avg_retry_count: string;
    avg_priority: string;
  }>(
    `SELECT type,
            COUNT(*) as count,
            ROUND(AVG(retry_count), 2) as avg_retry_count,
            ROUND(AVG(priority), 2) as avg_priority
     FROM task_queue
     GROUP BY type
     ORDER BY count DESC
     LIMIT 10`
  );

  console.log("5. 작업 타입별 통계 (상위 10개):");
  for (const row of typeStats) {
    console.log(
      `   ${row.type}: ${row.count}개 (평균 재시도: ${row.avg_retry_count}회, 평균 priority: ${row.avg_priority})`
    );
  }
  console.log();

  // 6. Concurrency Group별 분석
  const groupStats = await query<{
    concurrency_group: string;
    pending: string;
    running: string;
    completed: string;
    failed: string;
    dead_letter: string;
  }>(
    `SELECT concurrency_group,
            COUNT(*) FILTER (WHERE status = 'pending') as pending,
            COUNT(*) FILTER (WHERE status = 'running') as running,
            COUNT(*) FILTER (WHERE status = 'completed') as completed,
            COUNT(*) FILTER (WHERE status = 'failed') as failed,
            COUNT(*) FILTER (WHERE status = 'dead_letter') as dead_letter
     FROM task_queue
     GROUP BY concurrency_group
     ORDER BY concurrency_group`
  );

  console.log("6. Concurrency Group별 상태 분포:");
  for (const row of groupStats) {
    console.log(
      `   ${row.concurrency_group}: pending=${row.pending}, running=${row.running}, completed=${row.completed}, failed=${row.failed}, dead_letter=${row.dead_letter}`
    );
  }
  console.log();

  // 7. 의존성 패턴 분석
  const depStats = await query<{
    has_deps: boolean;
    count: string;
    avg_dep_count: string;
  }>(
    `SELECT (array_length(depends_on, 1) IS NOT NULL AND array_length(depends_on, 1) > 0) as has_deps,
            COUNT(*) as count,
            ROUND(AVG(COALESCE(array_length(depends_on, 1), 0)), 2) as avg_dep_count
     FROM task_queue
     GROUP BY has_deps
     ORDER BY has_deps`
  );

  console.log("7. 의존성(depends_on) 패턴:");
  for (const row of depStats) {
    console.log(
      `   ${row.has_deps ? "의존성 있음" : "독립 작업"}: ${row.count}개 (평균 의존 작업 수: ${row.avg_dep_count}개)`
    );
  }
  console.log();

  // 8. 대기중인 작업 샘플 (pending, queued)
  const pendingSample = await query<TaskQueueRow>(
    `SELECT *
     FROM task_queue
     WHERE status IN ('pending', 'queued')
     ORDER BY priority DESC, created_at ASC
     LIMIT 10`
  );

  console.log("8. 대기중인 작업 샘플 (최대 10개):");
  if (pendingSample.length === 0) {
    console.log("   (없음)");
  } else {
    for (const task of pendingSample) {
      console.log(`   ID: ${task.id.slice(0, 8)}...`);
      console.log(`   Title: ${task.title}`);
      console.log(`   Type: ${task.type}`);
      console.log(`   Status: ${task.status}`);
      console.log(`   Priority: ${task.priority}`);
      console.log(`   Retry Count: ${task.retry_count} / ${task.max_retries}`);
      console.log(`   Created: ${task.created_at}`);
      console.log(`   Assigned Agent: ${task.assigned_agent || "(없음)"}`);
      console.log(`   Concurrency Group: ${task.concurrency_group}`);
      console.log(`   Depends On: ${task.depends_on.length > 0 ? task.depends_on.map(id => id.slice(0, 8)).join(", ") : "(없음)"}`);
      if (task.error) {
        console.log(`   Last Error: ${task.error.slice(0, 100)}...`);
      }
      console.log();
    }
  }

  // 9. Dead Letter Queue 분석
  const dlqSample = await query<TaskQueueRow>(
    `SELECT *
     FROM task_queue
     WHERE status = 'dead_letter'
     ORDER BY completed_at DESC
     LIMIT 5`
  );

  console.log("9. Dead Letter Queue 샘플 (최근 5개):");
  if (dlqSample.length === 0) {
    console.log("   (없음)");
  } else {
    for (const task of dlqSample) {
      console.log(`   ID: ${task.id.slice(0, 8)}...`);
      console.log(`   Title: ${task.title}`);
      console.log(`   Type: ${task.type}`);
      console.log(`   Retry Count: ${task.retry_count} / ${task.max_retries}`);
      console.log(`   Completed: ${task.completed_at}`);
      console.log(`   Error: ${task.error?.slice(0, 150) || "(없음)"}...`);
      console.log(`   Retry Errors Count: ${task.retry_errors.length}`);
      console.log();
    }
  }

  // 10. UI 노출 기준 제안
  console.log("10. UI 노출 기준 제안:");
  console.log("   [노출해야 할 작업]");
  console.log("   - 사용자가 직접 생성한 작업 (created_by 필드로 식별 가능)");
  console.log("   - 최상위(root) 작업 (parent_task_id가 null)");
  console.log("   - 재시도 횟수가 0인 작업 (retry_count = 0)");
  console.log("   - 의존성이 없는 독립 작업 (depends_on이 빈 배열)");
  console.log();
  console.log("   [숨겨야 할 작업]");
  console.log("   - 시스템 자동 재시도 작업 (retry_count > 0)");
  console.log("   - 자식 작업 (parent_task_id가 null이 아님)");
  console.log("   - 내부 시스템 작업 (type이 'internal' 등)");
  console.log("   - Dead Letter Queue 작업 (별도 탭/섹션에서만 노출)");
  console.log();

  process.exit(0);
}

analyzeTasks().catch((error) => {
  console.error("분석 실패:", error);
  process.exit(1);
});
