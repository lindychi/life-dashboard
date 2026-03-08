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

// ─── Scan: Conversation Health ────────────────────────────────────────────────

/**
 * Find active conversations with no messages in 7+ days, or high unread counts.
 */
export async function scanConversationHealth(): Promise<ScanResult[]> {
  interface ConvoRow {
    id: string;
    title: string;
    status: string;
    participant_count: number;
    last_message_at: string | null;
    days_since_message: number | null;
    total_messages: number;
  }

  let rows: ConvoRow[];
  try {
    rows = await query<ConvoRow>(`
      SELECT
        c.id,
        c.title,
        c.status,
        array_length(c.participants, 1) AS participant_count,
        MAX(cm.created_at) AS last_message_at,
        EXTRACT(DAY FROM (NOW() - MAX(cm.created_at)))::integer AS days_since_message,
        COUNT(cm.id)::integer AS total_messages
      FROM conversations c
      LEFT JOIN conversation_messages cm ON cm.conversation_id = c.id
      WHERE c.status = 'active'
      GROUP BY c.id, c.title, c.status
      HAVING MAX(cm.created_at) IS NULL
          OR MAX(cm.created_at) < NOW() - INTERVAL '7 days'
      ORDER BY MAX(cm.created_at) ASC NULLS FIRST
    `);
  } catch {
    return [];
  }

  return rows.map((row) => {
    const daysSince = row.days_since_message ?? null;
    const noMessages = row.last_message_at === null;

    let urgency: ScanResult["urgency"] = "low";
    let priorityScore = 30;

    if (noMessages && row.total_messages === 0) {
      urgency = "low";
      priorityScore = 25;
    } else if (daysSince !== null && daysSince > 30) {
      urgency = "normal";
      priorityScore = 50;
    } else if (daysSince !== null && daysSince > 14) {
      urgency = "low";
      priorityScore = 35;
    }

    const activityDesc = noMessages
      ? "no messages recorded"
      : `no activity for ${daysSince} days`;

    return {
      title: `Stale Conversation: ${row.title}`,
      description: `Conversation "${row.title}" is active but has ${activityDesc} (${row.total_messages} total messages, ${row.participant_count} participants).`,
      rationale: `Active conversations without recent messages may be abandoned. Review and either continue or archive to reduce noise.`,
      category: "maintenance" as const,
      priorityScore,
      urgency,
      sourceAgentId: "suggestion-scanner",
      targetAgentId: "planner",
      executionPlan: {
        commandType: "review",
        task: `Review stale conversation "${row.title}" (id: ${row.id}). It has ${row.total_messages} messages with ${activityDesc}. Determine if it should be continued, completed, or archived.`,
        estimatedDurationMinutes: 10,
        requiresAgents: ["planner"],
      },
      triggerType: "threshold" as const,
      triggerData: {
        conversationId: row.id,
        totalMessages: row.total_messages,
        lastMessageAt: row.last_message_at,
        daysSinceMessage: daysSince,
        participantCount: row.participant_count,
      },
      dedupKey: `stale-conversation:${row.id}`,
    };
  });
}

// ─── Scan: Gateway Health ─────────────────────────────────────────────────────

/**
 * Find gateways that haven't sent a heartbeat in 10+ minutes.
 */
