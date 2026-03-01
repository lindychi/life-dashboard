/**
 * Fix 6: SSE Connection Limit
 *
 * Tests that the SSE broadcaster enforces a maximum number of concurrent connections.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock sse-metrics to avoid side effects
vi.mock("@/lib/sse-metrics", () => ({
  sseMetricsCollector: {
    trackConnection: vi.fn(),
    trackDisconnection: vi.fn(),
    trackEvent: vi.fn(),
    trackError: vi.fn(),
  },
}));

function createMockClient(id: string) {
  return {
    id,
    controller: {
      enqueue: vi.fn(),
      close: vi.fn(),
    } as unknown as ReadableStreamDefaultController,
    connectedAt: new Date(),
  };
}

describe("SSE Broadcaster - Connection Limit", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should export MAX_SSE_CONNECTIONS constant", async () => {
    const mod = await import("@/lib/sse-broadcaster");
    expect(mod.MAX_SSE_CONNECTIONS).toBeDefined();
    expect(typeof mod.MAX_SSE_CONNECTIONS).toBe("number");
    expect(mod.MAX_SSE_CONNECTIONS).toBeGreaterThan(0);
  });

  it("should accept connections up to MAX_SSE_CONNECTIONS", async () => {
    const mod = await import("@/lib/sse-broadcaster");
    const broadcaster = mod.sseBroadcaster;

    // Clean up any existing state
    broadcaster.cleanup();

    const maxConns = mod.MAX_SSE_CONNECTIONS;
    for (let i = 0; i < maxConns; i++) {
      broadcaster.addClient(createMockClient(`client-${i}`));
    }

    const stats = broadcaster.getStats();
    expect(stats.totalClients).toBe(maxConns);

    broadcaster.cleanup();
  });

  it("should reject new connections when at MAX_SSE_CONNECTIONS", async () => {
    const mod = await import("@/lib/sse-broadcaster");
    const broadcaster = mod.sseBroadcaster;

    // Clean up any existing state
    broadcaster.cleanup();

    const maxConns = mod.MAX_SSE_CONNECTIONS;

    // Fill to capacity
    for (let i = 0; i < maxConns; i++) {
      broadcaster.addClient(createMockClient(`client-${i}`));
    }

    // Try to add one more
    const extraClient = createMockClient("client-overflow");
    const accepted = broadcaster.addClient(extraClient);

    // Should return false (rejected)
    expect(accepted).toBe(false);

    // Total should still be at max
    const stats = broadcaster.getStats();
    expect(stats.totalClients).toBe(maxConns);

    // The rejected client's controller should have been closed
    expect(extraClient.controller.close).toHaveBeenCalled();

    broadcaster.cleanup();
  });

  it("should accept new connections after a client disconnects", async () => {
    const mod = await import("@/lib/sse-broadcaster");
    const broadcaster = mod.sseBroadcaster;

    broadcaster.cleanup();

    const maxConns = mod.MAX_SSE_CONNECTIONS;

    // Fill to capacity
    for (let i = 0; i < maxConns; i++) {
      broadcaster.addClient(createMockClient(`client-${i}`));
    }

    // Remove one
    broadcaster.removeClient("client-0");

    // Now adding one more should succeed
    const newClient = createMockClient("client-new");
    const accepted = broadcaster.addClient(newClient);
    expect(accepted).not.toBe(false);

    const stats = broadcaster.getStats();
    expect(stats.totalClients).toBe(maxConns);

    broadcaster.cleanup();
  });
});
