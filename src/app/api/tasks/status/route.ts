import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getTask,
  getTasks,
  getQueueStats,
  getAllConcurrencyConfigs,
} from "@/lib/task-queue";
import { getOrchestratorStatus } from "@/lib/orchestrator";
import { isDbConnectionError } from "@/lib/db";

/**
 * GET /api/tasks/status
 * 태스크 큐 상태 조회
 *
 * Query params:
 *   taskId?: string         — 특정 태스크 조회
 *   status?: string         — 상태 필터 (pending|queued|running|completed|failed)
 *   concurrencyGroup?: string — 그룹 필터
 *   assignedAgent?: string  — 에이전트 필터
 *   limit?: number          — 조회 개수 (기본: 100)
 *   overview?: "true"       — 전체 통계만 조회
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");
    const overview = searchParams.get("overview");

    // 특정 태스크 조회
    if (taskId) {
      const task = await getTask(taskId);
      if (!task) {
        return NextResponse.json(
          { error: "Task not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ task });
    }

    // 전체 통계 조회
    if (overview === "true") {
      const concurrencyGroup = searchParams.get("concurrencyGroup") || undefined;
      const stats = await getQueueStats(concurrencyGroup);
      const orchestrator = getOrchestratorStatus();
      const concurrencyConfigs = await getAllConcurrencyConfigs();

      return NextResponse.json({
        stats,
        orchestrator,
        concurrencyConfigs,
      });
    }

    // 태스크 목록 조회
    const status = searchParams.get("status") as
      | "pending"
      | "queued"
      | "running"
      | "completed"
      | "failed"
      | null;
    const concurrencyGroup = searchParams.get("concurrencyGroup") || undefined;
    const assignedAgent = searchParams.get("assignedAgent") || undefined;
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    const tasks = await getTasks({
      status: status || undefined,
      concurrencyGroup,
      assignedAgent,
      limit,
    });

    const stats = await getQueueStats(concurrencyGroup);

    return NextResponse.json({ tasks, stats });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json({
        tasks: [],
        stats: { pending: 0, queued: 0, running: 0, completed: 0, failed: 0, total: 0 },
      });
    }
    console.error("Task status error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
