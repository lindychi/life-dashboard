/**
 * SSE Metrics API Endpoint
 *
 * Provides real-time metrics about active SSE connections and event throughput.
 * Used by monitoring dashboards to track SSE system health.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { sseMetricsCollector } from "@/lib/sse-metrics";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // Verify authentication (admin only)
  const authResult = await verifyAuth(request);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const metrics = sseMetricsCollector.getMetrics();
    const health = sseMetricsCollector.getHealthStatus();
    const stats = sseBroadcaster.getStats();

    return NextResponse.json({
      success: true,
      metrics: {
        ...metrics,
        broadcasterStats: stats,
        healthStatus: health,
      },
    });
  } catch (error) {
    console.error("[SSE] Metrics endpoint error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve metrics" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Verify authentication
  const authResult = await verifyAuth(request);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    if (action === "reset") {
      sseMetricsCollector.reset();
      return NextResponse.json({
        success: true,
        message: "Metrics reset successfully",
      });
    }

    if (action === "cleanup") {
      sseMetricsCollector.cleanup();
      return NextResponse.json({
        success: true,
        message: "Stale connections cleaned up",
      });
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("[SSE] Metrics POST error:", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
