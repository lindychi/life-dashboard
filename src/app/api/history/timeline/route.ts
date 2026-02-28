import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getFilteredHistory } from "@/lib/history";
import { isDbConnectionError } from "@/lib/db";

export const dynamic = 'force-dynamic';

/**
 * GET /api/history/timeline
 *
 * 필터링 + 커서 기반 페이지네이션을 지원하는 타임라인 API
 *
 * Query parameters:
 *   - agentId: Filter by agent ID (optional)
 *   - types: Comma-separated list of event types (optional)
 *   - excludeTypes: Comma-separated list of types to exclude (optional)
 *   - search: Search in content (optional)
 *   - dateFrom: ISO date string for start filter (optional)
 *   - dateTo: ISO date string for end filter (optional)
 *   - requestGroupId: Filter by request group (optional)
 *   - cursor: Cursor for pagination (format: "timestamp|id") (optional)
 *   - limit: Max entries per page (default: 50, max: 100)
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);

    // Parse and validate query parameters
    const filters = {
      agentId: searchParams.get("agentId") || undefined,
      types: searchParams.get("types")?.split(",").filter(Boolean) || undefined,
      excludeTypes: searchParams.get("excludeTypes")?.split(",").filter(Boolean) || undefined,
      search: searchParams.get("search") || undefined,
      dateFrom: searchParams.get("dateFrom") || undefined,
      dateTo: searchParams.get("dateTo") || undefined,
      requestGroupId: searchParams.get("requestGroupId") || undefined,
      cursor: searchParams.get("cursor") || undefined,
      limit: Math.max(1, Math.min(100, parseInt(searchParams.get("limit") || "50", 10))),
    };

    const result = await getFilteredHistory(filters);

    return NextResponse.json({
      ...result,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        {
          entries: [],
          nextCursor: null,
          totalCount: 0,
          hasMore: false,
          generatedAt: new Date().toISOString(),
        },
        { status: 503 }
      );
    }
    console.error("Timeline GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
