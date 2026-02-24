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

## MCP Health Check

**File:** `scripts/mcp-healthcheck.ts`

Validates the MCP server configuration and connectivity before deployments.

### Usage

```bash
# Run full health check (includes API connectivity)
npx tsx scripts/mcp-healthcheck.ts

# Run offline checks only (skip API connectivity)
npx tsx scripts/mcp-healthcheck.ts --offline
```

### Checks Performed

1. **Config Check**: `.mcp.json` exists and has valid JSON with `life-dashboard` server entry
2. **Env Check**: `.env.local` exists with valid `DASHBOARD_URL` (starts with `http`) and `RELAY_API_KEY`
3. **File Check**: `scripts/mcp-server.ts` is readable
4. **Dependencies Check**: Required npm packages are installed (`@modelcontextprotocol/sdk`, `zod`)
5. **API Connectivity Check** (unless `--offline`): Hits `${DASHBOARD_URL}/api/relay/status` and verifies 200 response
6. **Tool Registration Check**: Verifies all 9 expected tools are registered in the MCP server

### Exit Codes

- `0` - All checks passed
- `1` - One or more checks failed

### Example Output

```
🔍 MCP Health Check
─────────────────────
✅ .mcp.json — valid config
✅ .env.local — DASHBOARD_URL set (https://...)
✅ .env.local — RELAY_API_KEY set
✅ mcp-server.ts — file readable
✅ Dependencies — @modelcontextprotocol/sdk installed
✅ Dependencies — zod installed
✅ API connectivity — /api/relay/status 200 OK
✅ Tool count — 9 tools registered
─────────────────────
✅ All 8 checks passed
```

### Programmatic Usage

```typescript
import { runHealthChecks } from './scripts/mcp-healthcheck';

const report = await runHealthChecks({ offline: true });
console.log(`${report.passed} passed, ${report.failed} failed`);

for (const result of report.results) {
  console.log(`${result.name}: ${result.passed ? 'PASS' : 'FAIL'}`);
  if (result.detail) {
    console.log(`  ${result.detail}`);
  }
}
```

### Testing

```bash
pnpm test scripts/__tests__/mcp-healthcheck.test.ts
```

The test suite covers:
- Valid and invalid config scenarios
- Missing environment variables
- Valid and invalid DASHBOARD_URL formats
- Dependency checking (installed vs missing)
- Offline mode behavior
- API connectivity (success, failure, timeout)
- Tool registration validation
