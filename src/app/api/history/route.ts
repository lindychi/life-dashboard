import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAllHistory, addHistoryEntry } from "@/lib/history";
import { isDbConnectionError } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/history
 * 모든 에이전트의 히스토리 조회
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const history = await getAllHistory(limit);

    return NextResponse.json({ history });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json({ history: {} });
    }
    console.error("History GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/history
 * 히스토리 엔트리 추가
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { agentId, type, content, metadata, requestGroupId, requestTitle } = await request.json();

    if (!agentId || !type || !content) {
      return NextResponse.json(
        { error: "agentId, type, and content are required" },
        { status: 400 }
      );
    }

    const entry = await addHistoryEntry(agentId, {
      agentId,
      type,
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
