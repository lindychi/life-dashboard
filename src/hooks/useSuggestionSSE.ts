/**
 * useSuggestionSSE Hook
 *
 * React hook for handling suggestion and agent-call SSE events
 */

import { useSSE, type SSEEvent } from "./useSSE";

export interface SuggestionSSEHandlers {
  onSuggestionCreated?: (data: { suggestion: unknown }) => void;
  onSuggestionApproved?: (data: { suggestion: unknown }) => void;
  onSuggestionRejected?: (data: { suggestion: unknown }) => void;
  onSuggestionCompleted?: (data: { suggestion: unknown }) => void;
  onAgentCallRequested?: (data: { call: unknown }) => void;
  onAgentCallCompleted?: (data: { call: unknown }) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
}

export function useSuggestionSSE(handlers: SuggestionSSEHandlers = {}) {
  const {
    onSuggestionCreated,
    onSuggestionApproved,
    onSuggestionRejected,
    onSuggestionCompleted,
    onAgentCallRequested,
    onAgentCallCompleted,
    onConnect,
    onDisconnect,
    onError,
  } = handlers;

  const handleEvent = (event: SSEEvent) => {
    switch (event.type) {
      case "suggestion:created":
        onSuggestionCreated?.(event.data as { suggestion: unknown });
        break;

      case "suggestion:approved":
        onSuggestionApproved?.(event.data as { suggestion: unknown });
        break;

      case "suggestion:rejected":
        onSuggestionRejected?.(event.data as { suggestion: unknown });
        break;

      case "suggestion:completed":
        onSuggestionCompleted?.(event.data as { suggestion: unknown });
        break;

      case "agent-call:requested":
        onAgentCallRequested?.(event.data as { call: unknown });
        break;

      case "agent-call:completed":
        onAgentCallCompleted?.(event.data as { call: unknown });
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
