/**
 * SSE Metrics Collection & Monitoring
 *
 * Real-time metrics for SSE connections:
 * - Active connections per user
 * - Message throughput
 * - Error rates & reconnection patterns
 * - Connection health & latency
 */

export interface SSEMetrics {
  timestamp: string;
  activeConnections: number;
  connectionsByUser: Record<string, number>;
  totalEventsFromTime: number;
  eventTypes: Record<string, number>;
  heartbeatsMissed: number;
  avgEventLatency: number;
  reconnectAttempts: number;
  errorCount: number;
}

export interface ConnectionMetadata {
  clientId: string;
  userId?: string;
  connectedAt: Date;
  disconnectedAt?: Date;
  eventCount: number;
  lastEventTime?: Date;
  reconnectCount: number;
  errorCount: number;
}

class SSEMetricsCollector {
  private connections: Map<string, ConnectionMetadata> = new Map();
  private eventCounts: Record<string, number> = {};
  private eventLatencies: number[] = [];
  private reconnectAttempts = 0;
  private startTime = Date.now();

  /**
   * Track connection establishment
   */
  trackConnection(clientId: string, userId?: string): void {
    this.connections.set(clientId, {
      clientId,
      userId,
      connectedAt: new Date(),
      eventCount: 0,
      reconnectCount: 0,
      errorCount: 0,
    });
  }

  /**
   * Track connection disconnection
   */
  trackDisconnection(clientId: string): void {
    const conn = this.connections.get(clientId);
    if (conn) {
      conn.disconnectedAt = new Date();
    }
  }

  /**
   * Track event broadcast
   */
  trackEvent(eventType: string, latency: number = 0): void {
    this.eventCounts[eventType] = (this.eventCounts[eventType] || 0) + 1;
    if (latency > 0) {
      this.eventLatencies.push(latency);
      // Keep only last 1000 measurements to avoid memory bloat
      if (this.eventLatencies.length > 1000) {
        this.eventLatencies.shift();
      }
    }
  }

  /**
   * Track reconnection attempt
   */
  trackReconnect(): void {
    this.reconnectAttempts++;
  }

  /**
   * Track error
   */
  trackError(clientId: string): void {
    const conn = this.connections.get(clientId);
    if (conn) {
      conn.errorCount++;
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): SSEMetrics {
    const activeConnections = Array.from(this.connections.values()).filter(
      (c) => !c.disconnectedAt
    );
    const connectionsByUser: Record<string, number> = {};

    activeConnections.forEach((conn) => {
      if (conn.userId) {
        connectionsByUser[conn.userId] = (connectionsByUser[conn.userId] || 0) + 1;
      }
    });

    const totalEvents = Object.values(this.eventCounts).reduce((a, b) => a + b, 0);
    const avgLatency =
      this.eventLatencies.length > 0
        ? this.eventLatencies.reduce((a, b) => a + b, 0) / this.eventLatencies.length
        : 0;

    return {
      timestamp: new Date().toISOString(),
      activeConnections: activeConnections.length,
      connectionsByUser,
      totalEventsFromTime: totalEvents,
      eventTypes: this.eventCounts,
      heartbeatsMissed: 0, // Will be calculated separately if needed
      avgEventLatency: Math.round(avgLatency * 100) / 100,
      reconnectAttempts: this.reconnectAttempts,
      errorCount: Array.from(this.connections.values()).reduce(
        (sum, c) => sum + c.errorCount,
        0
      ),
    };
  }

  /**
   * Get health status (OK, WARNING, CRITICAL)
   */
  getHealthStatus(): "OK" | "WARNING" | "CRITICAL" {
    const metrics = this.getMetrics();
    const errorRate = metrics.errorCount / Math.max(metrics.totalEventsFromTime, 1);
    const activeConnections = metrics.activeConnections;

    if (errorRate > 0.1 || metrics.reconnectAttempts > 50) {
      return "CRITICAL";
    }
    if (errorRate > 0.05 || metrics.avgEventLatency > 1000) {
      return "WARNING";
    }
    return "OK";
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.connections.clear();
    this.eventCounts = {};
    this.eventLatencies = [];
    this.reconnectAttempts = 0;
    this.startTime = Date.now();
  }

  /**
   * Cleanup stale connections (disconnected >5 min ago)
   */
  cleanup(): void {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const toDelete: string[] = [];

    this.connections.forEach((conn, clientId) => {
      if (conn.disconnectedAt && conn.disconnectedAt < fiveMinutesAgo) {
        toDelete.push(clientId);
      }
    });

    toDelete.forEach((id) => this.connections.delete(id));
  }
}

// Singleton instance
export const sseMetricsCollector = new SSEMetricsCollector();

// Auto-cleanup every 10 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    sseMetricsCollector.cleanup();
  }, 10 * 60 * 1000);
}
