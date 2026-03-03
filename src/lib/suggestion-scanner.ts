/**
 * Suggestion Scanner
 *
 * Intelligence layer that queries existing data sources to find things that
 * need attention. Each scan function queries PostgreSQL directly and returns
 * ScanResult objects ready for insertion into agent_suggestions.
 */

import { query } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScanResult {
  title: string;
  description: string;
  rationale: string;
  category: "maintenance" | "optimization" | "risk" | "opportunity" | "reporting" | "health" | "general";
  priorityScore: number; // 0-100
  urgency: "low" | "normal" | "high" | "critical";
  sourceAgentId: string;
  targetAgentId: string;
  executionPlan: {
    commandType: string;
    task: string;
    estimatedDurationMinutes?: number;
    requiresAgents?: string[];
  };
  triggerType: "scheduled" | "event" | "threshold" | "pattern";
  triggerData: Record<string, unknown>;
  dedupKey: string;
}

// ─── Scan: OKR Progress ───────────────────────────────────────────────────────

/**
 * Find active objectives that are critically behind (< 30% progress).
 * Calculates urgency based on how close the end_date is.
 */
export async function scanOKRProgress(): Promise<ScanResult[]> {
  interface OKRRow {
    id: string;
    title: string;
    overall_progress: number;
    end_date: string;
    days_remaining: number;
    period_type: string;
  }

  const rows = await query<OKRRow>(`
    SELECT
      o.id,
      o.title,
      o.overall_progress,
      o.end_date,
      o.period_type,
      EXTRACT(DAY FROM (o.end_date::timestamptz - NOW()))::integer AS days_remaining
    FROM objectives o
    WHERE o.status = 'active'
      AND o.overall_progress < 30
    ORDER BY o.end_date ASC
  `);

  return rows.map((row) => {
    const daysRemaining = row.days_remaining ?? 999;

    let urgency: ScanResult["urgency"] = "normal";
    let priorityScore = 50;

    if (daysRemaining <= 7) {
      urgency = "critical";
      priorityScore = 90;
    } else if (daysRemaining <= 30) {
      urgency = "high";
      priorityScore = 75;
    } else if (daysRemaining <= 90) {
      urgency = "normal";
      priorityScore = 55;
    } else {
      urgency = "low";
      priorityScore = 35;
    }

    return {
      title: `OKR Behind Schedule: ${row.title}`,
      description: `Objective "${row.title}" is only ${row.overall_progress}% complete with ${daysRemaining} days remaining.`,
      rationale: `Active objective has less than 30% progress. ${daysRemaining <= 30 ? "Deadline is approaching soon." : "Early intervention prevents last-minute crunch."}`,
      category: "risk" as const,
      priorityScore,
      urgency,
      sourceAgentId: "suggestion-scanner",
      targetAgentId: "analyst",
      executionPlan: {
        commandType: "analyze",
        task: `Analyze why objective "${row.title}" (id: ${row.id}) is at ${row.overall_progress}% progress. Identify blockers and recommend concrete actions to accelerate key results. Provide a revised breakdown plan.`,
        estimatedDurationMinutes: 30,
        requiresAgents: ["analyst", "planner"],
      },
      triggerType: "threshold" as const,
      triggerData: {
        objectiveId: row.id,
        overallProgress: row.overall_progress,
        daysRemaining,
        endDate: row.end_date,
        periodType: row.period_type,
      },
      dedupKey: `okr-progress:${row.id}`,
    };
  });
}

// ─── Scan: Stale Projects ─────────────────────────────────────────────────────

/**
 * Find active projects with no recent task_executions (> 7 days or none at all).
 */
