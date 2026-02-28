/**
 * Script to identify incomplete tasks from agent_history
 * Queries the Life Dashboard API to find tasks with 'task_started' or 'in_progress' status
 * that lack a corresponding 'task_completed' entry.
 *
 * Usage:
 *   npx ts-node scripts/find-incomplete-tasks.ts [--days 7] [--agent agentId] [--output json|table]
 *
 * Environment:
 *   DASHBOARD_URL=http://localhost:3000 (or production URL)
 *   AUTH_TOKEN=your-auth-token (optional, for authenticated requests)
 */

import fetch from 'node-fetch';

interface HistoryEntry {
  id: string;
  agentId: string;
  type: 'task_started' | 'task_completed' | 'task_failed' | 'status_change' | 'output' | 'gateway_restart' | 'message_sent' | 'message_received' | 'command_received';
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
  requestGroupId?: string;
  requestTitle?: string;
}

interface IncompleteTask {
  requestGroupId?: string;
  requestTitle?: string;
  agentId: string;
  startedAt: string;
  lastActivityAt: string;
  durationMinutes: number;
  startEntry: HistoryEntry;
  allEntries: HistoryEntry[];
  completionStatus: 'incomplete' | 'abandoned' | 'in_progress';
}

interface TaskSummary {
  totalIncomplete: number;
  recentIncomplete: number;
  abandonedTasks: number;
  byAgent: Record<string, number>;
  tasks: IncompleteTask[];
}

