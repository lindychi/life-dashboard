import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

/**
 * GET /api/metrics
 *
 * Query task execution metrics with flexible filters
 *
 * Query params:
 *   - view: 'daily_agent' | 'model_effectiveness' | 'timeout_analysis' | 'raw'
 *   - agent_id: filter by specific agent
 *   - model_tier: filter by model (haiku/sonnet/opus)
 *   - status: filter by status (completed/failed/timeout/hung)
 *   - days: number of days to look back (default: 7)
 *   - limit: max rows to return (default: 100)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const view = searchParams.get("view") || "daily_agent";
    const agentId = searchParams.get("agent_id");
    const modelTier = searchParams.get("model_tier");
    const status = searchParams.get("status");
    const days = parseInt(searchParams.get("days") || "7", 10);
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    let sql = "";
    const params: unknown[] = [];

    switch (view) {
      case "daily_agent":
        sql = `
          SELECT * FROM daily_agent_metrics
          WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
          ${agentId ? `AND agent_id = $${params.push(agentId)}` : ""}
          ORDER BY date DESC, agent_id
          LIMIT $${params.push(limit)}
        `;
        break;

      case "model_effectiveness":
        sql = `SELECT * FROM model_tier_effectiveness LIMIT $${params.push(limit)}`;
        break;

      case "timeout_analysis":
        sql = `SELECT * FROM timeout_analysis LIMIT $${params.push(limit)}`;
        break;

      case "raw":
      default:
        // Raw task_metrics query with filters
        const conditions: string[] = [`completed_at >= NOW() - INTERVAL '${days} days'`];
        if (agentId) conditions.push(`agent_id = $${params.push(agentId)}`);
        if (modelTier) conditions.push(`model_tier = $${params.push(modelTier)}`);
        if (status) conditions.push(`status = $${params.push(status)}`);

        sql = `
          SELECT
            id, task_id, agent_id,
            started_at, completed_at, duration_ms,
            model_tier, model_source, complexity_score,
            status, exit_code, retry_count,
            provider, fallback_used, num_turns, total_cost_usd,
            tool_calls_count, output_length, truncated
          FROM task_metrics
          WHERE ${conditions.join(" AND ")}
          ORDER BY completed_at DESC
          LIMIT $${params.push(limit)}
        `;
        break;
    }

    const results = await query(sql, params);

    return NextResponse.json({
      success: true,
      view,
      count: results.length,
      data: results,
    });
  } catch (error) {
    console.error("[Metrics API] Error:", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
