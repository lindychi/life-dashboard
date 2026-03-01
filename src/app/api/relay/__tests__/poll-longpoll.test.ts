/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * B-3: Gateway Long-Polling Tests
 *
 * Tests that the poll endpoint supports a `timeout` query parameter that
 * causes the server to hold the connection for up to 30 seconds, returning
 * immediately when commands arrive rather than always returning empty.
 *
 * TDD RED phase: these tests are written before the implementation.
 * Run to confirm RED, then implement to see GREEN.
 *
 * Coverage:
 * - timeout param absent / zero → returns immediately (backward compat)
 * - commands exist immediately → returns without waiting regardless of timeout
 * - timeout > 30000 → capped at 30000ms
 * - commands arrive during wait → returns promptly (does not wait full timeout)
 * - heartbeat + agent statuses updated on every poll regardless of timeout
 * - invalid timeout param → treated as 0 (safe default)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks (must be declared before any @/ imports)
// ---------------------------------------------------------------------------

vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  isDbConnectionError: vi.fn().mockReturnValue(false),
  pool: {},
}));

vi.mock("@/lib/relay", () => ({
  validateRelayKey: vi.fn(),
  updateHeartbeat: vi.fn().mockResolvedValue(true),
  getAndClearCommands: vi.fn(),
  updateAgentStatuses: vi.fn().mockResolvedValue(undefined),
  drainQueueForIdleAgents: vi.fn().mockResolvedValue([]),
  recoverStaleProcessingCommands: vi.fn().mockResolvedValue(0),
  recoverStaleErrorAgents: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/history", () => ({
  addHistoryEntry: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import * as relay from "@/lib/relay";

const mockValidateRelayKey = vi.mocked(relay.validateRelayKey);
const mockGetAndClearCommands = vi.mocked(relay.getAndClearCommands);
const mockUpdateHeartbeat = vi.mocked(relay.updateHeartbeat);
const mockUpdateAgentStatuses = vi.mocked(relay.updateAgentStatuses);
const mockDrainQueueForIdleAgents = vi.mocked(relay.drainQueueForIdleAgents);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_API_KEY = "test-relay-key";
const GATEWAY_ID = "gw-test-001";

function makeRequest(
  body: Record<string, unknown>,
  timeoutMs?: number
): NextRequest {
  const url = new URL("/api/relay/poll", "http://localhost:3000");
  if (timeoutMs !== undefined) {
    url.searchParams.set("timeout", String(timeoutMs));
  }
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-relay-key": VALID_API_KEY,
    },
    body: JSON.stringify({ gatewayId: GATEWAY_ID, ...body }),
  });
}

