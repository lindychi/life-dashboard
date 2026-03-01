-- 027_feedback_system.sql
-- Feedback-driven improvement system: task feedback, learned preferences, improvement actions

-- 1. Core feedback table
CREATE TABLE IF NOT EXISTS task_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_execution_id UUID,
  command_id      TEXT,
  history_entry_id UUID,
  rated_by        TEXT NOT NULL DEFAULT 'user',
  overall_rating  INTEGER NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  categories      JSONB NOT NULL DEFAULT '{}',
  comment         TEXT,
  tags            TEXT[] DEFAULT '{}',
  agent_id        TEXT NOT NULL,
  task_type       TEXT,
  model_used      TEXT,
  task_category   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_feedback_agent ON task_feedback(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_feedback_rating ON task_feedback(overall_rating);

-- 2. Learned preferences
CREATE TABLE IF NOT EXISTS learned_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           TEXT NOT NULL,
  preference_key  TEXT NOT NULL,
  preference_value JSONB NOT NULL,
  derived_from    UUID[] DEFAULT '{}',
  confidence      REAL DEFAULT 0.5,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(scope, preference_key, status)
);

CREATE INDEX IF NOT EXISTS idx_learned_prefs_scope ON learned_preferences(scope, status);

-- 3. Improvement actions
CREATE TABLE IF NOT EXISTS improvement_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       UUID,
  feedback_ids    UUID[] DEFAULT '{}',
  action_type     TEXT NOT NULL,
  description     TEXT NOT NULL,
  before_value    JSONB,
  after_value     JSONB,
  status          TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'applied', 'reverted', 'rejected')),
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  applied_at      TIMESTAMPTZ,
  impact_metrics  JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_improvement_actions_status ON improvement_actions(status);
