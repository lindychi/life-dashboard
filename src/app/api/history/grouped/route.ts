import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getGroupedHistory } from "@/lib/history";
import { isDbConnectionError } from "@/lib/db";

/**
 * GET /api/history/grouped
 * 요청 그룹별로 그룹화된 히스토리 조회
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const groups = await getGroupedHistory(limit);

    return NextResponse.json({ groups });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json({ groups: [] });
    }
    console.error("History grouped GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
