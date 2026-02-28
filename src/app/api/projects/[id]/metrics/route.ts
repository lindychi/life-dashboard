/**
 * GET /api/projects/[id]/metrics
 * 특정 프로젝트의 실시간 메트릭 조회
 *
 * POST /api/projects/[id]/metrics
 * 특정 프로젝트의 메트릭 스냅샷 생성
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getProjectKPISummary,
  snapshotProjectMetrics,
} from "@/lib/project-metrics";
import { getCurrentUser } from "@/lib/auth";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

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

    const summary = await getProjectKPISummary(projectId);

    return NextResponse.json({
      success: true,
      metrics: summary,
    });
  } catch (error) {
    console.error("Failed to fetch project metrics:", error);
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

    const snapshotId = await snapshotProjectMetrics(projectId);

    // Broadcast SSE event (non-blocking, errors logged but not thrown)
    try {
      const summary = await getProjectKPISummary(projectId);
      sseBroadcaster.broadcast({
        type: "project:metrics:updated",
        data: {
          projectId,
          snapshotId,
          metrics: summary,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (broadcastError) {
      console.error("Failed to broadcast SSE event:", broadcastError);
    }

    return NextResponse.json({
      success: true,
      snapshot: {
        snapshot_id: snapshotId,
        project_id: projectId,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to create metrics snapshot:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
