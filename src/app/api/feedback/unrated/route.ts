import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { getUnratedTasks } from "@/lib/feedback";

/**
 * GET /api/feedback/unrated
 * Get tasks awaiting feedback
 * Auth: session cookie or x-relay-key header
 */
export async function GET(request: NextRequest) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const tasks = await getUnratedTasks(limit);
    return NextResponse.json({ tasks });
  } catch (error) {
    console.error("Failed to fetch unrated tasks:", error);
    return NextResponse.json(
      { error: "미평가 태스크 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}
