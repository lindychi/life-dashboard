import { NextResponse } from "next/server";
import { performHealthCheck } from "@/lib/queue-metrics";

/**
 * GET /api/tasks/health
 * 태스크 큐 헬스체크 (공개 엔드포인트, 인증 불필요)
 *
 * Railway 및 외부 모니터링 서비스에서 사용
 * 200: healthy, 503: unhealthy
 */
export async function GET() {
  try {
    const health = await performHealthCheck();

    return NextResponse.json(health, {
      status: health.status === "healthy" ? 200 : 503,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch {
    return NextResponse.json(
      {
        status: "unhealthy",
        checks: {
          database: { status: "down", error: "Health check failed" },
          orchestrator: { status: "unknown" },
          queueBacklog: { status: "ok", pendingCount: 0, threshold: 1000 },
          cronScheduler: { status: "unknown" },
        },
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
