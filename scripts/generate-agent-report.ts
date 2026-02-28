#!/usr/bin/env tsx
/**
 * Agent Usage Report Generator
 *
 * Generates a comprehensive markdown report with visualizations
 * analyzing agent performance, collaboration, and bottlenecks.
 */

import { query } from '../src/lib/db';
import { writeFileSync } from 'fs';
import { join } from 'path';

interface AgentMetrics {
  workFrequency: any[];
  taskTypes: any[];
  collaborations: any[];
  bottlenecks: any[];
  costs: any[];
  timeSeriesData: any[];
}

async function collectMetrics(): Promise<AgentMetrics> {
  // 1. Work Frequency
  const workFrequency = await query<any>(`
    WITH task_stats AS (
      SELECT
        assigned_agent AS agent_id,
        COUNT(*) AS total_tasks,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_tasks,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed_tasks,
        COUNT(*) FILTER (WHERE status = 'running') AS running_tasks,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::INTEGER AS avg_duration_ms,
        (COUNT(*) FILTER (WHERE status = 'completed')::FLOAT / NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'failed')), 0))::NUMERIC(5,2) AS success_rate
      FROM task_queue
      WHERE assigned_agent IS NOT NULL
      GROUP BY assigned_agent
    )
    SELECT * FROM task_stats ORDER BY total_tasks DESC
  `);

  // 2. Task Type Distribution
  const taskTypes = await query<any>(`
    SELECT
      assigned_agent AS agent_id,
      type AS task_type,
      COUNT(*) AS count,
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::INTEGER AS avg_duration_ms
    FROM task_queue
    WHERE assigned_agent IS NOT NULL AND status IN ('completed', 'failed')
    GROUP BY assigned_agent, type
    ORDER BY count DESC
  `);

  // 3. Collaboration Patterns
  const collaborations = await query<any>(`
    SELECT
      from_id AS from_agent,
      to_id AS to_agent,
      COUNT(*) AS message_count
    FROM messages
    WHERE from_id != to_id
    GROUP BY from_id, to_id
    HAVING COUNT(*) >= 2
    ORDER BY message_count DESC
  `);

  // 4. Bottlenecks
  const bottlenecks = await query<any>(`
    SELECT
      assigned_agent AS agent_id,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending_tasks,
      COUNT(*) FILTER (WHERE status = 'running' AND started_at < NOW() - INTERVAL '30 minutes') AS stuck_tasks
    FROM task_queue
    WHERE assigned_agent IS NOT NULL AND status IN ('pending', 'running')
    GROUP BY assigned_agent
    HAVING COUNT(*) > 0
  `);

  // 5. Cost Analysis
  const costs = await query<any>(`
    SELECT
      agent_id,
      SUM(total_cost_usd) AS total_cost_usd,
      COUNT(*) AS total_calls,
      COUNT(*) FILTER (WHERE model = 'haiku') AS haiku_calls,
      COUNT(*) FILTER (WHERE model = 'sonnet') AS sonnet_calls,
      COUNT(*) FILTER (WHERE model = 'opus') AS opus_calls
    FROM token_usage
    WHERE total_cost_usd IS NOT NULL
    GROUP BY agent_id
    ORDER BY total_cost_usd DESC
  `);

  // 6. Time Series Data (last 7 days)
  const timeSeriesData = await query<any>(`
    SELECT
      DATE(created_at) AS day,
      assigned_agent AS agent_id,
      COUNT(*) AS task_count,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed_count
    FROM task_queue
    WHERE created_at >= NOW() - INTERVAL '7 days'
      AND assigned_agent IS NOT NULL
    GROUP BY DATE(created_at), assigned_agent
    ORDER BY day DESC, task_count DESC
  `);

  return {
    workFrequency: workFrequency.rows,
    taskTypes: taskTypes.rows,
    collaborations: collaborations.rows,
    bottlenecks: bottlenecks.rows,
    costs: costs.rows,
    timeSeriesData: timeSeriesData.rows,
  };
}