async function findIncompleteTasks(
  options: {
    days?: number;
    agentId?: string;
    outputFormat?: 'json' | 'table';
    dashboardUrl?: string;
    authToken?: string;
  } = {}
): Promise<TaskSummary> {
  const {
    days = 7,
    agentId,
    outputFormat = 'table',
    dashboardUrl = process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    authToken = process.env.AUTH_TOKEN,
  } = options;

  console.log(`\n🔍 Searching for incomplete tasks (last ${days} days)...`);
  console.log(`📍 Dashboard URL: ${dashboardUrl}`);
  if (agentId) console.log(`🤖 Filter: Agent ID = ${agentId}`);

  try {
    // Fetch all history with large limit
    const url = new URL(`${dashboardUrl}/api/history/timeline`);
    url.searchParams.set('limit', '500');
    if (agentId) url.searchParams.set('agentId', agentId);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authToken) {
      headers['Cookie'] = `auth-token=${authToken}`;
    }

    const response = await fetch(url.toString(), {
      headers,
      method: 'GET',
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Authentication failed. Please set AUTH_TOKEN env var.');
      }
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      entries: HistoryEntry[];
      totalCount?: number;
    };

    const entries = data.entries || [];
    console.log(`✅ Fetched ${entries.length} history entries`);

    // Analyze entries to find incomplete tasks
    const incomplete = analyzeIncompleteTasksFromEntries(entries, days);

    if (outputFormat === 'json') {
      console.log('\n📊 Results (JSON):');
      console.log(JSON.stringify(incomplete, null, 2));
    } else {
      printTasksSummary(incomplete);
    }

    return incomplete;
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function analyzeIncompleteTasksFromEntries(
  entries: HistoryEntry[],
  days: number
): TaskSummary {
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // Group entries by request_group_id
  const groupedByRequest = new Map<string, HistoryEntry[]>();
  const groupedByAgent = new Map<string, Map<string, HistoryEntry[]>>();

  for (const entry of entries) {
    const groupId = entry.requestGroupId || `ungrouped-${entry.agentId}-${entry.timestamp}`;

    if (!groupedByRequest.has(groupId)) {
      groupedByRequest.set(groupId, []);
    }
    groupedByRequest.get(groupId)!.push(entry);

    // Also group by agent
    if (!groupedByAgent.has(entry.agentId)) {
      groupedByAgent.set(entry.agentId, new Map());
    }
    const agentGroups = groupedByAgent.get(entry.agentId)!;
    if (!agentGroups.has(groupId)) {
      agentGroups.set(groupId, []);
    }
    agentGroups.get(groupId)!.push(entry);
  }

  // Analyze each group to find incomplete tasks
  const incompleteTasks: IncompleteTask[] = [];
  const byAgent: Record<string, number> = {};

  for (const [groupId, groupEntries] of groupedByRequest.entries()) {
    const taskStarted = groupEntries.filter((e) => e.type === 'task_started');
    const taskCompleted = groupEntries.filter((e) => e.type === 'task_completed');
    const taskFailed = groupEntries.filter((e) => e.type === 'task_failed');

    // Only count as incomplete if there are started tasks without completion
    if (taskStarted.length > 0 && taskCompleted.length === 0 && taskFailed.length === 0) {
      const startEntry = taskStarted[0];
      const startDate = new Date(startEntry.timestamp);

      // For recent priority, only include items from the last N days
      if (startDate >= cutoffDate) {
        const agentId = startEntry.agentId;
        byAgent[agentId] = (byAgent[agentId] || 0) + 1;

        const lastEntry = groupEntries.reduce((latest, e) => {
          return new Date(e.timestamp) > new Date(latest.timestamp) ? e : latest;
        });

        const durationMs = new Date(lastEntry.timestamp).getTime() - startDate.getTime();
        const durationMinutes = Math.floor(durationMs / (1000 * 60));

        // Determine status
        let completionStatus: IncompleteTask['completionStatus'] = 'in_progress';
        if (durationMinutes > 24 * 60) {
          // No activity for 24+ hours = abandoned
          const lastActivityTime = new Date();
          lastActivityTime.setTime(lastActivityTime.getTime() - durationMs);
          if (lastActivityTime < new Date(now.getTime() - 24 * 60 * 60 * 1000)) {
            completionStatus = 'abandoned';
          }
        }

        incompleteTasks.push({
          requestGroupId: entry.requestGroupId || undefined,
          requestTitle: entry.requestTitle || `Task by ${agentId}`,
          agentId,
          startedAt: startEntry.timestamp,
          lastActivityAt: lastEntry.timestamp,
          durationMinutes,
          startEntry,
          allEntries: groupEntries,
          completionStatus,
        });
      }
    }
  }

  // Sort by duration (longest first = most urgent)
  incompleteTasks.sort((a, b) => b.durationMinutes - a.durationMinutes);

  const totalIncomplete = incompleteTasks.length;
  const recentIncomplete = incompleteTasks.filter(
    (t) => new Date(t.startedAt) >= cutoffDate
  ).length;
  const abandonedTasks = incompleteTasks.filter(
    (t) => t.completionStatus === 'abandoned'
  ).length;

  return {
    totalIncomplete,
    recentIncomplete,
    abandonedTasks,
    byAgent,
    tasks: incompleteTasks,
  };
}

function printTasksSummary(summary: TaskSummary): void {
  console.log('\n' + '='.repeat(80));
  console.log('📊 INCOMPLETE TASKS SUMMARY');
  console.log('='.repeat(80));

  console.log(
    `\n📈 Statistics:\n` +
    `   Total Incomplete:     ${summary.totalIncomplete}\n` +
    `   Recent (≤7 days):     ${summary.recentIncomplete}\n` +
    `   Abandoned (24+ hrs):  ${summary.abandonedTasks}\n` +
    `   Affected Agents:      ${Object.keys(summary.byAgent).length}`
  );

  if (Object.keys(summary.byAgent).length > 0) {
    console.log('\n👥 By Agent:');
    for (const [agentId, count] of Object.entries(summary.byAgent).sort(
      ([, a], [, b]) => b - a
    )) {
      console.log(`   ${agentId.padEnd(30)} ${count} incomplete task(s)`);
    }
  }

  if (summary.tasks.length > 0) {
    console.log('\n📋 Details:\n');

    summary.tasks.forEach((task, idx) => {
      const statusEmoji =
        task.completionStatus === 'abandoned'
          ? '⏸️ '
          : task.completionStatus === 'in_progress'
            ? '⏳'
            : '❓';

      const durationStr =
        task.durationMinutes < 60
          ? `${task.durationMinutes}m`
          : task.durationMinutes < 1440
            ? `${Math.floor(task.durationMinutes / 60)}h`
            : `${Math.floor(task.durationMinutes / 1440)}d`;

      console.log(
        `${idx + 1}. ${statusEmoji} [${task.agentId}] ${task.requestTitle}\n` +
        `   Duration: ${durationStr} | Status: ${task.completionStatus}\n` +
        `   Started:  ${new Date(task.startedAt).toLocaleString()}\n` +
        `   Last Activity: ${new Date(task.lastActivityAt).toLocaleString()}\n` +
        `   Group ID: ${task.requestGroupId || 'none'}\n`
      );

      // Show recent activities
      const recentActivities = task.allEntries.slice(-3);
      if (recentActivities.length > 0) {
        console.log('   Recent Events:');
        recentActivities.forEach((entry) => {
          const preview = entry.content.substring(0, 60).replace(/\n/g, ' ');
          console.log(`     • [${entry.type}] ${preview}...`);
        });
      }

      console.log();
    });
  } else {
    console.log('\n✅ No incomplete tasks found!');
  }

  console.log('='.repeat(80) + '\n');
}

// CLI argument parsing
const args = process.argv.slice(2);
const options: Parameters<typeof findIncompleteTasks>[0] = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--days' && i + 1 < args.length) {
    options.days = parseInt(args[++i], 10);
  } else if (arg === '--agent' && i + 1 < args.length) {
    options.agentId = args[++i];
  } else if (arg === '--output' && i + 1 < args.length) {
    options.outputFormat = args[++i] as 'json' | 'table';
  } else if (arg === '--help') {
    console.log(`
Usage: npx ts-node scripts/find-incomplete-tasks.ts [options]

Options:
  --days N           Look for incomplete tasks in the last N days (default: 7)
  --agent ID         Filter by agent ID
  --output FORMAT    Output format: 'table' or 'json' (default: table)
  --help             Show this help message

Environment Variables:
  DASHBOARD_URL      URL of the dashboard (default: http://localhost:3000)
  AUTH_TOKEN         Optional authentication token (for non-public instances)

Examples:
  npx ts-node scripts/find-incomplete-tasks.ts
  npx ts-node scripts/find-incomplete-tasks.ts --days 30
  npx ts-node scripts/find-incomplete-tasks.ts --agent executor --output json
    `);
    process.exit(0);
  }
}

findIncompleteTasks(options).catch(console.error);