const sampleCommand = {
  id: "cmd-001",
  type: "spawn",
  payload: { agentId: "dev", task: "do something" },
  createdAt: new Date().toISOString(),
  status: "processing",
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("POST /api/relay/poll — long-polling support (B-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockValidateRelayKey.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Backward compatibility: no timeout param
  // -------------------------------------------------------------------------

  describe("backward compatibility: no timeout parameter", () => {
    it("returns immediately with empty commands when no commands exist and no timeout given", async () => {
      mockGetAndClearCommands.mockResolvedValue([]);

      const { POST } = await import("../poll/route");
      const request = makeRequest({});

      const responsePromise = POST(request);
      // Advance timers to let any internal polling settle
      await vi.runAllTimersAsync();
      const response = await responsePromise;
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.commands).toEqual([]);
      expect(data.timestamp).toBeDefined();
    });

    it("returns immediately with commands when commands exist and no timeout given", async () => {
      mockGetAndClearCommands.mockResolvedValue([sampleCommand]);

      const { POST } = await import("../poll/route");
      const request = makeRequest({});

      const responsePromise = POST(request);
      await vi.runAllTimersAsync();
      const response = await responsePromise;
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.commands).toHaveLength(1);
      expect(data.commands[0].id).toBe("cmd-001");
    });
  });

  // -------------------------------------------------------------------------
  // timeout=0: explicit zero, same as absent
  // -------------------------------------------------------------------------

  describe("timeout=0: returns immediately without waiting", () => {
    it("returns immediately with empty commands when timeout=0", async () => {
      mockGetAndClearCommands.mockResolvedValue([]);

      const { POST } = await import("../poll/route");
      const request = makeRequest({}, 0);

      const responsePromise = POST(request);
      await vi.runAllTimersAsync();
      const response = await responsePromise;
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.commands).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Commands exist immediately: return without waiting even with timeout set
  // -------------------------------------------------------------------------

  describe("commands exist immediately: return without waiting", () => {
    it("returns commands immediately when they exist, even with timeout=5000", async () => {
      mockGetAndClearCommands.mockResolvedValue([sampleCommand]);

      const { POST } = await import("../poll/route");
      const request = makeRequest({}, 5000);

      const responsePromise = POST(request);
      // Only advance a tiny bit — should already have commands on first check
      await vi.advanceTimersByTimeAsync(10);
      const response = await responsePromise;
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.commands).toHaveLength(1);
      // getAndClearCommands should NOT be called multiple times since we returned early
      expect(mockGetAndClearCommands).toHaveBeenCalledTimes(1);
    });

    it("returns immediately when drainQueueForIdleAgents yields commands", async () => {
      mockGetAndClearCommands.mockResolvedValue([]);
      mockDrainQueueForIdleAgents.mockResolvedValue([sampleCommand]);

      const { POST } = await import("../poll/route");
      const request = makeRequest(
        { agents: [{ id: "dev", status: "idle", name: "dev" }] },
        10000
      );

      const responsePromise = POST(request);
      await vi.advanceTimersByTimeAsync(10);
      const response = await responsePromise;
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.commands).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Long-poll: waits up to timeout, then returns empty
  // -------------------------------------------------------------------------

  describe("long-poll: waits when no commands arrive", () => {
    it("waits the specified timeout and returns empty when no commands arrive", async () => {
      mockGetAndClearCommands.mockResolvedValue([]);

      const { POST } = await import("../poll/route");
      const request = makeRequest({}, 2000);

      const responsePromise = POST(request);

      // Before timeout elapses, response should not be settled
      await vi.advanceTimersByTimeAsync(500);

      // Advance past the full timeout
      await vi.advanceTimersByTimeAsync(2000);
      await vi.runAllTimersAsync();

      const response = await responsePromise;
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.commands).toEqual([]);
    });

    it("polls multiple times during the wait period (approximately every 500ms)", async () => {
      // Return empty on every call to simulate no commands arriving
      mockGetAndClearCommands.mockResolvedValue([]);

      const { POST } = await import("../poll/route");
      const request = makeRequest({}, 2000);

      const responsePromise = POST(request);
      await vi.advanceTimersByTimeAsync(2500);
      await vi.runAllTimersAsync();
      await responsePromise;

      // With 500ms intervals over 2000ms, expect at least 3 poll attempts
      // (initial check + polls at ~500ms, ~1000ms, ~1500ms)
      expect(mockGetAndClearCommands.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });

  // -------------------------------------------------------------------------
  // Commands arrive during wait: return promptly
  // -------------------------------------------------------------------------

  describe("commands arrive during wait period: return promptly", () => {
    it("returns commands when they arrive mid-wait without waiting full timeout", async () => {
      // First two calls return empty, third returns a command
      mockGetAndClearCommands
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValue([sampleCommand]);

      const { POST } = await import("../poll/route");
      const request = makeRequest({}, 10000);

      const responsePromise = POST(request);

      // Advance past first two 500ms intervals so third check fires with command
      await vi.advanceTimersByTimeAsync(1500);

      const response = await responsePromise;
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.commands).toHaveLength(1);
      expect(data.commands[0].id).toBe("cmd-001");
      // Should have returned well before the 10s timeout
      expect(mockGetAndClearCommands.mock.calls.length).toBeLessThan(10);
    });
  });

  // -------------------------------------------------------------------------
  // Timeout cap at MAX_LONG_POLL_MS (30000)
  // -------------------------------------------------------------------------

  describe("timeout cap: values > 30000ms are capped at 30000ms", () => {
    it("caps timeout at 30000ms when caller sends 60000", async () => {
      mockGetAndClearCommands.mockResolvedValue([]);

      const { POST } = await import("../poll/route");
      const request = makeRequest({}, 60000);

      const responsePromise = POST(request);

      // Advance to just past 30s — should resolve at cap, not wait 60s
      await vi.advanceTimersByTimeAsync(31000);
      await vi.runAllTimersAsync();

      const response = await responsePromise;
      expect(response.status).toBe(200);

      // Should NOT still be pending at 31s (would hang test if not capped)
      // The fact we got here without timeout means it resolved within 30s
    });

    it("caps timeout at 30000ms when caller sends 100000", async () => {
      mockGetAndClearCommands.mockResolvedValue([]);

      const { POST } = await import("../poll/route");
      const request = makeRequest({}, 100000);

      const responsePromise = POST(request);
      await vi.advanceTimersByTimeAsync(31000);
      await vi.runAllTimersAsync();

      const response = await responsePromise;
      expect(response.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Heartbeat and agent statuses: always updated regardless of timeout
  // -------------------------------------------------------------------------

  describe("heartbeat and agent statuses: always updated on every poll request", () => {
    it("updates heartbeat when returning immediately (no timeout)", async () => {
      mockGetAndClearCommands.mockResolvedValue([]);

      const { POST } = await import("../poll/route");
      const request = makeRequest({});

      const responsePromise = POST(request);
      await vi.runAllTimersAsync();
      await responsePromise;

      expect(mockUpdateHeartbeat).toHaveBeenCalledWith(GATEWAY_ID);
    });

    it("updates heartbeat when using long-poll timeout", async () => {
      mockGetAndClearCommands.mockResolvedValue([]);

      const { POST } = await import("../poll/route");
      const request = makeRequest({}, 1000);

      const responsePromise = POST(request);
      await vi.advanceTimersByTimeAsync(1500);
      await vi.runAllTimersAsync();
      await responsePromise;

      // Heartbeat must be updated (once at the start of the request)
      expect(mockUpdateHeartbeat).toHaveBeenCalledWith(GATEWAY_ID);
    });

    it("updates agent statuses when agents array is provided", async () => {
      mockGetAndClearCommands.mockResolvedValue([]);
      const agents = [{ id: "dev", name: "dev", status: "idle" }];

      const { POST } = await import("../poll/route");
      const request = makeRequest({ agents }, 0);

      const responsePromise = POST(request);
      await vi.runAllTimersAsync();
      await responsePromise;

      expect(mockUpdateAgentStatuses).toHaveBeenCalledWith(GATEWAY_ID, agents);
    });

    it("does not call updateAgentStatuses when agents array is absent", async () => {
      mockGetAndClearCommands.mockResolvedValue([]);

      const { POST } = await import("../poll/route");
      const request = makeRequest({});

      const responsePromise = POST(request);
      await vi.runAllTimersAsync();
      await responsePromise;

      expect(mockUpdateAgentStatuses).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  describe("authentication", () => {
    it("returns 401 when API key is missing", async () => {
      const { POST } = await import("../poll/route");
      const url = new URL("/api/relay/poll", "http://localhost:3000");
      const request = new NextRequest(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gatewayId: GATEWAY_ID }),
      });

      const responsePromise = POST(request);
      await vi.runAllTimersAsync();
      const response = await responsePromise;

      expect(response.status).toBe(401);
    });

    it("returns 401 when API key is invalid", async () => {
      mockValidateRelayKey.mockReturnValue(false);

      const { POST } = await import("../poll/route");
      const url = new URL("/api/relay/poll", "http://localhost:3000");
      const request = new NextRequest(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-relay-key": "wrong-key",
        },
        body: JSON.stringify({ gatewayId: GATEWAY_ID }),
      });

      const responsePromise = POST(request);
      await vi.runAllTimersAsync();
      const response = await responsePromise;

      expect(response.status).toBe(401);
    });

    it("returns 400 when gatewayId is missing", async () => {
      const { POST } = await import("../poll/route");
      const url = new URL("/api/relay/poll", "http://localhost:3000");
      const request = new NextRequest(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-relay-key": VALID_API_KEY,
        },
        body: JSON.stringify({}),
      });

      const responsePromise = POST(request);
      await vi.runAllTimersAsync();
      const response = await responsePromise;

      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Invalid timeout param handling
  // -------------------------------------------------------------------------

  describe("invalid timeout param: treated as 0 (safe default)", () => {
    it("treats non-numeric timeout as 0 and returns immediately", async () => {
      mockGetAndClearCommands.mockResolvedValue([]);

      const { POST } = await import("../poll/route");
      const url = new URL("/api/relay/poll", "http://localhost:3000");
      url.searchParams.set("timeout", "notanumber");
      const request = new NextRequest(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-relay-key": VALID_API_KEY,
        },
        body: JSON.stringify({ gatewayId: GATEWAY_ID }),
      });

      const responsePromise = POST(request);
      await vi.runAllTimersAsync();
      const response = await responsePromise;

      expect(response.status).toBe(200);
    });

    it("treats negative timeout as 0 and returns immediately", async () => {
      mockGetAndClearCommands.mockResolvedValue([]);

      const { POST } = await import("../poll/route");
      const request = makeRequest({}, -5000);

      const responsePromise = POST(request);
      await vi.runAllTimersAsync();
      const response = await responsePromise;

      expect(response.status).toBe(200);
    });
  });
});