export async function scanGatewayHealth(): Promise<ScanResult[]> {
  interface GatewayRow {
    gateway_id: string;
    hostname: string;
    last_heartbeat: string;
    minutes_since_heartbeat: number;
    connected_at: string;
  }

  let rows: GatewayRow[];
  try {
    rows = await query<GatewayRow>(`
      SELECT
        gateway_id,
        hostname,
        last_heartbeat,
        EXTRACT(EPOCH FROM (NOW() - last_heartbeat))::integer / 60 AS minutes_since_heartbeat,
        connected_at
      FROM gateway_connections
      WHERE disconnected_at IS NULL
        AND last_heartbeat < NOW() - INTERVAL '10 minutes'
      ORDER BY last_heartbeat ASC
    `);
  } catch {
    return [];
  }

  return rows.map((row) => {
    const minutes = row.minutes_since_heartbeat;

    let urgency: ScanResult["urgency"] = "normal";
    let priorityScore = 60;

    if (minutes >= 60) {
      urgency = "critical";
      priorityScore = 90;
    } else if (minutes >= 30) {
      urgency = "high";
      priorityScore = 75;
    }

    return {
      title: `Gateway Unresponsive: ${row.hostname}`,
      description: `Gateway "${row.gateway_id}" (${row.hostname}) has not sent a heartbeat for ${minutes} minutes.`,
      rationale: `An unresponsive gateway cannot execute commands. It may have crashed without disconnecting. Investigation and potential restart are needed.`,
      category: "health" as const,
      priorityScore,
      urgency,
      sourceAgentId: "suggestion-scanner",
      targetAgentId: "devops",
      executionPlan: {
        commandType: "investigate",
        task: `Investigate unresponsive gateway "${row.gateway_id}" on host "${row.hostname}". Last heartbeat was ${minutes} minutes ago. Check if the gateway-connector process is running, review logs, and restart if necessary.`,
        estimatedDurationMinutes: 15,
        requiresAgents: ["debugger"],
      },
      triggerType: "threshold" as const,
      triggerData: {
        gatewayId: row.gateway_id,
        hostname: row.hostname,
        lastHeartbeat: row.last_heartbeat,
        minutesSinceHeartbeat: minutes,
        connectedAt: row.connected_at,
      },
      dedupKey: `gateway-health:${row.gateway_id}`,
    };
  });
}

// ─── Scan: Token Usage Spikes ─────────────────────────────────────────────────

/**
 * Find agents whose daily token usage exceeds 2x their 7-day average.
 */
export async function scanTokenUsageSpikes(): Promise<ScanResult[]> {
  interface TokenRow {
    agent_id: string;
    today_tokens: number;
    avg_daily_tokens: number;
    spike_ratio: number;
  }

  let rows: TokenRow[];
  try {
    rows = await query<TokenRow>(`
      WITH daily_totals AS (
        SELECT
          agent_id,
          DATE(created_at) AS day,
          SUM(total_tokens) AS day_tokens
        FROM token_usage
        WHERE created_at >= NOW() - INTERVAL '8 days'
        GROUP BY agent_id, DATE(created_at)
      ),
      averages AS (
        SELECT
          agent_id,
          AVG(day_tokens) FILTER (WHERE day < CURRENT_DATE) AS avg_daily_tokens,
          SUM(day_tokens) FILTER (WHERE day = CURRENT_DATE) AS today_tokens
        FROM daily_totals
        GROUP BY agent_id
        HAVING SUM(day_tokens) FILTER (WHERE day = CURRENT_DATE) IS NOT NULL
           AND AVG(day_tokens) FILTER (WHERE day < CURRENT_DATE) > 0
      )
      SELECT
        agent_id,
        today_tokens::integer,
        avg_daily_tokens::integer,
        (today_tokens / avg_daily_tokens)::numeric(6,2) AS spike_ratio
      FROM averages
      WHERE today_tokens > avg_daily_tokens * 2
      ORDER BY spike_ratio DESC
    `);
  } catch {
    return [];
  }

  return rows.map((row) => {
    const ratio = Number(row.spike_ratio);
    const priorityScore = Math.min(90, Math.round(ratio * 20));

    let urgency: ScanResult["urgency"] = "normal";
    if (ratio >= 5) urgency = "critical";
    else if (ratio >= 3) urgency = "high";

    return {
      title: `Token Spike: Agent ${row.agent_id}`,
      description: `Agent "${row.agent_id}" used ${row.today_tokens.toLocaleString()} tokens today — ${ratio}x the 7-day average of ${Number(row.avg_daily_tokens).toLocaleString()}.`,
      rationale: `Sudden token usage spikes may indicate runaway loops, repeated retries, or unintended model escalation. Cost optimization requires investigation.`,
      category: "optimization" as const,
      priorityScore,
      urgency,
      sourceAgentId: "suggestion-scanner",
      targetAgentId: "analyst",
      executionPlan: {
        commandType: "analyze",
        task: `Analyze token usage spike for agent "${row.agent_id}". Today's usage (${row.today_tokens} tokens) is ${ratio}x above the 7-day average. Check token_usage for model breakdown, identify which tasks consumed the most, and recommend cost optimization.`,
        estimatedDurationMinutes: 20,
        requiresAgents: ["analyst"],
      },
      triggerType: "threshold" as const,
      triggerData: {
        agentId: row.agent_id,
        todayTokens: row.today_tokens,
        avgDailyTokens: Number(row.avg_daily_tokens),
        spikeRatio: ratio,
      },
      dedupKey: `token-spike:${row.agent_id}:${new Date().toISOString().slice(0, 10)}`,
    };
  });
}

