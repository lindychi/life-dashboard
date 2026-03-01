/**
 * SSE Event Broadcast Helpers (C-4)
 *
 * Typed helpers for broadcasting relay/agent/metrics events.
 * Import these from API mutation routes or server-side utilities.
 */

import { broadcastSSE } from "./sse-broadcaster";

/**
 * Broadcast current relay/gateway connection status to all SSE clients.
 */
export function broadcastRelayStatus(status: Record<string, unknown>): void {
  broadcastSSE({
    type: "relay:status",
    data: status,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Broadcast updated agent stats to all SSE clients.
 */
export function broadcastAgentStatsUpdate(
  agentId: string,
  stats: Record<string, unknown>
): void {
  broadcastSSE({
    type: "agent:stats:updated",
    data: { agentId, stats },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Broadcast a project metrics update to all SSE clients.
 * Also called internally by invalidateProjectMetrics() in api-cache.
 */
export function broadcastMetricsUpdate(
  projectId: string,
  metrics: Record<string, unknown>
): void {
  broadcastSSE({
    type: "project:metrics:updated",
    data: { projectId, metrics },
    timestamp: new Date().toISOString(),
  });
}
