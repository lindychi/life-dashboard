/**
 * SSE Broadcaster
 *
 * Manages Server-Sent Events connections and broadcasts real-time updates
 * for projects, KPIs, OKRs, and other dashboard data.
 *
 * Integrated with metrics collection for real-time monitoring.
 */

import { sseMetricsCollector } from "./sse-metrics";

export const MAX_SSE_CONNECTIONS = 50;

export type SSEEventType =
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
  | "youtube:channel:added"
  | "youtube:monitoring:completed"
  | "youtube:monitoring:cycle_complete"
  | "youtube:video:discovered"
  | "youtube:video:analyzed"
  | "youtube:analysis:started"
  | "youtube:video:analysis_failed"
  | "relay:status"
  | "agent:stats:updated"
  | "feedback:submitted"
  | "improvement:proposed"
  | "improvement:applied"
  | "preferences:updated"
  | "heartbeat";

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  timestamp: string;
}

export interface SSEClient {
  id: string;
  controller: ReadableStreamDefaultController;
  userId?: string;
  connectedAt: Date;
}

class SSEBroadcaster {
  private clients: Map<string, SSEClient> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds

  constructor() {
    this.startHeartbeat();
  }

  /**
   * Add a new SSE client connection.
   * Returns false if the connection limit has been reached.
   */
  addClient(client: SSEClient): boolean {
    if (this.clients.size >= MAX_SSE_CONNECTIONS) {
      console.warn(
        `[SSE] Connection limit reached (${MAX_SSE_CONNECTIONS}). Rejecting client ${client.id}`
      );
      try {
        client.controller.close();
      } catch {
        // Ignore close errors
      }
      return false;
    }

    this.clients.set(client.id, client);
    console.log(`[SSE] Client ${client.id} connected (total: ${this.clients.size})`);

    // Track connection metrics
    sseMetricsCollector.trackConnection(client.id, client.userId);

    // Send initial connection event
    this.sendToClient(client.id, {
      type: "heartbeat",
      data: { status: "connected" },
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  /**
   * Remove a client connection
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.controller.close();
      } catch {
        // Ignore close errors
      }
      this.clients.delete(clientId);
      console.log(`[SSE] Client ${clientId} disconnected (total: ${this.clients.size})`);

      // Track disconnection metrics
      sseMetricsCollector.trackDisconnection(clientId);
    }
  }

  /**
   * Broadcast event to all connected clients
   */
  broadcast(event: SSEEvent): void {
    const startTime = Date.now();
    const message = this.formatSSEMessage(event);
    let successCount = 0;
    let errorCount = 0;

    this.clients.forEach((client, clientId) => {
      try {
        client.controller.enqueue(message);
        successCount++;
      } catch (err) {
        console.error(`[SSE] Failed to send to client ${clientId}:`, err);
        errorCount++;
        sseMetricsCollector.trackError(clientId);
        this.removeClient(clientId);
      }
    });

    // Track event metrics
    const latency = Date.now() - startTime;
    sseMetricsCollector.trackEvent(event.type, latency);

    if (successCount > 0 || errorCount > 0) {
      console.log(
        `[SSE] Broadcast ${event.type}: ${successCount} success, ${errorCount} errors (${latency}ms)`
      );
    }
  }

  /**
   * Send event to specific client
   */
  sendToClient(clientId: string, event: SSEEvent): void {
    const client = this.clients.get(clientId);
    if (!client) {
      console.warn(`[SSE] Client ${clientId} not found`);
      return;
    }

    try {
      const message = this.formatSSEMessage(event);
      client.controller.enqueue(message);
    } catch (err) {
      console.error(`[SSE] Failed to send to client ${clientId}:`, err);
      this.removeClient(clientId);
    }
  }

  /**
   * Broadcast event to clients belonging to specific user
   */
  broadcastToUser(userId: string, event: SSEEvent): void {
    this.clients.forEach((client, clientId) => {
      if (client.userId === userId) {
        this.sendToClient(clientId, event);
      }
    });
  }

  /**
   * Format event as SSE message
   */
  private formatSSEMessage(event: SSEEvent): Uint8Array {
    const data = JSON.stringify(event);
    const message = `event: ${event.type}\ndata: ${data}\n\n`;
    return new TextEncoder().encode(message);
  }

  /**
   * Start heartbeat to keep connections alive
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.clients.size === 0) return;

      const heartbeatEvent: SSEEvent = {
        type: "heartbeat",
        data: { timestamp: new Date().toISOString() },
        timestamp: new Date().toISOString(),
      };

      this.broadcast(heartbeatEvent);
    }, this.HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Get connection stats
   */
  getStats(): {
    totalClients: number;
    clientsByUser: Record<string, number>;
  } {
    const clientsByUser: Record<string, number> = {};

    this.clients.forEach((client) => {
      if (client.userId) {
        clientsByUser[client.userId] = (clientsByUser[client.userId] || 0) + 1;
      }
    });

    return {
      totalClients: this.clients.size,
      clientsByUser,
    };
  }

  /**
   * Cleanup all connections
   */
  cleanup(): void {
    this.stopHeartbeat();
    this.clients.forEach((client, clientId) => {
      this.removeClient(clientId);
    });
  }
}

// Singleton instance
export const sseBroadcaster = new SSEBroadcaster();

// Convenience alias — auto-fills timestamp if omitted
export const broadcastSSE = (event: Omit<SSEEvent, "timestamp"> & { timestamp?: string }) =>
  sseBroadcaster.broadcast({ ...event, timestamp: event.timestamp || new Date().toISOString() });

// Cleanup on process exit
if (typeof process !== "undefined") {
  process.on("exit", () => {
    sseBroadcaster.cleanup();
  });
}