// ─── Scan: Queue Backlog ──────────────────────────────────────────────────────

/**
 * Find concurrency groups with > 10 pending tasks, or tasks waiting > 30 min.
 */
export async function scanQueueBacklog(): Promise<ScanResult[]> {
  interface BacklogRow {
    concurrency_group: string;
    pending_count: number;
    oldest_pending_minutes: number;
  }

  let rows: BacklogRow[];
  try {
    rows = await query<BacklogRow>(`
      SELECT
        COALESCE(concurrency_group, 'default') AS concurrency_group,
        COUNT(*)::integer AS pending_count,
        EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::integer / 60 AS oldest_pending_minutes
      FROM task_queue
      WHERE status = 'pending'
      GROUP BY COALESCE(concurrency_group, 'default')
      HAVING COUNT(*) > 10
          OR EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) > 1800
      ORDER BY COUNT(*) DESC
    `);
  } catch {
    return [];
  }

  return rows.map((row) => {
    const count = row.pending_count;
    const minutes = row.oldest_pending_minutes;
    const priorityScore = Math.min(85, count * 5 + Math.floor(minutes / 10));

    let urgency: ScanResult["urgency"] = "normal";
    if (count > 50 || minutes > 120) urgency = "critical";
    else if (count > 20 || minutes > 60) urgency = "high";

    return {
      title: `Queue Backlog: ${row.concurrency_group}`,
      description: `Concurrency group "${row.concurrency_group}" has ${count} pending tasks. Oldest has been waiting ${minutes} minutes.`,
      rationale: `A growing queue backlog indicates insufficient processing capacity or a stuck consumer. Tasks may time out if not addressed.`,
      category: "health" as const,
      priorityScore,
      urgency,
      sourceAgentId: "suggestion-scanner",
      targetAgentId: "devops",
      executionPlan: {
        commandType: "investigate",
        task: `Investigate queue backlog in concurrency group "${row.concurrency_group}". ${count} tasks pending, oldest waiting ${minutes} min. Check if the orchestrator is running, review concurrency limits, and consider scaling or prioritizing.`,
        estimatedDurationMinutes: 15,
        requiresAgents: ["debugger"],
      },
      triggerType: "threshold" as const,
      triggerData: {
        concurrencyGroup: row.concurrency_group,
        pendingCount: count,
        oldestPendingMinutes: minutes,
      },
      dedupKey: `queue-backlog:${row.concurrency_group}`,
    };
  });
}

// ─── Scan: Relay Command Failures ─────────────────────────────────────────────

/**
 * Find relay commands stuck in 'processing' for > 30 min or high failure rates.
 */
