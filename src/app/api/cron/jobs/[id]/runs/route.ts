import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbConnectionError } from "@/lib/db";
import { getJobRuns, getCronJob } from "@/lib/cron-scheduler";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

/**
 * GET /api/cron/jobs/[id]/runs
 * cron job 실행 이력 조회
 *
 * Query:
 *   limit?: number (기본: 50)
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;

    // job 존재 여부 확인
    const job = await getCronJob(id);
    if (!job) {
      return NextResponse.json(
        { error: "Cron job not found" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 50;

    const runs = await getJobRuns(id, limit);
    return NextResponse.json({ runs, total: runs.length });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Cron job runs list error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
