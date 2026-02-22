import { NextRequest, NextResponse } from "next/server";
import { validateRelayKey } from "@/lib/relay";
import {
  getAgents,
  getAllAgents,
  getAgentsByCategory,
  type AgentConfig,
} from "@/lib/agents";

/**
 * GET /api/relay/agents
 * Relay-authenticated agent list endpoint
 * Query params:
 *   - category?: "dev" | "business" | "ops"
 *   - all?: include disabled agents (default false)
 */
export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-relay-key");

  if (!apiKey || !validateRelayKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const showAll = searchParams.get("all") === "true";
    const category = searchParams.get("category") as
      | AgentConfig["category"]
      | null;

    let agents: AgentConfig[];

    if (category) {
      // Category filtering
      agents = getAgentsByCategory(category);
      if (!showAll) {
        agents = agents.filter((a) => a.enabled);
      }
    } else if (showAll) {
      agents = getAllAgents();
    } else {
      agents = getAgents();
    }

    return NextResponse.json({ agents });
  } catch (error) {
    console.error("Relay agents GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
