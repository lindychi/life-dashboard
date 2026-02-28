# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start dev server (localhost:3000)
pnpm build        # Production build (Next.js standalone output)
pnpm lint         # ESLint (eslint-config-next with core-web-vitals + typescript)
pnpm start        # Start production server
pnpm test         # Run vitest tests
pnpm monitor      # Tmux agent session monitor (list/attach/peek/kill)

# Gateway Connector (launchd)
pnpm gateway:install    # Install as launchd service (auto-restart on crash/reboot)
pnpm gateway:uninstall  # Remove launchd service
pnpm gateway:restart    # Restart the service
pnpm gateway:status     # Check if running
pnpm gateway:logs       # Tail live logs
```

## Architecture

**LifeDashboard** is a personal dashboard for tracking side projects, AI agents, and finances. Built with Next.js 16 (App Router), Tailwind CSS 4, deployed on Railway via Docker (standalone output).

### Auth System

Magic link authentication using Resend for email delivery and `jose` for JWT:

- `src/lib/auth.ts` — JWT creation/verification, email allowlist (`ALLOWED_EMAILS` env), cookie management
- `src/lib/resend.ts` — Magic link email sending (falls back to console logging in dev when `RESEND_API_KEY` is absent)
- `src/middleware.ts` — Route protection; public paths are allowlisted, everything else requires valid `auth-token` cookie. API routes get 401, pages redirect to `/login`
- Login restricted to emails in `ALLOWED_EMAILS` env var

Auth flow: `/login` → POST `/api/auth/login` → email magic link → `/auth/verify?token=` → GET `/api/auth/verify` → sets session cookie → redirect to `/`

In dev mode without `RESEND_API_KEY`, the login API returns `devToken` in response for instant login.

### Database (PostgreSQL)

Local PostgreSQL 14 for persistent storage. All data stores (history, messages, relay) use PostgreSQL instead of in-memory Maps.

**Setup:**
```bash
brew install postgresql@14    # macOS
brew services start postgresql@14
createdb life_dashboard
psql life_dashboard < sql/001_init.sql
psql life_dashboard < sql/002_attachments.sql
```

- `sql/001_init.sql` — Schema migration (5 tables: agent_history, messages, gateway_connections, relay_commands, agent_statuses)
- `sql/002_attachments.sql` — Attachments table (file metadata, ref_key, storage_key, message FK)
- `src/lib/db.ts` — Minimal PostgreSQL client using `pg` Pool. Exports `query<T>()`, `queryOne<T>()`, `pool`
- `DATABASE_URL` env var (default: `postgresql://localhost:5432/life_dashboard`)

### Relay System

A command relay for remotely controlling AI agents from the dashboard. Data persisted in PostgreSQL.

- `src/lib/relay.ts` — Gateway connections, command queue, agent statuses (all async, PostgreSQL-backed). Gateways authenticate via `x-relay-key` header
- `scripts/gateway-connector.ts` — Client-side script that runs on a local machine, registers with the relay, polls for commands, and executes them via Claude CLI. Supports `restart` command for remote self-restart
- `scripts/claude-executor.ts` — Claude/Codex CLI executor with multi-signal hung detection (stale timeout + `lsof` network health check + tmux CPU check), retry, and optional tmux integration. Appends tool availability constraint to agent system prompts to prevent permission hangs
- API routes under `/api/relay/`: `register` (gateway connects), `poll` (gateway fetches commands + sends heartbeat), `command` (dashboard sends commands to gateway), `status` (dashboard reads current state)

**Gateway Connector Auto-Restart (launchd):**
- `scripts/gateway-connector.plist` — macOS launchd service definition (`KeepAlive`, `RunAtLoad`, 5s throttle)
- `scripts/gateway-setup.sh` — Install/uninstall/restart/status/logs helper script
- On crash or `process.exit()`: launchd auto-restarts within ~5 seconds
- On system reboot: auto-starts on login
- Remote restart: send `type: "restart"` command via relay → `gracefulRestart()` → `process.exit(0)` → launchd restarts with new code
- Install: `pnpm gateway:install` (copies plist to `~/Library/LaunchAgents/`)

**Hung Detection (3-layer system):**
- Layer 1: stdout/stderr silence tracking (concern threshold at 60% of staleTimeout)
- Layer 2: `lsof -i -a -p <pid>` checks for ESTABLISHED TCP connections to Anthropic API — if active connection exists, process is waiting for API response (not hung), timer resets
- Layer 3: Kill only when silence + no active connections + no CPU activity. Absolute max cap at 3x staleTimeout
- Stale timeouts: 5 min (simple tasks), 10 min (complex tasks matching `/분석|analyze|refactor|review|security|architect|debug|plan/i`)