export async function scanRelayCommandFailures(): Promise<ScanResult[]> {
  interface RelayRow {
    gateway_id: string;
    stuck_count: number;
    failed_count: number;
    oldest_stuck_minutes: number;
  }

  let rows: RelayRow[];
  try {
    rows = await query<RelayRow>(`
      SELECT
        gateway_id,
        COUNT(*) FILTER (WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '30 minutes')::integer AS stuck_count,
        COUNT(*) FILTER (WHERE status = 'failed' AND updated_at >= NOW() - INTERVAL '24 hours')::integer AS failed_count,
        COALESCE(
          EXTRACT(EPOCH FROM (NOW() - MIN(updated_at) FILTER (WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '30 minutes')))::integer / 60,
          0
        ) AS oldest_stuck_minutes
      FROM relay_commands
      WHERE (status = 'processing' AND updated_at < NOW() - INTERVAL '30 minutes')
         OR (status = 'failed' AND updated_at >= NOW() - INTERVAL '24 hours')
      GROUP BY gateway_id
      HAVING COUNT(*) FILTER (WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '30 minutes') > 0
          OR COUNT(*) FILTER (WHERE status = 'failed' AND updated_at >= NOW() - INTERVAL '24 hours') > 3
      ORDER BY COUNT(*) DESC
    `);
  } catch {
    return [];
  }

  return rows.map((row) => {
    const stuck = row.stuck_count;
    const failed = row.failed_count;
    const priorityScore = Math.min(90, stuck * 20 + failed * 10);

    let urgency: ScanResult["urgency"] = "normal";
    if (stuck > 5 || failed > 10) urgency = "critical";
    else if (stuck > 2 || failed > 5) urgency = "high";

    const issues: string[] = [];
    if (stuck > 0) issues.push(`${stuck} stuck (>${row.oldest_stuck_minutes}min)`);
    if (failed > 0) issues.push(`${failed} failed in 24h`);

    return {
      title: `Relay Issues: Gateway ${row.gateway_id}`,
      description: `Gateway "${row.gateway_id}" has relay command issues: ${issues.join(", ")}.`,
      rationale: `Stuck or failing relay commands indicate gateway-connector problems. Commands will not execute until resolved.`,
      category: "health" as const,
      priorityScore,
      urgency,
      sourceAgentId: "suggestion-scanner",
      targetAgentId: "devops",
      executionPlan: {
        commandType: "investigate",
        task: `Investigate relay command issues for gateway "${row.gateway_id}". ${issues.join("; ")}. Check gateway-connector logs, review stuck commands, and consider restarting the gateway.`,
        estimatedDurationMinutes: 20,
        requiresAgents: ["debugger"],
      },
      triggerType: "threshold" as const,
      triggerData: {
        gatewayId: row.gateway_id,
        stuckCount: stuck,
        failedCount: failed,
        oldestStuckMinutes: row.oldest_stuck_minutes,
      },
      dedupKey: `relay-failures:${row.gateway_id}`,
    };
  });
}

// ─── Scan: Permission Backlog ─────────────────────────────────────────────────

/**
 * Find pending permission approval requests older than 1 hour.
 */
export async function scanPermissionBacklog(): Promise<ScanResult[]> {
  interface PermRow {
    id: string;
    agent_id: string;
    tool_name: string;
    minutes_waiting: number;
    created_at: string;
  }

  let rows: PermRow[];
  try {
    rows = await query<PermRow>(`
      SELECT
        id,
        agent_id,
        tool_name,
        EXTRACT(EPOCH FROM (NOW() - created_at))::integer / 60 AS minutes_waiting,
        created_at::text
      FROM permission_approvals
      WHERE status = 'pending'
        AND created_at < NOW() - INTERVAL '1 hour'
      ORDER BY created_at ASC
      LIMIT 20
    `);
  } catch {
    return [];
  }

  if (rows.length === 0) return [];

  const priorityScore = Math.min(80, rows.length * 15);

  let urgency: ScanResult["urgency"] = "normal";
  if (rows.length > 10) urgency = "high";
  if (rows.some((r) => r.minutes_waiting > 360)) urgency = "critical";

  return [{
    title: `${rows.length} Permission Requests Awaiting Approval`,
    description: `${rows.length} permission approval requests have been pending for over 1 hour. Oldest: agent "${rows[0].agent_id}" requesting "${rows[0].tool_name}" (${rows[0].minutes_waiting} min).`,
    rationale: `Pending permission requests block agent execution. Auto-approval rules or manual intervention needed to unblock workflows.`,
    category: "maintenance" as const,
    priorityScore,
    urgency,
    sourceAgentId: "suggestion-scanner",
    targetAgentId: "planner",
    executionPlan: {
      commandType: "review",
      task: `Review ${rows.length} pending permission approval requests. Consider creating auto-approval rules for frequently requested permissions. Agents: ${[...new Set(rows.map((r) => r.agent_id))].join(", ")}. Tools: ${[...new Set(rows.map((r) => r.tool_name))].join(", ")}.`,
      estimatedDurationMinutes: 15,
      requiresAgents: ["planner"],
    },
    triggerType: "threshold" as const,
    triggerData: {
      pendingCount: rows.length,
      oldestMinutes: rows[0].minutes_waiting,
      agents: [...new Set(rows.map((r) => r.agent_id))],
      tools: [...new Set(rows.map((r) => r.tool_name))],
    },
    dedupKey: `permission-backlog:${new Date().toISOString().slice(0, 13)}`,
  }];
}

