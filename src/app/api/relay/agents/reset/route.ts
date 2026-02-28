import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { validateRelayKey, resetAgentStatus } from "@/lib/relay";
import { addHistoryEntry } from "@/lib/history";
import { isDbConnectionError } from "@/lib/db";

/**
 * POST /api/relay/agents/reset
 * Manually reset an agent's status from error/stale to idle.
 * Requires user session auth or relay API key.
 *
 * Body: { agentId: string, gatewayId?: string }
 */
export async function POST(request: NextRequest) {
  // Auth: relay key or user session
  const relayValid = validateRelayKey(
    request.headers.get("x-relay-key") || ""
  );
  const user = relayValid ? null : await getCurrentUser();
  if (!relayValid && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { agentId, gatewayId } = await request.json();

    if (!agentId || typeof agentId !== "string") {
      return NextResponse.json(
        { error: "agentId required" },
        { status: 400 }
      );
    }

    const reset = await resetAgentStatus(agentId, gatewayId);

    if (!reset) {
      return NextResponse.json(
        { error: "Agent not found or not in error/stale state" },
        { status: 404 }
      );
    }

    // Record in history
    try {
      await addHistoryEntry(agentId, {
        type: "status_change",
        content: `🔄 수동 리셋: ${user?.email || "relay"} → idle`,
      });
    } catch {
      // Best-effort history logging
    }

    return NextResponse.json({
      success: true,
      agentId,
      newStatus: "idle",
    });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Agent reset error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
