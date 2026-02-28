#!/usr/bin/env tsx
/**
 * Agent Usage Analytics
 *
 * Analyzes agent_history, messages, task_queue, task_executions, and token_usage
 * to provide insights on:
 * - Agent work frequency and volume
 * - Task type distribution
 * - Collaboration patterns (message exchanges)
 * - Bottleneck identification (queue depth, failure rates)
 * - Cost and performance metrics
 */

import { query } from '../src/lib/db';

interface AgentWorkFrequency {
  agent_id: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  running_tasks: number;
  avg_duration_ms: number;
  success_rate: number;
  first_seen: Date;
  last_seen: Date;
}

interface TaskTypeDistribution {
  agent_id: string;
  task_type: string;
  count: number;
  avg_duration_ms: number;
  failure_rate: number;
}

interface CollaborationPattern {
  from_agent: string;
  to_agent: string;
  message_count: number;
  first_contact: Date;
  last_contact: Date;
  avg_response_time_minutes: number;
}

interface BottleneckAnalysis {
  agent_id: string;
  pending_tasks: number;
  avg_wait_time_minutes: number;
  max_wait_time_minutes: number;
  stuck_tasks: number; // running > 30min
}

interface CostAnalysis {
  agent_id: string;
  total_cost_usd: number;
  total_calls: number;
  avg_cost_per_call: number;
  model_distribution: { haiku: number; sonnet: number; opus: number };
  ecomode_usage_rate: number;
}

async function getAgentWorkFrequency(): Promise<AgentWorkFrequency[]> {
  const result = await query<AgentWorkFrequency>(`
    WITH task_stats AS (
      SELECT
        assigned_agent AS agent_id,
        COUNT(*) AS total_tasks,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_tasks,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed_tasks,
        COUNT(*) FILTER (WHERE status = 'running') AS running_tasks,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::INTEGER AS avg_duration_ms,
        (COUNT(*) FILTER (WHERE status = 'completed')::FLOAT / NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'failed')), 0))::NUMERIC(5,2) AS success_rate,
        MIN(created_at) AS first_seen,
        MAX(created_at) AS last_seen
      FROM task_queue
      WHERE assigned_agent IS NOT NULL
      GROUP BY assigned_agent
    ),
    history_stats AS (
      SELECT
        agent_id,
        MIN(created_at) AS first_history,
        MAX(created_at) AS last_history
      FROM agent_history
      GROUP BY agent_id
    )
    SELECT
      COALESCE(t.agent_id, h.agent_id) AS agent_id,
      COALESCE(t.total_tasks, 0) AS total_tasks,
      COALESCE(t.completed_tasks, 0) AS completed_tasks,
      COALESCE(t.failed_tasks, 0) AS failed_tasks,
      COALESCE(t.running_tasks, 0) AS running_tasks,
      COALESCE(t.avg_duration_ms, 0) AS avg_duration_ms,
      COALESCE(t.success_rate, 0) AS success_rate,
      LEAST(t.first_seen, h.first_history) AS first_seen,
      GREATEST(t.last_seen, h.last_history) AS last_seen
    FROM task_stats t
    FULL OUTER JOIN history_stats h ON t.agent_id = h.agent_id
    ORDER BY total_tasks DESC NULLS LAST
  `);
  return result;
}

async function getTaskTypeDistribution(): Promise<TaskTypeDistribution[]> {
  const result = await query<TaskTypeDistribution>(`
    SELECT
      assigned_agent AS agent_id,
      type AS task_type,
      COUNT(*) AS count,
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::INTEGER AS avg_duration_ms,
      (COUNT(*) FILTER (WHERE status = 'failed')::FLOAT / COUNT(*))::NUMERIC(5,2) AS failure_rate
    FROM task_queue
    WHERE assigned_agent IS NOT NULL
      AND status IN ('completed', 'failed')
    GROUP BY assigned_agent, type
    ORDER BY assigned_agent, count DESC
  `);
  return result.rows;
}

