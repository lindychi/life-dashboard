-- 메트릭 시스템 개선 패치
-- 작성일: 2025-02-28
-- 목적: NULL 안전성 강화, 동기화 트리거 추가, 배치 처리 함수 추가

-- ============================================================================
-- 1. NULL 안전성 강화
-- ============================================================================

-- calculate_key_result_progress 함수 개선
CREATE OR REPLACE FUNCTION calculate_key_result_progress(
  p_metric_type TEXT,
  p_current_value NUMERIC,
  p_target_value NUMERIC
)
RETURNS INTEGER AS $$
BEGIN
  -- NULL 체크 추가
  IF p_current_value IS NULL THEN
    RETURN 0;
  END IF;

  IF p_target_value IS NULL OR p_target_value <= 0 THEN
    RETURN 0;
  END IF;

  IF p_metric_type = 'boolean' THEN
    -- Boolean: 0 or 100
    RETURN CASE WHEN p_current_value >= 1 THEN 100 ELSE 0 END;
  ELSE
    -- Percentage, number, currency: (current / target) * 100, capped at 100
    RETURN LEAST(100, GREATEST(0, ROUND((p_current_value / p_target_value) * 100)));
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- 2. Denormalized 데이터 동기화
-- ============================================================================

-- project_tasks.task_status를 task_executions.status와 동기화하는 트리거
CREATE OR REPLACE FUNCTION sync_project_task_status()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE project_tasks
  SET task_status = NEW.status
  WHERE task_execution_id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성: task_executions 상태 변경 시 project_tasks 업데이트
DROP TRIGGER IF EXISTS task_execution_status_sync ON task_executions;
CREATE TRIGGER task_execution_status_sync
  AFTER UPDATE OF status ON task_executions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION sync_project_task_status();

-- ============================================================================
-- 3. 배치 스냅샷 생성 함수
-- ============================================================================

-- 여러 프로젝트의 메트릭 스냅샷을 한 번에 생성
CREATE OR REPLACE FUNCTION snapshot_project_metrics_batch(p_project_ids UUID[])
RETURNS INTEGER AS $$
DECLARE
  v_project_id UUID;
  v_count INTEGER := 0;
