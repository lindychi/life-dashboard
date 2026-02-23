import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { completeTask, failTask } from "@/lib/task-queue";
import { triggerDispatch } from "@/lib/orchestrator";
import { isDbConnectionError } from "@/lib/db";

/**
 * POST /api/tasks/dispatch
 * 수동 디스패치 실행 또는 태스크 완료/실패 처리
 *
 * Body:
 *   action: "dispatch" | "complete" | "fail"
 *
 *   action="dispatch":
 *     수동으로 디스패치 사이클 1회 실행
 *
 *   action="complete":
 *     taskId: string (필수)
 *     result?: object
 *
 *   action="fail":
 *     taskId: string (필수)
 *     error: string (필수)
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const action = body.action;

    if (!action) {
      return NextResponse.json(
        { error: "action is required (dispatch | complete | fail)" },
        { status: 400 }
      );
    }

    switch (action) {
      case "dispatch": {
        const result = await triggerDispatch();
        return NextResponse.json({
          success: true,
          dispatched: result.dispatched,
          expired: result.expired,
          stats: result.stats,
        });
      }

      case "complete": {
        if (!body.taskId) {
          return NextResponse.json(
            { error: "taskId is required for complete action" },
            { status: 400 }
          );
        }

        const task = await completeTask(body.taskId, body.result);
        if (!task) {
          return NextResponse.json(
            { error: "Task not found or not in running state" },
            { status: 404 }
          );
        }

        return NextResponse.json({ success: true, task });
      }

      case "fail": {
        if (!body.taskId || !body.error) {
          return NextResponse.json(
            { error: "taskId and error are required for fail action" },
            { status: 400 }
          );
        }

        const task = await failTask(body.taskId, body.error);
        if (!task) {
          return NextResponse.json(
            { error: "Task not found or not in running state" },
            { status: 404 }
          );
        }

        return NextResponse.json({ success: true, task });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Use dispatch, complete, or fail` },
          { status: 400 }
        );
    }
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Task dispatch error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
