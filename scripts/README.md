# Life Dashboard MCP Server

Model Context Protocol (MCP) server that exposes the Life Dashboard Relay API as tools for Claude Code agents.

## Installation

First, install the required dependencies:

```bash
pnpm add @modelcontextprotocol/sdk zod
```

## Running the Server

### Development (TypeScript)

```bash
npx ts-node scripts/mcp-server.ts
```

### Production (Compiled)

```bash
pnpm build
node scripts/mcp-server.js
```

## Configuration

Set these environment variables:

- `DASHBOARD_URL` - Dashboard URL (default: `http://localhost:3000`)
- `RELAY_API_KEY` - Relay API key (default: `life-dashboard-relay-key-2024`)

## Available Tools

### Read Tools

1. **`dashboard_get_history`** - Get history entries
   - `agentId?` (string) - Filter by agent ID
   - `limit?` (number, default 20) - Max entries

2. **`dashboard_get_agents`** - List agent configurations
   - `category?` ("dev"|"business"|"ops") - Filter by category
   - `includeDisabled?` (boolean) - Include disabled agents

3. **`dashboard_get_status`** - Get gateway connection status
   - No parameters

4. **`dashboard_get_messages`** - Get messages for an agent
   - `agentId` (string, required) - Agent ID
   - `unreadOnly?` (boolean) - Only unread messages

### Write Tools

5. **`dashboard_add_history`** - Add a history entry
   - `agentId` (string, required)
   - `type` (required) - One of: `task_started`, `task_completed`, `task_failed`, `output`, `status_change`
   - `content` (string, required)
   - `metadata?` (object)

6. **`dashboard_send_message`** - Send message between agents
   - `from` (string, required)
   - `to` (string, required)
   - `content` (string, required)
   - `type?` (string, default "text")

7. **`dashboard_send_command`** - Send command to gateway
   - `type` (required) - One of: `spawn`, `orchestrate`, `status`
   - `payload` (object, required)

8. **`dashboard_search_history`** - Search history by keyword
   - `query` (string, required)
   - `agentId?` (string) - Filter by agent
   - `limit?` (number, default 20)

## Usage in Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "life-dashboard": {
      "command": "npx",
      "args": ["ts-node", "/absolute/path/to/life-dashboard/scripts/mcp-server.ts"],
      "env": {
        "DASHBOARD_URL": "http://localhost:3000",
        "RELAY_API_KEY": "life-dashboard-relay-key-2024"
      }
    }
  }
}
```

Restart Claude Desktop and the tools will be available.