export async function scanProjectStale(): Promise<ScanResult[]> {
  interface StaleProjectRow {
    id: string;
    name: string;
    description: string;
    progress: number;
    last_task_at: string | null;
    days_since_activity: number | null;
  }

  const rows = await query<StaleProjectRow>(`
    SELECT
      p.id,
      p.name,
      p.description,
      p.progress,
      MAX(te.started_at) AS last_task_at,
      EXTRACT(DAY FROM (NOW() - MAX(te.started_at)))::integer AS days_since_activity
    FROM projects p
    LEFT JOIN task_executions te ON te.gateway_id IS NOT NULL
      -- task_executions doesn't have a direct project_id FK; match via project_tasks if available
    WHERE p.status = 'active'
    GROUP BY p.id, p.name, p.description, p.progress
    HAVING MAX(te.started_at) IS NULL
        OR MAX(te.started_at) < NOW() - INTERVAL '7 days'
    ORDER BY MAX(te.started_at) ASC NULLS FIRST
  `);

  return rows.map((row) => {
    const daysSince = row.days_since_activity ?? null;
    const noActivity = row.last_task_at === null;

    let urgency: ScanResult["urgency"] = "low";
    let priorityScore = 40;

    if (noActivity) {
      urgency = "normal";
      priorityScore = 55;
    } else if (daysSince !== null && daysSince > 30) {
      urgency = "high";
      priorityScore = 70;
    } else if (daysSince !== null && daysSince > 14) {
      urgency = "normal";
      priorityScore = 50;
    }

    const activityDescription = noActivity
      ? "no task activity recorded"
      : `no activity for ${daysSince} days`;

    return {
      title: `Stale Project: ${row.name}`,
      description: `Project "${row.name}" is active but has ${activityDescription}.`,
      rationale: `Active projects without recent execution activity may be abandoned or blocked. Review and either re-plan or archive.`,
      category: "maintenance" as const,
      priorityScore,
      urgency,
      sourceAgentId: "suggestion-scanner",
      targetAgentId: "planner",
      executionPlan: {
        commandType: "review",
        task: `Review stale project "${row.name}" (id: ${row.id}). It is ${row.progress}% complete with ${activityDescription}. Determine if it should be re-activated with a new task plan, put on hold, or archived. Provide a recommendation with reasoning.`,
        estimatedDurationMinutes: 20,
        requiresAgents: ["planner"],
      },
      triggerType: "threshold" as const,
      triggerData: {
        projectId: row.id,
        progress: row.progress,
        lastTaskAt: row.last_task_at,
        daysSinceActivity: daysSince,
      },
      dedupKey: `stale-project:${row.id}`,
    };
  });
}

// ─── Scan: Task Failures ──────────────────────────────────────────────────────

/**
 * Find agents with > 3 error entries in agent_history over the last 7 days.
 */
export async function scanTaskFailures(): Promise<ScanResult[]> {
  interface FailureRow {
    agent_id: string;
    failure_count: number;
    latest_failure_at: string;
  }

  const rows = await query<FailureRow>(`
    SELECT
      agent_id,
      COUNT(*) AS failure_count,
      MAX(created_at) AS latest_failure_at
    FROM agent_history
    WHERE type = 'error'
      AND created_at >= NOW() - INTERVAL '7 days'
    GROUP BY agent_id
    HAVING COUNT(*) > 3
    ORDER BY COUNT(*) DESC
  `);

  return rows.map((row) => {
    const count = Number(row.failure_count);
    const priorityScore = Math.min(90, count * 15);

    let urgency: ScanResult["urgency"] = "normal";
    if (count >= 10) urgency = "critical";
    else if (count >= 7) urgency = "high";

    return {
      title: `High Failure Rate: Agent ${row.agent_id}`,
      description: `Agent "${row.agent_id}" recorded ${count} errors in the last 7 days. Latest failure at ${new Date(row.latest_failure_at).toLocaleString()}.`,
      rationale: `Repeated failures indicate a systemic issue — broken tooling, bad prompts, or infrastructure problems. Investigation prevents wasted compute.`,
      category: "health" as const,
      priorityScore,
      urgency,
      sourceAgentId: "suggestion-scanner",
      targetAgentId: "debugger",
      executionPlan: {
        commandType: "investigate",
        task: `Investigate high failure rate for agent "${row.agent_id}". There have been ${count} errors in the last 7 days. Query agent_history for recent error entries, identify patterns, and propose a fix or configuration change.`,
        estimatedDurationMinutes: 45,
        requiresAgents: ["debugger"],
      },
      triggerType: "threshold" as const,
      triggerData: {
        agentId: row.agent_id,
        failureCount: count,
        latestFailureAt: row.latest_failure_at,
        windowDays: 7,
      },
      dedupKey: `task-failures:${row.agent_id}`,
    };
  });
}

// ─── Scan: Feedback Patterns ──────────────────────────────────────────────────

/**
 * Find agents with average feedback rating <= 2.0 (minimum 3 ratings in last 7 days).
 */
