-- 028_agent_suggestions.sql
-- Agent Suggestion System: proactive suggestion lifecycle, scan configs, inter-agent calls
-- Tables: agent_suggestions, suggestion_scan_configs, agent_calls, agent_call_permissions

-- ============================================================================
-- 1. agent_suggestions: core suggestion table with lifecycle tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_suggestions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_agent_id   TEXT        NOT NULL,
  category          TEXT        NOT NULL CHECK (category IN (
                      'optimization', 'bug_fix', 'feature', 'maintenance',
                      'security', 'performance', 'data_quality', 'other'
                    )),
  title             TEXT        NOT NULL,
  description       TEXT        NOT NULL,
  rationale         TEXT,
  execution_plan    JSONB       NOT NULL DEFAULT '{}',
  status            TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
                      'pending', 'approved', 'rejected', 'executing', 'completed', 'failed', 'expired'
                    )),
  urgency           TEXT        NOT NULL DEFAULT 'normal' CHECK (urgency IN (
                      'low', 'normal', 'high', 'critical'
                    )),
  priority_score    REAL        NOT NULL DEFAULT 0.5,
  trigger_type      TEXT        NOT NULL DEFAULT 'scheduled' CHECK (trigger_type IN (
                      'scheduled', 'event_driven', 'threshold', 'manual', 'cascade'
                    )),
  trigger_context   JSONB       DEFAULT '{}',
  dedup_key         TEXT,
  approved_by       TEXT,
  approved_at       TIMESTAMPTZ,
  rejected_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  execution_id      TEXT,
  completed_at      TIMESTAMPTZ,
  result_summary    JSONB,
  error_message     TEXT,
  expires_at        TIMESTAMPTZ,
  metadata          JSONB       DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary lookup: pending suggestions ordered by priority
CREATE INDEX IF NOT EXISTS idx_agent_suggestions_status_priority
  ON agent_suggestions (status, priority_score DESC, created_at DESC);

-- Agent-scoped queries
CREATE INDEX IF NOT EXISTS idx_agent_suggestions_source_agent
  ON agent_suggestions (source_agent_id, status, created_at DESC);

-- Category filtering
CREATE INDEX IF NOT EXISTS idx_agent_suggestions_category
  ON agent_suggestions (category, status);

-- Dedup lookup
CREATE INDEX IF NOT EXISTS idx_agent_suggestions_dedup_key
  ON agent_suggestions (dedup_key)
  WHERE dedup_key IS NOT NULL AND status = 'pending';

-- TTL expiry scans
CREATE INDEX IF NOT EXISTS idx_agent_suggestions_expires_at
  ON agent_suggestions (expires_at)
  WHERE expires_at IS NOT NULL AND status = 'pending';

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_agent_suggestions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_suggestions_updated_at ON agent_suggestions;
CREATE TRIGGER trg_agent_suggestions_updated_at
  BEFORE UPDATE ON agent_suggestions
  FOR EACH ROW EXECUTE FUNCTION update_agent_suggestions_updated_at();

-- ============================================================================
-- 2. suggestion_scan_configs: scheduling configuration per agent/scan_type
-- ============================================================================

CREATE TABLE IF NOT EXISTS suggestion_scan_configs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          TEXT        NOT NULL,
  scan_type         TEXT        NOT NULL,
  enabled           BOOLEAN     NOT NULL DEFAULT TRUE,
  interval_seconds  INTEGER     NOT NULL DEFAULT 3600 CHECK (interval_seconds > 0),
  last_run_at       TIMESTAMPTZ,
  next_run_at       TIMESTAMPTZ,
  config_params     JSONB       NOT NULL DEFAULT '{}',
  failure_count     INTEGER     NOT NULL DEFAULT 0,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, scan_type)
);

CREATE INDEX IF NOT EXISTS idx_scan_configs_next_run
  ON suggestion_scan_configs (next_run_at)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_scan_configs_agent
  ON suggestion_scan_configs (agent_id, enabled);

CREATE OR REPLACE FUNCTION update_scan_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scan_configs_updated_at ON suggestion_scan_configs;
CREATE TRIGGER trg_scan_configs_updated_at
  BEFORE UPDATE ON suggestion_scan_configs
  FOR EACH ROW EXECUTE FUNCTION update_scan_configs_updated_at();

