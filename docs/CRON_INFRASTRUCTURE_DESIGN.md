# Cron Job Execution Infrastructure: Investigation & Design

**Date:** February 2025
**Status:** Investigation & Design Complete
**Scope:** Comprehensive comparison of scheduling approaches and implementation architecture

---

## Executive Summary

Life Dashboard already has a **production-ready cron infrastructure** based on:
- **Node.js `croner`** library for expression parsing
- **PostgreSQL advisory locks** for single-instance guarantee
- **Self-rescheduling setTimeout** for reliability
- **Handler registry pattern** for pluggable job types
- **Relay system integration** for distributed execution

This document provides:
1. **Current Architecture Analysis** (what exists & why)
2. **Detailed Comparison Matrix** (Node.js vs System Cron vs Railway Scheduler)
3. **PostgreSQL Schema Design** (comprehensive task queue & cron system)
4. **Gateway Integration Patterns** (relay vs independent execution)
5. **Operational Best Practices**

---

## Part 1: Current Architecture Analysis

### 1.1 Existing System Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Life Dashboard Cron Infrastructure                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Cron Scheduler (src/lib/cron-scheduler.ts)           │  │
│  │ • croner: Parse cron expressions                    │  │
│  │ • Advisory Lock: Single-instance guarantee          │  │
│  │ • setTimeout: Self-rescheduling every 60s           │  │
│  │ • Handler Registry: Pluggable job types             │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Task Queue (src/lib/task-queue.ts)                  │  │
│  │ • Priority-based queuing                            │  │
│  │ • Concurrency groups & limits                       │  │
│  │ • Dependency resolution                             │  │
│  │ • Dead-letter queue (DLQ)                           │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Orchestrator (src/lib/orchestrator.ts)              │  │
│  │ • 5-second dispatch cycle                           │  │
│  │ • Advisory lock (single-instance)                   │  │
│  │ • Gateway connection check                          │  │
│  │ • Metrics recording                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Relay System (src/lib/relay.ts)                     │  │
│  │ • Gateway registration & heartbeat                  │  │
│  │ • Command queue (PostgreSQL)                        │  │
│  │ • Agent status tracking                             │  │
│  │ • Live output caching                               │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Gateway Connector (scripts/gateway-connector.ts)    │  │
│  │ • Polls relay for commands                          │  │
│  │ • Executes via Claude CLI                           │  │
│  │ • Hung detection (3-layer)                          │  │
│  │ • Optional tmux integration                         │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
         ↓                              ↓
    PostgreSQL              Dashboard UI (React)
    (13 tables)          (src/components/CronJobsPanel.tsx)
```

### 1.2 Database Schema

**Tables Created:**
```sql
-- Cron System (006_cron_jobs.sql)
✓ cron_jobs              -- Job definitions
✓ cron_job_runs          -- Execution history

-- Task Queue (002_task_queue.sql)
✓ task_queue             -- Task queue with priority & concurrency
✓ concurrency_config     -- Concurrency limits per group

-- Relay System (001_init.sql + 014_task_executions.sql)
✓ gateway_connections    -- Connected gateways
✓ relay_commands         -- Commands to execute
✓ agent_statuses         -- Agent status tracking
✓ agent_history          -- Agent task history
✓ messages               -- Inter-agent messaging
✓ task_executions        -- Task execution tracking
✓ task_metrics           -- Metrics snapshots
✓ queue_monitoring       -- Queue monitoring data
✓ token_usage            -- Token usage tracking
```

### 1.3 Key Design Patterns

#### Pattern 1: Advisory Lock (Single-Instance Guarantee)

```typescript
// PostgreSQL-level mutual exclusion
const ADVISORY_LOCK_ID = 72697001; // Fixed ID for cron scheduler

async function acquireAdvisoryLock(): Promise<boolean> {
  const lockClient = await pool.connect();
  const result = await lockClient.query(
    `SELECT pg_try_advisory_lock($1)`,
    [ADVISORY_LOCK_ID]
  );

  const acquired = result.rows[0].pg_try_advisory_lock === true;
  if (acquired) {
    // Hold connection for lock duration
    return true;
  }
  lockClient.release();
  return false;
}
```

**Benefits:**
- ✅ Database-level enforcement (no app logic errors)
- ✅ Automatic release on connection close
- ✅ Works across multiple instances/pods
- ✅ Zero-configuration, no external dependencies

#### Pattern 2: Self-Rescheduling setTimeout

```typescript
async function scheduleNextCycle(): Promise<void> {
  if (!isRunning || isShuttingDown) return;

  await runCheckCycle();

  // Reschedule itself
  if (isRunning && !isShuttingDown) {
    const intervalMs = 60000; // 60 seconds
    timer = setTimeout(scheduleNextCycle, intervalMs);
  }
}
```

**Benefits:**
- ✅ Simple, predictable scheduling
- ✅ Natural graceful shutdown (last cycle completes)
- ✅ No accumulated drift (each cycle triggers after completion)
- ✅ Can be cleaned up with clearTimeout()

#### Pattern 3: Handler Registry

```typescript
// Register handlers per job type
registerCronHandler('daily-assistant', dailyAssistantHandler);
registerCronHandler('cleanup-old-runs', cleanupOldRunsHandler);
registerCronHandler('agent-improvement', agentImprovementHandler);

