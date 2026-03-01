-- Agent Intelligence System
-- Migration: 026_agent_intelligence.sql
-- Purpose: Track per-agent task success/failure history and model promotion audit log
-- Used by: src/lib/agent-intelligence.ts

-- ============================================================================
-- 1. agent_task_results: per-task outcome log (scoped to agent)
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_task_results (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    TEXT        NOT NULL,
  status      TEXT        NOT NULL CHECK (status IN ('success', 'failure')),
  model_used  TEXT,       -- e.g. 'haiku', 'sonnet', 'opus'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Efficient lookups by agent ordered by recency (for windowed stats)
CREATE INDEX IF NOT EXISTS idx_agent_task_results_agent_created
  ON agent_task_results (agent_id, created_at DESC);

-- ============================================================================
-- 2. agent_model_promotions: audit log for model tier promotions
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_model_promotions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    TEXT        NOT NULL,
  from_model  TEXT        NOT NULL,
  to_model    TEXT        NOT NULL,
  reason      TEXT        NOT NULL,
  promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Efficient lookups for cooldown check (most recent promotion per agent)
CREATE INDEX IF NOT EXISTS idx_agent_model_promotions_agent_promoted
  ON agent_model_promotions (agent_id, promoted_at DESC);

-- ============================================================================
-- 3. Migration verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================';
  RAISE NOTICE 'Agent Intelligence Migration (026) Completed';
  RAISE NOTICE '=================================================';
  RAISE NOTICE 'Tables created:';
  RAISE NOTICE '  - agent_task_results  (per-task outcome log)';
  RAISE NOTICE '  - agent_model_promotions  (promotion audit log)';
  RAISE NOTICE '=================================================';
END $$;
