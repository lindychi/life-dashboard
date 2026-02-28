# Token Optimization — Before/After Measurement Plan

## Overview

This document outlines the methodology for measuring cost optimization effectiveness of the OMC token optimization system integrated into Life Dashboard's agent infrastructure.

## Phase 0: Baseline Collection (Pre-Optimization)

### Duration: 1 week (normal operations)

Before enabling any optimization features, collect baseline metrics with the new `token_usage` table tracking all agent task executions at the current default (all sonnet, no model routing).

#### Configuration
```env
DISABLE_MODEL_ROUTING=true    # All tasks use default model (sonnet)
ENABLE_TOKEN_TRACKING=true    # Record all metrics to token_usage table
DEFAULT_ECOMODE=false
```

#### Metrics to Collect (Automatic via token_usage table)
| Metric | Source | Purpose |
|---|---|---|
| Cost per task | `total_cost_usd` from Claude CLI result event | Baseline API cost |
| Elapsed time per task | `elapsed_ms` from executor | Baseline latency |
| API duration per task | `duration_api_ms` from CLI result event | API-measured duration |
| Tool calls per task | `tool_calls_count` | Baseline tool usage |
| Success/failure rate | `success` column | Baseline reliability |
| Hung task rate | `is_hung` column | Baseline timeout issues |
| Task complexity distribution | `complexity_score` (still computed, just not acted on) | Understand workload profile |
| Agent task distribution | `agent_id` column | Per-agent workload |

#### Baseline Queries

```sql
-- Baseline summary (run at end of Phase 0)
SELECT
  COUNT(*) as total_tasks,
  ROUND(AVG(total_cost_usd)::numeric, 6) as avg_cost_per_task,
  ROUND(SUM(total_cost_usd)::numeric, 4) as total_cost,
  ROUND(AVG(elapsed_ms)::numeric, 0) as avg_elapsed_ms,
  ROUND(AVG(CASE WHEN success THEN 1 ELSE 0 END)::numeric * 100, 1) as success_rate_pct,
  ROUND(AVG(CASE WHEN is_hung THEN 1 ELSE 0 END)::numeric * 100, 1) as hung_rate_pct,
  ROUND(AVG(complexity_score)::numeric, 1) as avg_complexity_score,
  ROUND(AVG(tool_calls_count)::numeric, 1) as avg_tool_calls,
  ROUND(AVG(retry_count)::numeric, 2) as avg_retries
FROM token_usage
WHERE created_at >= NOW() - INTERVAL '7 days';

-- Per-agent baseline
SELECT
  agent_id,
  COUNT(*) as tasks,
  ROUND(AVG(total_cost_usd)::numeric, 6) as avg_cost,
  ROUND(AVG(elapsed_ms)::numeric, 0) as avg_ms,
  ROUND(AVG(complexity_score)::numeric, 1) as avg_complexity,
  ROUND(AVG(CASE WHEN success THEN 1 ELSE 0 END)::numeric * 100, 1) as success_pct
FROM token_usage
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY agent_id
ORDER BY tasks DESC;
```

## Phase 1: Smart Model Routing Only

### Duration: 1 week

Enable model routing but keep ecomode off. This isolates the effect of automatic haiku/sonnet/opus selection.

#### Configuration
```env
DISABLE_MODEL_ROUTING=false   # Enable model routing
ENABLE_TOKEN_TRACKING=true
DEFAULT_ECOMODE=false
```

#### What Changes
- Simple queries → haiku (faster, cheaper)
- Standard tasks → sonnet (same as baseline)
- Complex tasks → opus (better quality, more expensive)
- Stale timeouts → model-adjusted (haiku shorter, opus longer)

#### Key Comparison Queries

```sql
-- Phase 1 vs Baseline: model distribution
SELECT
  model,
  COUNT(*) as tasks,
  ROUND(AVG(total_cost_usd)::numeric, 6) as avg_cost,
  ROUND(AVG(elapsed_ms)::numeric, 0) as avg_ms,
  ROUND(AVG(CASE WHEN success THEN 1 ELSE 0 END)::numeric * 100, 1) as success_pct,
  ROUND(AVG(CASE WHEN is_hung THEN 1 ELSE 0 END)::numeric * 100, 1) as hung_pct
FROM token_usage
WHERE created_at >= NOW() - INTERVAL '7 days'
  AND model_source = 'analysis'  -- Only auto-routed tasks
GROUP BY model;

-- Cost comparison: this week vs last week
WITH
  baseline AS (
    SELECT SUM(total_cost_usd) as cost, COUNT(*) as tasks
    FROM token_usage
    WHERE created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'
  ),
  current AS (
    SELECT SUM(total_cost_usd) as cost, COUNT(*) as tasks
    FROM token_usage
    WHERE created_at >= NOW() - INTERVAL '7 days'
  )
SELECT
  ROUND(baseline.cost::numeric, 4) as baseline_cost,
  ROUND(current.cost::numeric, 4) as current_cost,
  baseline.tasks as baseline_tasks,
  current.tasks as current_tasks,
  ROUND(((baseline.cost - current.cost) / NULLIF(baseline.cost, 0) * 100)::numeric, 1) as savings_pct
FROM baseline, current;
```

