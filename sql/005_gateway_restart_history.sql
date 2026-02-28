-- Migration: Gateway Restart History Tracking
-- Date: 2025-02-27
-- Purpose: Track gateway restart events to prevent task loss

-- Gateway restart events log
CREATE TABLE IF NOT EXISTS gateway_restart_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id UUID NOT NULL,  -- FK to gateway_connections.id
  restart_reason TEXT NOT NULL,
  restarted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pending_tasks_count INTEGER NOT NULL DEFAULT 0,
  pending_task_ids UUID[] NOT NULL DEFAULT '{}',  -- Array of task IDs that were pending
  recovery_completed_at TIMESTAMPTZ,  -- When recovery finished (NULL if still pending)
  FOREIGN KEY (gateway_id) REFERENCES gateway_connections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gateway_restart_history_gateway_id ON gateway_restart_history(gateway_id);
CREATE INDEX IF NOT EXISTS idx_gateway_restart_history_restarted_at ON gateway_restart_history(restarted_at DESC);
CREATE INDEX IF NOT EXISTS idx_gateway_restart_history_recovery_status ON gateway_restart_history(recovery_completed_at) WHERE recovery_completed_at IS NULL;

-- Add comment
COMMENT ON TABLE gateway_restart_history IS 'Logs gateway restart events and tracks task recovery status to prevent task loss';
