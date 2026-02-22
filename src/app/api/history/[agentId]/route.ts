import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAgentHistory, clearAgentHistory } from "@/lib/history";
import { isDbConnectionError } from "@/lib/db";

interface RouteParams {
  params: Promise<{
    agentId: string;
  }>;
}

/**
 * GET /api/history/[agentId]
 * 특정 에이전트의 히스토리 조회
 */
export async function GET(request: NextRequest, props: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const params = await props.params;
    const { agentId } = params;

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const history = await getAgentHistory(agentId, limit);

    return NextResponse.json({ agentId, history });
  } catch (error) {
    if (isDbConnectionError(error)) {
      const params = await props.params;
      return NextResponse.json({ agentId: params.agentId, history: [] });
    }
    console.error("History GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/history/[agentId]
 * 특정 에이전트의 히스토리 삭제
 */
export async function DELETE(request: NextRequest, props: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const params = await props.params;
    const { agentId } = params;

    await clearAgentHistory(agentId);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("History DELETE error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
