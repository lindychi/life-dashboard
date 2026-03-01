import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { getFeedbackTrends } from "@/lib/feedback";

/**
 * GET /api/feedback/trends
 * Get weekly feedback trends
 * Auth: session cookie or x-relay-key header
 */
export async function GET(request: NextRequest) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get("agentId") || undefined;
    const weeks = parseInt(searchParams.get("weeks") || "12", 10);

    const trends = await getFeedbackTrends({ agentId, weeks });
    return NextResponse.json({ trends });
  } catch (error) {
    console.error("Failed to fetch feedback trends:", error);
    return NextResponse.json(
      { error: "피드백 트렌드 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}
