import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  queueCommand,
  getConnectedGateways,
  validateRelayKey,
  isDbAvailable,
  queueInstruction,
  isAgentBusy,
} from "@/lib/relay";
import { isDbConnectionError } from "@/lib/db";

// Dashboard에서 Gateway로 명령 전송 (supports both user session and relay key auth)
export async function POST(request: NextRequest) {
  // 인증 체크: relay key 또는 user session
  const relayValid = validateRelayKey(
    request.headers.get("x-relay-key") || ""
  );
  const user = relayValid ? null : await getCurrentUser();
  if (!relayValid && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { gatewayId, type, payload, queue } = await request.json();

    // gatewayId 없으면 첫 번째 연결된 gateway 사용
    let targetGateway = gatewayId;
    if (!targetGateway) {
      const gateways = (await getConnectedGateways()).filter(
        (g) => g.status === "connected"
      );
      // If no connected gateways and DB is down, use default gateway
      if (gateways.length === 0) {
        if (!isDbAvailable()) {
          targetGateway = "default";
        } else {
          return NextResponse.json(
            { error: "No connected gateway" },
            { status: 400 }
          );
        }
      } else {
        targetGateway = gateways[0].id;
      }
    }

    if (!type || !payload) {
      return NextResponse.json(
        { error: "type and payload required" },
        { status: 400 }
      );
    }

    // Check if we should queue this instruction instead of sending immediately
    const shouldQueue =
      queue === true ||
      ((type === "orchestrate" || type === "spawn") &&
        payload.agentId &&
        (await isAgentBusy(targetGateway, payload.agentId)));

    const instruction =
      (payload.instruction as string | undefined) ||
      (payload.task as string | undefined);

    if (shouldQueue && payload.agentId && instruction) {
      // Queue instruction for later execution
      const { id, position } = await queueInstruction(
        targetGateway,
        payload.agentId,
        instruction,
        payload.metadata
      );

      return NextResponse.json({
        success: true,
        queued: true,
        position,
        instructionId: id,
      });
    }

    // Send command immediately
    const command = await queueCommand(targetGateway, { type, payload });

    return NextResponse.json({
      success: true,
      command,
    });
  } catch (error) {
    console.error("Command error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
