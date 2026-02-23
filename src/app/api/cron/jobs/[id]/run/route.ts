import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbConnectionError } from "@/lib/db";
import { executeCronJob, getCronJob } from "@/lib/cron-scheduler";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

/**
 * POST /api/cron/jobs/[id]/run
 * cron job 수동 실행
 * enabled 상태와 무관하게 즉시 실행
 */
export async function POST(request: NextRequest, context: RouteContext) {
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

    const run = await executeCronJob(id);
    return NextResponse.json({ success: true, run });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Cron job manual run error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