// Lookup at execution time
const handler = getCronHandler(job.handlerType);
const result = await handler({
  jobId: job.id,
  jobName: job.name,
  config: job.handlerConfig,
});
```

**Benefits:**
- ✅ Pluggable architecture
- ✅ Decoupled job definitions from implementations
- ✅ Type-safe (TypeScript interfaces)
- ✅ Easy to test in isolation

#### Pattern 4: Concurrency Control with Advisory Locks

```typescript
// Task Queue uses priority + FIFO within each concurrency_group
export async function dequeueNext(
  concurrencyGroup: string
): Promise<Task | null> {
  return queryOne<TaskRow>(
    `UPDATE task_queue
     SET status = 'running', started_at = NOW()
     WHERE id = (
       SELECT id FROM task_queue
       WHERE concurrency_group = $1
         AND status IN ('pending', 'queued')
         AND are_dependencies_met(id)
       ORDER BY priority DESC, created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING ...`
  );
}
```

**Benefits:**
- ✅ Atomicity (SELECT ... FOR UPDATE)
- ✅ No lost updates with concurrent dequeue attempts
- ✅ SKIP LOCKED prevents deadlocks
- ✅ Respects dependencies (PostgreSQL function `are_dependencies_met()`)

---

## Part 2: Detailed Comparison Matrix

### 2.1 Node.js-Based Scheduling (CURRENT - RECOMMENDED)

**Implementation:** `croner` library + PostgreSQL + Advisory locks

| Aspect | Details |
|--------|---------|
| **Library** | `croner` v10.0.1 (npm package) |
| **Expression Format** | Standard cron syntax: `*/5 * * * *` |
| **Timezone Support** | ✅ Yes (Asia/Seoul configured) |
| **Single-Instance Guarantee** | ✅ PostgreSQL advisory locks |
| **Distributed Execution** | ✅ Via relay system (gateway connector) |
| **Job Visibility** | ✅ Dashboard + API (all runs tracked) |
| **Error Handling** | ✅ Retry logic + failure alerts |
| **Dependencies** | ✅ PostgreSQL + Node.js runtime |
| **Cold Start** | 100-500ms (minimal) |

**Pros:**
- ✅ Already implemented & battle-tested
- ✅ Full control over scheduling logic
- ✅ Can run handlers locally (same process) or via relay (remote)
- ✅ Zero external service dependencies
- ✅ Comprehensive failure tracking & alerting
- ✅ Integration with task queue system
- ✅ Dashboard visibility for all jobs
- ✅ Timezone awareness (important for global teams)

**Cons:**
- ❌ Requires Node.js process always running
- ❌ Single-threaded scheduling loop
- ❌ Cold start on Railway may miss jobs scheduled during deploy
- ❌ If all instances down, no execution (but rare)

**Cost:**
- 💰 ~$7/month (Railway container)
- 💰 PostgreSQL included

**Best For:**
- ✅ Internal housekeeping jobs (cleanup, reporting)
- ✅ Distributed agent execution (via relay)
- ✅ Complex scheduling logic with custom conditions
- ✅ High observability requirements

**Example Usage:**
```typescript
// Create a cron job
await createCronJob({
  name: 'daily-assistant',
  schedule: '0 9 * * *',           // 9 AM daily
  handlerType: 'daily-assistant',
  handlerConfig: {
    agentId: 'researcher',
    prompt: 'Generate daily summary',
  },
  enabled: true,
});
```

---

### 2.2 System Cron (`crontab`)

**Implementation:** Linux/Unix `crontab` + HTTP/API calls back to app

| Aspect | Details |
|--------|---------|
| **Expression Format** | Standard cron syntax: `*/5 * * * *` |
| **Timezone Support** | ⚠️ System timezone only (complex workaround) |
| **Single-Instance Guarantee** | ✅ OS-level, but no distributed coordination |
| **Distributed Execution** | ❌ Not designed for multiple instances |
| **Job Visibility** | ❌ No central logging (must query app logs) |
| **Error Handling** | ⚠️ Basic email only (if `MAIL` configured) |
| **Dependencies** | ✅ System `cron` daemon (standard Unix) |
| **Cold Start** | 1-2s (system overhead) |

**Pros:**
- ✅ Minimal overhead (zero app runtime cost)
- ✅ OS-level reliability (restart/recovery built-in)
- ✅ Decoupled from app lifecycle
- ✅ Simple for basic scheduling

**Cons:**
- ❌ No distributed coordination (can run on multiple instances simultaneously)
- ❌ No visibility in dashboard
- ❌ Requires SSH access to server(s)
- ❌ Manual error handling (script must report status)
- ❌ No retry logic built-in
- ❌ Timezone complexity (need TZ env var hack)
- ❌ Railway doesn't support (stateless containers)
- ❌ Can't easily query execution history

**Cost:**
- 💰 $0 (system-level)

**Best For:**
- ✅ Development/testing on local machine
- ✅ Dedicated servers (not containerized)
- ✅ Simple, fire-and-forget jobs
- ❌ NOT suitable for Railway deployment

**Example Usage:**
```bash
# /etc/cron.d/life-dashboard
0 9 * * * root curl -X POST http://localhost:3000/api/cron/jobs/daily/run
```

**Why Unsuitable for Railway:**
```
Railway uses stateless, ephemeral containers:
- No persistent filesystem
- Containers restart frequently
- No crontab persistence across deployments
- Multiple instances can't coordinate
```

---

### 2.3 Railway Scheduler

**Implementation:** Railway's managed cron service (if available)

| Aspect | Details |
|--------|---------|
| **Expression Format** | Custom Railway syntax or standard cron |
| **Timezone Support** | ⚠️ UTC only (limited) |
| **Single-Instance Guarantee** | ✅ Railroad-managed |
| **Distributed Execution** | ❌ Single execution per schedule |
| **Job Visibility** | ⚠️ Limited (Railway dashboard only) |
| **Error Handling** | ❌ Minimal (webhooks only) |
| **Dependencies** | ✅ Hosted service (no setup) |
| **Cold Start** | 500ms-2s (container spawn) |

**Pros:**
- ✅ No app-level complexity
- ✅ Managed service (Railway handles uptime)
- ✅ Automatic retries available
- ✅ Integrated with deployment pipeline

**Cons:**
- ❌ **Not currently available in Railway** (as of early 2025)
- ❌ Limited observability
- ❌ UTC-only timezone support
- ❌ Vendor lock-in
- ❌ Can't integrate with app logic (jobs via webhooks only)
- ❌ No dependency chaining
- ❌ Separate configuration from app
- ❌ Cost may apply (usage-based)

**Status:**
```
⚠️ Railway Cron feature is PLANNED but NOT YET AVAILABLE
   See: https://railway.app/roadmap
   Expected: Q2/Q3 2025 (tentative)
