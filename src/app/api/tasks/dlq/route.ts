import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDeadLetterTasks, retryDeadLetterTask } from "@/lib/task-queue";
import { isDbConnectionError } from "@/lib/db";

/**
 * GET /api/tasks/dlq
 * 데드레터 큐 태스크 목록 조회
 *
 * Query params:
 *   limit?: number (기본: 50)
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const tasks = await getDeadLetterTasks(limit);

    return NextResponse.json({ tasks, count: tasks.length });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("DLQ list error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/tasks/dlq
 * 데드레터 태스크 재시도
 *
 * Body:
 *   action: "retry" (필수)
 *   taskId: string (필수)
 *   resetRetries?: boolean (기본: true)
 *   maxRetries?: number
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (body.action !== "retry") {
      return NextResponse.json(
        { error: "action must be 'retry'" },
        { status: 400 }
      );
    }

    if (!body.taskId) {
      return NextResponse.json(
        { error: "taskId is required" },
        { status: 400 }
      );
    }

    const task = await retryDeadLetterTask(body.taskId, {
      resetRetries: body.resetRetries,
      maxRetries: body.maxRetries,
    });

    if (!task) {
      return NextResponse.json(
        { error: "Task not found or not in dead_letter status" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, task });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("DLQ retry error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