### Tmux Agent Monitoring

Optional tmux integration for real-time agent output monitoring. Enable by setting `ENABLE_TMUX=true` in `.env.local`.

- `scripts/tmux-manager.ts` — Tmux session lifecycle: create, capture, list, kill. Session naming: `ld-agent-{agentId}`
- `scripts/tmux-monitor.ts` — Interactive CLI: `pnpm monitor` (list/attach/peek/kill agent sessions)
- When enabled, each Claude CLI agent task runs inside a tmux session; attach with `tmux attach -t ld-agent-{agentId}`
- Falls back to normal `child_process.spawn` when tmux is unavailable or disabled

### History & Messages

PostgreSQL-backed stores for agent task history and inter-agent messaging.

- `src/lib/history.ts` — Agent task history (async). `addHistoryEntry()`, `getAgentHistory()`, `getAllHistory()`, `clearAgentHistory()`
- `src/lib/messages.ts` — Messaging system (async). `sendMessage()`, `getMessages()`, `markAsRead()`, `getConversation()`, `getUnreadCount()`, `getAllAgentsOverview()`
- API routes: `/api/history/`, `/api/history/[agentId]`, `/api/messages/`, `/api/messages/[agentId]`

### Attachments & File Storage

File attachment system for uploading, referencing, and downloading files between agents and the dashboard. Files are linked to messages via the `@file:ref_key` inline reference syntax.

**Database Schema** (`sql/002_attachments.sql`):
- `attachments` table — `id` (UUID PK), `message_id` (FK → messages, nullable), `original_filename`, `mime_type`, `size_bytes`, `storage_key`, `ref_key` (UNIQUE, 8-char), `created_at`
- Indexes on `message_id` and `ref_key`

**Setup:**
```bash
psql life_dashboard < sql/002_attachments.sql
```

**Storage Layer** (`src/lib/storage.ts`):
- `StorageDriver` interface — `save()`, `read()`, `delete()`, `exists()`, `getUrl()`
- `LocalStorageDriver` — saves to `uploads/YYYY/MM/ref_key.ext` directory
- `S3StorageDriver` — S3-compatible object storage (requires `S3_BUCKET`, `S3_REGION`, etc.)
- `STORAGE_TYPE` env var selects driver (`local` default, `s3`)
- `UPLOAD_MAX_SIZE` env var (default 10MB = 10485760 bytes)

**Core Library** (`src/lib/attachments.ts`):
- `saveAttachment(buffer, filename, mimeType, refKey?)` — Upload file + create DB record
- `generateRefKey(buffer)` — 8-char key: 4 SHA-256 hash + 4 random hex
- `linkAttachmentsFromContent(content, messageId)` — Auto-link all `@file:ref_key` in message text
- `parseFileReferences(content)` — Extract `@file:ref_key` patterns via regex
- `getAttachment(id)`, `getAttachmentByRefKey(refKey)`, `getMessageAttachments(messageId)` — Query functions
- `readAttachmentFile(storageKey)` — Read file buffer from storage
- `deleteAttachment(id)` — Delete file + DB record

**API Routes:**
- `POST /api/attachments` — Upload file (multipart/form-data: `file` + optional `refKey`). Auth: session or `x-relay-key`
- `GET /api/attachments/[id]` — Download file by attachment UUID. Streams with `Content-Type`, immutable caching
- `GET /api/attachments/by-ref/[refKey]` — Lookup attachment metadata by ref_key

**`@file:ref_key` Reference Syntax:**
Messages can reference uploaded files inline using `@file:<ref_key>` (e.g., `@file:a3f9k2m1`). When `sendMessage()` is called, `linkAttachmentsFromContent()` automatically parses the content and links matching attachments to the message via `message_id` FK.

**MCP Tool (`scripts/mcp-server.ts`):**
- `dashboard_send_message` — `attachments` parameter accepts `[{filePath, refKey?}]`. MCP server uploads each file, appends `@file:ref_key` to content
- `dashboard_upload_attachment` — Standalone upload: `{filePath, refKey?}`. Returns `ref_key` for later use

### Frontend

Single-page client component (`src/app/page.tsx`) with tabs: Agents, History, Messages, Projects, Finance. Uses react-markdown + remark-gfm for rendering Claude's markdown responses. Polls `/api/relay/status` every 5 seconds for gateway connectivity.

