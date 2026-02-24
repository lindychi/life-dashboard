import { NextRequest, NextResponse } from "next/server";
import { validateRelayKey } from "@/lib/relay";
import { getFilteredHistory } from "@/lib/history";
import { isDbConnectionError } from "@/lib/db";

/**
 * GET /api/relay/timeline
 * Relay-authenticated timeline endpoint for MCP server access
 * Same functionality as /api/history/timeline but uses relay key auth
 */
export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-relay-key");

  if (!apiKey || !validateRelayKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
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
      requestGroupId: searchParams.get("requestGroupId") || undefined,
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
    console.error("Relay timeline GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
