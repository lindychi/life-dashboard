/**
 * SSE Event Expansion Tests (TDD - C-4)
 *
 * Tests for new broadcast helpers:
 *   broadcastRelayStatus, broadcastAgentStatsUpdate, broadcastMetricsUpdate
 * And cache-invalidation → SSE integration via api-cache helpers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoist the mock fn so it is available when vi.mock factory runs
// ---------------------------------------------------------------------------
const { mockBroadcastSSE } = vi.hoisted(() => ({
  mockBroadcastSSE: vi.fn(),
}));

vi.mock("../sse-broadcaster", () => ({
  broadcastSSE: mockBroadcastSSE,
  sseBroadcaster: { broadcast: vi.fn() },
}));

// Mock sse-metrics (imported transitively by sse-broadcaster real module)
vi.mock("../sse-metrics", () => ({
  sseMetricsCollector: {
    trackConnection: vi.fn(),
    trackDisconnection: vi.fn(),
    trackEvent: vi.fn(),
    trackError: vi.fn(),
  },
}));

import {
  broadcastRelayStatus,
  broadcastAgentStatsUpdate,
  broadcastMetricsUpdate,
} from "../sse-events";

import {
  invalidateProjectMetrics,
  invalidateOKR,
  invalidateAgentStats,
  projectMetricsCache,
  okrObjectivesCache,
  agentStatsCache,
} from "../api-cache";

describe("broadcastRelayStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sends relay:status event via broadcastSSE", () => {
    const status = { connected: true, gatewayId: "gw-1", agentCount: 3 };
    broadcastRelayStatus(status);
    expect(mockBroadcastSSE).toHaveBeenCalledOnce();
    const call = mockBroadcastSSE.mock.calls[0][0];
    expect(call.type).toBe("relay:status");
    expect(call.data).toMatchObject(status);
  });

  it("includes timestamp in payload", () => {
    broadcastRelayStatus({ connected: false });
    const call = mockBroadcastSSE.mock.calls[0][0];
    expect(call.timestamp).toBeDefined();
    expect(typeof call.timestamp).toBe("string");
    // ISO format
    expect(() => new Date(call.timestamp)).not.toThrow();
  });
});

describe("broadcastAgentStatsUpdate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sends agent:stats:updated event via broadcastSSE", () => {
    const stats = { tasksCompleted: 10, successRate: 0.95, avgDuration: 30 };
    broadcastAgentStatsUpdate("agent-42", stats);
    expect(mockBroadcastSSE).toHaveBeenCalledOnce();
    const call = mockBroadcastSSE.mock.calls[0][0];
    expect(call.type).toBe("agent:stats:updated");
    expect(call.data).toMatchObject({ agentId: "agent-42", stats });
  });

  it("includes timestamp in payload", () => {
    broadcastAgentStatsUpdate("agent-1", {});
    const call = mockBroadcastSSE.mock.calls[0][0];
    expect(call.timestamp).toBeDefined();
    expect(typeof call.timestamp).toBe("string");
  });
});

describe("broadcastMetricsUpdate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sends project:metrics:updated event via broadcastSSE", () => {
    const metrics = { completionRate: 0.8, totalTasks: 20, completedTasks: 16 };
    broadcastMetricsUpdate("proj-99", metrics);
    expect(mockBroadcastSSE).toHaveBeenCalledOnce();
    const call = mockBroadcastSSE.mock.calls[0][0];
    expect(call.type).toBe("project:metrics:updated");
    expect(call.data).toMatchObject({ projectId: "proj-99", metrics });
  });

  it("includes timestamp in payload", () => {
    broadcastMetricsUpdate("proj-1", {});
    const call = mockBroadcastSSE.mock.calls[0][0];
    expect(call.timestamp).toBeDefined();
    expect(typeof call.timestamp).toBe("string");
  });
});

describe("Cache invalidation triggers SSE broadcast", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    projectMetricsCache.clear();
    okrObjectivesCache.clear();
    agentStatsCache.clear();
  });

  it("invalidateProjectMetrics broadcasts project:metrics:updated", () => {
    projectMetricsCache.set("proj-1", { value: 1 }, 60_000);
    invalidateProjectMetrics("proj-1");
    // Entry should be gone
    expect(projectMetricsCache.has("proj-1")).toBe(false);
    // SSE should have fired
    expect(mockBroadcastSSE).toHaveBeenCalledOnce();
    const call = mockBroadcastSSE.mock.calls[0][0];
    expect(call.type).toBe("project:metrics:updated");
  });

  it("invalidateOKR broadcasts okr:objective:updated", () => {
    okrObjectivesCache.set("obj-1", { title: "Q1 Goal" }, 60_000);
    invalidateOKR("obj-1");
    expect(okrObjectivesCache.has("obj-1")).toBe(false);
    expect(mockBroadcastSSE).toHaveBeenCalledOnce();
    const call = mockBroadcastSSE.mock.calls[0][0];
    expect(call.type).toBe("okr:objective:updated");
  });

  it("invalidateAgentStats broadcasts task:status:changed", () => {
    agentStatsCache.set("agent-7", { runs: 5 }, 60_000);
    invalidateAgentStats("agent-7");
    expect(agentStatsCache.has("agent-7")).toBe(false);
    expect(mockBroadcastSSE).toHaveBeenCalledOnce();
    const call = mockBroadcastSSE.mock.calls[0][0];
    expect(call.type).toBe("task:status:changed");
  });

  it("invalidateProjectMetrics without id clears entire cache and broadcasts", () => {
    projectMetricsCache.set("p1", {}, 60_000);
    projectMetricsCache.set("p2", {}, 60_000);
    invalidateProjectMetrics();
    expect(projectMetricsCache.size).toBe(0);
    expect(mockBroadcastSSE).toHaveBeenCalledOnce();
  });
});
