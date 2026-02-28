/**
 * useProjectSSE Hook
 *
 * React hook for handling project-related SSE events
 */

import { useSSE, type SSEEvent } from "./useSSE";

export interface ProjectSSEHandlers {
  onProjectCreated?: (data: { project: unknown }) => void;
  onProjectUpdated?: (data: { project: unknown }) => void;
  onProjectDeleted?: (data: { projectId: string }) => void;
  onMetricsUpdated?: (data: {
    projectId: string;
    snapshotId: string;
    metrics: unknown;
  }) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
}

export function useProjectSSE(handlers: ProjectSSEHandlers = {}) {
  const {
    onProjectCreated,
    onProjectUpdated,
    onProjectDeleted,
    onMetricsUpdated,
    onConnect,
    onDisconnect,
    onError,
  } = handlers;

  const handleEvent = (event: SSEEvent) => {
    switch (event.type) {
      case "project:created":
        onProjectCreated?.(event.data as { project: unknown });
        break;

      case "project:updated":
        onProjectUpdated?.(event.data as { project: unknown });
        break;

      case "project:deleted":
        onProjectDeleted?.(event.data as { projectId: string });
        break;

      case "project:metrics:updated":
        onMetricsUpdated?.(
          event.data as {
            projectId: string;
            snapshotId: string;
            metrics: unknown;
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
