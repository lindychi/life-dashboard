import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isDbConnectionError } from "@/lib/db";
import {
  getCronJob,
  updateCronJob,
  deleteCronJob,
  validateCronExpression,
} from "@/lib/cron-scheduler";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

/**
 * GET /api/cron/jobs/[id]
 * 특정 cron job 조회
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const job = await getCronJob(id);

    if (!job) {
      return NextResponse.json(
        { error: "Cron job not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ job });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Cron job get error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/cron/jobs/[id]
 * cron job 수정
 *
 * Body (모든 필드 optional):
 *   name?: string
 *   description?: string
 *   schedule?: string
 *   handlerType?: string
 *   handlerConfig?: object
 *   enabled?: boolean
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const body = await request.json();

    // schedule 변경 시 검증
    if (body.schedule) {
      const validation = validateCronExpression(body.schedule);
      if (!validation.valid) {
        return NextResponse.json(
          { error: `Invalid cron expression: ${validation.error}` },
          { status: 400 }
        );
      }
    }

    const job = await updateCronJob(id, {
      name: body.name,
      description: body.description,
      schedule: body.schedule,
      handlerType: body.handlerType,
      handlerConfig: body.handlerConfig,
      enabled: body.enabled,
    });

    if (!job) {
      return NextResponse.json(
        { error: "Cron job not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, job });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Cron job update error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/cron/jobs/[id]
 * cron job 삭제 (CASCADE로 실행 이력도 삭제)
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const deleted = await deleteCronJob(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Cron job not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Cron job delete error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
