-- Task Execution State Persistence
-- Tracks running tasks so gateway-connector can recover after restart
-- Each row represents a task that was being executed when the process died

CREATE TABLE IF NOT EXISTS task_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Task identity
  gateway_id TEXT NOT NULL REFERENCES gateway_connections(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  command_id TEXT,                -- Original relay command ID
  command_type TEXT NOT NULL DEFAULT 'spawn',  -- 'spawn' or 'orchestrate'

  -- Task content (enough to re-execute)
  task TEXT NOT NULL,
  system_prompt TEXT,

  -- Execution state
  status TEXT NOT NULL DEFAULT 'running',  -- running, completed, failed, interrupted, recovered

  -- Progress tracking
  last_output TEXT,               -- Last ~2000 chars of output (for context on recovery)
  tool_calls_count INTEGER DEFAULT 0,
  total_output_chars INTEGER DEFAULT 0,
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),

  -- Orchestration context (for orchestrate commands)
  orchestration_id UUID,          -- Links subtasks to parent orchestration
  orchestration_plan JSONB,       -- The plan (for parent orchestration)
  subtask_index INTEGER,          -- Position in plan (for subtasks)
  subtask_results JSONB,          -- Accumulated results so far (for parent)

  -- Request group context
  request_group_id TEXT,
  request_title TEXT,

  -- Metadata
  attempt_number INTEGER DEFAULT 1,  -- Which attempt this is (1 = first try)
  max_attempts INTEGER DEFAULT 3,
  attachment_ref_keys TEXT[],        -- Attachment ref keys for re-download

  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Recovery info
  recovered_from_id UUID,           -- Previous execution ID if this is a recovery
  recovery_reason TEXT              -- Why recovery was triggered
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_task_executions_gateway_status
  ON task_executions(gateway_id, status);
CREATE INDEX IF NOT EXISTS idx_task_executions_agent
  ON task_executions(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_task_executions_orchestration
  ON task_executions(orchestration_id) WHERE orchestration_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_executions_running
  ON task_executions(gateway_id) WHERE status = 'running';

-- Auto-cleanup: delete completed executions older than 7 days
-- (can be run by cron job)
CREATE OR REPLACE FUNCTION cleanup_old_task_executions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM task_executions
  WHERE status IN ('completed', 'failed')
    AND completed_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