### Projects System

PostgreSQL-backed CRUD system for tracking user's side projects with real-time KPI metrics.

**Database Schema:**
- `sql/017_projects.sql` — `projects` table with `id`, `name`, `description`, `status`, `progress` (0-100), `url`, `kpis` (JSONB array)
- `sql/018_project_metrics.sql` — Real-time KPI system with `project_metrics` (metrics snapshots) and `project_tasks` (task-project linkage)

**Setup:**
```bash
psql life_dashboard < sql/017_projects.sql
psql life_dashboard < sql/018_project_metrics.sql
```

**Core Libraries:**
- `src/lib/projects.ts` — CRUD operations (getProjects, createProject, updateProject, deleteProject)
- `src/lib/project-metrics.ts` — Real-time KPI calculation and metrics tracking

**API Routes:**
- `/api/projects` — List/create projects
- `/api/projects/[id]` — Get/update/delete single project
- `/api/projects/metrics` — Get all projects with latest metrics
- `/api/projects/[id]/metrics` — Get/create metrics snapshot for project
- `/api/projects/[id]/metrics/history` — Get metrics history (time-series)
- `/api/projects/[id]/tasks` — Get/link tasks to project

**Real-time KPI Metrics:**
- Automatic calculation based on linked `task_executions` and `task_queue` entries
- Metrics: completion_rate, success_rate, total_tasks, completed_tasks, failed_tasks, running_tasks, avg_task_duration_seconds
- Auto-triggered snapshot creation on task status changes
- Auto-update `projects.progress` field based on completion_rate

**MCP Tools (for Claude Code agents):**
- `dashboard_get_project_metrics` — Get real-time metrics for all/specific project
- `dashboard_get_project_metrics_history` — Get metrics time-series data
- `dashboard_snapshot_project_metrics` — Create metrics snapshot
- `dashboard_link_task_to_project` — Link task to project for auto-tracking
- `dashboard_get_project_tasks` — Get tasks linked to project

See `docs/project-metrics-system.md` for detailed documentation.

### OKR System

PostgreSQL-backed OKR (Objectives and Key Results) system for tracking quarterly/annual goals with measurable outcomes.

**Database Schema:**
- `sql/019_okr_system.sql` — 3 tables: `objectives`, `key_results`, `project_objectives`

**Setup:**
```bash
psql life_dashboard < sql/019_okr_system.sql
```

**Core Library:**
- `src/lib/okr.ts` — Full CRUD for objectives, key results, and project-OKR linkage

**API Routes:**
- `/api/okr/objectives` — List/create objectives
- `/api/okr/objectives/[id]` — Get/update/delete objective (with key results)
- `/api/okr/key-results` — Create key result
- `/api/okr/key-results/[id]` — Get/update/delete key result
- `/api/okr/projects/[projectId]/objectives` — Get/link project objectives
- `/api/okr/projects/[projectId]/objectives/[objectiveId]` — Unlink project objective

**Auto-Calculation Features:**
- Key result `progress` auto-calculates from `current_value / target_value * 100`
- Objective `overall_progress` auto-updates as weighted average of key results
- Metric types: `percentage`, `number`, `boolean`, `currency`

**MCP Tools (for Claude Code agents):**
- `dashboard_get_objectives` — List objectives (optional status filter)
- `dashboard_get_objective` — Get objective with key results
- `dashboard_create_objective` — Create objective
- `dashboard_update_objective` — Update objective
- `dashboard_create_key_result` — Create key result
- `dashboard_update_key_result` — Update key result (auto-recalculates progress)
- `dashboard_link_project_objective` — Link project to objective
- `dashboard_get_project_objectives` — Get project's objectives

See `docs/okr-system.md` for detailed documentation.

### Conversation Sessions System

PostgreSQL-backed conversation session system for context-aware multi-agent communication with message threading and read status tracking.

**Database Schema:**
- `sql/022_conversation_sessions.sql` — 3 tables: `conversations`, `conversation_messages`, `conversation_read_status`, plus views and triggers

**Setup:**
```bash
psql life_dashboard < sql/022_conversation_sessions.sql
```

**Core Library:**
- `src/lib/conversations.ts` — Full CRUD for conversations, messages, read status, and threading

**API Routes:**
- `/api/conversations` — List/create conversations
- `/api/conversations/[id]` — Get/update/delete conversation (with optional stats)
- `/api/conversations/[id]/messages` — Get/add messages with threading support
- `/api/conversations/[id]/read-status` — Update read status