// ─── Scan: Metrics Regression ─────────────────────────────────────────────────

/**
 * Find projects where key metrics dropped significantly (> 20%) vs prior snapshot.
 */
export async function scanMetricsRegression(): Promise<ScanResult[]> {
  interface RegressionRow {
    project_id: string;
    project_name: string;
    metric_name: string;
    current_value: number;
    previous_value: number;
    drop_percent: number;
  }

  let rows: RegressionRow[];
  try {
    rows = await query<RegressionRow>(`
      WITH ranked AS (
        SELECT
          pm.project_id,
          p.name AS project_name,
          'success_rate' AS metric_name,
          pm.success_rate AS current_value,
          LAG(pm.success_rate) OVER (PARTITION BY pm.project_id ORDER BY pm.created_at) AS previous_value,
          pm.created_at
        FROM project_metrics pm
        JOIN projects p ON p.id = pm.project_id
        WHERE p.status = 'active'
          AND pm.created_at >= NOW() - INTERVAL '7 days'
          AND pm.success_rate IS NOT NULL
      )
      SELECT
        project_id,
        project_name,
        metric_name,
        current_value::numeric(6,2)::float,
        previous_value::numeric(6,2)::float,
        ((previous_value - current_value) / NULLIF(previous_value, 0) * 100)::numeric(6,2)::float AS drop_percent
      FROM ranked
      WHERE previous_value > 0
        AND current_value < previous_value * 0.8
      ORDER BY drop_percent DESC
      LIMIT 10
    `);
  } catch {
    return [];
  }

  return rows.map((row) => {
    const drop = Number(row.drop_percent);
    const priorityScore = Math.min(85, Math.round(drop));

    let urgency: ScanResult["urgency"] = "normal";
    if (drop >= 50) urgency = "critical";
    else if (drop >= 35) urgency = "high";

    return {
      title: `Metrics Drop: ${row.project_name}`,
      description: `Project "${row.project_name}" ${row.metric_name} dropped ${drop.toFixed(1)}% (${Number(row.previous_value).toFixed(1)}% → ${Number(row.current_value).toFixed(1)}%).`,
      rationale: `A significant metrics regression indicates quality or reliability issues that need investigation before they compound.`,
      category: "risk" as const,
      priorityScore,
      urgency,
      sourceAgentId: "suggestion-scanner",
      targetAgentId: "analyst",
      executionPlan: {
        commandType: "analyze",
        task: `Analyze metrics regression for project "${row.project_name}" (id: ${row.project_id}). ${row.metric_name} dropped ${drop.toFixed(1)}%. Review recent task executions, identify what changed, and recommend corrective actions.`,
        estimatedDurationMinutes: 25,
        requiresAgents: ["analyst", "debugger"],
      },
      triggerType: "threshold" as const,
      triggerData: {
        projectId: row.project_id,
        metricName: row.metric_name,
        currentValue: row.current_value,
        previousValue: row.previous_value,
        dropPercent: drop,
      },
      dedupKey: `metrics-regression:${row.project_id}:${row.metric_name}`,
    };
  });
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
    { name: "scanConversationHealth", fn: scanConversationHealth },
    { name: "scanGatewayHealth", fn: scanGatewayHealth },
    { name: "scanTokenUsageSpikes", fn: scanTokenUsageSpikes },
    { name: "scanQueueBacklog", fn: scanQueueBacklog },
    { name: "scanRelayCommandFailures", fn: scanRelayCommandFailures },
    { name: "scanPermissionBacklog", fn: scanPermissionBacklog },
    { name: "scanMetricsRegression", fn: scanMetricsRegression },
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
