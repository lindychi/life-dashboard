import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAllHistory } from "@/lib/history";

/**
 * GET /api/history
 * 모든 에이전트의 히스토리 조회
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  const history = await getAllHistory(limit);

  return NextResponse.json({ history });
}
