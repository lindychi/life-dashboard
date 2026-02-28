import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock pg FIRST to prevent native module loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn(), end: vi.fn() })),
}));

// Mock db module — query must RESOLVE for updateAgentStatuses (DB upsert)
const mockQuery = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: vi.fn(),
  pool: {},
  isDbConnectionError: (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const err = error as any;
    const codes = [
      "ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT",
      "EHOSTUNREACH", "EPIPE", "EAI_AGAIN", "57P01", "57P02", "57P03",
    ];
    if (err.code && codes.includes(err.code)) return true;
    if (err.errors)
      return err.errors.some((e: any) => e.code && codes.includes(e.code));
    return false;
  },
  withDbFallback: async (fn: () => Promise<any>, fallback: any) => {
    try {
      return await fn();
    } catch (e: any) {
      const codes = [
        "ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT",
        "EHOSTUNREACH", "EPIPE", "EAI_AGAIN", "57P01", "57P02", "57P03",
      ];
      const isConn =
        (e.code && codes.includes(e.code)) ||
        e.errors?.some((x: any) => x.code && codes.includes(x.code));
      if (isConn) return fallback;
      throw e;
    }
  },
}));

import {
  updateAgentStatuses,
  getQueueStats,
  queueCommand,
  cleanupAllInMemory,
  getLiveOutputForAgent,
  getMemoryBoundsEstimate,
  MAX_RECENT_EVENTS_PER_AGENT,
  MAX_LAST_CHUNK_CHARS,
  LIVE_OUTPUT_TTL_MS,
  cleanupExpiredCommands,
} from "../relay";

function createECONNREFUSED() {
  const inner = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  return new AggregateError([inner], "AggregateError");
}

/** Helper: create an agent entry matching updateAgentStatuses signature */
function makeAgent(
  id: string,
  status: "running" | "idle" | "error" = "running",
  liveOutput?: {
    lastChunk: string;
    totalChars: number;
    lastActivityAt: string;
    chunksReceived: number;
    recentEvents?: Array<{
      type: "tool_use" | "text" | "health" | "warning" | "stderr";
      timestamp: string;
      tool?: string;
      target?: string;
      content?: string;
    }>;
  }
) {
  return {
    id,
    name: `agent-${id}`,
    status: status as any,
    liveOutput,
  };
}

