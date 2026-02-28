import { NextRequest, NextResponse } from "next/server";
import {
  validateRelayKey,
  updateHeartbeat,
  getAndClearCommands,
  updateAgentStatuses,
  drainQueueForIdleAgents,
  recoverStaleProcessingCommands,
  recoverStaleErrorAgents,
} from "@/lib/relay";
import { addHistoryEntry } from "@/lib/history";
import { isDbConnectionError } from "@/lib/db";

// Throttle stale command recovery to run at most once per minute
let lastStaleRecoveryAt = 0;
const STALE_RECOVERY_INTERVAL_MS = 60_000;

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
              type: entry.type,
              content: entry.content,
              metadata: entry.metadata,
              requestGroupId: entry.requestGroupId,
              requestTitle: entry.requestTitle,
            });
          } catch (error) {
            if (!isDbConnectionError(error)) {
              throw error;
            }
          }
        }
      }
    }

    // Periodically clean up stale 'processing' commands and error agents (throttled to 1/min)
    const now = Date.now();
    if (now - lastStaleRecoveryAt > STALE_RECOVERY_INTERVAL_MS) {
      lastStaleRecoveryAt = now;
      try {
        await recoverStaleProcessingCommands();
      } catch {
        // Best-effort cleanup
      }
      try {
        await recoverStaleErrorAgents();
      } catch {
        // Best-effort cleanup
      }
    }

    // Get pending commands (has fallback for DB down)
    const commands = await getAndClearCommands(gatewayId);

    // Drain queued instructions for idle agents
    if (agents && Array.isArray(agents)) {
      const idleAgentIds = agents
        .filter((a: { status: string }) => a.status === "idle")
        .map((a: { id: string }) => a.id);

      try {
        const drained = await drainQueueForIdleAgents(gatewayId, idleAgentIds);
        commands.push(...drained);
      } catch {
        // Queue drain is best-effort
      }
    }

    return NextResponse.json({
      commands,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Poll error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
