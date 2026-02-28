/**
 * GET /api/projects/metrics
 * 모든 프로젝트의 최신 메트릭 조회
 */

import { NextRequest, NextResponse } from "next/server";
import { getAllProjectsKPISummary } from "@/lib/project-metrics";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  // 인증 확인
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await getAllProjectsKPISummary();

    return NextResponse.json({
      success: true,
      data: summary,
      count: summary.length,
    });
  } catch (error) {
    console.error("Failed to fetch project metrics:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
