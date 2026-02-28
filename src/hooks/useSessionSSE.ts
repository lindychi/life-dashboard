/**
 * useSessionSSE Hook
 *
 * React hook for handling conversation session-related SSE events
 */

import { useSSE, type SSEEvent } from "./useSSE";
import type {
  Conversation,
  ConversationMessage,
  ConversationStats,
} from "@/lib/conversations";

export interface SessionSSEHandlers {
  onConversationCreated?: (data: { conversation: Conversation }) => void;
  onConversationUpdated?: (data: { conversation: Conversation }) => void;
  onConversationDeleted?: (data: { conversationId: string }) => void;
  onMessageAdded?: (data: {
    conversationId: string;
    message: ConversationMessage;
  }) => void;
  onReadStatusUpdated?: (data: {
    conversationId: string;
    agentId: string;
    lastReadMessageId: string;
  }) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
}

export function useSessionSSE(handlers: SessionSSEHandlers = {}) {
  const {
    onConversationCreated,
    onConversationUpdated,
    onConversationDeleted,
    onMessageAdded,
    onReadStatusUpdated,
    onConnect,
    onDisconnect,
    onError,
  } = handlers;

  const handleEvent = (event: SSEEvent) => {
    switch (event.type) {
      case "conversation:created":
        onConversationCreated?.(event.data as { conversation: Conversation });
        break;

      case "conversation:updated":
        onConversationUpdated?.(event.data as { conversation: Conversation });
        break;

      case "conversation:deleted":
        onConversationDeleted?.(event.data as { conversationId: string });
        break;

      case "conversation:message:added":
        onMessageAdded?.(
          event.data as {
            conversationId: string;
            message: ConversationMessage;
          }
        );
        break;

      case "conversation:read-status:updated":
        onReadStatusUpdated?.(
          event.data as {
            conversationId: string;
            agentId: string;
            lastReadMessageId: string;
          }
        );
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