**Key Features:**
- **Session Context Management** — Store project info, goals, and metadata per conversation
- **Message Threading** — Parent-child message relationships for structured discussions
- **Per-Agent Read Status** — Track which messages each participant has read
- **Auto-Unread Calculation** — Triggers automatically update unread counts
- **Status Lifecycle** — `active` → `completed` / `archived`

**MCP Tools (for Claude Code agents):**
- `dashboard_create_conversation` — Create conversation with title, participants, context
- `dashboard_get_conversations` — List conversations (filter by participant, status, creator)
- `dashboard_get_conversation` — Get conversation (with optional statistics)
- `dashboard_update_conversation` — Update title, context, or status
- `dashboard_delete_conversation` — Delete conversation and all messages
- `dashboard_add_conversation_message` — Add message with threading support
- `dashboard_get_conversation_messages` — Get messages (pagination, since timestamp, threading)
- `dashboard_update_conversation_read_status` — Mark messages as read
- `dashboard_get_unread_conversations` — Get all conversations with unread messages

**Example Usage:**
```typescript
// Create a conversation for a project
const conversation = await createConversation({
  title: "Project Alpha Planning",
  participants: ["dev-agent", "pm-agent", "user"],
  context: {
    projectId: "uuid",
    goal: "Plan project architecture",
    deadline: "2024-12-31",
  },
  createdBy: "user",
});

// Add threaded messages
const rootMessage = await addConversationMessage({
  conversationId: conversation.id,
  from: "user",
  content: "What's the best database for this project?",
  type: "question",
});

const reply = await addConversationMessage({
  conversationId: conversation.id,
  from: "dev-agent",
  content: "PostgreSQL would be ideal because...",
  type: "answer",
  parentMessageId: rootMessage.id, // Thread support
  metadata: { model: "sonnet", tokens: 450 },
});

// Update read status
await updateConversationReadStatus(
  conversation.id,
  "dev-agent",
  reply.id
);
```

See `docs/conversation-sessions.md` for detailed documentation.

### SSE Real-time Synchronization

Server-Sent Events (SSE) system for real-time updates without client polling.

**Core Components:**
- `src/lib/sse-broadcaster.ts` — Singleton broadcaster managing SSE connections, broadcasting events to all/specific clients
- `src/app/api/sse/route.ts` — SSE endpoint (`GET /api/sse`), establishes authenticated event stream
- `src/hooks/useSSE.ts` — Base React hook for SSE connection management with auto-reconnect
- `src/hooks/useProjectSSE.ts` — High-level hook for project-related events
- `src/hooks/useOKRSSE.ts` — High-level hook for OKR-related events

**Supported Events:**
- `project:created`, `project:updated`, `project:deleted` — Project CRUD
- `project:metrics:updated` — Metrics snapshot created
- `okr:objective:created`, `okr:objective:updated`, `okr:objective:deleted` — Objective CRUD
- `okr:key-result:created`, `okr:key-result:updated`, `okr:key-result:deleted` — Key result CRUD
- `heartbeat` — Connection keepalive (30s interval)

**Client Usage:**
```typescript
import { useProjectSSE } from "@/hooks/useProjectSSE";

useProjectSSE({
  onProjectCreated: ({ project }) => setProjects(prev => [...prev, project]),
  onProjectUpdated: ({ project }) => setProjects(prev => prev.map(p => p.id === project.id ? project : p)),
  onProjectDeleted: ({ projectId }) => setProjects(prev => prev.filter(p => p.id !== projectId)),
  onMetricsUpdated: ({ projectId, metrics }) => console.log("Metrics updated:", projectId),
});
```

**Features:**
- Auto-connect on mount, auto-disconnect on unmount
- Auto-reconnect with backoff (max 10 attempts, 3s interval)
- Heartbeat keepalive every 30 seconds
- Authentication required (JWT session)
- Graceful cleanup on server shutdown

See `docs/sse-realtime-sync.md` for detailed documentation.

### Path Alias

`@/*` maps to `./src/*` (configured in `tsconfig.json`).

### Environment Variables

See `.env.example`: `JWT_SECRET`, `ALLOWED_EMAILS`, `RESEND_API_KEY`, `RELAY_API_KEY`, `DATABASE_URL`, `DASHBOARD_URL`, `NEXT_PUBLIC_APP_URL`, `UPLOAD_MAX_SIZE`, `STORAGE_TYPE`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT`, `ENABLE_TMUX`

### Deployment

Railway with Dockerfile. Next.js standalone output. Config in `railway.toml`.
