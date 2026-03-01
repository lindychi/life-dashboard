import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { getImprovementActions } from "@/lib/feedback";

/**
 * GET /api/improvements
 * List improvement actions with optional status filter
 * Auth: session cookie or x-relay-key header
 */
export async function GET(request: NextRequest) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;

    const actions = await getImprovementActions(status);
    return NextResponse.json({ actions });
  } catch (error) {
    console.error("Failed to fetch improvement actions:", error);
    return NextResponse.json(
      { error: "개선 액션 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}
