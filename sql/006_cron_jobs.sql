-- Cron Jobs: 주기적 작업 스케줄링 시스템
-- cron expression 기반 스케줄링, 실행 이력 추적

-- ─── 1. cron_jobs 테이블 ────────────────────────────────────
CREATE TABLE IF NOT EXISTS cron_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  schedule VARCHAR(100) NOT NULL,            -- cron expression (예: "*/5 * * * *")
  handler_type VARCHAR(100) NOT NULL,        -- handler registry key
  handler_config JSONB NOT NULL DEFAULT '{}', -- handler에 전달할 설정
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled
  ON cron_jobs (enabled, next_run_at)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_cron_jobs_name
  ON cron_jobs (name);

-- ─── 2. cron_job_runs 테이블 ────────────────────────────────
CREATE TYPE cron_run_status AS ENUM ('running', 'success', 'failed');

CREATE TABLE IF NOT EXISTS cron_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_job_id UUID NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status cron_run_status NOT NULL DEFAULT 'running',
  result JSONB,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_cron_job_runs_job
  ON cron_job_runs (cron_job_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_cron_job_runs_status
  ON cron_job_runs (status)
  WHERE status = 'running';

-- ─── 3. updated_at 자동 갱신 트리거 ────────────────────────
CREATE OR REPLACE FUNCTION update_cron_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cron_jobs_updated_at ON cron_jobs;
CREATE TRIGGER trg_cron_jobs_updated_at
  BEFORE UPDATE ON cron_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_cron_jobs_updated_at();
