import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAgentHistory, clearAgentHistory } from "@/lib/history";
import { isDbConnectionError } from "@/lib/db";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{
    agentId: string;
  }>;
}

/**
 * GET /api/history/[agentId]
 *
 * 특정 에이전트의 히스토리 조회
 *
 * Query parameters:
 *   - limit: Max entries to return (default: 50, max: 500)
 */
export async function GET(request: NextRequest, props: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const params = await props.params;
    const { agentId } = params;

    // Validate agentId format (basic check)
    if (!agentId || typeof agentId !== 'string' || agentId.trim() === '') {
      return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(500, parseInt(searchParams.get("limit") || "50", 10)));

    const history = await getAgentHistory(agentId, limit);

    return NextResponse.json({
      agentId,
      history,
      count: history.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (isDbConnectionError(error)) {
      const params = await props.params;
      return NextResponse.json(
        {
          agentId: params.agentId,
          history: [],
          count: 0,
          generatedAt: new Date().toISOString(),
        },
        { status: 503 }
      );
    }
    console.error("History GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/history/[agentId]
 *
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

    // Validate agentId format (basic check)
    if (!agentId || typeof agentId !== 'string' || agentId.trim() === '') {
      return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
    }

    await clearAgentHistory(agentId);

    return NextResponse.json({
      success: true,
      agentId,
      deletedAt: new Date().toISOString(),
    });
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