BEGIN
  FOREACH v_project_id IN ARRAY p_project_ids LOOP
    PERFORM snapshot_project_metrics(v_project_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. 최적화된 calculate_project_metrics (Denormalized 데이터 활용)
-- ============================================================================

-- 기존 함수를 개선하여 불필요한 JOIN 제거
-- project_tasks.task_status를 직접 사용 (task_executions JOIN 제거)
CREATE OR REPLACE FUNCTION calculate_project_metrics_optimized(p_project_id UUID)
RETURNS TABLE (
  total_tasks BIGINT,
  completed_tasks BIGINT,
  failed_tasks BIGINT,
  running_tasks BIGINT,
  completion_rate NUMERIC,
  success_rate NUMERIC,
  avg_task_duration_seconds NUMERIC,
  total_execution_time_seconds BIGINT,
  last_task_completed_at TIMESTAMPTZ,
  last_task_failed_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  WITH task_stats AS (
    SELECT
      -- denormalized task_status 사용
      COUNT(*) FILTER (WHERE pt.task_status IN ('completed', 'failed', 'running', 'interrupted')) AS total,
      COUNT(*) FILTER (WHERE pt.task_status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE pt.task_status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE pt.task_status = 'running') AS running,
      -- 실행 시간은 여전히 task_executions에서 가져와야 함
      AVG(EXTRACT(EPOCH FROM (te.completed_at - te.started_at)))
        FILTER (WHERE te.status = 'completed' AND te.completed_at IS NOT NULL) AS avg_duration,
      SUM(EXTRACT(EPOCH FROM (te.completed_at - te.started_at)))
        FILTER (WHERE te.status = 'completed' AND te.completed_at IS NOT NULL) AS total_duration,
      MAX(te.completed_at) FILTER (WHERE te.status = 'completed') AS last_completed,
      MAX(te.completed_at) FILTER (WHERE te.status = 'failed') AS last_failed
    FROM project_tasks pt
    LEFT JOIN task_executions te ON pt.task_execution_id = te.id
    WHERE pt.project_id = p_project_id
  )
  SELECT
    COALESCE(ts.total, 0)::BIGINT,
    COALESCE(ts.completed, 0)::BIGINT,
    COALESCE(ts.failed, 0)::BIGINT,
    COALESCE(ts.running, 0)::BIGINT,
    CASE
      WHEN COALESCE(ts.total, 0) > 0
      THEN ROUND((COALESCE(ts.completed, 0)::NUMERIC / ts.total::NUMERIC) * 100, 2)
      ELSE 0.00
    END AS completion_rate,
    CASE
      WHEN COALESCE(ts.completed, 0) + COALESCE(ts.failed, 0) > 0
      THEN ROUND((COALESCE(ts.completed, 0)::NUMERIC / (ts.completed + ts.failed)::NUMERIC) * 100, 2)
      ELSE 0.00
    END AS success_rate,
    ROUND(COALESCE(ts.avg_duration, 0)::NUMERIC, 2),
    COALESCE(ts.total_duration, 0)::BIGINT,
    ts.last_completed,
    ts.last_failed
  FROM task_stats ts;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. 메트릭 임계값 알림 트리거 (선택적)
-- ============================================================================

-- 메트릭 임계값 도달 시 pg_notify로 알림 전송
CREATE OR REPLACE FUNCTION check_metric_thresholds()
RETURNS TRIGGER AS $$
BEGIN
  -- 완료율 80% 도달
  IF NEW.completion_rate >= 80 AND COALESCE(OLD.completion_rate, 0) < 80 THEN
    PERFORM pg_notify(
      'metric_threshold_reached',
      json_build_object(
        'project_id', NEW.project_id,
        'metric', 'completion_rate',
        'value', NEW.completion_rate,
        'threshold', 80
      )::text
    );
  END IF;

  -- 성공률 90% 도달
  IF NEW.success_rate >= 90 AND COALESCE(OLD.success_rate, 0) < 90 THEN
    PERFORM pg_notify(
      'metric_threshold_reached',
      json_build_object(
        'project_id', NEW.project_id,
        'metric', 'success_rate',
        'value', NEW.success_rate,
        'threshold', 90
      )::text
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성 (선택적: 알림 기능이 필요한 경우만 활성화)
-- DROP TRIGGER IF EXISTS metrics_threshold_check ON project_metrics;
-- CREATE TRIGGER metrics_threshold_check
--   AFTER INSERT OR UPDATE ON project_metrics
--   FOR EACH ROW
--   EXECUTE FUNCTION check_metric_thresholds();

-- ============================================================================
-- 6. 대시보드용 집계 쿼리 최적화 (Materialized View)
-- ============================================================================

-- 전체 프로젝트 메트릭 요약을 위한 Materialized View
-- 대규모 프로젝트(100+)에서 성능 향상
CREATE MATERIALIZED VIEW IF NOT EXISTS project_metrics_summary AS
SELECT
  COUNT(DISTINCT pm.project_id) AS total_projects,
  AVG(pm.completion_rate) AS avg_completion_rate,
  AVG(pm.success_rate) AS avg_success_rate,
  SUM(pm.total_tasks) AS total_tasks_all_projects,
  SUM(pm.completed_tasks) AS total_completed_tasks,
  SUM(pm.failed_tasks) AS total_failed_tasks,
  SUM(pm.running_tasks) AS total_running_tasks
FROM (
  SELECT DISTINCT ON (project_id)
    project_id,
    completion_rate,
    success_rate,
    total_tasks,
    completed_tasks,
    failed_tasks,
    running_tasks
  FROM project_metrics
  ORDER BY project_id, snapshot_at DESC
) pm;

-- Unique index for CONCURRENTLY refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_metrics_summary_unique
  ON project_metrics_summary ((1));

-- Materialized View 갱신 함수
CREATE OR REPLACE FUNCTION refresh_project_metrics_summary()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY project_metrics_summary;
END;
$$ LANGUAGE plpgsql;

-- 트리거로 자동 갱신 (선택적: 성능 영향 고려)
-- DROP TRIGGER IF EXISTS auto_refresh_metrics_summary ON project_metrics;
-- CREATE TRIGGER auto_refresh_metrics_summary
--   AFTER INSERT ON project_metrics
--   FOR EACH STATEMENT
--   EXECUTE FUNCTION refresh_project_metrics_summary();

-- ============================================================================
-- 7. OKR 시스템 개선: Key Result 생성/업데이트 시 자동 검증
-- ============================================================================

-- Key Result weight 합계 검증 함수
CREATE OR REPLACE FUNCTION validate_key_result_weights(p_objective_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_total_weight INTEGER;
BEGIN
  SELECT COALESCE(SUM(weight), 0)
  INTO v_total_weight
  FROM key_results
  WHERE objective_id = p_objective_id;

  -- weight 합계가 100이면 true, 아니면 false
  RETURN v_total_weight = 100;
END;
$$ LANGUAGE plpgsql;

-- Key Result weight 합계 경고 함수 (pg_notify)
CREATE OR REPLACE FUNCTION warn_key_result_weight_mismatch()
RETURNS TRIGGER AS $$
DECLARE
  v_total_weight INTEGER;
BEGIN
  SELECT COALESCE(SUM(weight), 0)
  INTO v_total_weight
  FROM key_results
  WHERE objective_id = COALESCE(NEW.objective_id, OLD.objective_id);

  -- weight 합계가 100이 아니면 경고
  IF v_total_weight != 100 THEN
    PERFORM pg_notify(
      'key_result_weight_warning',
      json_build_object(
        'objective_id', COALESCE(NEW.objective_id, OLD.objective_id),
        'total_weight', v_total_weight,
        'expected', 100
      )::text
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성 (선택적: 경고 기능이 필요한 경우만 활성화)
-- DROP TRIGGER IF EXISTS key_result_weight_check ON key_results;
-- CREATE TRIGGER key_result_weight_check
--   AFTER INSERT OR UPDATE OR DELETE ON key_results
--   FOR EACH ROW
--   EXECUTE FUNCTION warn_key_result_weight_mismatch();

-- ============================================================================
-- 8. 인덱스 최적화 (선택적)
-- ============================================================================

-- Partial index for active projects (대시보드 성능 개선)
CREATE INDEX IF NOT EXISTS idx_project_metrics_active_projects
  ON project_metrics (project_id, snapshot_at DESC)
  WHERE project_id IN (SELECT id FROM projects WHERE status = 'active');

-- GIN index for JSONB tags (OKR 태그 검색 최적화)
CREATE INDEX IF NOT EXISTS idx_objectives_tags_gin
  ON objectives USING GIN (tags);

-- ============================================================================
-- 9. 유틸리티 함수: 프로젝트 메트릭 히스토리 압축
-- ============================================================================

-- 오래된 스냅샷을 시간별/일별로 압축하여 저장 공간 절약
-- 예: 1주일 이상 된 스냅샷은 시간당 1개만 유지
CREATE OR REPLACE FUNCTION compress_old_metrics_snapshots()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- 1주일 ~ 1개월: 시간당 1개만 유지
  DELETE FROM project_metrics
  WHERE id NOT IN (
    SELECT DISTINCT ON (project_id, DATE_TRUNC('hour', snapshot_at))
      id
    FROM project_metrics
    WHERE snapshot_at BETWEEN NOW() - INTERVAL '30 days' AND NOW() - INTERVAL '7 days'
    ORDER BY project_id, DATE_TRUNC('hour', snapshot_at), snapshot_at DESC
  )
  AND snapshot_at BETWEEN NOW() - INTERVAL '30 days' AND NOW() - INTERVAL '7 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 10. 마이그레이션 검증
-- ============================================================================

-- 이 스크립트가 성공적으로 실행되었는지 확인
DO $$
BEGIN
  RAISE NOTICE '=================================================';
  RAISE NOTICE 'Metrics Improvements Migration (020) Completed';
  RAISE NOTICE '=================================================';
  RAISE NOTICE 'Applied:';
  RAISE NOTICE '  - NULL safety improvements';
  RAISE NOTICE '  - Denormalized data sync trigger';
  RAISE NOTICE '  - Batch snapshot function';
  RAISE NOTICE '  - Optimized metrics calculation';
  RAISE NOTICE '  - Materialized view for dashboard';
  RAISE NOTICE '  - Optional: threshold notifications';
  RAISE NOTICE '  - Optional: weight validation';
  RAISE NOTICE '=================================================';
END $$;
