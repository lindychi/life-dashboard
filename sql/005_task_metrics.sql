-- 005_task_metrics.sql
-- 태스크별 실행 메트릭 수집: 성능 추이 분석 및 모델 최적화 지표

-- ─── 1. task_metrics 테이블 ───────────────────────────────
-- 각 태스크 실행에 대한 상세 메트릭 저장 (task_queue.metadata와 별도 저장)

CREATE TABLE IF NOT EXISTS task_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES task_queue(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,

  -- Timing metrics
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL,

  -- Model selection
  model_tier TEXT NOT NULL CHECK (model_tier IN ('haiku', 'sonnet', 'opus')),
  model_source TEXT NOT NULL CHECK (model_source IN ('explicit', 'agent_config', 'analysis', 'ecomode_cap')),
  complexity_score INTEGER NOT NULL DEFAULT 0,

  -- Execution outcome
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'timeout', 'hung')),
  exit_code INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,

  -- LLM usage metrics
  provider TEXT,  -- 'claude' or 'codex'
  fallback_used BOOLEAN DEFAULT false,
  num_turns INTEGER,
  total_cost_usd NUMERIC(10, 6),

  -- Tool usage
  tool_calls_count INTEGER DEFAULT 0,
  tool_calls JSONB,  -- [{tool, timestamp, duration}]

  -- Output metadata
  output_length INTEGER,
  truncated BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. 인덱스 ─────────────────────────────────────────────

-- 에이전트별 성능 추이 조회
CREATE INDEX IF NOT EXISTS idx_task_metrics_agent_time
  ON task_metrics (agent_id, completed_at DESC);

-- 모델별 효율성 분석
CREATE INDEX IF NOT EXISTS idx_task_metrics_model
  ON task_metrics (model_tier, status, completed_at DESC);

-- 실패율 분석 (timeout/hung 원인 파악)
CREATE INDEX IF NOT EXISTS idx_task_metrics_failures
  ON task_metrics (status, completed_at DESC)
  WHERE status IN ('failed', 'timeout', 'hung');

-- 비용 분석 (총 비용, 에이전트별 비용)
CREATE INDEX IF NOT EXISTS idx_task_metrics_cost
  ON task_metrics (completed_at DESC)
  WHERE total_cost_usd IS NOT NULL;

-- ─── 3. 메트릭 집계 뷰 ──────────────────────────────────────

-- Daily agent performance summary
CREATE OR REPLACE VIEW daily_agent_metrics AS
SELECT
  agent_id,
  DATE(completed_at) AS date,
  COUNT(*) AS total_tasks,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
  SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) AS timeout_count,
  SUM(CASE WHEN status = 'hung' THEN 1 ELSE 0 END) AS hung_count,
  ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate,
  ROUND(AVG(duration_ms) / 1000.0, 1) AS avg_duration_sec,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) / 1000.0, 1) AS median_duration_sec,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) / 1000.0, 1) AS p95_duration_sec,
  SUM(total_cost_usd) AS total_cost_usd,
  SUM(tool_calls_count) AS total_tool_calls
FROM task_metrics
GROUP BY agent_id, DATE(completed_at);

-- Model tier effectiveness (complexity score vs actual performance)
CREATE OR REPLACE VIEW model_tier_effectiveness AS
SELECT
  model_tier,
  agent_id,
  COUNT(*) AS total_tasks,
  ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate,
  ROUND(AVG(complexity_score), 1) AS avg_complexity_score,
  ROUND(AVG(duration_ms) / 1000.0, 1) AS avg_duration_sec,
  SUM(total_cost_usd) AS total_cost_usd,
  ROUND(SUM(total_cost_usd) / NULLIF(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0), 4) AS cost_per_success
FROM task_metrics
WHERE completed_at >= NOW() - INTERVAL '7 days'
GROUP BY model_tier, agent_id
ORDER BY model_tier, agent_id;

