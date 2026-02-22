-- Agent History (replaces in-memory Map in history.ts)
CREATE TABLE IF NOT EXISTS agent_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_history_agent ON agent_history(agent_id, created_at DESC);

-- Messages (replaces in-memory Map in messages.ts)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(from_id, to_id, created_at DESC);

-- Gateway Connections (replaces in-memory Map in relay.ts)
CREATE TABLE IF NOT EXISTS gateway_connections (
  id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'connected',
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_heartbeat TIMESTAMPTZ DEFAULT NOW()
);

-- Relay Commands (replaces in-memory command queue in relay.ts)
CREATE TABLE IF NOT EXISTS relay_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id TEXT REFERENCES gateway_connections(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_relay_commands_gateway ON relay_commands(gateway_id, status, created_at);

-- Agent Statuses (replaces in-memory Map in relay.ts)
CREATE TABLE IF NOT EXISTS agent_statuses (
  id TEXT NOT NULL,
  gateway_id TEXT REFERENCES gateway_connections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'idle',
  current_task TEXT,
  session_key TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, gateway_id)
);