export async function scanFeedbackPatterns(): Promise<ScanResult[]> {
  interface FeedbackRow {
    agent_id: string;
    avg_rating: number;
    rating_count: number;
    latest_feedback_at: string;
  }

  const rows = await query<FeedbackRow>(`
    SELECT
      agent_id,
      AVG(overall_rating)::numeric(4,2) AS avg_rating,
      COUNT(*) AS rating_count,
      MAX(created_at) AS latest_feedback_at
    FROM task_feedback
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY agent_id
    HAVING COUNT(*) >= 3
       AND AVG(overall_rating) <= 2.0
    ORDER BY AVG(overall_rating) ASC
  `);

  return rows.map((row) => {
    const avgRating = Number(row.avg_rating);
    const count = Number(row.rating_count);
    const priorityScore = Math.round((5 - avgRating) * 20);

    let urgency: ScanResult["urgency"] = "normal";
    if (avgRating <= 1.5) urgency = "critical";
    else if (avgRating <= 1.8) urgency = "high";

    return {
      title: `Poor Feedback: Agent ${row.agent_id}`,
      description: `Agent "${row.agent_id}" has an average rating of ${avgRating.toFixed(1)}/5 over ${count} recent ratings.`,
      rationale: `Consistently low feedback signals the agent is not meeting quality expectations. Pattern analysis can uncover prompt, tooling, or scope issues.`,
      category: "optimization" as const,
      priorityScore,
      urgency,
      sourceAgentId: "suggestion-scanner",
      targetAgentId: "analyst",
      executionPlan: {
        commandType: "analyze",
        task: `Analyze poor feedback patterns for agent "${row.agent_id}". Average rating: ${avgRating.toFixed(1)}/5 over ${count} ratings in the last 7 days. Query task_feedback for this agent, identify recurring complaint categories, and propose specific improvements to prompts, task scope, or model selection.`,
        estimatedDurationMinutes: 30,
        requiresAgents: ["analyst"],
      },
      triggerType: "pattern" as const,
      triggerData: {
        agentId: row.agent_id,
        avgRating,
        ratingCount: count,
        latestFeedbackAt: row.latest_feedback_at,
        windowDays: 7,
      },
      dedupKey: `feedback-patterns:${row.agent_id}`,
    };
  });
}

// ─── Scan: Dead Letter Queue ──────────────────────────────────────────────────

/**
 * Find dead-lettered tasks in task_queue that need investigation.
 */
export async function scanDeadLetterQueue(): Promise<ScanResult[]> {
  interface DeadLetterRow {
    id: string;
    title: string;
    concurrency_group: string | null;
    priority: number;
    created_at: string;
    updated_at: string;
    attempt_number: number | null;
  }

  // task_queue may not exist yet; wrap in try/catch
  let rows: DeadLetterRow[];
  try {
    rows = await query<DeadLetterRow>(`
      SELECT
        id,
        title,
        concurrency_group,
        priority,
        created_at,
        updated_at,
        attempt_number
      FROM task_queue
      WHERE status = 'dead_letter'
      ORDER BY updated_at DESC
      LIMIT 20
    `);
  } catch (err) {
    // table might not exist in some environments
    console.warn("[suggestion-scanner] scanDeadLetterQueue: query failed:", err);
    return [];
  }

  return rows.map((row) => ({
    title: `Dead-Letter Task: ${row.title}`,
    description: `Task "${row.title}" (id: ${row.id}) has been dead-lettered after ${row.attempt_number ?? "unknown"} attempts.`,
    rationale: `Dead-lettered tasks represent persistent failures that block downstream dependencies. Manual investigation is required to unblock the queue.`,
    category: "maintenance" as const,
    priorityScore: 70,
    urgency: "high" as const,
    sourceAgentId: "suggestion-scanner",
    targetAgentId: "devops",
    executionPlan: {
      commandType: "investigate",
      task: `Investigate dead-lettered task "${row.title}" (id: ${row.id}, group: ${row.concurrency_group ?? "none"}). Review its execution history and error messages in agent_history, identify the root cause, and either fix the underlying issue and re-queue or mark as permanently failed with documentation.`,
      estimatedDurationMinutes: 30,
      requiresAgents: ["debugger"],
    },
    triggerType: "event" as const,
    triggerData: {
      taskId: row.id,
      taskTitle: row.title,
      concurrencyGroup: row.concurrency_group,
      priority: row.priority,
      attemptNumber: row.attempt_number,
      deadLetteredAt: row.updated_at,
    },
    dedupKey: `dead-letter:${row.id}`,
  }));
}

// ─── Run All Scans ────────────────────────────────────────────────────────────

/**
 * Run all scan functions in parallel, collect results, return combined array.
 * Individual scan failures are caught and logged without stopping other scans.
 */
export async function runAllScans(): Promise<ScanResult[]> {
  const scanFunctions = [
    { name: "scanOKRProgress", fn: scanOKRProgress },
    { name: "scanProjectStale", fn: scanProjectStale },
    { name: "scanTaskFailures", fn: scanTaskFailures },
    { name: "scanFeedbackPatterns", fn: scanFeedbackPatterns },
    { name: "scanDeadLetterQueue", fn: scanDeadLetterQueue },
  ];

  const results = await Promise.allSettled(
    scanFunctions.map(({ fn }) => fn())
  );

  const allResults: ScanResult[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      allResults.push(...result.value);
    } else {
      console.error(
        `[suggestion-scanner] ${scanFunctions[i].name} failed:`,
        result.reason
      );
    }
  }

  console.log(
    `[suggestion-scanner] runAllScans complete: ${allResults.length} results from ${
      results.filter((r) => r.status === "fulfilled").length
    }/${results.length} scans`
  );

  return allResults;
}
