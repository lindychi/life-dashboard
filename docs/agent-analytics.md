# Agent Analytics Documentation

## Overview

The Agent Analytics system provides comprehensive insights into agent performance, collaboration patterns, bottlenecks, and cost optimization opportunities within the Life Dashboard ecosystem.

## Available Tools

### 1. Console Analytics (`pnpm analyze:agents`)

Real-time console output showing key metrics across six categories:

```bash
pnpm analyze:agents
```

**Output Sections:**

1. **Agent Work Frequency** — Task counts, success rates, and average duration per agent
2. **Task Type Distribution** — Breakdown of task types by agent with failure rates
3. **Collaboration Patterns** — Top 10 agent-to-agent message exchanges with response times
4. **Bottleneck Analysis** — Pending queue depth and stuck tasks (>30min runtime)
5. **Cost Analysis** — Token usage costs by agent with model distribution (Haiku/Sonnet/Opus)
6. **Key Insights** — Automated detection of:
   - Most active agents
   - High failure rate warnings
   - Busiest collaborations
   - Expensive agents
   - Stuck task alerts
   - Queue depth warnings

**Use Cases:**
- Quick health check of the agent ecosystem
- Identify immediate bottlenecks or stuck tasks
- Monitor cost trends
- Debug collaboration issues

---

### 2. Markdown Report Generator (`pnpm analyze:report`)

Comprehensive markdown report with visualizations using Mermaid diagrams:

```bash
pnpm analyze:report
```

**Generated File:** `agent-usage-report.md` (root directory)

**Report Contents:**

#### Executive Summary
- Total agents active
- Total tasks executed
- Total cost (USD)
- Active collaboration count

#### Detailed Sections

1. **Agent Work Frequency Table**
   - Full task metrics for all agents
   - Success rates and average duration

2. **Task Type Distribution**
   - Per-agent breakdown of task types
   - Average duration by task type

3. **Collaboration Patterns**
   - Agent-to-agent message count table
   - **Mermaid graph** visualizing top 10 collaboration flows

4. **Bottleneck Analysis**
   - Pending task counts
   - Stuck task warnings (>30min runtime)
   - Actionable alerts for high queue depth

5. **Cost Analysis**
   - Cost by agent with model breakdown
   - **Mermaid pie chart** showing Haiku/Sonnet/Opus distribution

6. **Activity Timeline (Last 7 Days)**
   - Daily task counts and completion rates

7. **Recommendations**
   - Automated suggestions for:
     - Cost optimization (ecomode candidates)
     - Reliability improvements (low success rate agents)
     - Hung detection adjustments
     - Queue backlog solutions
     - Isolated agent coordination

**Use Cases:**
- Weekly/monthly performance reviews
- Stakeholder reporting
- Trend analysis over time
- Optimization planning

---

## Data Sources

### Database Tables

| Table | Purpose |
|-------|---------|
| `agent_history` | Historical task execution records |
| `messages` | Inter-agent message exchanges |
| `task_queue` | Current and historical task queue state |
| `task_executions` | Gateway execution tracking |
| `token_usage` | Model usage and cost tracking |

### Key Metrics

#### Work Frequency Metrics
- **Total Tasks:** All tasks assigned to agent (pending + completed + failed + running)
- **Completed Tasks:** Successfully finished tasks
- **Failed Tasks:** Tasks that returned non-zero exit code or error
- **Running Tasks:** Currently executing tasks
- **Success Rate:** `completed / (completed + failed)`
- **Avg Duration:** Mean execution time in milliseconds for completed tasks

#### Collaboration Metrics
- **Message Count:** Total messages exchanged between agent pairs
- **Avg Response Time:** Time between consecutive messages in a conversation
- **First Contact / Last Contact:** Temporal bounds of collaboration

#### Bottleneck Metrics
- **Pending Tasks:** Tasks in `pending` or `queued` status
- **Avg Wait Time:** Mean time tasks have been waiting in queue
- **Max Wait Time:** Longest waiting task
- **Stuck Tasks:** Tasks running longer than 30 minutes

#### Cost Metrics
- **Total Cost USD:** Sum of `total_cost_usd` from `token_usage` table
- **Total Calls:** Count of API calls per agent
- **Avg Cost Per Call:** `total_cost / total_calls`
- **Model Distribution:** Breakdown of Haiku/Sonnet/Opus usage
- **Ecomode Usage Rate:** Percentage of calls with ecomode enabled

---

## Example Workflows

### Weekly Health Check

```bash
# Run console analytics for quick overview
pnpm analyze:agents

# Look for:
# - Agents with <70% success rate → investigate failure patterns
# - Stuck tasks → check hung detection thresholds
# - High pending counts → increase concurrency limits
```

### Monthly Cost Review

```bash
# Generate full report with visualizations
pnpm analyze:report

# Open agent-usage-report.md and review:
# - Cost Analysis section for high-spend agents
# - Model Distribution pie chart
# - Recommendations for ecomode candidates
```

### Bottleneck Investigation

```bash
# Run console analytics
pnpm analyze:agents

# Check Bottleneck Analysis section:
# - If pending > 10: increase concurrency_config.max_concurrent
# - If stuck_tasks > 0: review claude-executor.ts stale timeout settings
# - If avg_wait_time > 5min: consider adding gateway instances
```

### Collaboration Audit

```bash
# Generate report
pnpm analyze:report

# Review Collaboration Patterns section:
# - Identify isolated agents (no message exchanges)
# - Review Mermaid graph for unexpected communication flows
# - Check avg_response_time for slow agent pairs
```

---

## Understanding the Output

