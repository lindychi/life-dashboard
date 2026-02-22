# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start dev server (localhost:3000)
pnpm build        # Production build (Next.js standalone output)
pnpm lint         # ESLint (eslint-config-next with core-web-vitals + typescript)
pnpm start        # Start production server
pnpm test         # Run vitest tests
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
```

- `sql/001_init.sql` — Schema migration (5 tables: agent_history, messages, gateway_connections, relay_commands, agent_statuses)
- `src/lib/db.ts` — Minimal PostgreSQL client using `pg` Pool. Exports `query<T>()`, `queryOne<T>()`, `pool`
- `DATABASE_URL` env var (default: `postgresql://localhost:5432/life_dashboard`)

### Relay System

A command relay for remotely controlling AI agents from the dashboard. Data persisted in PostgreSQL.

- `src/lib/relay.ts` — Gateway connections, command queue, agent statuses (all async, PostgreSQL-backed). Gateways authenticate via `x-relay-key` header
- `scripts/gateway-connector.ts` — Client-side script that runs on a local machine, registers with the relay, polls for commands, and executes them via Claude CLI
- API routes under `/api/relay/`: `register` (gateway connects), `poll` (gateway fetches commands + sends heartbeat), `command` (dashboard sends commands to gateway), `status` (dashboard reads current state)

### History & Messages

PostgreSQL-backed stores for agent task history and inter-agent messaging.

- `src/lib/history.ts` — Agent task history (async). `addHistoryEntry()`, `getAgentHistory()`, `getAllHistory()`, `clearAgentHistory()`
- `src/lib/messages.ts` — Messaging system (async). `sendMessage()`, `getMessages()`, `markAsRead()`, `getConversation()`, `getUnreadCount()`, `getAllAgentsOverview()`
- API routes: `/api/history/`, `/api/history/[agentId]`, `/api/messages/`, `/api/messages/[agentId]`

### Frontend

Single-page client component (`src/app/page.tsx`) with tabs: Agents, History, Messages, Projects, Finance. Uses react-markdown + remark-gfm for rendering Claude's markdown responses. Polls `/api/relay/status` every 5 seconds for gateway connectivity.

### Path Alias

`@/*` maps to `./src/*` (configured in `tsconfig.json`).

### Environment Variables

See `.env.example`: `JWT_SECRET`, `ALLOWED_EMAILS`, `RESEND_API_KEY`, `RELAY_API_KEY`, `DATABASE_URL`, `NEXT_PUBLIC_APP_URL`

### Deployment

Railway with Dockerfile. Next.js standalone output. Config in `railway.toml`.