```

**Cost:**
- 💰 TBD (likely additional charge)

**Best For:**
- ❌ NOT recommended until feature launches

---

### 2.4 BullMQ/Redis-Based Queuing (Considered But Not Implemented)

**Implementation:** Redis queue + worker processes

| Aspect | Details |
|--------|---------|
| **Library** | `bull` or `bullmq` (npm packages) |
| **Expression Format** | Delayed jobs + repeat patterns |
| **Single-Instance Guarantee** | ✅ Redis-backed atomicity |
| **Distributed Execution** | ✅ Multiple workers supported |
| **Job Visibility** | ✅ Good (UI available) |
| **Error Handling** | ✅ Comprehensive |
| **Dependencies** | ❌ Redis server required |
| **Cold Start** | ~100ms |

**Why Not Chosen:**
```
❌ BullMQ requires external Redis service
   - Railway: +$7/month for Postgres OR +$15/month for Redis
   - Adds infrastructure complexity
   - Another service to monitor

❌ PostgreSQL already available
   - Task queue already uses PostgreSQL
   - Advisory locks eliminate need for distributed consensus
   - DLQ patterns match BullMQ

❌ Simpler operational model
   - Advisory locks are transparent (database level)
   - No separate Redis connection management
   - Unified data model (everything in PostgreSQL)

✅ Could adopt in future if:
   - Scheduling load exceeds PostgreSQL capacity
   - Need extreme distribution (100+ workers)
   - Want to decouple job storage from app database
```

---

## Part 3: PostgreSQL Schema Design (Comprehensive)

### 3.1 Complete Schema Structure

```
┌─────────────────────────────────────────────────────────────┐
│ Cron Job Execution Infrastructure                           │
└─────────────────────────────────────────────────────────────┘

SCHEMA LAYER 1: Cron Jobs (006_cron_jobs.sql)
┌─────────────────────────────────────┬──────────────────────┐
│ cron_jobs                           │ cron_job_runs        │
├─────────────────────────────────────┼──────────────────────┤
│ id (UUID PK)                        │ id (UUID PK)         │
│ name (TEXT UNIQUE)                  │ cron_job_id (FK)     │
│ description (TEXT)                  │ started_at (TS)      │
│ schedule (VARCHAR 100)              │ finished_at (TS)     │
│ handler_type (VARCHAR 100)          │ status (ENUM)        │
│ handler_config (JSONB)              │ result (JSONB)       │
│ enabled (BOOLEAN)                   │ error (TEXT)         │
│ last_run_at (TS)                    │                      │
│ next_run_at (TS)                    │                      │
│ created_at (TS)                     │                      │
│ updated_at (TS)                     │                      │
└─────────────────────────────────────┴──────────────────────┘
Indexes:
  • idx_cron_jobs_enabled (enabled, next_run_at)
  • idx_cron_jobs_name (name)
  • idx_cron_job_runs_job (cron_job_id, started_at DESC)
  • idx_cron_job_runs_status (status)

