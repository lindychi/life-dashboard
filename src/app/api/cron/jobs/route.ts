import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbConnectionError } from "@/lib/db";
import {
  createCronJob,
  listCronJobs,
  validateCronExpression,
} from "@/lib/cron-scheduler";
import { hasCronHandler } from "@/lib/cron-handlers";

/**
 * GET /api/cron/jobs
 * cron job 목록 조회
 *
 * Query:
 *   enabled?: "true" | "false"
 *   limit?: number
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const enabledParam = searchParams.get("enabled");
    const limitParam = searchParams.get("limit");

    const options: { enabled?: boolean; limit?: number } = {};
    if (enabledParam !== null) {
      options.enabled = enabledParam === "true";
    }
    if (limitParam) {
      options.limit = parseInt(limitParam, 10);
    }

    const jobs = await listCronJobs(options);
    return NextResponse.json({ jobs });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Cron jobs list error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/cron/jobs
 * cron job 생성
 *
 * Body:
 *   name: string (필수)
 *   schedule: string (필수, cron expression)
 *   handlerType: string (필수)
 *   description?: string
 *   handlerConfig?: object
 *   enabled?: boolean (기본: true)
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // 필수 필드 검증
    if (!body.name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }
    if (!body.schedule) {
      return NextResponse.json(
        { error: "schedule is required" },
        { status: 400 }
      );
    }
    if (!body.handlerType) {
      return NextResponse.json(
        { error: "handlerType is required" },
        { status: 400 }
      );
    }

    // cron expression 검증
    const validation = validateCronExpression(body.schedule);
    if (!validation.valid) {
      return NextResponse.json(
        { error: `Invalid cron expression: ${validation.error}` },
        { status: 400 }
      );
    }

    // handler 등록 여부 경고 (생성은 허용 — 나중에 등록할 수도 있음)
    const handlerExists = hasCronHandler(body.handlerType);

    const job = await createCronJob({
      name: body.name,
      description: body.description,
      schedule: body.schedule,
      handlerType: body.handlerType,
      handlerConfig: body.handlerConfig,
      enabled: body.enabled,
    });

    return NextResponse.json({
      success: true,
      job,
      warnings: handlerExists
        ? undefined
        : [`Handler type '${body.handlerType}' is not currently registered`],
    });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }

    // unique constraint 위반 (name 중복)
    if (
      error instanceof Error &&
      error.message.includes("unique")
    ) {
      return NextResponse.json(
        { error: "A cron job with this name already exists" },
        { status: 409 }
      );
    }

    console.error("Cron job create error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
