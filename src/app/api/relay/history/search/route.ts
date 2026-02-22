import { NextRequest, NextResponse } from "next/server";
import { validateRelayKey } from "@/lib/relay";
import { query } from "@/lib/db";
import type { HistoryEntry } from "@/lib/history";

/**
 * GET /api/relay/history/search
 * Search history entries by content
 * Query params:
 *   - q: search query (required)
 *   - agentId?: filter by agent
 *   - limit?: max results (default 20)
 */
export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-relay-key");

  if (!apiKey || !validateRelayKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const searchQuery = searchParams.get("q");
    const agentId = searchParams.get("agentId");
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    if (!searchQuery) {
      return NextResponse.json(
        { error: "Search query 'q' is required" },
        { status: 400 }
      );
    }

    // Build SQL query
    const agentFilter = agentId ? "AND agent_id = $2" : "";
    const params = agentId
      ? [`%${searchQuery}%`, agentId, limit]
      : [`%${searchQuery}%`, limit];

    const paramIndex = agentId ? 3 : 2;

    const results = await query<HistoryEntry>(
      `SELECT id, agent_id as "agentId", type, content, metadata, created_at as timestamp
       FROM agent_history
       WHERE content ILIKE $1 ${agentFilter}
       ORDER BY created_at DESC
       LIMIT $${paramIndex}`,
      params
    );

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Relay history search error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
