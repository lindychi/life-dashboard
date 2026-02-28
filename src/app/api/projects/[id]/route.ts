import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import {
  getProjectById,
  updateProject,
  deleteProject,
  type UpdateProjectInput,
} from "@/lib/projects";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

/**
 * GET /api/projects/[id]
 * Fetch a single project by ID
 * Auth: session cookie or x-relay-key header
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const project = await getProjectById(id);

    if (!project) {
      return NextResponse.json(
        { error: "프로젝트를 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    return NextResponse.json({ project });
  } catch (error) {
    console.error("Failed to fetch project:", error);
    return NextResponse.json(
      { error: "프로젝트 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/projects/[id]
 * Update an existing project
 * Auth: session cookie or x-relay-key header
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    // Validate progress if provided
    if (body.progress !== undefined) {
      const progress = Number(body.progress);
      if (isNaN(progress) || progress < 0 || progress > 100) {
        return NextResponse.json(
          { error: "progress는 0에서 100 사이의 숫자여야 합니다" },
          { status: 400 }
        );
      }
    }

    // Validate kpis if provided
    if (body.kpis !== undefined && !Array.isArray(body.kpis)) {
      return NextResponse.json(
        { error: "kpis는 배열이어야 합니다" },
        { status: 400 }
      );
    }

    // Validate string fields if provided
    const stringFields: (keyof UpdateProjectInput)[] = ["name", "description", "status", "url"];
    for (const field of stringFields) {
      if (body[field] !== undefined && typeof body[field] !== "string") {
        return NextResponse.json(
          { error: `${field}는 문자열이어야 합니다` },
          { status: 400 }
        );
      }
    }

    const project = await updateProject(id, body);

    if (!project) {
      return NextResponse.json(
        { error: "프로젝트를 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    // Broadcast SSE event (non-blocking, errors logged but not thrown)
    try {
      sseBroadcaster.broadcast({
        type: "project:updated",
        data: { project },
        timestamp: new Date().toISOString(),
      });
    } catch (broadcastError) {
      console.error("Failed to broadcast SSE event:", broadcastError);
    }

    return NextResponse.json({ success: true, project });
  } catch (error) {
    console.error("Failed to update project:", error);
    return NextResponse.json(
      { error: "프로젝트 업데이트에 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/projects/[id]
 * Delete a project
 * Auth: session cookie or x-relay-key header
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const success = await deleteProject(id);

    if (!success) {
      return NextResponse.json(
        { error: "프로젝트를 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    // Broadcast SSE event (non-blocking, errors logged but not thrown)
    try {
      sseBroadcaster.broadcast({
        type: "project:deleted",
        data: { projectId: id },
        timestamp: new Date().toISOString(),
      });
    } catch (broadcastError) {
      console.error("Failed to broadcast SSE event:", broadcastError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete project:", error);
    return NextResponse.json(
      { error: "프로젝트 삭제에 실패했습니다" },
      { status: 500 }
    );
  }
}