-- Timeout analysis: which agents/models are hitting timeouts?
CREATE OR REPLACE VIEW timeout_analysis AS
SELECT
  agent_id,
  model_tier,
  COUNT(*) AS timeout_count,
  ROUND(AVG(duration_ms) / 1000.0, 1) AS avg_duration_before_timeout_sec,
  ROUND(AVG(complexity_score), 1) AS avg_complexity_score,
  ARRAY_AGG(DISTINCT status) AS failure_types
FROM task_metrics
WHERE status IN ('timeout', 'hung')
  AND completed_at >= NOW() - INTERVAL '7 days'
GROUP BY agent_id, model_tier
ORDER BY timeout_count DESC;

-- ─── 4. 메트릭 자동 기록 트리거 ─────────────────────────────
-- task_queue.metadata에 메트릭 데이터가 있으면 자동으로 task_metrics에 복사

CREATE OR REPLACE FUNCTION auto_record_task_metrics()
RETURNS TRIGGER AS $$
BEGIN
  -- Only record when task transitions to terminal state with metrics in metadata
  IF NEW.status IN ('completed', 'failed', 'dead_letter') AND NEW.metadata IS NOT NULL THEN
    INSERT INTO task_metrics (
      task_id,
      agent_id,
      started_at,
      completed_at,
      duration_ms,
      model_tier,
      model_source,
      complexity_score,
      status,
      exit_code,
      retry_count,
      provider,
      fallback_used,
      num_turns,
      total_cost_usd,
      tool_calls_count,
      tool_calls,
      output_length,
      truncated
    )
    SELECT
      NEW.id,
      NEW.agent_id,
      (NEW.metadata->>'started_at')::TIMESTAMPTZ,
      (NEW.metadata->>'completed_at')::TIMESTAMPTZ,
      (NEW.metadata->>'elapsedMs')::INTEGER,
      COALESCE(NEW.metadata->>'modelTier', 'sonnet'),
      COALESCE(NEW.metadata->>'modelSource', 'analysis'),
      COALESCE((NEW.metadata->>'complexityScore')::INTEGER, 0),
      CASE
        WHEN (NEW.metadata->>'exitCode')::INTEGER = -2 THEN 'hung'
        WHEN (NEW.metadata->>'exitCode')::INTEGER = -1 THEN 'timeout'
        WHEN NEW.status = 'failed' OR NEW.status = 'dead_letter' THEN 'failed'
        ELSE 'completed'
      END,
      (NEW.metadata->>'exitCode')::INTEGER,
      COALESCE((NEW.metadata->>'retryCount')::INTEGER, 0),
      NEW.metadata->>'provider',
      COALESCE((NEW.metadata->>'fallbackUsed')::BOOLEAN, false),
      (NEW.metadata->>'numTurns')::INTEGER,
      (NEW.metadata->>'totalCostUsd')::NUMERIC,
      COALESCE(JSONB_ARRAY_LENGTH(NEW.metadata->'toolCalls'), 0),
      NEW.metadata->'toolCalls',
      (NEW.metadata->>'fullResponseLength')::INTEGER,
      (NEW.metadata->>'fullResponseLength') IS NOT NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM task_metrics WHERE task_id = NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_record_metrics
  AFTER UPDATE OF status ON task_queue
  FOR EACH ROW
  EXECUTE FUNCTION auto_record_task_metrics();

-- ─── 5. 데이터 정리 함수 ───────────────────────────────────
-- 90일 이상 된 메트릭 삭제 (디스크 절약)

CREATE OR REPLACE FUNCTION cleanup_old_task_metrics()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM task_metrics
  WHERE completed_at < NOW() - INTERVAL '90 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Optional: 매일 자동 실행 (pg_cron 필요)
-- SELECT cron.schedule('cleanup-old-metrics', '0 3 * * *', 'SELECT cleanup_old_task_metrics()');
