/**
 * useAgentStatsSSE Hook
 *
 * React hook for handling agent stats SSE events.
 * Allows the agent performance dashboard to auto-refresh
 * without polling /api/relay/status.
 */

import { useSSE, type SSEEvent } from "./useSSE";

export interface AgentStats {
  agentId: string;
  stats: Record<string, unknown>;
}

export interface AgentStatsSSEHandlers {
  onAgentStatsUpdated?: (payload: AgentStats) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
}

export function useAgentStatsSSE(handlers: AgentStatsSSEHandlers = {}) {
  const { onAgentStatsUpdated, onConnect, onDisconnect, onError } = handlers;

  const handleEvent = (event: SSEEvent) => {
    switch (event.type) {
      case "agent:stats:updated":
        onAgentStatsUpdated?.(event.data as AgentStats);
        break;

      case "heartbeat":
        // Ignore heartbeat
        break;

      default:
        break;
    }
  };

  const { disconnect, reconnect } = useSSE({
    onConnect,
    onDisconnect,
    onError,
    onEvent: handleEvent,
  });

  return { disconnect, reconnect };
}