#### Success Criteria
- [ ] Cost per task decreased by 15-30%
- [ ] Success rate maintained or improved
- [ ] Hung task rate decreased (better-tuned timeouts)
- [ ] Haiku tasks complete 50-70% faster than baseline

## Phase 2: Ecomode Comparison

### Duration: 2 weeks (alternating days or A/B split)

Run ecomode on/off for comparable workloads. Use the `ecomode` column for clean comparison.

#### Configuration
```env
DISABLE_MODEL_ROUTING=false
ENABLE_TOKEN_TRACKING=true
DEFAULT_ECOMODE=false    # Not enabled by default — enable per-command or on specific days
```

#### Methodology: A/B Day Split
- Even days: `ecomode=false` (normal routing)
- Odd days: `ecomode=true` (eco routing)

Or trigger ecomode explicitly via MCP:
```json
{ "type": "spawn", "payload": { "agentId": "dev", "task": "...", "ecomode": true } }
```

#### Key Comparison Query

```sql
-- Ecomode A/B comparison
SELECT * FROM token_usage_ecomode_comparison(14);

-- Or manual:
SELECT
  ecomode,
  COUNT(*) as tasks,
  ROUND(AVG(total_cost_usd)::numeric, 6) as avg_cost,
  ROUND(SUM(total_cost_usd)::numeric, 4) as total_cost,
  ROUND(AVG(elapsed_ms)::numeric, 0) as avg_ms,
  ROUND(AVG(CASE WHEN success THEN 1 ELSE 0 END)::numeric * 100, 1) as success_pct,
  ROUND(AVG(CASE WHEN was_escalated THEN 1 ELSE 0 END)::numeric * 100, 1) as escalation_pct,
  ROUND(AVG(retry_count)::numeric, 2) as avg_retries
FROM token_usage
WHERE created_at >= NOW() - INTERVAL '14 days'
GROUP BY ecomode;
```

#### Escalation Analysis

```sql
-- How often does ecomode need to escalate? What's the cost?
SELECT
  escalated_from,
  model as escalated_to,
  COUNT(*) as escalations,
  ROUND(AVG(total_cost_usd)::numeric, 6) as avg_cost,
  ROUND(AVG(CASE WHEN success THEN 1 ELSE 0 END)::numeric * 100, 1) as success_after_escalation
FROM token_usage
WHERE was_escalated = true
  AND created_at >= NOW() - INTERVAL '14 days'
GROUP BY escalated_from, model;
```

#### Success Criteria
- [ ] Ecomode saves 20-30% additional cost vs Phase 1
- [ ] Escalation rate < 15% (ecomode isn't causing excessive retries)
- [ ] Success rate >= 90% even in ecomode
- [ ] Ecomode latency not worse than 2x normal for same agent

## Phase 3: Full Optimization (Steady State)

### Duration: Ongoing

All optimizations enabled. Track weekly/monthly trends.

#### Configuration
```env
DISABLE_MODEL_ROUTING=false
ENABLE_TOKEN_TRACKING=true
DEFAULT_ECOMODE=false    # Leave off by default, enable per-command when budget matters
```

#### Weekly Dashboard Query

```sql
-- Weekly trend (last 4 weeks)
SELECT * FROM token_usage_daily_summary(28);

-- Monthly agent summary
SELECT * FROM token_usage_agent_summary(30);
```

## API Endpoints for Monitoring

All available at `/api/token-usage`:

| Endpoint | Purpose |
|---|---|
| `GET /api/token-usage?view=overview&days=7` | Dashboard widget: total cost, model distribution, success rate |
| `GET /api/token-usage?view=daily&days=7` | Daily cost chart |
| `GET /api/token-usage?view=agents&days=30` | Per-agent cost table |
| `GET /api/token-usage?view=models&days=7` | Model distribution pie chart |
| `GET /api/token-usage?view=ecomode&days=30` | Ecomode vs normal comparison |
| `GET /api/token-usage?view=recent&agentId=dev&limit=20` | Recent task log |

## Key Metrics to Track

| Metric | Target | Measurement |
|---|---|---|
| Total API cost reduction | 35-50% vs baseline | `SUM(total_cost_usd)` weekly |
| Avg response time (simple tasks) | -50% (haiku effect) | `AVG(elapsed_ms) WHERE complexity_score < 15` |
| Success rate | >= 95% | `AVG(success)` |
| Hung task rate | -30% (better timeouts) | `AVG(is_hung)` |
| Ecomode savings | 20-30% additional | Compare `ecomode=true` vs `false` |
| Model accuracy | < 10% escalation rate | `AVG(was_escalated)` |
| Quality (subjective) | No degradation | Manual review of agent outputs |

## Rollback Plan

If optimization degrades quality or reliability:

1. **Quick disable**: Set `DISABLE_MODEL_ROUTING=true` → all tasks use default model
2. **Soft cap**: Set `GLOBAL_MODEL_CAP=sonnet` → prevents haiku usage
3. **Per-agent**: Set `maxModel: "sonnet"` in agents.json for specific agents
4. **Full rollback**: Revert gateway-connector to pre-optimization code (model routing is isolated in separate modules)

All token_usage data is preserved regardless of routing config changes, enabling post-hoc analysis of what worked.
