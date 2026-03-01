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

// Long-polling configuration
const MAX_LONG_POLL_MS = 30_000;
const LONG_POLL_INTERVAL_MS = 500;

// Parse and clamp the ?timeout= query param.
// Returns 0 for absent, invalid, or negative values.
function parseLongPollTimeout(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get("timeout");
  if (raw === null) return 0;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, MAX_LONG_POLL_MS);
}

// Gateway가 주기적으로 호출 (polling). Supports long-polling via ?timeout=<ms>.
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

    // Determine idle agent IDs for queue draining (used in every poll iteration)
    const idleAgentIds: string[] =
      agents && Array.isArray(agents)
        ? agents
            .filter((a: { status: string }) => a.status === "idle")
            .map((a: { id: string }) => a.id)
        : [];

    // Helper: fetch commands + drain idle-agent queue in one shot
    async function fetchCommands(): Promise<import("@/lib/relay").RelayCommand[]> {
      const commands = await getAndClearCommands(gatewayId);
      if (idleAgentIds.length > 0) {
        try {
          const drained = await drainQueueForIdleAgents(gatewayId, idleAgentIds);
          commands.push(...drained);
        } catch {
          // Queue drain is best-effort
        }
      }
      return commands;
    }

    // Determine long-poll duration (0 = return immediately)
    const longPollMs = parseLongPollTimeout(request);

    if (longPollMs === 0) {
      // Backward-compatible: return immediately
      const commands = await fetchCommands();
      return NextResponse.json({
        commands,
        timestamp: new Date().toISOString(),
      });
    }

    // Long-poll loop: check every LONG_POLL_INTERVAL_MS until we have
    // commands or the timeout elapses.
    const deadline = Date.now() + longPollMs;

    while (true) {
      const commands = await fetchCommands();
      if (commands.length > 0) {
        return NextResponse.json({
          commands,
          timestamp: new Date().toISOString(),
        });
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        // Timeout elapsed — return empty
        return NextResponse.json({
          commands: [],
          timestamp: new Date().toISOString(),
        });
      }

      // Sleep for the lesser of LONG_POLL_INTERVAL_MS and remaining time
      const sleepMs = Math.min(LONG_POLL_INTERVAL_MS, remaining);
      await new Promise<void>((resolve) => setTimeout(resolve, sleepMs));
    }
  } catch (error) {
    console.error("Poll error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
