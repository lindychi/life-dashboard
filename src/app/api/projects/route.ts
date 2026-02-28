import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { getProjects, createProject, type CreateProjectInput } from "@/lib/projects";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

/**
 * GET /api/projects
 * Fetch all projects
 * Auth: session cookie or x-relay-key header
 */
export async function GET(request: NextRequest) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const projects = await getProjects();
    return NextResponse.json({ projects });
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return NextResponse.json(
      { error: "프로젝트 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects
 * Create a new project
 * Auth: session cookie or x-relay-key header
 */
export async function POST(request: NextRequest) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Required field validation
    const requiredFields: (keyof CreateProjectInput)[] = ["name", "description"];

    for (const field of requiredFields) {
      if (!body[field] || typeof body[field] !== "string" || body[field].trim() === "") {
        return NextResponse.json(
          { error: `필수 필드가 누락되었습니다: ${field}` },
          { status: 400 }
        );
      }
    }

    // Optional field validation
    if (body.progress !== undefined) {
      const progress = Number(body.progress);
      if (isNaN(progress) || progress < 0 || progress > 100) {
        return NextResponse.json(
          { error: "progress는 0에서 100 사이의 숫자여야 합니다" },
          { status: 400 }
        );
      }
    }

    if (body.kpis !== undefined && !Array.isArray(body.kpis)) {
      return NextResponse.json(
        { error: "kpis는 배열이어야 합니다" },
        { status: 400 }
      );
    }

    const project = await createProject(body);

    // Broadcast SSE event (non-blocking, errors logged but not thrown)
    try {
      sseBroadcaster.broadcast({
        type: "project:created",
        data: { project },
        timestamp: new Date().toISOString(),
      });
    } catch (broadcastError) {
      console.error("Failed to broadcast SSE event:", broadcastError);
      // Continue - SSE broadcast failure should not affect API response
    }

    return NextResponse.json({ success: true, project }, { status: 201 });
  } catch (error) {
    console.error("Failed to create project:", error);
    return NextResponse.json(
      { error: "프로젝트 생성에 실패했습니다" },
      { status: 500 }
    );
  }
}