function generateMarkdown(metrics: AgentMetrics): string {
  const timestamp = new Date().toISOString();
  let md = `# Agent Usage Analysis Report\n\n`;
  md += `**Generated:** ${new Date(timestamp).toLocaleString()}\n\n`;
  md += `---\n\n`;

  // Executive Summary
  md += `## 📊 Executive Summary\n\n`;
  const totalTasks = metrics.workFrequency.reduce((sum, a) => sum + parseInt(a.total_tasks), 0);
  const totalAgents = metrics.workFrequency.length;
  const totalCost = metrics.costs.reduce((sum, c) => sum + parseFloat(c.total_cost_usd || 0), 0);
  const activeCollaborations = metrics.collaborations.length;

  md += `- **Total Agents Active:** ${totalAgents}\n`;
  md += `- **Total Tasks Executed:** ${totalTasks}\n`;
  md += `- **Total Cost (USD):** $${totalCost.toFixed(4)}\n`;
  md += `- **Active Collaborations:** ${activeCollaborations} agent pairs\n\n`;

  // 1. Agent Work Frequency
  md += `## 📈 Agent Work Frequency\n\n`;
  md += `| Agent ID | Total Tasks | Completed | Failed | Running | Success Rate | Avg Duration |\n`;
  md += `|----------|-------------|-----------|--------|---------|--------------|-------------|\n`;
  for (const agent of metrics.workFrequency) {
    const successRate = agent.success_rate ? `${(agent.success_rate * 100).toFixed(0)}%` : 'N/A';
    const avgDuration = agent.avg_duration_ms > 0 ? `${(agent.avg_duration_ms / 1000).toFixed(1)}s` : 'N/A';
    md += `| ${agent.agent_id} | ${agent.total_tasks} | ${agent.completed_tasks} | ${agent.failed_tasks} | ${agent.running_tasks} | ${successRate} | ${avgDuration} |\n`;
  }
  md += `\n`;

  // 2. Task Type Distribution
  md += `## 📋 Task Type Distribution\n\n`;
  const tasksByAgent = metrics.taskTypes.reduce((acc, task) => {
    if (!acc[task.agent_id]) acc[task.agent_id] = [];
    acc[task.agent_id].push(task);
    return acc;
  }, {} as Record<string, any[]>);

  for (const [agentId, tasks] of Object.entries(tasksByAgent)) {
    md += `### ${agentId}\n\n`;
    md += `| Task Type | Count | Avg Duration |\n`;
    md += `|-----------|-------|-------------|\n`;
    for (const task of tasks) {
      const avgDuration = task.avg_duration_ms > 0 ? `${(task.avg_duration_ms / 1000).toFixed(1)}s` : 'N/A';
      md += `| ${task.task_type} | ${task.count} | ${avgDuration} |\n`;
    }
    md += `\n`;
  }

  // 3. Collaboration Network
  md += `## 🤝 Collaboration Patterns\n\n`;
  md += `Top agent-to-agent message exchanges:\n\n`;
  md += `| From Agent | To Agent | Message Count |\n`;
  md += `|------------|----------|---------------|\n`;
  for (const collab of metrics.collaborations.slice(0, 15)) {
    md += `| ${collab.from_agent} | ${collab.to_agent} | ${collab.message_count} |\n`;
  }
  md += `\n`;

  // Mermaid collaboration graph
  if (metrics.collaborations.length > 0) {
    md += `### Collaboration Network Graph\n\n`;
    md += '```mermaid\n';
    md += 'graph LR\n';
    const topCollabs = metrics.collaborations.slice(0, 10);
    for (const collab of topCollabs) {
      const fromNode = collab.from_agent.replace(/[^a-zA-Z0-9]/g, '_');
      const toNode = collab.to_agent.replace(/[^a-zA-Z0-9]/g, '_');
      md += `  ${fromNode}["${collab.from_agent}"] -->|${collab.message_count}| ${toNode}["${collab.to_agent}"]\n`;
    }
    md += '```\n\n';
  }

  // 4. Bottleneck Analysis
  md += `## ⚠️ Bottleneck Analysis\n\n`;
  if (metrics.bottlenecks.length === 0) {
    md += `✅ No bottlenecks detected. All agents have healthy queue depths.\n\n`;
  } else {
    md += `| Agent ID | Pending Tasks | Stuck Tasks (>30min) |\n`;
    md += `|----------|---------------|----------------------|\n`;
    for (const bn of metrics.bottlenecks) {
      md += `| ${bn.agent_id} | ${bn.pending_tasks} | ${bn.stuck_tasks} |\n`;
    }
    md += `\n`;

    // Warnings
    const highPendingAgents = metrics.bottlenecks.filter(bn => bn.pending_tasks > 5);
    const stuckAgents = metrics.bottlenecks.filter(bn => bn.stuck_tasks > 0);

    if (highPendingAgents.length > 0) {
      md += `### ⚠️ High Queue Depth\n\n`;
      md += `The following agents have high pending task counts:\n\n`;
      for (const agent of highPendingAgents) {
        md += `- **${agent.agent_id}**: ${agent.pending_tasks} pending tasks\n`;
      }
      md += `\n`;
    }

    if (stuckAgents.length > 0) {
      md += `### 🚨 Stuck Tasks\n\n`;
      md += `The following agents have tasks running longer than 30 minutes:\n\n`;
      for (const agent of stuckAgents) {
        md += `- **${agent.agent_id}**: ${agent.stuck_tasks} stuck task(s)\n`;
      }
      md += `\n`;
    }
  }

  // 5. Cost Analysis
  md += `## 💰 Cost Analysis\n\n`;
  if (metrics.costs.length === 0) {
    md += `No cost data available.\n\n`;
  } else {
    md += `| Agent ID | Total Cost (USD) | Calls | Haiku | Sonnet | Opus |\n`;
    md += `|----------|------------------|-------|-------|--------|------|\n`;
    for (const cost of metrics.costs) {
      const totalCost = parseFloat(cost.total_cost_usd || 0);
      md += `| ${cost.agent_id} | $${totalCost.toFixed(4)} | ${cost.total_calls} | ${cost.haiku_calls} | ${cost.sonnet_calls} | ${cost.opus_calls} |\n`;
    }
    md += `\n`;

    // Cost distribution pie chart (using mermaid)
    const totalModelCalls = metrics.costs.reduce((sum, c) =>
      sum + parseInt(c.haiku_calls) + parseInt(c.sonnet_calls) + parseInt(c.opus_calls), 0
    );
    const haikuTotal = metrics.costs.reduce((sum, c) => sum + parseInt(c.haiku_calls), 0);
    const sonnetTotal = metrics.costs.reduce((sum, c) => sum + parseInt(c.sonnet_calls), 0);
    const opusTotal = metrics.costs.reduce((sum, c) => sum + parseInt(c.opus_calls), 0);

    md += `### Model Distribution\n\n`;
    md += '```mermaid\n';
    md += 'pie title Model Usage Distribution\n';
    md += `  "Haiku" : ${haikuTotal}\n`;
    md += `  "Sonnet" : ${sonnetTotal}\n`;
    md += `  "Opus" : ${opusTotal}\n`;
    md += '```\n\n';
  }

  // 6. Activity Timeline
  md += `## 📅 Activity Timeline (Last 7 Days)\n\n`;
  if (metrics.timeSeriesData.length === 0) {
    md += `No recent activity data.\n\n`;
  } else {
    // Group by day
    const byDay = metrics.timeSeriesData.reduce((acc, row) => {
      const day = row.day.toISOString().split('T')[0];
      if (!acc[day]) acc[day] = { total: 0, completed: 0 };
      acc[day].total += parseInt(row.task_count);
      acc[day].completed += parseInt(row.completed_count);
      return acc;
    }, {} as Record<string, { total: number; completed: number }>);

    md += `| Date | Total Tasks | Completed |\n`;
    md += `|------|-------------|------------|\n`;
    for (const [day, stats] of Object.entries(byDay)) {
      md += `| ${day} | ${stats.total} | ${stats.completed} |\n`;
    }
    md += `\n`;
  }

  // 7. Recommendations
  md += `## 💡 Recommendations\n\n`;
  const recommendations: string[] = [];

  // Check for high-cost agents
  const highCostAgents = metrics.costs.filter(c => parseFloat(c.total_cost_usd) > 0.10);
  if (highCostAgents.length > 0) {
    recommendations.push(`- **Cost Optimization**: Consider enabling ecomode for high-cost agents: ${highCostAgents.map(a => a.agent_id).join(', ')}`);
  }

  // Check for low success rates
  const lowSuccessAgents = metrics.workFrequency.filter(a => a.success_rate < 0.7 && parseInt(a.total_tasks) >= 5);
  if (lowSuccessAgents.length > 0) {
    recommendations.push(`- **Reliability Issue**: Investigate failure patterns for: ${lowSuccessAgents.map(a => a.agent_id).join(', ')}`);
  }

  // Check for stuck tasks
  const totalStuck = metrics.bottlenecks.reduce((sum, bn) => sum + parseInt(bn.stuck_tasks), 0);
  if (totalStuck > 0) {
    recommendations.push(`- **Hung Detection**: ${totalStuck} task(s) running longer than 30 minutes. Consider adjusting timeout settings or investigating hung processes.`);
  }

  // Check for pending backlog
  const totalPending = metrics.bottlenecks.reduce((sum, bn) => sum + parseInt(bn.pending_tasks), 0);
  if (totalPending > 10) {
    recommendations.push(`- **Queue Backlog**: ${totalPending} pending tasks. Consider increasing concurrency limits or adding more gateway instances.`);
  }

  // Check for isolated agents (no collaboration)
  const collaboratingAgents = new Set([
    ...metrics.collaborations.map(c => c.from_agent),
    ...metrics.collaborations.map(c => c.to_agent),
  ]);
  const isolatedAgents = metrics.workFrequency
    .map(a => a.agent_id)
    .filter(id => !collaboratingAgents.has(id));
  if (isolatedAgents.length > 0) {
    recommendations.push(`- **Isolated Agents**: The following agents have no message exchanges with others: ${isolatedAgents.join(', ')}. Consider enabling inter-agent communication for better coordination.`);
  }

  if (recommendations.length === 0) {
    md += `✅ System is performing well. No critical issues detected.\n\n`;
  } else {
    recommendations.forEach((rec, i) => {
      md += `${i + 1}. ${rec}\n`;
    });
    md += `\n`;
  }

  md += `---\n\n`;
  md += `*Report generated by Life Dashboard Analytics at ${new Date(timestamp).toLocaleString()}*\n`;

  return md;
}

async function main() {
  console.log('📊 Collecting agent usage metrics...\n');

  const metrics = await collectMetrics();

  console.log('✍️  Generating report...\n');

  const markdown = generateMarkdown(metrics);

  const outputPath = join(process.cwd(), 'agent-usage-report.md');
  writeFileSync(outputPath, markdown, 'utf-8');

  console.log(`✅ Report generated: ${outputPath}\n`);
  console.log('📖 Open the file to view detailed analysis with visualizations.\n');
}

main().catch((error) => {
  console.error('❌ Report generation failed:', error);
  process.exit(1);
});
