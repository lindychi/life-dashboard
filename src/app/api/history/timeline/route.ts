import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getFilteredHistory } from "@/lib/history";
import { isDbConnectionError } from "@/lib/db";

/**
 * GET /api/history/timeline
 * 필터링 + 커서 기반 페이지네이션을 지원하는 타임라인 API
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);

    const filters = {
      agentId: searchParams.get("agentId") || undefined,
      types: searchParams.get("types")?.split(",").filter(Boolean) || undefined,
      excludeTypes: searchParams.get("excludeTypes")?.split(",").filter(Boolean) || undefined,
      search: searchParams.get("search") || undefined,
      dateFrom: searchParams.get("dateFrom") || undefined,
      dateTo: searchParams.get("dateTo") || undefined,
      cursor: searchParams.get("cursor") || undefined,
      limit: searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined,
    };

    const result = await getFilteredHistory(filters);

    return NextResponse.json(result);
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json({
        entries: [],
        nextCursor: null,
        totalCount: 0,
        hasMore: false,
      });
    }
    console.error("Timeline GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
