import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { getFeedbackSummary } from "@/lib/feedback";

/**
 * GET /api/feedback/summary
 * Get aggregated feedback summary
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
    const days = parseInt(searchParams.get("days") || "30", 10);

    const summary = await getFeedbackSummary({ agentId, days });
    return NextResponse.json({ summary });
  } catch (error) {
    console.error("Failed to fetch feedback summary:", error);
    return NextResponse.json(
      { error: "피드백 요약 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}