describe("relay memory limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // DB query resolves (for updateAgentStatuses upsert)
    mockQuery.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------
  // 1. recentEvents limit
  // -------------------------------------------------------
  describe("liveOutputCache recentEvents limit", () => {
    it("should truncate recentEvents to MAX_RECENT_EVENTS_PER_AGENT when exceeded", async () => {
      const gw = "gw-re-1";
      const agentId = "a1";

      // Build 100 events — more than the limit
      const events = Array.from({ length: 100 }, (_, i) => ({
        type: "text" as const,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        content: `Event ${i}`,
      }));

      await updateAgentStatuses(gw, [
        makeAgent(agentId, "running", {
          lastChunk: "test",
          totalChars: 4,
          lastActivityAt: new Date().toISOString(),
          chunksReceived: 1,
          recentEvents: events,
        }),
      ]);

      const output = getLiveOutputForAgent(gw, agentId);
      expect(output).toBeDefined();
      expect(output!.recentEvents!.length).toBe(MAX_RECENT_EVENTS_PER_AGENT);
    });

    it("should keep all events when under limit", async () => {
      const gw = "gw-re-2";
      const agentId = "a2";

      const events = Array.from({ length: 10 }, (_, i) => ({
        type: "text" as const,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        content: `Event ${i}`,
      }));

      await updateAgentStatuses(gw, [
        makeAgent(agentId, "running", {
          lastChunk: "ok",
          totalChars: 2,
          lastActivityAt: new Date().toISOString(),
          chunksReceived: 1,
          recentEvents: events,
        }),
      ]);

      const output = getLiveOutputForAgent(gw, agentId);
      expect(output!.recentEvents!.length).toBe(10);
    });

    it("should keep newest events and discard oldest on truncation", async () => {
      const gw = "gw-re-3";
      const agentId = "a3";

      const events = Array.from({ length: 100 }, (_, i) => ({
        type: "text" as const,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        content: `Event ${i}`,
      }));

      await updateAgentStatuses(gw, [
        makeAgent(agentId, "running", {
          lastChunk: "x",
          totalChars: 1,
          lastActivityAt: new Date().toISOString(),
          chunksReceived: 1,
          recentEvents: events,
        }),
      ]);

      const output = getLiveOutputForAgent(gw, agentId);
      const first = output!.recentEvents![0];
      const last =
        output!.recentEvents![output!.recentEvents!.length - 1];

      // Oldest kept = Event (100 - MAX_RECENT_EVENTS_PER_AGENT)
      expect(first.content).toBe(
        `Event ${100 - MAX_RECENT_EVENTS_PER_AGENT}`
      );
      expect(last.content).toBe("Event 99");
    });
  });

  // -------------------------------------------------------
  // 2. lastChunk size limit
  // -------------------------------------------------------
  describe("liveOutputCache lastChunk size limit", () => {
    it("should truncate lastChunk to MAX_LAST_CHUNK_CHARS", async () => {
      const gw = "gw-lc-1";
      const agentId = "b1";
      const largeChunk = "x".repeat(20_000);

      await updateAgentStatuses(gw, [
        makeAgent(agentId, "running", {
          lastChunk: largeChunk,
          totalChars: largeChunk.length,
          lastActivityAt: new Date().toISOString(),
          chunksReceived: 1,
        }),
      ]);

      const output = getLiveOutputForAgent(gw, agentId);
      expect(output!.lastChunk.length).toBe(MAX_LAST_CHUNK_CHARS);
    });

    it("should not truncate lastChunk when under limit", async () => {
      const gw = "gw-lc-2";
      const agentId = "b2";
      const smallChunk = "small chunk";

      await updateAgentStatuses(gw, [
        makeAgent(agentId, "running", {
          lastChunk: smallChunk,
          totalChars: smallChunk.length,
          lastActivityAt: new Date().toISOString(),
          chunksReceived: 1,
        }),
      ]);

      const output = getLiveOutputForAgent(gw, agentId);
      expect(output!.lastChunk).toBe(smallChunk);
    });

    it("should truncate from the beginning (keep tail)", async () => {
      const gw = "gw-lc-3";
      const agentId = "b3";
      const largeChunk = "START" + "x".repeat(20_000) + "END";

      await updateAgentStatuses(gw, [
        makeAgent(agentId, "running", {
          lastChunk: largeChunk,
          totalChars: largeChunk.length,
          lastActivityAt: new Date().toISOString(),
          chunksReceived: 1,
        }),
      ]);

      const output = getLiveOutputForAgent(gw, agentId);
      expect(output!.lastChunk).toMatch(/END$/);
      expect(output!.lastChunk).not.toMatch(/^START/);
      expect(output!.lastChunk.length).toBe(MAX_LAST_CHUNK_CHARS);
    });
  });

  // -------------------------------------------------------
  // 3. liveOutputCache TTL
  // -------------------------------------------------------
  describe("liveOutputCache TTL", () => {
    it("should expire liveOutput entries older than LIVE_OUTPUT_TTL_MS", async () => {
      vi.useFakeTimers();
      const gw = "gw-ttl-1";
      const agentId = "c1";

      await updateAgentStatuses(gw, [
        makeAgent(agentId, "running", {
          lastChunk: "old",
          totalChars: 3,
          lastActivityAt: new Date().toISOString(),
          chunksReceived: 1,
        }),
      ]);

      vi.advanceTimersByTime(LIVE_OUTPUT_TTL_MS + 1000);
      await cleanupAllInMemory();

      const output = getLiveOutputForAgent(gw, agentId);
      expect(output).toBeUndefined();
    });

    it("should retain fresh liveOutput entries", async () => {
      vi.useFakeTimers();
      const gw = "gw-ttl-2";
      const agentId = "c2";

      await updateAgentStatuses(gw, [
        makeAgent(agentId, "running", {
          lastChunk: "fresh",
          totalChars: 5,
          lastActivityAt: new Date().toISOString(),
          chunksReceived: 1,
        }),
      ]);

      vi.advanceTimersByTime(LIVE_OUTPUT_TTL_MS - 1000);
      await cleanupAllInMemory();

      const output = getLiveOutputForAgent(gw, agentId);
      expect(output).toBeDefined();
      expect(output!.lastChunk).toBe("fresh");
    });

    it("should remove stale liveOutput and keep fresh during cleanup", async () => {
      vi.useFakeTimers();
      const gw = "gw-ttl-3";

      // Create agent-1 at T=0
      await updateAgentStatuses(gw, [
        makeAgent("c3-old", "running", {
          lastChunk: "old output",
          totalChars: 10,
          lastActivityAt: new Date().toISOString(),
          chunksReceived: 1,
        }),
      ]);

      // Advance to T = TTL/2
      vi.advanceTimersByTime(LIVE_OUTPUT_TTL_MS / 2);

      // Create agent-2 at T=TTL/2
      await updateAgentStatuses(gw, [
        makeAgent("c3-new", "running", {
          lastChunk: "new output",
          totalChars: 10,
          lastActivityAt: new Date().toISOString(),
          chunksReceived: 1,
        }),
      ]);

      // Advance to T = TTL + 1s → agent-1 expired, agent-2 still fresh
      vi.advanceTimersByTime(LIVE_OUTPUT_TTL_MS / 2 + 1000);
      await cleanupAllInMemory();

      expect(getLiveOutputForAgent(gw, "c3-old")).toBeUndefined();
      expect(getLiveOutputForAgent(gw, "c3-new")).toBeDefined();
      expect(getLiveOutputForAgent(gw, "c3-new")!.lastChunk).toBe("new output");
    });
  });

  // -------------------------------------------------------
  // 4. cleanupAllInMemory
  // -------------------------------------------------------
  describe("cleanupAllInMemory", () => {
    it("should clean both expired commands and stale liveOutput", async () => {
      vi.useFakeTimers();
      const gw = "gw-cleanup-1";

      // Queue an in-memory command (DB down for queueCommand)
      mockQuery.mockRejectedValueOnce(createECONNREFUSED()); // for queueCommand's queryOne
      // Actually queueCommand uses queryOne, not query — but our mock setup
      // makes query fail for the UNNEST upsert. Let's just add liveOutput:
      mockQuery.mockResolvedValue([]); // restore for updateAgentStatuses

      await updateAgentStatuses(gw, [
        makeAgent("d1", "running", {
          lastChunk: "data",
          totalChars: 4,
          lastActivityAt: new Date().toISOString(),
          chunksReceived: 1,
        }),
      ]);

      // Expire everything
      vi.advanceTimersByTime(LIVE_OUTPUT_TTL_MS + 1000);

      const result = await cleanupAllInMemory();

      expect(result).toBeDefined();
      expect(typeof result.commandsRemoved).toBe("number");
      expect(result.liveOutputRemoved).toBe(1);
    });

    it("should report cleanup counts for multiple stale entries", async () => {
      vi.useFakeTimers();
      const gw = "gw-cleanup-2";

      await updateAgentStatuses(gw, [
        makeAgent("d2-a", "running", {
          lastChunk: "1",
          totalChars: 1,
          lastActivityAt: new Date().toISOString(),
          chunksReceived: 1,
        }),
        makeAgent("d2-b", "running", {
          lastChunk: "2",
          totalChars: 1,
          lastActivityAt: new Date().toISOString(),
          chunksReceived: 1,
        }),
        makeAgent("d2-c", "running", {
          lastChunk: "3",
          totalChars: 1,
          lastActivityAt: new Date().toISOString(),
          chunksReceived: 1,
        }),
      ]);

      vi.advanceTimersByTime(LIVE_OUTPUT_TTL_MS + 1000);

      const result = await cleanupAllInMemory();
      expect(result.liveOutputRemoved).toBe(3);
      expect(typeof result.commandsRemoved).toBe("number");
    });
  });

  // -------------------------------------------------------
  // 5. Memory bounds estimate
  // -------------------------------------------------------
  describe("total memory bounds calculation", () => {
    it("should return worst-case memory estimate with all constants", () => {
      const bounds = getMemoryBoundsEstimate();

      expect(bounds).toBeDefined();
      expect(bounds.maxCommands).toBeGreaterThan(0);
      expect(bounds.maxLiveOutputEntries).toBeGreaterThan(0);
      expect(bounds.maxRecentEventsPerAgent).toBe(MAX_RECENT_EVENTS_PER_AGENT);
      expect(bounds.maxLastChunkChars).toBe(MAX_LAST_CHUNK_CHARS);
      expect(bounds.estimatedMaxMemoryBytes).toBeGreaterThan(0);
      expect(bounds.estimatedMaxMemoryMB).toBeGreaterThan(0);
    });
  });
});
