import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getConnectedGateways,
  getAllAgentStatuses,
  validateRelayKey,
  isDbAvailable,
  getPendingInstructions,
  getPendingCommands,
} from "@/lib/relay";
import { isDbConnectionError } from "@/lib/db";
import type { QueuedCommandEntry } from "@/lib/types";

// Dashboard에서 현재 상태 조회 (supports both user session and relay key auth)
export async function GET(request: NextRequest) {
  // 인증 체크: relay key 또는 user session
  const relayValid = validateRelayKey(
    request.headers.get("x-relay-key") || ""
  );
  const user = relayValid ? null : await getCurrentUser();
  if (!relayValid && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const gateways = await getConnectedGateways();
    const agents = await getAllAgentStatuses();
    const pendingInstructions = await getPendingInstructions();
    const pendingCmds = await getPendingCommands();

    // Group pending instructions by agent
    const instructionsByAgent: Record<
      string,
      Array<{ id: string; content: string; createdAt: string; position: number }>
    > = {};

    for (const instruction of pendingInstructions) {
      if (!instructionsByAgent[instruction.agentId]) {
        instructionsByAgent[instruction.agentId] = [];
      }
      instructionsByAgent[instruction.agentId].push({
        id: instruction.id,
        content: instruction.content,
        createdAt: instruction.createdAt,
        position: instruction.position,
      });
    }

    // Group queued commands by agent
    const commandsByAgent: Record<string, QueuedCommandEntry[]> = {};

    for (const cmd of pendingCmds) {
      const agentId = cmd.agentId || "unknown";
      if (!commandsByAgent[agentId]) {
        commandsByAgent[agentId] = [];
      }
      commandsByAgent[agentId].push({
        id: cmd.id,
        type: cmd.type,
        payload: cmd.payload,
        createdAt: cmd.createdAt,
        status: "pending",
      });
    }

    return NextResponse.json({
      gateways,
      agents,
      pendingInstructions: instructionsByAgent,
      pendingCount: pendingInstructions.length,
      queuedCommands: commandsByAgent,
      queuedCommandsCount: pendingCmds.length,
      dbConnected: isDbAvailable(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json({
        gateways: [],
        agents: {},
        pendingInstructions: {},
        pendingCount: 0,
        queuedCommands: {},
        queuedCommandsCount: 0,
        dbConnected: false,
        timestamp: new Date().toISOString(),
      });
    }
    console.error("Status error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
