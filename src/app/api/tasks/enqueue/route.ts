import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enqueueTask, setConcurrencyLimit } from "@/lib/task-queue";
import { isDbConnectionError } from "@/lib/db";

/**
 * POST /api/tasks/enqueue
 * 태스크를 큐에 추가
 *
 * Body:
 *   title: string (필수)
 *   type?: string (기본: "generic")
 *   payload?: object
 *   priority?: number (기본: 0, 높을수록 우선)
 *   concurrencyGroup?: string (기본: "default")
 *   assignedAgent?: string
 *   maxRetries?: number (기본: 3)
 *   timeoutSeconds?: number (기본: 300)
 *   concurrencyLimit?: number (해당 그룹의 동시 실행 제한 설정)
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (!body.title) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 }
      );
    }

    // concurrencyLimit이 지정되면 해당 그룹의 동시 실행 제한 업데이트
    if (body.concurrencyLimit !== undefined) {
      const limit = parseInt(body.concurrencyLimit, 10);
      if (isNaN(limit) || limit < 1) {
        return NextResponse.json(
          { error: "concurrencyLimit must be a positive integer" },
          { status: 400 }
        );
      }
      await setConcurrencyLimit(
        body.concurrencyGroup || "default",
        limit
      );
    }

    const task = await enqueueTask({
      title: body.title,
      type: body.type,
      payload: body.payload,
      priority: body.priority,
      concurrencyGroup: body.concurrencyGroup,
      assignedAgent: body.assignedAgent,
      maxRetries: body.maxRetries,
      timeoutSeconds: body.timeoutSeconds,
    });

    return NextResponse.json({ success: true, task });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Task enqueue error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
