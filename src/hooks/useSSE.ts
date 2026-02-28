/**
 * useSSE Hook
 *
 * React hook for connecting to SSE endpoint and receiving real-time updates
 */

import { useEffect, useRef, useCallback } from "react";

export type SSEEventType =
  | "connected"
  | "project:created"
  | "project:updated"
  | "project:deleted"
  | "project:metrics:updated"
  | "okr:objective:created"
  | "okr:objective:updated"
  | "okr:objective:deleted"
  | "okr:key-result:created"
  | "okr:key-result:updated"
  | "okr:key-result:deleted"
  | "conversation:created"
  | "conversation:updated"
  | "conversation:deleted"
  | "conversation:message:added"
  | "conversation:read-status:updated"
  | "task:status:changed"
  | "permission:approval:created"
  | "permission:approval:updated"
  | "permission:approval:responded"
  | "heartbeat";

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  timestamp: string;
}

export interface SSEOptions {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  onEvent?: (event: SSEEvent) => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export function useSSE(options: SSEOptions = {}) {
  const {
    onConnect,
    onDisconnect,
    onError,
    onEvent,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
  } = options;

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isIntentionalCloseRef = useRef(false);

  const connect = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    console.log("[SSE] Connecting to /api/sse...");
    const eventSource = new EventSource("/api/sse");
    eventSourceRef.current = eventSource;

    // Connection opened
    eventSource.onopen = () => {
      console.log("[SSE] Connection established");
      reconnectAttemptsRef.current = 0;
      onConnect?.();
    };

    // Generic message handler (catches all events)
    eventSource.onmessage = (event) => {
      try {
        const parsedData: SSEEvent = JSON.parse(event.data);
        console.log("[SSE] Event received:", parsedData.type, parsedData);
        onEvent?.(parsedData);
      } catch (err) {
        console.error("[SSE] Failed to parse event data:", err);
      }
    };

    // Specific event handlers
    const eventTypes: SSEEventType[] = [
      "connected",
      "project:created",
      "project:updated",
      "project:deleted",
      "project:metrics:updated",
      "okr:objective:created",
      "okr:objective:updated",
      "okr:objective:deleted",
      "okr:key-result:created",
      "okr:key-result:updated",
      "okr:key-result:deleted",
      "conversation:created",
      "conversation:updated",
      "conversation:deleted",
      "conversation:message:added",
      "conversation:read-status:updated",
      "task:status:changed",
      "permission:approval:created",
      "permission:approval:updated",
      "permission:approval:responded",
      "heartbeat",
    ];

    eventTypes.forEach((eventType) => {
      eventSource.addEventListener(eventType, (event: MessageEvent) => {
        try {
          const parsedData: SSEEvent = JSON.parse(event.data);
          onEvent?.(parsedData);
        } catch (err) {
          console.error(`[SSE] Failed to parse ${eventType} event:`, err);
        }
      });
    });

    // Error handler
    eventSource.onerror = (error) => {
      console.error("[SSE] Connection error:", error);
      onError?.(error);

      // Attempt reconnection if not intentional close
      if (!isIntentionalCloseRef.current) {
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          console.log(
            `[SSE] Reconnecting in ${reconnectInterval}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        } else {
          console.error("[SSE] Max reconnect attempts reached");
          onDisconnect?.();
        }
      }

      eventSource.close();
    };
  }, [
    onConnect,
    onDisconnect,
    onError,
    onEvent,
    reconnectInterval,
    maxReconnectAttempts,
  ]);

  const disconnect = useCallback(() => {
    console.log("[SSE] Disconnecting...");
    isIntentionalCloseRef.current = true;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    onDisconnect?.();
  }, [onDisconnect]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    isIntentionalCloseRef.current = false;
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    disconnect,
    reconnect: connect,
  };
}
