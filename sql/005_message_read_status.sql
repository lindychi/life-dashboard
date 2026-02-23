-- Per-agent read status for broadcast messages
-- Fixes the shared `read` flag bug where marking a broadcast as read
-- for one agent affects all other agents' unread counts.

CREATE TABLE IF NOT EXISTS message_read_status (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (message_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_message_read_status_agent
  ON message_read_status(agent_id, message_id);
