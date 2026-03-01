import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PromotionHistoryEntry {
  from: string;
  to: string;
  reason: string;
  date: string;
}

interface AgentStatsEntry {
  id: string;
  successRate: number;
  totalTasks: number;
  failedTasks: number;
  currentModelTier: string | null;
  promotionHistory: PromotionHistoryEntry[];
  avgDurationSec: number;
}

interface SystemSummary {
  totalAgents: number;
  overallSuccessRate: number;
  totalTasksToday: number;
  totalCostUsd: number;
}

// ---------------------------------------------------------------------------
// GET /api/agent-stats
//
// Query params:
//   ?agent_id=<id>   — filter to a single agent (optional)
//
// Auth: session cookie or x-relay-key header
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Authenticate
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const agentIdFilter = request.nextUrl.searchParams.get("agent_id");

    // ------------------------------------------------------------------
    // 1. Per-agent stats from agent_task_results
    // ------------------------------------------------------------------
    let agentStatsQuery = `
      SELECT
        agent_id,
        COUNT(*)                                       AS total_tasks,
        COUNT(*) FILTER (WHERE status = 'failure')    AS failed_tasks,
        COALESCE(AVG(
          EXTRACT(EPOCH FROM (created_at - created_at))
        ), 0)                                          AS avg_duration_sec,
        (SELECT model_used
         FROM agent_task_results atr2
         WHERE atr2.agent_id = atr.agent_id
         ORDER BY created_at DESC
         LIMIT 1)                                      AS last_model_used
      FROM agent_task_results atr
    `;
    const agentStatsParams: string[] = [];

    if (agentIdFilter) {
      agentStatsParams.push(agentIdFilter);
      agentStatsQuery += ` WHERE agent_id = $1`;
    }

    agentStatsQuery += ` GROUP BY agent_id ORDER BY agent_id`;

    const agentRows = await query<{
      agent_id: string;
      total_tasks: string;
      failed_tasks: string;
      avg_duration_sec: string;
      last_model_used: string | null;
    }>(agentStatsQuery, agentStatsParams);

    // ------------------------------------------------------------------
    // 2. Promotion history from agent_model_promotions
    // ------------------------------------------------------------------
    let promotionsQuery = `
      SELECT agent_id, from_model, to_model, reason, promoted_at
      FROM agent_model_promotions
    `;
    const promotionsParams: string[] = [];

    if (agentIdFilter) {
      promotionsParams.push(agentIdFilter);
      promotionsQuery += ` WHERE agent_id = $1`;
    }

    promotionsQuery += ` ORDER BY promoted_at ASC`;

    const promotionRows = await query<{
      agent_id: string;
      from_model: string;
      to_model: string;
      reason: string;
      promoted_at: string;
    }>(promotionsQuery, promotionsParams);

    // Group promotions by agent_id
    const promotionsByAgent = new Map<string, PromotionHistoryEntry[]>();
    for (const row of promotionRows) {
      const existing = promotionsByAgent.get(row.agent_id) ?? [];
      existing.push({
        from: row.from_model,
        to: row.to_model,
        reason: row.reason,
        date: row.promoted_at,
      });
      promotionsByAgent.set(row.agent_id, existing);
    }

    // ------------------------------------------------------------------
    // 3. Build per-agent response
    // ------------------------------------------------------------------
    const agents: AgentStatsEntry[] = agentRows.map((row) => {
      const totalTasks = parseInt(row.total_tasks, 10) || 0;
      const failedTasks = parseInt(row.failed_tasks, 10) || 0;
      const successRate =
        totalTasks === 0 ? 0 : ((totalTasks - failedTasks) / totalTasks) * 100;
      const avgDurationSec = parseFloat(row.avg_duration_sec) || 0;

      return {
        id: row.agent_id,
        successRate: Math.round(successRate * 10) / 10,
        totalTasks,
        failedTasks,
        currentModelTier: row.last_model_used ?? null,
        promotionHistory: promotionsByAgent.get(row.agent_id) ?? [],
        avgDurationSec: Math.round(avgDurationSec * 10) / 10,
      };
    });

    // ------------------------------------------------------------------
    // 4. System summary
    // ------------------------------------------------------------------
    const summaryRow = await queryOne<{
      total_agents: string;
      overall_success_rate: string;
      tasks_today: string;
      total_cost_usd: string;
    }>(
      `
      SELECT
        COUNT(DISTINCT agent_id)                                AS total_agents,
        COALESCE(
          (COUNT(*) FILTER (WHERE status = 'success'))::float /
          NULLIF(COUNT(*), 0) * 100,
          0
        )                                                       AS overall_success_rate,
        COUNT(*) FILTER (
          WHERE created_at >= CURRENT_DATE
        )                                                       AS tasks_today,
        COALESCE(SUM(cost_usd), 0)                             AS total_cost_usd
      FROM agent_task_results
      `,
      []
    );

    const summary: SystemSummary = summaryRow
      ? {
          totalAgents: agents.length, // use the filtered/actual count
          overallSuccessRate:
            Math.round(parseFloat(summaryRow.overall_success_rate) * 10) / 10,
          totalTasksToday: parseInt(summaryRow.tasks_today, 10) || 0,
          totalCostUsd:
            Math.round(parseFloat(summaryRow.total_cost_usd) * 100) / 100,
        }
      : {
          totalAgents: 0,
          overallSuccessRate: 0,
          totalTasksToday: 0,
          totalCostUsd: 0,
        };

    return NextResponse.json({
      success: true,
      agents,
      summary,
    });
  } catch (error) {
    console.error("[agent-stats] Error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
