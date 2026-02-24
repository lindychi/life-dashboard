-- Command Attachments: links attachments to relay_commands for instruction-level file passing
-- Reuses existing attachments table (storage, ref_key) — this table only creates the N:M link

CREATE TABLE IF NOT EXISTS command_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID NOT NULL REFERENCES relay_commands(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (command_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_command_attachments_command ON command_attachments(command_id);
CREATE INDEX IF NOT EXISTS idx_command_attachments_attachment ON command_attachments(attachment_id);