async function getCollaborationPatterns(): Promise<CollaborationPattern[]> {
  const result = await query<CollaborationPattern>(`
    WITH message_pairs AS (
      SELECT
        from_id,
        to_id,
        created_at,
        LAG(created_at) OVER (PARTITION BY from_id, to_id ORDER BY created_at) AS prev_message_at
      FROM messages
      WHERE from_id != to_id  -- exclude self-messages
    )
    SELECT
      from_id AS from_agent,
      to_id AS to_agent,
      COUNT(*) AS message_count,
      MIN(created_at) AS first_contact,
      MAX(created_at) AS last_contact,
      AVG(EXTRACT(EPOCH FROM (created_at - prev_message_at)) / 60)::INTEGER AS avg_response_time_minutes
    FROM message_pairs
    GROUP BY from_id, to_id
    HAVING COUNT(*) >= 3  -- Only show meaningful collaborations
    ORDER BY message_count DESC
  `);
  return result.rows;
}

async function getBottleneckAnalysis(): Promise<BottleneckAnalysis[]> {
  const result = await query<BottleneckAnalysis>(`
    SELECT
      assigned_agent AS agent_id,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending_tasks,
      AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60)::INTEGER AS avg_wait_time_minutes,
      MAX(EXTRACT(EPOCH FROM (NOW() - created_at)) / 60)::INTEGER AS max_wait_time_minutes,
      COUNT(*) FILTER (WHERE status = 'running' AND started_at < NOW() - INTERVAL '30 minutes') AS stuck_tasks
    FROM task_queue
    WHERE assigned_agent IS NOT NULL
      AND status IN ('pending', 'queued', 'running')
    GROUP BY assigned_agent
    HAVING COUNT(*) > 0
    ORDER BY pending_tasks DESC
  `);
  return result.rows;
}

async function getCostAnalysis(): Promise<CostAnalysis[]> {
  const result = await query<any>(`
    SELECT
      agent_id,
      SUM(total_cost_usd) AS total_cost_usd,
      COUNT(*) AS total_calls,
      (SUM(total_cost_usd) / NULLIF(COUNT(*), 0))::NUMERIC(10,6) AS avg_cost_per_call,
      COUNT(*) FILTER (WHERE model = 'haiku') AS haiku_calls,
      COUNT(*) FILTER (WHERE model = 'sonnet') AS sonnet_calls,
      COUNT(*) FILTER (WHERE model = 'opus') AS opus_calls,
      (COUNT(*) FILTER (WHERE ecomode)::FLOAT / NULLIF(COUNT(*), 0))::NUMERIC(5,2) AS ecomode_usage_rate
    FROM token_usage
    WHERE total_cost_usd IS NOT NULL
    GROUP BY agent_id
    ORDER BY total_cost_usd DESC
  `);

  return result.rows.map((row: any) => ({
    agent_id: row.agent_id,
    total_cost_usd: parseFloat(row.total_cost_usd),
    total_calls: parseInt(row.total_calls),
    avg_cost_per_call: parseFloat(row.avg_cost_per_call),
    model_distribution: {
      haiku: parseInt(row.haiku_calls),
      sonnet: parseInt(row.sonnet_calls),
      opus: parseInt(row.opus_calls),
    },
    ecomode_usage_rate: parseFloat(row.ecomode_usage_rate),
  }));
}

