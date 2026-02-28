import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAllHistory, addHistoryEntry } from "@/lib/history";
import { isDbConnectionError } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/history
 *
 * 모든 에이전트의 히스토리 조회
 *
 * Query parameters:
 *   - limit: Max entries per agent (default: 50, max: 500)
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(500, parseInt(searchParams.get("limit") || "50", 10)));

    const history = await getAllHistory(limit);

    return NextResponse.json({
      history,
      agentCount: Object.keys(history).length,
      totalEntries: Object.values(history).reduce((sum, entries) => sum + entries.length, 0),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        {
          history: {},
          agentCount: 0,
          totalEntries: 0,
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
 * POST /api/history
 *
 * 히스토리 엔트리 추가
 *
 * Request body:
 *   {
 *     agentId: string (required)
 *     type: string (required) - event type
 *     content: string (required)
 *     metadata?: object
 *     requestGroupId?: string
 *     requestTitle?: string
 *   }
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { agentId, type, content, metadata, requestGroupId, requestTitle } = body;

    // Validate required fields
    if (!agentId || !type || !content) {
      return NextResponse.json(
        { error: "agentId, type, and content are required" },
        { status: 400 }
      );
    }

    // Validate types
    if (typeof agentId !== 'string' || typeof type !== 'string' || typeof content !== 'string') {
      return NextResponse.json(
        { error: "agentId, type, and content must be strings" },
        { status: 400 }
      );
    }

    const entry = await addHistoryEntry(agentId, {
      type: type as any,
      content,
      metadata,
      requestGroupId,
      requestTitle,
    });

    return NextResponse.json({ success: true, entry });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("History POST error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
