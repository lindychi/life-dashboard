import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getConnectedGateways, getAllAgentStatuses, validateRelayKey, isDbAvailable } from "@/lib/relay";
import { isDbConnectionError } from "@/lib/db";

// Dashboard에서 현재 상태 조회 (supports both user session and relay key auth)
export async function GET(request: NextRequest) {
  // 인증 체크: relay key 또는 user session
  const relayValid = validateRelayKey(request.headers.get("x-relay-key") || "");
  const user = relayValid ? null : await getCurrentUser();
  if (!relayValid && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const gateways = await getConnectedGateways();
    const agents = await getAllAgentStatuses();

    return NextResponse.json({
      gateways,
      agents,
      dbConnected: isDbAvailable(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json({
        gateways: [],
        agents: {},
        dbConnected: false,
        timestamp: new Date().toISOString(),
      });
    }
    console.error("Status error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
