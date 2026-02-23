-- 003_queue_monitoring.sql
-- 큐 모니터링, 데드레터 큐, 오케스트레이터 하트비트

-- ─── 1. dead_letter 상태 및 retry_errors 컬럼 추가 ───────

-- CHECK 제약 조건 확장: 'dead_letter' 포함
ALTER TABLE task_queue DROP CONSTRAINT IF EXISTS task_queue_status_check;
ALTER TABLE task_queue ADD CONSTRAINT task_queue_status_check
  CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed', 'dead_letter'));

-- 구조화된 에러 이력: [{error, timestamp, attempt}] 배열
ALTER TABLE task_queue
  ADD COLUMN IF NOT EXISTS retry_errors JSONB NOT NULL DEFAULT '[]'::JSONB;

-- DLQ 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_task_queue_dead_letter
  ON task_queue (status, created_at DESC)
  WHERE status = 'dead_letter';

-- ─── 2. 큐 메트릭 스냅샷 (1분 해상도) ───────────────────

CREATE TABLE IF NOT EXISTS queue_metrics (
  id BIGSERIAL PRIMARY KEY,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concurrency_group TEXT NOT NULL,
  pending_count INTEGER NOT NULL DEFAULT 0,
  running_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  dead_letter_count INTEGER NOT NULL DEFAULT 0,
  avg_wait_ms DOUBLE PRECISION,
  throughput_per_min DOUBLE PRECISION,
  slots_used INTEGER NOT NULL DEFAULT 0,
  slots_max INTEGER NOT NULL DEFAULT 3
);

CREATE INDEX IF NOT EXISTS idx_queue_metrics_lookup
  ON queue_metrics (concurrency_group, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_queue_metrics_retention
  ON queue_metrics (recorded_at);

-- ─── 3. 오케스트레이터 하트비트 ──────────────────────────

CREATE TABLE IF NOT EXISTS orchestrator_heartbeat (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  last_cycle_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cycle_count BIGINT NOT NULL DEFAULT 0,
  instance_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO orchestrator_heartbeat (id)
VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;
