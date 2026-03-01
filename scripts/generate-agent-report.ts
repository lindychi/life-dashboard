#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
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
  roadmapKpis: RoadmapKpis | null;
  modelPromotions: any[];
}

interface RoadmapKpis {
  qa_success_rate: number;
  overall_success_rate: number;
  hung_timeout_rate: number;
  opus_usage_rate: number;
  total_tasks_in_window: number;
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

  // 7. B-2 Roadmap KPI metrics from agent_task_results + task_executions
  let roadmapKpis: RoadmapKpis | null = null;
  try {
    const kpiResult = await query<any>(`
      SELECT
        (COUNT(*) FILTER (WHERE agent_id = 'qa' AND status = 'success')::FLOAT
          / NULLIF(COUNT(*) FILTER (WHERE agent_id = 'qa'), 0))::NUMERIC(5,4) AS qa_success_rate,
        (COUNT(*) FILTER (WHERE status = 'success')::FLOAT
          / NULLIF(COUNT(*), 0))::NUMERIC(5,4) AS overall_success_rate,
        (COUNT(*) FILTER (WHERE model_used = 'opus')::FLOAT
          / NULLIF(COUNT(*), 0))::NUMERIC(5,4) AS opus_usage_rate,
        COUNT(*) AS total_tasks_in_window
      FROM agent_task_results
    `);
    const hungResult = await query<any>(`
      SELECT
        (COUNT(*) FILTER (WHERE exit_code = -2)::FLOAT
          / NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'failed', 'dead_letter')), 0))::NUMERIC(5,4)
          AS hung_timeout_rate
      FROM task_executions
    `);
    const krow = kpiResult.rows[0] || {};
    const hrow = hungResult.rows[0] || {};
    roadmapKpis = {
      qa_success_rate: parseFloat(krow.qa_success_rate ?? '0'),
      overall_success_rate: parseFloat(krow.overall_success_rate ?? '0'),
      hung_timeout_rate: parseFloat(hrow.hung_timeout_rate ?? '0'),
      opus_usage_rate: parseFloat(krow.opus_usage_rate ?? '0'),
      total_tasks_in_window: parseInt(krow.total_tasks_in_window ?? '0'),
    };
  } catch {
    // Tables may not exist yet; omit section from report
    roadmapKpis = null;
  }

  // 8. Model Promotion History
  let modelPromotions: any[] = [];
  try {
    const promoResult = await query<any>(`
      SELECT
        agent_id,
        COUNT(*) AS total_promotions,
        MAX(promoted_at) AS last_promotion_at,
        (ARRAY_AGG(from_model ORDER BY promoted_at DESC))[1] AS from_model,
        (ARRAY_AGG(to_model ORDER BY promoted_at DESC))[1] AS to_model
      FROM agent_model_promotions
      GROUP BY agent_id
      ORDER BY total_promotions DESC
    `);
    modelPromotions = promoResult.rows;
  } catch {
    modelPromotions = [];
  }

  return {
    workFrequency: workFrequency.rows,
    taskTypes: taskTypes.rows,
    collaborations: collaborations.rows,
    bottlenecks: bottlenecks.rows,
    costs: costs.rows,
    timeSeriesData: timeSeriesData.rows,
    roadmapKpis,
    modelPromotions,
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
    const _totalModelCalls = metrics.costs.reduce((sum: number, c: Record<string, string>) =>
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

  // 7. B-2 Roadmap KPI Dashboard
  md += `## 🎯 Roadmap B-2 KPI Dashboard\n\n`;
  if (!metrics.roadmapKpis || metrics.roadmapKpis.total_tasks_in_window === 0) {
    md += `> No data in \`agent_task_results\` yet. Run migrations (sql/026_agent_intelligence.sql) and let agents accumulate task results.\n\n`;
  } else {
    const kpis = metrics.roadmapKpis;
    const qaStatus = kpis.qa_success_rate >= 0.80 ? '✅' : '❌';
    const overallStatus = kpis.overall_success_rate >= 0.90 ? '✅' : '❌';
    const hungStatus = kpis.hung_timeout_rate <= 0.05 ? '✅' : '❌';
    const opusStatus = kpis.opus_usage_rate <= 0.20 ? '✅' : '❌';

    md += `| Metric | Value | Target | Status |\n`;
    md += `|--------|-------|--------|--------|\n`;
    md += `| QA Agent 성공률 | ${(kpis.qa_success_rate * 100).toFixed(1)}% | >80% | ${qaStatus} |\n`;
    md += `| 전체 성공률 | ${(kpis.overall_success_rate * 100).toFixed(1)}% | >90% | ${overallStatus} |\n`;
    md += `| Hung Timeout 비율 | ${(kpis.hung_timeout_rate * 100).toFixed(1)}% | <5% | ${hungStatus} |\n`;
    md += `| Opus 사용 비율 | ${(kpis.opus_usage_rate * 100).toFixed(1)}% | <20% | ${opusStatus} |\n`;
    md += `\n`;
    md += `*Based on ${kpis.total_tasks_in_window} tasks recorded in \`agent_task_results\`.*\n\n`;
  }

  // 8. Model Promotion History
  md += `## 🔼 Model Promotion History\n\n`;
  if (metrics.modelPromotions.length === 0) {
    md += `No model promotions recorded yet. Promotions are triggered when an agent's failure rate exceeds 30% over the last 20 tasks.\n\n`;
  } else {
    md += `| Agent ID | Promotions | Last Promotion | Latest Change |\n`;
    md += `|----------|------------|----------------|---------------|\n`;
    for (const p of metrics.modelPromotions) {
      const lastAt = p.last_promotion_at
        ? new Date(p.last_promotion_at).toISOString().slice(0, 10)
        : 'N/A';
      const change = p.from_model && p.to_model ? `${p.from_model} → ${p.to_model}` : 'N/A';
      md += `| ${p.agent_id} | ${p.total_promotions} | ${lastAt} | ${change} |\n`;
    }
    md += `\n`;
  }

  // 9. Recommendations
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

  // B-2 KPI threshold alerts
  if (metrics.roadmapKpis && metrics.roadmapKpis.total_tasks_in_window > 0) {
    const kpis = metrics.roadmapKpis;
    if (kpis.qa_success_rate < 0.80) {
      recommendations.push(`- **B-2 QA 성공률 미달**: ${(kpis.qa_success_rate * 100).toFixed(1)}% (목표: >80%). QA 에이전트 systemPrompt 및 timeout 설정 재검토 필요.`);
    }
    if (kpis.overall_success_rate < 0.90) {
      recommendations.push(`- **B-2 전체 성공률 미달**: ${(kpis.overall_success_rate * 100).toFixed(1)}% (목표: >90%). 실패 원인 분석 후 재시도 로직 강화 필요.`);
    }
    if (kpis.hung_timeout_rate > 0.05) {
      recommendations.push(`- **B-2 Hung Timeout 초과**: ${(kpis.hung_timeout_rate * 100).toFixed(1)}% (목표: <5%). claude-executor staleTimeout 및 lsof 헬스체크 설정 재검토 필요.`);
    }
    if (kpis.opus_usage_rate > 0.20) {
      recommendations.push(`- **B-2 Opus 사용 비율 초과**: ${(kpis.opus_usage_rate * 100).toFixed(1)}% (목표: <20%). Ecomode 활성화 또는 modelTier 태깅 강화 필요.`);
    }
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