async function analyzeAgentUsage() {
  console.log('📊 Agent Usage Analytics Report\n');
  console.log('=' .repeat(80));

  // 1. Work Frequency Analysis
  console.log('\n📈 1. AGENT WORK FREQUENCY\n');
  const workFrequency = await getAgentWorkFrequency();

  if (workFrequency.length === 0) {
    console.log('  No agent activity found.');
  } else {
    console.log('  Agent ID                   | Tasks | Completed | Failed | Running | Success% | Avg Duration');
    console.log('  ' + '-'.repeat(78));
    for (const agent of workFrequency) {
      const successRate = (agent.success_rate * 100).toFixed(0) + '%';
      const avgDuration = agent.avg_duration_ms > 0
        ? `${(agent.avg_duration_ms / 1000).toFixed(1)}s`
        : 'N/A';
      console.log(
        `  ${agent.agent_id.padEnd(25)} | ${String(agent.total_tasks).padStart(5)} | ${String(agent.completed_tasks).padStart(9)} | ${String(agent.failed_tasks).padStart(6)} | ${String(agent.running_tasks).padStart(7)} | ${successRate.padStart(8)} | ${avgDuration.padStart(12)}`
      );
    }
  }

  // 2. Task Type Distribution
  console.log('\n\n📋 2. TASK TYPE DISTRIBUTION\n');
  const taskTypes = await getTaskTypeDistribution();

  if (taskTypes.length === 0) {
    console.log('  No task type data available.');
  } else {
    let currentAgent = '';
    for (const task of taskTypes) {
      if (task.agent_id !== currentAgent) {
        currentAgent = task.agent_id;
        console.log(`\n  ${currentAgent}:`);
      }
      const failRate = (task.failure_rate * 100).toFixed(0) + '%';
      const avgDuration = task.avg_duration_ms > 0
        ? `${(task.avg_duration_ms / 1000).toFixed(1)}s`
        : 'N/A';
      console.log(
        `    ${task.task_type.padEnd(20)} | Count: ${String(task.count).padStart(4)} | Fail: ${failRate.padStart(4)} | Avg: ${avgDuration}`
      );
    }
  }

  // 3. Collaboration Patterns
  console.log('\n\n🤝 3. COLLABORATION PATTERNS (Top 10)\n');
  const collaborations = await getCollaborationPatterns();

  if (collaborations.length === 0) {
    console.log('  No collaboration data found.');
  } else {
    console.log('  From → To                      | Messages | Avg Response Time | Active Period');
    console.log('  ' + '-'.repeat(78));
    for (const collab of collaborations.slice(0, 10)) {
      const pair = `${collab.from_agent} → ${collab.to_agent}`.padEnd(30);
      const responseTime = collab.avg_response_time_minutes
        ? `${collab.avg_response_time_minutes}min`
        : 'N/A';
      const activeDays = Math.floor(
        (collab.last_contact.getTime() - collab.first_contact.getTime()) / (1000 * 60 * 60 * 24)
      );
      console.log(
        `  ${pair} | ${String(collab.message_count).padStart(8)} | ${responseTime.padStart(17)} | ${activeDays} days`
      );
    }
  }

  // 4. Bottleneck Analysis
  console.log('\n\n⚠️  4. BOTTLENECK ANALYSIS\n');
  const bottlenecks = await getBottleneckAnalysis();

  if (bottlenecks.length === 0) {
    console.log('  ✅ No bottlenecks detected (no pending/stuck tasks).');
  } else {
    console.log('  Agent ID                   | Pending | Avg Wait | Max Wait | Stuck (>30min)');
    console.log('  ' + '-'.repeat(78));
    for (const bn of bottlenecks) {
      const avgWait = `${bn.avg_wait_time_minutes}min`;
      const maxWait = `${bn.max_wait_time_minutes}min`;
      console.log(
        `  ${bn.agent_id.padEnd(25)} | ${String(bn.pending_tasks).padStart(7)} | ${avgWait.padStart(8)} | ${maxWait.padStart(8)} | ${String(bn.stuck_tasks).padStart(14)}`
      );
    }
  }

  // 5. Cost Analysis
  console.log('\n\n💰 5. COST ANALYSIS (Top 10 by Spend)\n');
  const costs = await getCostAnalysis();

  if (costs.length === 0) {
    console.log('  No cost data available.');
  } else {
    console.log('  Agent ID                   | Total Cost | Calls | Avg/Call | Haiku | Sonnet | Opus | Eco%');
    console.log('  ' + '-'.repeat(95));
    for (const cost of costs.slice(0, 10)) {
      const totalCost = `$${cost.total_cost_usd.toFixed(4)}`;
      const avgCost = `$${cost.avg_cost_per_call.toFixed(5)}`;
      const ecoRate = (cost.ecomode_usage_rate * 100).toFixed(0) + '%';
      console.log(
        `  ${cost.agent_id.padEnd(25)} | ${totalCost.padStart(10)} | ${String(cost.total_calls).padStart(5)} | ${avgCost.padStart(8)} | ${String(cost.model_distribution.haiku).padStart(5)} | ${String(cost.model_distribution.sonnet).padStart(6)} | ${String(cost.model_distribution.opus).padStart(4)} | ${ecoRate.padStart(4)}`
      );
    }

    // Summary stats
    const totalCost = costs.reduce((sum, c) => sum + c.total_cost_usd, 0);
    const totalCalls = costs.reduce((sum, c) => sum + c.total_calls, 0);
    const totalHaiku = costs.reduce((sum, c) => sum + c.model_distribution.haiku, 0);
    const totalSonnet = costs.reduce((sum, c) => sum + c.model_distribution.sonnet, 0);
    const totalOpus = costs.reduce((sum, c) => sum + c.model_distribution.opus, 0);

    console.log('  ' + '-'.repeat(95));
    console.log(
      `  ${'TOTAL'.padEnd(25)} | ${`$${totalCost.toFixed(4)}`.padStart(10)} | ${String(totalCalls).padStart(5)} | ${`$${(totalCost / totalCalls).toFixed(5)}`.padStart(8)} | ${String(totalHaiku).padStart(5)} | ${String(totalSonnet).padStart(6)} | ${String(totalOpus).padStart(4)} |`
    );
  }

  // 6. Key Insights
  console.log('\n\n💡 6. KEY INSIGHTS\n');

  const insights: string[] = [];

  // Most active agent
  if (workFrequency.length > 0) {
    const mostActive = workFrequency[0];
    insights.push(`  🔥 Most active agent: ${mostActive.agent_id} (${mostActive.total_tasks} tasks)`);
  }

  // Highest failure rate
  const highFailureAgents = workFrequency.filter(a => a.success_rate < 0.7 && a.total_tasks >= 5);
  if (highFailureAgents.length > 0) {
    const worst = highFailureAgents[0];
    insights.push(`  ⚠️  High failure rate: ${worst.agent_id} (${(worst.success_rate * 100).toFixed(0)}% success)`);
  }

  // Busiest collaboration
  if (collaborations.length > 0) {
    const busiest = collaborations[0];
    insights.push(`  🤝 Busiest collaboration: ${busiest.from_agent} → ${busiest.to_agent} (${busiest.message_count} messages)`);
  }

  // Most expensive agent
  if (costs.length > 0) {
    const expensive = costs[0];
    insights.push(`  💸 Highest cost: ${expensive.agent_id} ($${expensive.total_cost_usd.toFixed(4)} over ${expensive.total_calls} calls)`);
  }

  // Stuck tasks warning
  const stuckTasks = bottlenecks.reduce((sum, bn) => sum + bn.stuck_tasks, 0);
  if (stuckTasks > 0) {
    insights.push(`  ⏱️  ${stuckTasks} task(s) running longer than 30 minutes (may be stuck)`);
  }

  // Pending queue depth
  const totalPending = bottlenecks.reduce((sum, bn) => sum + bn.pending_tasks, 0);
  if (totalPending > 10) {
    insights.push(`  📦 High queue depth: ${totalPending} pending tasks across all agents`);
  }

  if (insights.length === 0) {
    console.log('  ✅ System is healthy. No critical issues detected.');
  } else {
    insights.forEach(insight => console.log(insight));
  }

  console.log('\n' + '='.repeat(80) + '\n');
}

// Execute analysis
analyzeAgentUsage().catch((error) => {
  console.error('❌ Analysis failed:', error);
  process.exit(1);
});
