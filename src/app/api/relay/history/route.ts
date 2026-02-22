import { NextRequest, NextResponse } from "next/server";
import { validateRelayKey } from "@/lib/relay";
import {
  getAllHistory,
  getAgentHistory,
  addHistoryEntry,
} from "@/lib/history";

/**
 * GET /api/relay/history
 * Relay-authenticated history endpoint
 * Query params:
 *   - agentId?: specific agent history
 *   - limit?: max entries (default 50)
 */
export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-relay-key");

  if (!apiKey || !validateRelayKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get("agentId");
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    if (agentId) {
      // Get history for specific agent
      const history = await getAgentHistory(agentId, limit);
      return NextResponse.json({ history });
    } else {
      // Get history for all agents
      const history = await getAllHistory(limit);
      return NextResponse.json({ history });
    }
  } catch (error) {
    console.error("Relay history GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/relay/history
 * Write a history entry
 * Body: { agentId: string, type: string, content: string, metadata?: object }
 */
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-relay-key");

  if (!apiKey || !validateRelayKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const { agentId, type, content, metadata } = await request.json();

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
    });

    return NextResponse.json({ success: true, entry });
  } catch (error) {
    console.error("Relay history POST error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
