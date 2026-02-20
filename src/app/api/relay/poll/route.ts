import { NextRequest, NextResponse } from "next/server";
import {
  validateRelayKey,
  updateHeartbeat,
  getAndClearCommands,
  updateAgentStatuses,
} from "@/lib/relay";

// Gateway가 주기적으로 호출 (polling)
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-relay-key");

  if (!apiKey || !validateRelayKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const { gatewayId, agents } = await request.json();

    if (!gatewayId) {
      return NextResponse.json(
        { error: "gatewayId required" },
        { status: 400 }
      );
    }

    // Update heartbeat
    updateHeartbeat(gatewayId);

    // Update agent statuses if provided
    if (agents && Array.isArray(agents)) {
      updateAgentStatuses(gatewayId, agents);
    }

    // Get pending commands
    const commands = getAndClearCommands(gatewayId);

    return NextResponse.json({
      commands,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Poll error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
