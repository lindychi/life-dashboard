/**
 * useOKRSSE Hook
 *
 * React hook for handling OKR-related SSE events
 */

import { useSSE, type SSEEvent } from "./useSSE";

export interface OKRSSEHandlers {
  onObjectiveCreated?: (data: { objective: unknown }) => void;
  onObjectiveUpdated?: (data: { objective: unknown }) => void;
  onObjectiveDeleted?: (data: { objectiveId: string }) => void;
  onKeyResultCreated?: (data: { keyResult: unknown }) => void;
  onKeyResultUpdated?: (data: { keyResult: unknown }) => void;
  onKeyResultDeleted?: (data: { keyResultId: string }) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
}

export function useOKRSSE(handlers: OKRSSEHandlers = {}) {
  const {
    onObjectiveCreated,
    onObjectiveUpdated,
    onObjectiveDeleted,
    onKeyResultCreated,
    onKeyResultUpdated,
    onKeyResultDeleted,
    onConnect,
    onDisconnect,
    onError,
  } = handlers;

  const handleEvent = (event: SSEEvent) => {
    switch (event.type) {
      case "okr:objective:created":
        onObjectiveCreated?.(event.data as { objective: unknown });
        break;

      case "okr:objective:updated":
        onObjectiveUpdated?.(event.data as { objective: unknown });
        break;

      case "okr:objective:deleted":
        onObjectiveDeleted?.(event.data as { objectiveId: string });
        break;

      case "okr:key-result:created":
        onKeyResultCreated?.(event.data as { keyResult: unknown });
        break;

      case "okr:key-result:updated":
        onKeyResultUpdated?.(event.data as { keyResult: unknown });
        break;

      case "okr:key-result:deleted":
        onKeyResultDeleted?.(event.data as { keyResultId: string });
        break;

      case "heartbeat":
        // Ignore heartbeat events
        break;

      default:
        // Ignore other events
        break;
    }
  };

  const { disconnect, reconnect } = useSSE({
    onConnect,
    onDisconnect,
    onError,
    onEvent: handleEvent,
  });

  return {
    disconnect,
    reconnect,
  };
}
