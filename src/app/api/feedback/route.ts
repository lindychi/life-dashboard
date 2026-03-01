import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { submitFeedback, getFeedback } from "@/lib/feedback";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

/**
 * GET /api/feedback
 * List feedback with optional filters
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
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const feedback = await getFeedback({ agentId, limit, offset });
    return NextResponse.json({ feedback });
  } catch (error) {
    console.error("Failed to fetch feedback:", error);
    return NextResponse.json(
      { error: "피드백 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/feedback
 * Submit new feedback
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
    if (!body.agentId || typeof body.agentId !== "string") {
      return NextResponse.json(
        { error: "필수 필드가 누락되었습니다: agentId" },
        { status: 400 }
      );
    }

    if (
      body.overallRating === undefined ||
      typeof body.overallRating !== "number" ||
      body.overallRating < 1 ||
      body.overallRating > 5 ||
      !Number.isInteger(body.overallRating)
    ) {
      return NextResponse.json(
        { error: "overallRating은 1에서 5 사이의 정수여야 합니다" },
        { status: 400 }
      );
    }

    const feedback = await submitFeedback(body);

    // Broadcast SSE event (non-blocking)
    try {
      sseBroadcaster.broadcast({
        type: "feedback:submitted",
        data: { feedback },
        timestamp: new Date().toISOString(),
      });
    } catch (broadcastError) {
      console.error("Failed to broadcast SSE event:", broadcastError);
    }

    return NextResponse.json({ success: true, feedback }, { status: 201 });
  } catch (error) {
    console.error("Failed to submit feedback:", error);
    return NextResponse.json(
      { error: "피드백 제출에 실패했습니다" },
      { status: 500 }
    );
  }
}