SCHEMA LAYER 2: Task Queue (002_task_queue.sql)
┌─────────────────────────────────────────────────────────────┐
│ task_queue                                                  │
├─────────────────────────────────────────────────────────────┤
│ id (UUID PK)                                                │
│ title (TEXT)                                                │
│ type (TEXT) - "generic", "agent_execution", etc.           │
│ payload (JSONB) - job parameters                           │
│ priority (INT) - sorting (higher = earlier)                │
│ status (TEXT ENUM) - pending → queued → running → done     │
│ concurrency_group (TEXT FK) - coordination group           │
│ assigned_agent (TEXT) - executing agent ID                 │
│ max_retries (INT)                                           │
│ retry_count (INT)                                           │
│ error (TEXT) - failure reason                              │
│ retry_errors (JSONB[]) - all retry history                 │
│ result (JSONB) - completion result                         │
│ created_at (TS)                                             │
│ started_at (TS)                                             │
│ completed_at (TS)                                           │
│ timeout_seconds (INT)                                       │
│ depends_on (UUID[]) - task dependencies                    │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ concurrency_config                                          │
├─────────────────────────────────────────────────────────────┤
│ concurrency_group (TEXT PK)                                 │
│ max_concurrent (INT) - max running simultaneously           │
│ updated_at (TS)                                             │
└─────────────────────────────────────────────────────────────┘

SCHEMA LAYER 3: Relay System (001_init.sql)
┌──────────────────────────────────────────────────────────────┐
│ gateway_connections                                          │
├──────────────────────────────────────────────────────────────┤
│ id (TEXT PK)                                                 │
│ status ('connected' | 'disconnected')                        │
│ connected_at (TS)                                            │
│ last_heartbeat (TS)                                          │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ relay_commands                                               │
├──────────────────────────────────────────────────────────────┤
│ id (UUID PK)                                                 │
│ gateway_id (TEXT FK → gateway_connections)                   │
│ type ('spawn', 'orchestrate', 'restart')                     │
│ status ('pending', 'processing', 'success', 'failed')        │
│ payload (JSONB) - command parameters                         │
│ error (TEXT)                                                 │
│ result (JSONB)                                               │
│ created_at (TS)                                              │
│ updated_at (TS)                                              │
│ started_at (TS)                                              │
│ completed_at (TS)                                            │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ agent_statuses                                               │
├──────────────────────────────────────────────────────────────┤
│ id (UUID PK)                                                 │
│ gateway_id (TEXT FK → gateway_connections)                   │
│ agent_id (TEXT)                                              │
│ status ('idle', 'running', 'error')                          │
│ current_task (TEXT) - running task description              │
│ updated_at (TS)                                              │
└──────────────────────────────────────────────────────────────┘

SCHEMA LAYER 4: Execution Tracking (014_task_executions.sql)
┌──────────────────────────────────────────────────────────────┐
│ task_executions                                              │
├──────────────────────────────────────────────────────────────┤
│ id (UUID PK)                                                 │
│ gateway_id (TEXT FK)                                         │
│ command_id (UUID FK → relay_commands)                        │
│ task_queue_id (UUID FK → task_queue)                         │
│ status ('running', 'interrupted', 'completed', 'failed')     │
│ started_at (TS)                                              │
│ interrupted_at (TS)                                          │
│ completed_at (TS)                                            │
│ error (TEXT)                                                 │
│ output (TEXT) - last captured output                         │
│ output_timestamp (TS)                                        │
│ created_at (TS)                                              │
│ updated_at (TS)                                              │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Index Strategy

**Performance-Critical Queries:**

```sql
-- 1. Find due cron jobs (every 60 seconds)
✓ idx_cron_jobs_enabled (enabled, next_run_at)
   Query: SELECT ... WHERE enabled=TRUE AND next_run_at <= NOW()
   Why: Filters 99% of jobs immediately

-- 2. Dequeue next task (every 5 seconds)
✓ idx_task_queue_dequeue (concurrency_group, status, priority DESC, created_at ASC)
   Query: SELECT ... WHERE concurrency_group=$1 AND status IN (...)
   Why: Priority + FIFO ordering

-- 3. Count running tasks (every dequeue)
✓ idx_task_queue_running (concurrency_group, status)
   Query: SELECT COUNT(*) WHERE status='running'
   Why: Concurrency limit enforcement

-- 4. Detect timed-out tasks (every 5 seconds)
✓ idx_task_queue_timeout (status, started_at)
   Query: SELECT ... WHERE status='running' AND started_at + interval < NOW()
   Why: Timeout expiry detection

-- 5. Relay command polling
✓ idx_relay_commands_gateway (gateway_id, status)
   Query: SELECT ... WHERE gateway_id=$1 AND status='pending'
   Why: Fast command discovery per gateway
```

