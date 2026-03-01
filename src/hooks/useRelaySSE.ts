/**
 * useRelaySSE Hook
 *
 * React hook for handling relay/gateway status SSE events.
 * When SSE is connected, components can reduce or eliminate polling of
 * /api/relay/status (currently polled every 5 s in page.tsx).
 */

import { useSSE, type SSEEvent } from "./useSSE";

export interface RelayStatus {
  connected?: boolean;
  gatewayId?: string;
  agentCount?: number;
  [key: string]: unknown;
}

export interface RelaySSEHandlers {
  onRelayStatusUpdate?: (status: RelayStatus) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
}

export function useRelaySSE(handlers: RelaySSEHandlers = {}) {
  const { onRelayStatusUpdate, onConnect, onDisconnect, onError } = handlers;

  const handleEvent = (event: SSEEvent) => {
    switch (event.type) {
      case "relay:status":
        onRelayStatusUpdate?.(event.data as RelayStatus);
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
