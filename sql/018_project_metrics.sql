-- Project Metrics: 실시간 KPI 연동 시스템
-- 프로젝트별 메트릭을 태스크 실행 데이터와 자동 연동하여 계산

-- 프로젝트 메트릭 스냅샷 테이블
-- 일정 주기마다 계산된 메트릭을 저장 (시계열 데이터)
CREATE TABLE IF NOT EXISTS project_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- 메트릭 값들
  total_tasks INTEGER NOT NULL DEFAULT 0,
  completed_tasks INTEGER NOT NULL DEFAULT 0,
  failed_tasks INTEGER NOT NULL DEFAULT 0,
  running_tasks INTEGER NOT NULL DEFAULT 0,
  completion_rate NUMERIC(5,2) DEFAULT 0.00,  -- 완료율 (0-100)
  success_rate NUMERIC(5,2) DEFAULT 0.00,      -- 성공률 (0-100)
  avg_task_duration_seconds NUMERIC(10,2),    -- 평균 태스크 실행 시간
  total_execution_time_seconds BIGINT DEFAULT 0,

  -- 최근 활동 정보
  last_task_completed_at TIMESTAMPTZ,
  last_task_failed_at TIMESTAMPTZ,

  -- 스냅샷 시각
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 프로젝트별 최신 메트릭 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_project_metrics_latest
  ON project_metrics (project_id, snapshot_at DESC);

-- 시계열 분석용 인덱스
CREATE INDEX IF NOT EXISTS idx_project_metrics_timeline
  ON project_metrics (snapshot_at DESC);

-- 프로젝트-태스크 연결 테이블
-- 태스크가 어느 프로젝트에 속하는지 명시적으로 연결
CREATE TABLE IF NOT EXISTS project_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_execution_id UUID REFERENCES task_executions(id) ON DELETE CASCADE,
  task_queue_id UUID REFERENCES task_queue(id) ON DELETE CASCADE,

  -- 태스크 정보 (denormalized for faster queries)
  task_title TEXT,
  task_status TEXT,
  task_type TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 하나의 태스크는 하나의 프로젝트에만 속함
  CONSTRAINT unique_task_execution UNIQUE (task_execution_id),
  CONSTRAINT unique_task_queue UNIQUE (task_queue_id),
  -- 최소한 하나는 있어야 함
  CONSTRAINT has_task_reference CHECK (
    task_execution_id IS NOT NULL OR task_queue_id IS NOT NULL
  )
);

-- 프로젝트별 태스크 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_project_tasks_project
  ON project_tasks (project_id, created_at DESC);

-- 태스크별 프로젝트 역조회 인덱스
CREATE INDEX IF NOT EXISTS idx_project_tasks_execution
  ON project_tasks (task_execution_id) WHERE task_execution_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_tasks_queue
  ON project_tasks (task_queue_id) WHERE task_queue_id IS NOT NULL;

-- 프로젝트 메트릭 자동 계산 함수
-- 프로젝트별 태스크 실행 데이터를 기반으로 메트릭 계산
CREATE OR REPLACE FUNCTION calculate_project_metrics(p_project_id UUID)
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
      COUNT(*) FILTER (WHERE te.status IN ('completed', 'failed', 'running', 'interrupted')) AS total,
      COUNT(*) FILTER (WHERE te.status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE te.status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE te.status = 'running') AS running,
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

-- 프로젝트 메트릭 스냅샷 생성 함수
-- 현재 시점의 메트릭을 계산하여 스냅샷 테이블에 저장
CREATE OR REPLACE FUNCTION snapshot_project_metrics(p_project_id UUID)
RETURNS UUID AS $$
DECLARE
  v_snapshot_id UUID;
  v_metrics RECORD;
BEGIN
  -- 메트릭 계산
  SELECT * INTO v_metrics FROM calculate_project_metrics(p_project_id);

  -- 스냅샷 저장
  INSERT INTO project_metrics (
    project_id,
    total_tasks,
    completed_tasks,
    failed_tasks,
    running_tasks,
    completion_rate,
    success_rate,
    avg_task_duration_seconds,
    total_execution_time_seconds,
    last_task_completed_at,
    last_task_failed_at,
    snapshot_at
  ) VALUES (
    p_project_id,
    v_metrics.total_tasks,
    v_metrics.completed_tasks,
    v_metrics.failed_tasks,
    v_metrics.running_tasks,
    v_metrics.completion_rate,
    v_metrics.success_rate,
    v_metrics.avg_task_duration_seconds,
    v_metrics.total_execution_time_seconds,
    v_metrics.last_task_completed_at,
    v_metrics.last_task_failed_at,
    NOW()
  ) RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$$ LANGUAGE plpgsql;

