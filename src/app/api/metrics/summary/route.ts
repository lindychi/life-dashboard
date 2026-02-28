import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

/**
 * GET /api/metrics/summary
 *
 * High-level metrics dashboard summary
 *
 * Returns:
 *   - overall: total tasks, success rate, avg duration, total cost
 *   - by_agent: per-agent breakdown
 *   - by_model: per-model tier breakdown
 *   - trend: daily task counts over past 7 days
 *   - top_failures: agents with highest failure rates
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "7", 10);

    // Overall metrics
    const overallResult = await query(`
      SELECT
        COUNT(*) AS total_tasks,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
        SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) AS timeout_count,
        SUM(CASE WHEN status = 'hung' THEN 1 ELSE 0 END) AS hung_count,
        ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS success_rate,
        ROUND(AVG(duration_ms) / 1000.0, 1) AS avg_duration_sec,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) / 1000.0, 1) AS median_duration_sec,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) / 1000.0, 1) AS p95_duration_sec,
        SUM(total_cost_usd) AS total_cost_usd,
        SUM(tool_calls_count) AS total_tool_calls
      FROM task_metrics
      WHERE completed_at >= NOW() - INTERVAL '${days} days'
    `);

    // By agent
    const byAgentResult = await query(`
      SELECT
        agent_id,
        COUNT(*) AS total_tasks,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
        ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS success_rate,
        ROUND(AVG(duration_ms) / 1000.0, 1) AS avg_duration_sec,
        SUM(total_cost_usd) AS total_cost_usd
      FROM task_metrics
      WHERE completed_at >= NOW() - INTERVAL '${days} days'
      GROUP BY agent_id
      ORDER BY total_tasks DESC
    `);

    // By model tier
    const byModelResult = await query(`
      SELECT
        model_tier,
        COUNT(*) AS total_tasks,
        ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS success_rate,
        ROUND(AVG(duration_ms) / 1000.0, 1) AS avg_duration_sec,
        SUM(total_cost_usd) AS total_cost_usd
      FROM task_metrics
      WHERE completed_at >= NOW() - INTERVAL '${days} days'
      GROUP BY model_tier
      ORDER BY total_tasks DESC
    `);

    // Daily trend (past 7 days)
    const trendResult = await query(`
      SELECT
        DATE(completed_at) AS date,
        COUNT(*) AS total_tasks,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN status IN ('failed', 'timeout', 'hung') THEN 1 ELSE 0 END) AS failed_count
      FROM task_metrics
      WHERE completed_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY DATE(completed_at)
      ORDER BY date DESC
    `);

    // Top failures (agents with highest failure rates)
    const topFailuresResult = await query(`
      SELECT
        agent_id,
        COUNT(*) AS total_tasks,
        SUM(CASE WHEN status IN ('failed', 'timeout', 'hung') THEN 1 ELSE 0 END) AS failure_count,
        ROUND(100.0 * SUM(CASE WHEN status IN ('failed', 'timeout', 'hung') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS failure_rate,
        ARRAY_AGG(DISTINCT status) FILTER (WHERE status IN ('failed', 'timeout', 'hung')) AS failure_types
      FROM task_metrics
      WHERE completed_at >= NOW() - INTERVAL '${days} days'
      GROUP BY agent_id
      HAVING SUM(CASE WHEN status IN ('failed', 'timeout', 'hung') THEN 1 ELSE 0 END) > 0
      ORDER BY failure_rate DESC
      LIMIT 10
    `);

    return NextResponse.json({
      success: true,
      period_days: days,
      overall: overallResult[0] || {},
      by_agent: byAgentResult,
      by_model: byModelResult,
      trend: trendResult,
      top_failures: topFailuresResult,
    });
  } catch (error) {
    console.error("[Metrics Summary API] Error:", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
