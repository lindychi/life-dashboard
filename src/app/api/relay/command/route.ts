import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { queueCommand, getConnectedGateways } from "@/lib/relay";

// Dashboard에서 Gateway로 명령 전송
export async function POST(request: NextRequest) {
  // 인증 체크
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { gatewayId, type, payload } = await request.json();

    // gatewayId 없으면 첫 번째 연결된 gateway 사용
    let targetGateway = gatewayId;
    if (!targetGateway) {
      const gateways = getConnectedGateways().filter(
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

    const command = queueCommand(targetGateway, { type, payload });

    return NextResponse.json({
      success: true,
      command,
    });
  } catch (error) {
    console.error("Command error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