-- 모든 프로젝트의 메트릭 스냅샷 생성
CREATE OR REPLACE FUNCTION snapshot_all_project_metrics()
RETURNS INTEGER AS $$
DECLARE
  v_project_id UUID;
  v_count INTEGER := 0;
BEGIN
  FOR v_project_id IN SELECT id FROM projects LOOP
    PERFORM snapshot_project_metrics(v_project_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- 프로젝트 progress 필드 자동 업데이트 함수
-- completion_rate를 기반으로 progress 필드 업데이트
CREATE OR REPLACE FUNCTION update_project_progress(p_project_id UUID)
RETURNS VOID AS $$
DECLARE
  v_metrics RECORD;
BEGIN
  SELECT * INTO v_metrics FROM calculate_project_metrics(p_project_id);

  UPDATE projects
  SET progress = LEAST(100, GREATEST(0, v_metrics.completion_rate::INTEGER))
  WHERE id = p_project_id;
END;
$$ LANGUAGE plpgsql;

-- 최신 메트릭 조회 뷰 (매번 계산하지 않고 최신 스냅샷 반환)
CREATE OR REPLACE VIEW latest_project_metrics AS
SELECT DISTINCT ON (pm.project_id)
  pm.project_id,
  pm.total_tasks,
  pm.completed_tasks,
  pm.failed_tasks,
  pm.running_tasks,
  pm.completion_rate,
  pm.success_rate,
  pm.avg_task_duration_seconds,
  pm.total_execution_time_seconds,
  pm.last_task_completed_at,
  pm.last_task_failed_at,
  pm.snapshot_at,
  p.name AS project_name,
  p.status AS project_status,
  p.progress AS project_progress
FROM project_metrics pm
JOIN projects p ON pm.project_id = p.id
ORDER BY pm.project_id, pm.snapshot_at DESC;

-- 프로젝트별 메트릭 히스토리 조회 함수
CREATE OR REPLACE FUNCTION get_project_metrics_history(
  p_project_id UUID,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  snapshot_id UUID,
  total_tasks INTEGER,
  completed_tasks INTEGER,
  failed_tasks INTEGER,
  running_tasks INTEGER,
  completion_rate NUMERIC,
  success_rate NUMERIC,
  avg_task_duration_seconds NUMERIC,
  snapshot_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pm.id,
    pm.total_tasks,
    pm.completed_tasks,
    pm.failed_tasks,
    pm.running_tasks,
    pm.completion_rate,
    pm.success_rate,
    pm.avg_task_duration_seconds,
    pm.snapshot_at
  FROM project_metrics pm
  WHERE pm.project_id = p_project_id
  ORDER BY pm.snapshot_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- 트리거: task_executions 상태 변경 시 프로젝트 메트릭 스냅샷 자동 생성
CREATE OR REPLACE FUNCTION trigger_project_metrics_update()
RETURNS TRIGGER AS $$
DECLARE
  v_project_id UUID;
BEGIN
  -- 태스크가 속한 프로젝트 찾기
  SELECT project_id INTO v_project_id
  FROM project_tasks
  WHERE task_execution_id = NEW.id;

  -- 프로젝트가 연결되어 있으면 메트릭 업데이트
  IF v_project_id IS NOT NULL THEN
    -- 비동기로 스냅샷 생성 (성능 최적화)
    PERFORM snapshot_project_metrics(v_project_id);
    -- progress 필드도 업데이트
    PERFORM update_project_progress(v_project_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성: task_executions의 status가 변경될 때
CREATE TRIGGER task_execution_status_changed
  AFTER UPDATE OF status ON task_executions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION trigger_project_metrics_update();

-- 트리거: project_tasks 생성 시 메트릭 스냅샷 자동 생성
CREATE OR REPLACE FUNCTION trigger_project_task_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM snapshot_project_metrics(NEW.project_id);
  PERFORM update_project_progress(NEW.project_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_task_created
  AFTER INSERT ON project_tasks
  FOR EACH ROW
  EXECUTE FUNCTION trigger_project_task_created();

-- 오래된 메트릭 스냅샷 정리 함수 (30일 이상 된 것만 유지)
CREATE OR REPLACE FUNCTION cleanup_old_metrics_snapshots()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM project_metrics
  WHERE snapshot_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