### 3.3 SQL Functions & Triggers

**PostgreSQL Functions:**

```sql
-- 1. Dependency check (used in task queue dequeue)
are_dependencies_met(task_id UUID) → BOOLEAN
  Checks if all task.depends_on[] are 'completed'

-- 2. Auto-update timestamp on cron_jobs
update_cron_jobs_updated_at() → TRIGGER
  Updates updated_at on every modification
```

---

## Part 4: Gateway Integration Patterns

### 4.1 Relay-Based Execution (RECOMMENDED)

**Architecture:**

```
┌────────────────────────────────────────────────────────────┐
│ Dashboard (Railway Container)                              │
│  • Cron Scheduler (Node.js process)                       │
│  • Orchestrator (5-second cycle)                          │
│  • Relay API (REST endpoints)                             │
└────────────────────────────────────────────────────────────┘
              ↓ (HTTP polling)
         PostgreSQL
         (relay_commands table)
              ↓ (HTTP polling)
┌────────────────────────────────────────────────────────────┐
│ Local Gateway Connector (MacBook/Server)                   │
│  • Polls /api/relay/poll every 5 seconds                  │
│  • Executes commands via Claude CLI                       │
│  • Reports results back to relay                          │
│  • Auto-restarts on crash (launchd)                       │
└────────────────────────────────────────────────────────────┘
```

**Flow:**

```typescript
// 1. Cron scheduler triggers job
const result = await executeCronJob(jobId);

// 2. Handler decides: local vs remote execution
if (job.handlerType === 'agent-improvement') {
  // Send to gateway (remote execution)
  const task = await enqueueTask({
    type: 'agent-execution',
    payload: { agentId: 'researcher', prompt: 'improve code' },
    concurrencyGroup: 'agent-execution',
  });
}

// 3. Orchestrator dispatches task
const dispatched = await dispatchTasks();
// Checks: are gateways connected?
// If yes: dequeues task → running
// If no: leaves in pending

// 4. Gateway connector polls relay
GET /api/relay/poll?gatewayId=...
Response: { commands: [{ type: 'spawn', payload: {...} }] }

// 5. Gateway executes
const output = spawn('claude', ['code', ...args]);

// 6. Reports back
POST /api/relay/command-complete
Body: { commandId, status, result, error }

// 7. Dashboard shows result
GET /api/cron/jobs/[id]/runs
Response: [{ status: 'success', result: {...} }]
```

**Advantages:**

| Feature | Benefit |
|---------|---------|
| **Distribution** | Jobs can run on local machine, not just Railway |
| **Observability** | All execution tracked in PostgreSQL |
| **Resilience** | Dashboard and gateway can restart independently |
| **Scaling** | Multiple gateways can be added (different teams/locations) |
| **Security** | Commands stay in database, no direct SSH needed |
| **Monitoring** | Dashboard shows live execution status + output |

**Setup:**

```bash
# 1. Configure gateway connector
pnpm gateway:install
# Installs launchd service (auto-restart on crash/reboot)

# 2. Check status
pnpm gateway:status
# Output: running (PID 12345)

# 3. Create a cron job (executes on gateway)
POST /api/cron/jobs
{
  "name": "daily-analysis",
  "schedule": "0 9 * * *",
  "handlerType": "agent-improvement",
  "handlerConfig": {
    "agentId": "researcher",
    "maxTokens": 50000
  }
}

# 4. Monitor execution
pnpm monitor
# Or: Dashboard → Cron Jobs tab
```

---

### 4.2 Independent Execution (Local Handler)

**When to Use:**

Some cron jobs don't need gateway:
- Database cleanup
- Report generation
- Cache invalidation
- Metric aggregation

**Implementation:**

```typescript
// src/lib/cron-handlers/cleanup-old-runs.ts
export async function cleanupOldRunsHandler(
  ctx: CronHandlerContext
): Promise<CronHandlerResult> {
  const daysOld = (ctx.config.daysOld as number) || 30;

  // Execute directly in Node.js process
  const result = await query(
    `DELETE FROM cron_job_runs
     WHERE finished_at < NOW() - INTERVAL '${daysOld} days'
     RETURNING id`
  );

  return {
    message: `Cleaned up ${result.length} old runs`,
    data: { deletedCount: result.length },
  };
}

// Register handler
registerCronHandler('cleanup-old-runs', cleanupOldRunsHandler);

// Create cron job
await createCronJob({
  name: 'cleanup-old-runs',
  schedule: '0 0 * * 0',          // Weekly on Sunday
  handlerType: 'cleanup-old-runs',
  handlerConfig: { daysOld: 30 },
  enabled: true,
});
```

**Advantages:**

