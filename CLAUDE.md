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
- `scripts/gateway-connector.ts` — Client-side script that runs on a local machine, registers with the relay, polls for commands, and executes them via Claude CLI
- `scripts/claude-executor.ts` — Claude/Codex CLI executor with hung detection (stale timeout), retry, and optional tmux integration
- API routes under `/api/relay/`: `register` (gateway connects), `poll` (gateway fetches commands + sends heartbeat), `command` (dashboard sends commands to gateway), `status` (dashboard reads current state)

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

### Path Alias

`@/*` maps to `./src/*` (configured in `tsconfig.json`).

### Environment Variables

See `.env.example`: `JWT_SECRET`, `ALLOWED_EMAILS`, `RESEND_API_KEY`, `RELAY_API_KEY`, `DATABASE_URL`, `DASHBOARD_URL`, `NEXT_PUBLIC_APP_URL`, `UPLOAD_MAX_SIZE`, `STORAGE_TYPE`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT`, `ENABLE_TMUX`

### Deployment

Railway with Dockerfile. Next.js standalone output. Config in `railway.toml`.
