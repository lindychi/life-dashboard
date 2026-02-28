/**
 * GET /api/projects/[id]/tasks
 * 프로젝트에 연결된 태스크 목록 조회
 *
 * POST /api/projects/[id]/tasks
 * 태스크를 프로젝트에 연결
 */

import { NextRequest, NextResponse } from "next/server";
import { getProjectTasks, linkTaskToProject } from "@/lib/project-metrics";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 인증 확인
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { id: projectId } = await params;
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const tasks = await getProjectTasks(projectId, limit);

    return NextResponse.json({
      success: true,
      tasks: tasks,
      count: tasks.length,
    });
  } catch (error) {
    console.error("Failed to fetch project tasks:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 인증 확인
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { id: projectId } = await params;
    const body = await req.json();

    // camelCase와 snake_case 모두 지원
    const task_execution_id = body.task_execution_id || body.taskExecutionId;
    const task_queue_id = body.task_queue_id || body.taskQueueId;
    const { metadata } = body;

    if (!task_execution_id && !task_queue_id) {
      return NextResponse.json(
        { error: "Either task_execution_id or task_queue_id is required" },
        { status: 400 }
      );
    }

    const projectTask = await linkTaskToProject(
      projectId,
      task_execution_id,
      task_queue_id,
      metadata
    );

    return NextResponse.json({
      success: true,
      link: projectTask,
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to link task to project:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