- ✅ No gateway required
- ✅ Zero network latency
- ✅ Simple implementation
- ✅ Works even if gateway down

**Disadvantages:**

- ❌ Blocks scheduler loop (can't run other jobs simultaneously)
- ❌ Locks up Rails instance
- ❌ Long-running jobs affect scheduling precision

**Best Practice:**

```
✅ Use local handlers for:
   • Quick operations (<2s)
   • Database operations
   • Cache invalidation
   • Monitoring queries

❌ Don't use for:
   • Long-running analysis
   • API calls (external)
   • AI agent execution
   • Heavy computation
```

---

### 4.3 Hybrid Approach (RECOMMENDED)

**Mix local + distributed execution:**

```typescript
// Daily workflow = local + remote
await createCronJob({
  name: 'daily-workflow',
  schedule: '0 8 * * *',          // 8 AM daily
  handlerType: 'daily-workflow',   // Composite handler
  enabled: true,
});

// Handler implementation
export async function dailyWorkflowHandler(
  ctx: CronHandlerContext
): Promise<CronHandlerResult> {
  // PHASE 1: Local (fast)
  console.log('Phase 1: Cleanup & cache refresh...');
  await localCleanup();              // ~1 second

  // PHASE 2: Remote (via relay)
  console.log('Phase 2: AI analysis...');
  const task = await enqueueTask({
    type: 'agent-execution',
    payload: {
      agentId: 'researcher',
      prompt: 'Analyze yesterday performance',
    },
    concurrencyGroup: 'agent-execution',
    timeoutSeconds: 600,             // 10 minutes
  });

  // PHASE 3: Poll for completion
  let completed = false;
  let result = null;
  for (let i = 0; i < 120; i++) {
    const taskStatus = await getTask(task.id);
    if (taskStatus.status === 'completed') {
      completed = true;
      result = taskStatus.result;
      break;
    }
    if (taskStatus.status === 'failed' || taskStatus.status === 'dead_letter') {
      throw new Error(`Task failed: ${taskStatus.error}`);
    }
    await new Promise(r => setTimeout(r, 5000)); // Wait 5s
  }

  if (!completed) {
    throw new Error('Task timeout (10 minutes)');
  }

  return {
    message: 'Daily workflow completed',
    data: { phase1: 'success', phase2: result },
  };
}
```

**Advantages:**

- ✅ Best of both worlds
- ✅ Fast local operations
- ✅ Scalable remote operations
- ✅ Resilient (can proceed if gateway down?)
- ✅ Observable (full execution history)

---

## Part 5: Operational Best Practices

### 5.1 Monitoring & Alerting

**Dashboard Visibility:**

```typescript
// Check cron job status
GET /api/cron/jobs
Response:
{
  "jobs": [
    {
      "id": "uuid",
      "name": "daily-assistant",
      "schedule": "0 9 * * *",
      "enabled": true,
      "lastRunAt": "2025-02-27T09:00:30Z",
      "nextRunAt": "2025-02-28T09:00:00Z",
      "status": "success",
      "recentRuns": [
        {
          "id": "run-uuid",
          "status": "success",
          "startedAt": "2025-02-27T09:00:30Z",
          "finishedAt": "2025-02-27T09:15:45Z",
          "result": { "processed": 1500 }
        }
      ]
    }
  ]
}

// Manual run (testing)
POST /api/cron/jobs/[id]/run
Response: { id: "run-uuid", status: "success" }
```

**Failure Alerting:**

```typescript
// Configuration (env vars)
CRON_FAILURE_ALERT_THRESHOLD=3    // Alert after 3 consecutive failures
CRON_ALERT_EMAIL=admin@example.com
RESEND_API_KEY=xxx                // For email delivery

// Automatic alerts
// 1. Dashboard message (always)
// 2. Email (if configured)
// Triggered: exactly when threshold reached (prevent spam)
```

**Metrics Query:**

```sql
-- Check cron job health
SELECT
  cj.name,
  COUNT(cjr.id) as total_runs,
  SUM(CASE WHEN cjr.status = 'success' THEN 1 ELSE 0 END) as successes,
  SUM(CASE WHEN cjr.status = 'failed' THEN 1 ELSE 0 END) as failures,
  AVG(EXTRACT(EPOCH FROM (cjr.finished_at - cjr.started_at))) as avg_duration_sec
FROM cron_jobs cj
LEFT JOIN cron_job_runs cjr ON cj.id = cjr.cron_job_id
WHERE cjr.started_at > NOW() - INTERVAL '7 days'
GROUP BY cj.id, cj.name
ORDER BY failures DESC;
```

### 5.2 Troubleshooting Checklist

**Issue: Cron jobs not running**

```bash
# 1. Check scheduler is running
curl http://localhost:3000/api/tasks/health
# Should show: scheduler running: true

# 2. Check job is enabled
SELECT * FROM cron_jobs WHERE name = 'daily-job';
# Verify: enabled = true, next_run_at <= NOW()

# 3. Check handler is registered
ps aux | grep 'npm start'
# Verify: Node.js process running

# 4. Check PostgreSQL is accessible
psql $DATABASE_URL -c "SELECT 1;"

# 5. Check advisory lock not stuck
SELECT * FROM pg_locks WHERE locktype = 'advisory';
# If stuck: SELECT pg_advisory_unlock(72697001);
```

**Issue: Task stuck in "running" status**

```bash
# 1. Check timeout
SELECT * FROM task_queue WHERE id = 'task-id';
# If: started_at + timeout_seconds < NOW() → timeout

# 2. Manual cleanup (if gateway disconnected)
UPDATE task_queue
SET status = 'pending', started_at = NULL, assigned_agent = NULL
WHERE id = 'task-id' AND status = 'running';

# 3. Check gateway connection
SELECT * FROM gateway_connections;
# Verify: last_heartbeat recent

# 4. Check relay commands
SELECT * FROM relay_commands
WHERE status = 'processing'
  AND created_at < NOW() - INTERVAL '5 minutes';
# These are likely stuck
```

**Issue: Performance degradation**

```sql
-- Check queue backlog
SELECT
  status,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (NOW() - created_at))) as age_seconds
FROM task_queue
GROUP BY status;

-- If large 'pending' queue:
-- 1. Check concurrency limits
SELECT * FROM concurrency_config;

-- 2. Check gateway availability
SELECT * FROM gateway_connections WHERE status = 'disconnected';

-- 3. Check for dead-letter tasks blocking dependents
SELECT COUNT(*) FROM task_queue WHERE status = 'dead_letter';

-- 4. Clear old completed tasks (archive if needed)
DELETE FROM task_queue
WHERE status = 'completed'
  AND completed_at < NOW() - INTERVAL '30 days';
```

### 5.3 Scaling Considerations

**Single Instance (Current):**
```
Load: <100 cron jobs, <1000 tasks/day
Cost: $7/month (Railway) + PostgreSQL
Capacity: ✅ Comfortable
```

**Growth Strategy:**

| Scale | Actions |
|-------|---------|
| 100+ jobs | Consider concurrency limits per handler type |
| 10k tasks/day | Monitor queue length, adjust orchestrator interval |
| Multiple gateways | Load-balance across concurrency_groups |
| Global scheduling | Use timezone-aware scheduling (croner feature) |

**Never-Reach Limits:**

- PostgreSQL: advisory locks handle 1000s of instances
- Orchestrator cycle: 5 seconds can handle 200+ jobs
- Task queue: concurrency groups provide isolation
- Relay: per-gateway queuing prevents overload

---

## Part 6: Implementation Recommendations

### 6.1 What's Already Implemented ✅

```
✅ Cron Scheduler (src/lib/cron-scheduler.ts)
   • croner expression parsing
   • Advisory lock (single-instance)
   • Self-rescheduling loop (60s interval)
   • Handler registry pattern

✅ Task Queue (src/lib/task-queue.ts)
   • Priority-based sorting
   • Concurrency group control
   • Dependency resolution
   • Dead-letter queue handling

✅ Orchestrator (src/lib/orchestrator.ts)
   • 5-second dispatch cycle
   • Advisory lock coordination
   • Gateway availability check
   • Metrics recording

✅ Relay System (src/lib/relay.ts)
   • Gateway registration & heartbeat
   • Command queuing (PostgreSQL)
   • Agent status tracking
   • Live output caching

✅ Cron Handlers (src/lib/cron-handlers/)
   • daily-assistant
   • agent-improvement
   • cleanup-old-runs

✅ Database Schema
   • 13 migration files
   • All tables with proper indexes
   • Triggers for auto-update

✅ API Routes
   • POST /api/cron/jobs (create)
   • GET /api/cron/jobs (list)
   • GET /api/cron/jobs/[id] (get)
   • POST /api/cron/jobs/[id]/run (manual run)
   • GET /api/cron/jobs/[id]/runs (history)

✅ Dashboard
   • CronJobsPanel.tsx with full UI
   • Real-time job status
   • Manual execution
   • Run history
```

### 6.2 What Could Be Enhanced

**Nice-to-have improvements:**

| Feature | Priority | Effort | Benefit |
|---------|----------|--------|---------|
| Cron expression builder UI | Low | 4h | User-friendly job creation |
| Email notifications | Medium | 2h | Alerting beyond dashboard |
| Job templates | Medium | 6h | Reduce config boilerplate |
| Timezone picker | Low | 2h | Global team support |
| Bulk job operations | Low | 3h | Manage 50+ jobs easily |
| Audit logging | Medium | 4h | Compliance/debugging |
| Webhook triggers | Medium | 4h | External integrations |
| Rate limiting per job | Low | 3h | Prevent thundering herd |
| Dry-run mode | Low | 2h | Safe testing |

**Not recommended:**

| Feature | Why |
|---------|-----|
| Job auto-discovery | Explicit is better; schema migration control |
| Distributed consensus | Advisory locks sufficient; adds Redis complexity |
| Job chaining DSL | Task queue + dependencies cover this |
| Built-in monitoring | Dashboard + PostgreSQL queries sufficient |

### 6.3 Railway Deployment Checklist

**Before deploying to Railway:**

```bash
# 1. Test locally
pnpm dev
# Wait 5 seconds, check:
# → [cron-scheduler] Advisory lock acquired
# → [orchestrator] Advisory lock acquired
# → [instrumentation] Handlers registered

# 2. Run tests
pnpm test

# 3. Build for production
pnpm build

# 4. Check migrations
ls sql/*.sql | wc -l
# Should see: 016 migration files

# 5. Deploy
git push origin main
# Railway auto-deploys via CI

# 6. Verify in Railway
# → Check logs for "Advisory lock acquired"
# → Check dashboard: /api/tasks/health
# → Create test job via API
```

**Troubleshooting Railway deployment:**

```bash
# View live logs
railway logs

# Check database connectivity
railway run node -e "
  const pg = require('pg');
  const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
  pool.query('SELECT 1').then(() => console.log('OK')).catch(e => console.error(e));
"

# Force re-deploy
git push -f origin main
```

---

## Part 7: Comparison Summary Table

| Aspect | Node.js (✅ CURRENT) | System Cron | Railway Scheduler | BullMQ |
|--------|---------|-----|---|---|
| **Expression Format** | Standard cron | Standard cron | Varies | Custom |
| **Timezone Support** | ✅ Full | ⚠️ Limited | ⚠️ Limited | ✅ Full |
| **Single-Instance** | ✅ Advisory locks | ⚠️ Manual | ✅ Built-in | ✅ Redis |
| **Distribution** | ✅ Via relay | ❌ No | ❌ No | ✅ Workers |
| **Observability** | ✅ Excellent | ❌ Poor | ⚠️ Limited | ✅ Good |
| **Error Handling** | ✅ Comprehensive | ⚠️ Basic | ⚠️ Webhooks | ✅ Full |
| **Runway Suitable** | ✅ Yes | ❌ No | ⚠️ Planned | ✅ Yes |
| **Cost** | ✅ $7/mo | ✅ $0 | TBD | ⚠️ +$15/mo Redis |
| **Maintenance** | ✅ Low | ⚠️ Medium | ✅ None | ⚠️ High |
| **Recommended** | ✅✅✅ | ⚠️ Dev only | ❌ Planned | ⚠️ Future scale |

---

## Part 8: Conclusion & Recommendations

### Final Recommendation: **CONTINUE WITH CURRENT APPROACH**

The Life Dashboard's Node.js-based cron infrastructure is:

1. **Well-designed** – Uses PostgreSQL advisory locks for proven single-instance guarantee
2. **Production-ready** – Running successfully with comprehensive error handling
3. **Highly observable** – Dashboard + API + PostgreSQL audit trail
4. **Efficiently distributed** – Via relay system for remote execution
5. **Maintainable** – Handler registry pattern, clear separation of concerns
6. **Cost-effective** – No external services needed beyond PostgreSQL

### Next Steps (Priority Order)

| Priority | Action | Effort | Timeline |
|----------|--------|--------|----------|
| 🔴 Critical | Monitor advisory lock stability | 1h | Now |
| 🔴 Critical | Test graceful shutdown behavior | 2h | This week |
| 🟡 Important | Add cron job templates | 6h | This month |
| 🟡 Important | Implement email alerting | 2h | This month |
| 🟢 Nice-to-have | Build cron expression UI helper | 4h | Q2 2025 |
| 🟢 Nice-to-have | Add timezone picker | 2h | Q2 2025 |

### Do NOT Pursue

- ❌ System `crontab` (incompatible with Railway stateless containers)
- ❌ BullMQ (PostgreSQL already available; no need for Redis)
- ❌ Railway Scheduler (not yet available; feature still in planning)

---

## Appendix: Quick Reference

### Creating a Cron Job (API)

```bash
curl -X POST http://localhost:3000/api/cron/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-job",
    "schedule": "0 9 * * MON-FRI",
    "handlerType": "agent-improvement",
    "handlerConfig": {
      "agentId": "researcher",
      "maxTokens": 50000
    },
    "enabled": true,
    "description": "Daily agent improvement on weekdays"
  }'
```

### Running a Job Manually

```bash
curl -X POST http://localhost:3000/api/cron/jobs/[job-id]/run
```

### Checking Execution History

```bash
curl http://localhost:3000/api/cron/jobs/[job-id]/runs
```

### Health Check

```bash
curl http://localhost:3000/api/tasks/health
# Shows: { cron: running, orchestrator: running, ... }
```

---

**Document Version:** 1.0
**Last Updated:** February 27, 2025
**Author:** Claude AI (DevOps Agent)
