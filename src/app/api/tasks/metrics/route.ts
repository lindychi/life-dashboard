import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMetrics } from "@/lib/queue-metrics";
import { isDbConnectionError } from "@/lib/db";

/**
 * GET /api/tasks/metrics
 * 큐 메트릭 조회 (인증 필요)
 *
 * Query params:
 *   window?: "15m" | "1h" | "24h" (기본: "15m")
 *   concurrencyGroup?: string (특정 그룹 필터)
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const window = searchParams.get("window") || "15m";
    const concurrencyGroup = searchParams.get("concurrencyGroup") || undefined;

    const metrics = await getMetrics(window, concurrencyGroup);

    return NextResponse.json(metrics);
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Metrics error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
