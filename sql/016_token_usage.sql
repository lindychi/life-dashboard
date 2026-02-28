-- 016_token_usage.sql
-- Token usage tracking for OMC token optimization
-- Records model selection, delegation category, cost, and performance per agent task

CREATE TABLE IF NOT EXISTS token_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Task identity
  agent_id TEXT NOT NULL,
  command_id UUID,                     -- FK intentionally soft (commands may be cleaned up)
  task_execution_id UUID REFERENCES task_executions(id) ON DELETE SET NULL,
  request_group_id TEXT,               -- Correlate with orchestration groups

  -- Model routing decision
  model TEXT NOT NULL,                 -- 'haiku', 'sonnet', 'opus'
  model_source TEXT,                   -- 'explicit', 'agent_config', 'analysis', 'ecomode_cap'
  complexity_score INTEGER,            -- 0-100 from ComplexityAnalyzer
  delegation_category TEXT,            -- 'quick', 'writing', 'visual-engineering', 'ultrabrain', 'artistry'
  ecomode BOOLEAN DEFAULT false,

  -- Token usage (from Claude CLI stream-json result event)
  total_cost_usd NUMERIC(10, 6),       -- total_cost_usd from result event
  num_turns INTEGER,                    -- num_turns from result event
  duration_api_ms INTEGER,              -- duration_ms from result event (API-measured)

  -- Execution metrics
  elapsed_ms INTEGER,                  -- Wall-clock time from executor
  tool_calls_count INTEGER DEFAULT 0,
  success BOOLEAN NOT NULL,
  exit_code INTEGER,
  is_hung BOOLEAN DEFAULT false,       -- Was killed by stale detection
  retry_count INTEGER DEFAULT 0,

  -- Provider info
  provider TEXT DEFAULT 'claude',      -- 'claude' or 'codex'
  fallback_used BOOLEAN DEFAULT false,

  -- Escalation tracking (ecomode)
  was_escalated BOOLEAN DEFAULT false,
  escalated_from TEXT,                 -- Original model before escalation

  -- Task classification
  task_preview TEXT,                   -- First 200 chars of task for analysis
  is_complex BOOLEAN DEFAULT false,    -- Was detected as complex task

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Primary query patterns
CREATE INDEX IF NOT EXISTS idx_token_usage_agent
  ON token_usage(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_usage_model
  ON token_usage(model, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_usage_category
  ON token_usage(delegation_category, created_at DESC)
  WHERE delegation_category IS NOT NULL;

-- Cost analysis indexes
CREATE INDEX IF NOT EXISTS idx_token_usage_cost
  ON token_usage(created_at DESC)
  WHERE total_cost_usd IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_token_usage_ecomode
  ON token_usage(ecomode, created_at DESC)
  WHERE ecomode = true;

-- Request group correlation
CREATE INDEX IF NOT EXISTS idx_token_usage_request_group
  ON token_usage(request_group_id, created_at DESC)
  WHERE request_group_id IS NOT NULL;

-- Aggregation helpers

-- Daily cost summary by model (materialized via application-level cron)
CREATE OR REPLACE FUNCTION token_usage_daily_summary(
  p_days INTEGER DEFAULT 7
)
RETURNS TABLE(
  day DATE,
  model TEXT,
  total_calls BIGINT,
  successful_calls BIGINT,
  total_cost NUMERIC,
  avg_elapsed_ms NUMERIC,
  avg_complexity NUMERIC,
  haiku_calls BIGINT,
  sonnet_calls BIGINT,
  opus_calls BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(tu.created_at) as day,
    tu.model,
    COUNT(*) as total_calls,
    COUNT(*) FILTER (WHERE tu.success) as successful_calls,
    COALESCE(SUM(tu.total_cost_usd), 0) as total_cost,
    AVG(tu.elapsed_ms)::NUMERIC as avg_elapsed_ms,
    AVG(tu.complexity_score)::NUMERIC as avg_complexity,
    COUNT(*) FILTER (WHERE tu.model = 'haiku') as haiku_calls,
    COUNT(*) FILTER (WHERE tu.model = 'sonnet') as sonnet_calls,
    COUNT(*) FILTER (WHERE tu.model = 'opus') as opus_calls
  FROM token_usage tu
  WHERE tu.created_at >= NOW() - (p_days || ' days')::INTERVAL
  GROUP BY DATE(tu.created_at), tu.model
  ORDER BY day DESC, tu.model;
END;
$$ LANGUAGE plpgsql;

-- Agent-level cost summary
CREATE OR REPLACE FUNCTION token_usage_agent_summary(
  p_days INTEGER DEFAULT 30
)
RETURNS TABLE(
  agent_id TEXT,
  total_calls BIGINT,
  successful_calls BIGINT,
  total_cost NUMERIC,
  avg_elapsed_ms NUMERIC,
  primary_model TEXT,
  ecomode_calls BIGINT,
  escalation_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    tu.agent_id,
    COUNT(*) as total_calls,
    COUNT(*) FILTER (WHERE tu.success) as successful_calls,
    COALESCE(SUM(tu.total_cost_usd), 0) as total_cost,
    AVG(tu.elapsed_ms)::NUMERIC as avg_elapsed_ms,
    MODE() WITHIN GROUP (ORDER BY tu.model) as primary_model,
    COUNT(*) FILTER (WHERE tu.ecomode) as ecomode_calls,
    COUNT(*) FILTER (WHERE tu.was_escalated) as escalation_count
  FROM token_usage tu
  WHERE tu.created_at >= NOW() - (p_days || ' days')::INTERVAL
  GROUP BY tu.agent_id
  ORDER BY total_cost DESC;
END;
$$ LANGUAGE plpgsql;

-- Auto-cleanup: delete records older than 90 days
CREATE OR REPLACE FUNCTION cleanup_old_token_usage()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM token_usage
  WHERE created_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