-- ============================================================================
-- 3. agent_calls: inter-agent call log with call_chain cycle detection
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_calls (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_agent_id   TEXT        NOT NULL,
  callee_agent_id   TEXT        NOT NULL,
  call_type         TEXT        NOT NULL CHECK (call_type IN (
                      'task', 'query', 'notification', 'delegation', 'coordination'
                    )),
  call_chain        TEXT[]      NOT NULL DEFAULT '{}',
  depth             INTEGER     NOT NULL DEFAULT 0 CHECK (depth >= 0),
  parent_call_id    UUID        REFERENCES agent_calls(id) ON DELETE SET NULL,
  status            TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
                      'pending', 'approved', 'denied', 'executing', 'completed', 'failed', 'timeout'
                    )),
  permission_status TEXT        NOT NULL DEFAULT 'auto_approved' CHECK (permission_status IN (
                      'auto_approved', 'awaiting_user', 'user_approved', 'user_denied', 'denied_by_policy'
                    )),
  request_payload   JSONB       NOT NULL DEFAULT '{}',
  response_payload  JSONB,
  command_id        TEXT,
  error_message     TEXT,
  timeout_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  metadata          JSONB       DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_calls_status
  ON agent_calls (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_calls_caller
  ON agent_calls (caller_agent_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_calls_callee
  ON agent_calls (callee_agent_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_calls_parent
  ON agent_calls (parent_call_id)
  WHERE parent_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_calls_timeout
  ON agent_calls (timeout_at)
  WHERE status IN ('pending', 'executing') AND timeout_at IS NOT NULL;

CREATE OR REPLACE FUNCTION update_agent_calls_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_calls_updated_at ON agent_calls;
CREATE TRIGGER trg_agent_calls_updated_at
  BEFORE UPDATE ON agent_calls
  FOR EACH ROW EXECUTE FUNCTION update_agent_calls_updated_at();

-- ============================================================================
-- 4. agent_call_permissions: permission matrix with rate limiting
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_call_permissions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_agent_id   TEXT        NOT NULL,
  callee_agent_id   TEXT        NOT NULL,
  permission        TEXT        NOT NULL DEFAULT 'ask_user' CHECK (permission IN (
                      'auto_approve', 'ask_user', 'deny'
                    )),
  max_depth         INTEGER     NOT NULL DEFAULT 3 CHECK (max_depth > 0),
  rate_limit_per_hour INTEGER   CHECK (rate_limit_per_hour IS NULL OR rate_limit_per_hour > 0),
  allowed_call_types TEXT[]     DEFAULT NULL,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (caller_agent_id, callee_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_call_permissions_lookup
  ON agent_call_permissions (caller_agent_id, callee_agent_id);

CREATE OR REPLACE FUNCTION update_call_permissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_call_permissions_updated_at ON agent_call_permissions;
CREATE TRIGGER trg_call_permissions_updated_at
  BEFORE UPDATE ON agent_call_permissions
  FOR EACH ROW EXECUTE FUNCTION update_call_permissions_updated_at();

-- ============================================================================
-- 5. Seed data: default permission matrix
-- ============================================================================

INSERT INTO agent_call_permissions (caller_agent_id, callee_agent_id, permission, max_depth, rate_limit_per_hour, notes)
VALUES
  -- Orchestrator can call any specialist agent automatically
  ('orchestrator', 'executor',    'auto_approve', 5, 60,  'Orchestrator → Executor: fully trusted'),
  ('orchestrator', 'planner',     'auto_approve', 5, 30,  'Orchestrator → Planner: fully trusted'),
  ('orchestrator', 'analyst',     'auto_approve', 5, 30,  'Orchestrator → Analyst: fully trusted'),
  ('orchestrator', 'verifier',    'auto_approve', 5, 60,  'Orchestrator → Verifier: fully trusted'),
  ('orchestrator', 'debugger',    'auto_approve', 5, 30,  'Orchestrator → Debugger: fully trusted'),

  -- Executor can call verifier and debugger automatically
  ('executor',     'verifier',    'auto_approve', 3, 30,  'Executor self-verification'),
  ('executor',     'debugger',    'auto_approve', 3, 20,  'Executor debug assistance'),

  -- Planner can query analyst for requirements
  ('planner',      'analyst',     'auto_approve', 3, 20,  'Planner → Analyst: requirements lookup'),
  ('planner',      'architect',   'ask_user',     3, 10,  'Planner → Architect: needs user approval'),

  -- Cross-agent arbitrary calls require user approval
  ('executor',     'planner',     'ask_user',     2, 10,  'Executor → Planner: ask user'),
  ('analyst',      'executor',    'ask_user',     2, 10,  'Analyst → Executor: ask user'),

  -- Deny recursive same-type calls to prevent loops
  ('executor',     'executor',    'deny',         1, NULL, 'Prevent executor recursion'),
  ('planner',      'planner',     'deny',         1, NULL, 'Prevent planner recursion'),
  ('verifier',     'verifier',    'deny',         1, NULL, 'Prevent verifier recursion')
ON CONFLICT (caller_agent_id, callee_agent_id) DO NOTHING;

-- ============================================================================
-- 6. Migration verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '=================================================';
  RAISE NOTICE 'Agent Suggestions Migration (028) Completed';
  RAISE NOTICE '=================================================';
  RAISE NOTICE 'Tables created:';
  RAISE NOTICE '  - agent_suggestions       (suggestion lifecycle)';
  RAISE NOTICE '  - suggestion_scan_configs (scheduling config)';
  RAISE NOTICE '  - agent_calls             (inter-agent call log)';
  RAISE NOTICE '  - agent_call_permissions  (permission matrix)';
  RAISE NOTICE 'Seed data: 13 default call permission entries';
  RAISE NOTICE '=================================================';
END $$;
