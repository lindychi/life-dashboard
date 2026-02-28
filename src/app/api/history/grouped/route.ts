import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getGroupedHistory } from "@/lib/history";
import { isDbConnectionError } from "@/lib/db";

export const dynamic = 'force-dynamic';

/**
 * GET /api/history/grouped
 *
 * 요청 그룹별로 그룹화된 히스토리 조회
 *
 * Query parameters:
 *   - limit: Max number of groups to return (default: 20, max: 100)
 *   - agentId: Filter by specific agent (optional)
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") || "20", 10)));
    const agentId = searchParams.get("agentId") || undefined;

    const groups = await getGroupedHistory(limit, { agentId });

    return NextResponse.json({
      groups,
      count: groups.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        {
          groups: [],
          count: 0,
          generatedAt: new Date().toISOString(),
        },
        { status: 503 }
      );
    }
    console.error("History grouped GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
