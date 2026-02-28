/**
 * GET /api/projects/[id]/metrics/history
 * 프로젝트 메트릭 히스토리 조회 (시계열 데이터)
 */

import { NextRequest, NextResponse } from "next/server";
import { getProjectMetricsHistory } from "@/lib/project-metrics";
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
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    const history = await getProjectMetricsHistory(projectId, limit);

    return NextResponse.json({
      success: true,
      history: history,
      count: history.length,
    });
  } catch (error) {
    console.error("Failed to fetch metrics history:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