### Success Rate Thresholds

| Rate | Status | Action |
|------|--------|--------|
| ≥90% | ✅ Healthy | No action needed |
| 70-89% | ⚠️ Monitor | Review failure logs |
| <70% | 🚨 Critical | Immediate investigation required |

### Cost Benchmarks

| Daily Cost | Volume | Optimization Priority |
|------------|--------|----------------------|
| <$0.10 | Low | Low |
| $0.10-$1.00 | Medium | Medium (consider ecomode) |
| >$1.00 | High | High (enable ecomode, review model selection) |

### Queue Depth Guidelines

| Pending Count | Status | Action |
|---------------|--------|--------|
| 0-5 | ✅ Normal | No action |
| 6-10 | ⚠️ Elevated | Monitor |
| >10 | 🚨 Backlog | Increase concurrency or add gateways |

### Stuck Task Thresholds

Any task running longer than **30 minutes** is flagged as stuck. Common causes:

1. **Network hang** — Anthropic API unresponsive (check layer-2 lsof detection)
2. **Infinite loop** — Agent stuck in retry/verification loop
3. **Large output** — Processing massive stdout/stderr (check buffer limits)
4. **User input prompt** — Agent waiting for approval (check system prompts)

---

## Troubleshooting

### No Data in Report

**Symptom:** Empty tables or "No data available" messages

**Causes:**
1. Database tables not initialized
2. No tasks executed yet
3. No `token_usage` records (missing Claude CLI stream-json integration)

**Fix:**
```bash
# Verify database schema
psql life_dashboard -c "\dt"

# Check for existing data
psql life_dashboard -c "SELECT COUNT(*) FROM task_queue;"
psql life_dashboard -c "SELECT COUNT(*) FROM token_usage;"
```

### Inaccurate Cost Data

**Symptom:** `total_cost_usd` is NULL or zero

**Cause:** Token usage not being recorded from Claude CLI result events

**Fix:**
- Ensure `claude-executor.ts` captures `result` event with `total_cost_usd` field
- Verify `recordTokenUsage()` is called in `executeTask()` with correct parameters

### Missing Collaboration Data

**Symptom:** No collaborations shown despite agent activity

**Causes:**
1. Agents not sending messages via `sendMessage()` API
2. All messages are self-messages (`from_id === to_id`)
3. Message threshold too high (currently set to ≥3 messages)

**Fix:**
- Lower threshold in `getCollaborationPatterns()` query (change `HAVING COUNT(*) >= 3` to `>= 2`)
- Verify agents are calling `/api/messages/` endpoint

---

## Advanced Queries

### Custom SQL Analysis

Connect directly to the database for custom queries:

```bash
psql life_dashboard
```

#### Example: Top 5 Most Expensive Tasks (Last 24h)

```sql
SELECT
  t.agent_id,
  t.task_preview,
  t.model,
  t.total_cost_usd,
  t.elapsed_ms / 1000.0 AS elapsed_sec,
  t.created_at
FROM token_usage t
WHERE t.created_at >= NOW() - INTERVAL '24 hours'
  AND t.total_cost_usd IS NOT NULL
ORDER BY t.total_cost_usd DESC
LIMIT 5;
```

#### Example: Agent Failure Patterns

```sql
SELECT
  assigned_agent AS agent_id,
  type AS task_type,
  COUNT(*) AS failure_count,
  ARRAY_AGG(DISTINCT SUBSTRING(error FROM 1 FOR 100)) AS error_samples
FROM task_queue
WHERE status = 'failed'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY assigned_agent, type
ORDER BY failure_count DESC;
```

#### Example: Hourly Activity Distribution

```sql
SELECT
  EXTRACT(HOUR FROM created_at) AS hour_of_day,
  COUNT(*) AS task_count,
  COUNT(*) FILTER (WHERE status = 'completed') AS completed_count
FROM task_queue
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY EXTRACT(HOUR FROM created_at)
ORDER BY hour_of_day;
```

---

## Future Enhancements

Planned features for Agent Analytics v2:

- [ ] Real-time dashboard UI (WebSocket-based live metrics)
- [ ] Cost forecasting based on historical trends
- [ ] Agent performance scoring (composite metric)
- [ ] Automated alerts via Slack/email for critical thresholds
- [ ] Comparative analysis (week-over-week, month-over-month)
- [ ] Export to CSV/JSON for external BI tools
- [ ] Integration with Grafana/Prometheus

---

## Contributing

To add new metrics or visualizations:

1. **Add SQL query** in `scripts/analyze-agent-usage.ts` or `generate-agent-report.ts`
2. **Define interface** for the new metric type
3. **Add section** to console output or markdown report
4. **Update this documentation** with metric definition and use cases

Example:

```typescript
// 1. Add SQL query
async function getNewMetric(): Promise<NewMetric[]> {
  const result = await query<NewMetric>(`
    SELECT ...
    FROM ...
  `);
  return result.rows;
}

// 2. Define interface
interface NewMetric {
  metric_id: string;
  value: number;
}

// 3. Call in main function
const newMetrics = await getNewMetric();

// 4. Add output section
console.log('\n## New Metric\n');
for (const m of newMetrics) {
  console.log(`${m.metric_id}: ${m.value}`);
}
```

---

## References

- Database schema: `sql/` directory
- Token usage tracking: `sql/016_token_usage.sql`
- Task queue design: `sql/002_task_queue.sql`
- Orchestration system: `src/lib/orchestrator.ts`
- Gateway connector: `scripts/gateway-connector.ts`

For questions or issues, contact the Life Dashboard maintainers.
