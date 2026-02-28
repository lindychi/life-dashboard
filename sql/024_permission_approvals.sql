-- Permission Approval System
-- Stores approval requests for sensitive file operations

CREATE TABLE IF NOT EXISTS permission_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  gateway_id TEXT NOT NULL,
  command_id TEXT NOT NULL,

  -- Operation details
  path TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('read', 'write', 'delete', 'execute')),
  reason TEXT NOT NULL,

  -- Approval status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  responded_by TEXT,
  expires_at TIMESTAMPTZ NOT NULL,

  -- Additional context
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_permission_approvals_status ON permission_approvals(status);
CREATE INDEX IF NOT EXISTS idx_permission_approvals_agent_id ON permission_approvals(agent_id);
CREATE INDEX IF NOT EXISTS idx_permission_approvals_gateway_id ON permission_approvals(gateway_id);
CREATE INDEX IF NOT EXISTS idx_permission_approvals_command_id ON permission_approvals(command_id);
CREATE INDEX IF NOT EXISTS idx_permission_approvals_expires_at ON permission_approvals(expires_at);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_permission_approvals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER permission_approvals_updated_at
BEFORE UPDATE ON permission_approvals
FOR EACH ROW
EXECUTE FUNCTION update_permission_approvals_updated_at();

-- Auto-expire pending approvals
-- This function can be called periodically by a cron job
CREATE OR REPLACE FUNCTION expire_pending_approvals()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE permission_approvals
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at < NOW();

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$ LANGUAGE plpgsql;

-- Permission rules configuration (optional: store custom rules in DB)
CREATE TABLE IF NOT EXISTS permission_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern TEXT NOT NULL,
  actions TEXT[] NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('allow', 'deny', 'require_approval')),
  reason TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permission_rules_enabled ON permission_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_permission_rules_priority ON permission_rules(priority DESC);

-- Auto-update updated_at timestamp for rules
CREATE TRIGGER permission_rules_updated_at
BEFORE UPDATE ON permission_rules
FOR EACH ROW
EXECUTE FUNCTION update_permission_approvals_updated_at();

-- Approval history view (for audit trail)
CREATE OR REPLACE VIEW permission_approval_history AS
SELECT
  id,
  agent_id,
  gateway_id,
  command_id,
  path,
  action,
  reason,
  status,
  requested_at,
  responded_at,
  responded_by,
  expires_at,
  EXTRACT(EPOCH FROM (COALESCE(responded_at, NOW()) - requested_at)) as response_time_seconds,
  metadata
FROM permission_approvals
ORDER BY requested_at DESC;
