import { NextRequest, NextResponse } from "next/server";
import {
  validateRelayKey,
  updateHeartbeat,
  getAndClearCommands,
  updateAgentStatuses,
} from "@/lib/relay";
import { addHistoryEntry } from "@/lib/history";
import { isDbConnectionError } from "@/lib/db";

// Gateway가 주기적으로 호출 (polling)
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-relay-key");

  if (!apiKey || !validateRelayKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const { gatewayId, agents, historyEntries } = await request.json();

    if (!gatewayId) {
      return NextResponse.json(
        { error: "gatewayId required" },
        { status: 400 }
      );
    }

    // Update heartbeat (fire-and-forget, ignore DB errors)
    try {
      await updateHeartbeat(gatewayId);
    } catch (error) {
      if (!isDbConnectionError(error)) {
        throw error;
      }
    }

    // Update agent statuses if provided (fire-and-forget, ignore DB errors)
    if (agents && Array.isArray(agents)) {
      try {
        await updateAgentStatuses(gatewayId, agents);
      } catch (error) {
        if (!isDbConnectionError(error)) {
          throw error;
        }
      }
    }

    // 히스토리 엔트리 저장 (fire-and-forget, ignore DB errors)
    if (historyEntries && Array.isArray(historyEntries)) {
      for (const entry of historyEntries) {
        if (entry.agentId && entry.type && entry.content) {
          try {
            await addHistoryEntry(entry.agentId, {
              agentId: entry.agentId,
              type: entry.type,
              content: entry.content,
              metadata: entry.metadata,
            });
          } catch (error) {
            if (!isDbConnectionError(error)) {
              throw error;
            }
          }
        }
      }
    }

    // Get pending commands (has fallback for DB down)
    const commands = await getAndClearCommands(gatewayId);

    return NextResponse.json({
      commands,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Poll error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
