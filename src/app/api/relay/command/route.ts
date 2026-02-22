import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { queueCommand, getConnectedGateways, validateRelayKey } from "@/lib/relay";
import { isDbConnectionError } from "@/lib/db";

// Dashboard에서 Gateway로 명령 전송 (supports both user session and relay key auth)
export async function POST(request: NextRequest) {
  // 인증 체크: relay key 또는 user session
  const relayValid = validateRelayKey(request.headers.get("x-relay-key") || "");
  const user = relayValid ? null : await getCurrentUser();
  if (!relayValid && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { gatewayId, type, payload } = await request.json();

    // gatewayId 없으면 첫 번째 연결된 gateway 사용
    let targetGateway = gatewayId;
    if (!targetGateway) {
      const gateways = (await getConnectedGateways()).filter(
        (g) => g.status === "connected"
      );
      if (gateways.length === 0) {
        return NextResponse.json(
          { error: "No connected gateway" },
          { status: 400 }
        );
      }
      targetGateway = gateways[0].id;
    }

    if (!type || !payload) {
      return NextResponse.json(
        { error: "type and payload required" },
        { status: 400 }
      );
    }

    const command = await queueCommand(targetGateway, { type, payload });

    return NextResponse.json({
      success: true,
      command,
    });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Command error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
