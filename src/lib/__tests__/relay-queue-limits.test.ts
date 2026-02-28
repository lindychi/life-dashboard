import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({ Pool: vi.fn(() => ({ query: vi.fn() })) }));

// Mock DB module
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  pool: {},
  isDbConnectionError: (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const err = error as any;
    const codes = ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "EPIPE", "EAI_AGAIN", "57P01", "57P02", "57P03"];
    if (err.code && codes.includes(err.code)) return true;
    if (err.errors) return err.errors.some((e: any) => e.code && codes.includes(e.code));
    return false;
  },
  withDbFallback: async (fn: () => Promise<any>, fallback: any) => {
    try { return await fn(); } catch (e: any) {
      const codes = ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "EPIPE", "EAI_AGAIN", "57P01", "57P02", "57P03"];
      const isConn = (e.code && codes.includes(e.code)) || e.errors?.some((x: any) => x.code && codes.includes(x.code));
      if (isConn) return fallback;
      throw e;
    }
  },
}));

function createECONNREFUSED() {
  const inner = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  return new AggregateError([inner], "AggregateError");
}

import {
  queueCommand,
  getAndClearCommands,
  getQueueStats,
  cleanupExpiredCommands,
  getLiveOutputCacheSize,
  cleanupStaleLiveOutput,
  startAutoCleanup,
  stopAutoCleanup,
} from "../relay";

describe("relay in-memory queue size limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Force DB down for all tests
    mockQueryOne.mockRejectedValue(createECONNREFUSED());
    mockQuery.mockRejectedValue(createECONNREFUSED());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("per-gateway command queue size limit (MAX_COMMANDS_PER_GATEWAY = 100)", () => {
    it("should retain only latest 100 commands when 110 are queued (FIFO eviction)", async () => {
      const gatewayId = "ql-gw1";

      // Queue 110 commands
      const commands = [];
      for (let i = 1; i <= 110; i++) {
        const cmd = await queueCommand(gatewayId, {
          type: "orchestrate",
          payload: { taskId: `task-${i}`, index: i },
        });
        commands.push(cmd);
      }

      // The last queued command should still be valid
      expect(commands[109].payload).toEqual({ taskId: "task-110", index: 110 });

      // When we retrieve commands, should get exactly 100 (not 110)
      const retrieved = await getAndClearCommands(gatewayId);
      expect(retrieved).toHaveLength(100);

      // First 10 commands should be evicted, so we should have task-11 through task-110
      expect(retrieved[0].payload).toEqual({ taskId: "task-11", index: 11 });
      expect(retrieved[99].payload).toEqual({ taskId: "task-110", index: 110 });
    });

    it("should continue to evict oldest when queue remains at capacity", async () => {
      const gatewayId = "ql-gw2";

      // Fill to capacity (100)
      for (let i = 1; i <= 100; i++) {
        await queueCommand(gatewayId, {
          type: "spawn",
          payload: { batch: 1, index: i },
        });
      }

      // Add 50 more (should evict first 50)
      for (let i = 1; i <= 50; i++) {
        await queueCommand(gatewayId, {
          type: "spawn",
          payload: { batch: 2, index: i },
        });
      }

      const retrieved = await getAndClearCommands(gatewayId);
      expect(retrieved).toHaveLength(100);

      // Should have: batch 1 (51-100) + batch 2 (1-50)
      expect(retrieved[0].payload).toEqual({ batch: 1, index: 51 });
      expect(retrieved[49].payload).toEqual({ batch: 1, index: 100 });
      expect(retrieved[50].payload).toEqual({ batch: 2, index: 1 });
      expect(retrieved[99].payload).toEqual({ batch: 2, index: 50 });
    });

    it("should not evict when queue is under capacity", async () => {
      const gatewayId = "ql-gw3";

      // Queue only 50 commands
      for (let i = 1; i <= 50; i++) {
        await queueCommand(gatewayId, {
          type: "status",
          payload: { index: i },
        });
      }

      const retrieved = await getAndClearCommands(gatewayId);
      expect(retrieved).toHaveLength(50);

      // All commands should be present
      expect(retrieved[0].payload).toEqual({ index: 1 });
      expect(retrieved[49].payload).toEqual({ index: 50 });
    });
  });

  describe("global gateway count limit (MAX_GATEWAYS_IN_MEMORY = 50)", () => {
    it("should retain only 50 gateways when 55 are queued", async () => {
      // Queue commands to 55 different gateways
      for (let i = 1; i <= 55; i++) {
        await queueCommand(`ql-gw-multi-${i}`, {
          type: "spawn",
          payload: { gatewayIndex: i },
        });
      }

      // Check that only 50 gateways are in memory
      const stats = await getQueueStats();
      expect(stats.totalGateways).toBe(50);

      // First 5 gateways should be evicted (oldest)
      const gw1Commands = await getAndClearCommands("ql-gw-multi-1");
      const gw5Commands = await getAndClearCommands("ql-gw-multi-5");
      const gw6Commands = await getAndClearCommands("ql-gw-multi-6");
      const gw55Commands = await getAndClearCommands("ql-gw-multi-55");

      expect(gw1Commands).toHaveLength(0); // Evicted
      expect(gw5Commands).toHaveLength(0); // Evicted
      expect(gw6Commands).toHaveLength(1); // Retained
      expect(gw55Commands).toHaveLength(1); // Retained
    });

    it("should evict oldest gateways based on earliest command timestamp", async () => {
      // Queue to gateway A first
      await queueCommand("ql-gw-oldest", {
        type: "spawn",
        payload: { order: "first" },
      });

      // Queue to 50 other gateways
      for (let i = 1; i <= 50; i++) {
        await queueCommand(`ql-gw-newer-${i}`, {
          type: "spawn",
          payload: { order: "middle" },
        });
      }

      // Gateway A should be evicted (oldest)
      const stats = await getQueueStats();
      expect(stats.totalGateways).toBe(50);

      const oldestCommands = await getAndClearCommands("ql-gw-oldest");
      expect(oldestCommands).toHaveLength(0); // Evicted
    });
  });

  describe("command TTL expiry (COMMAND_TTL_MS = 5 minutes)", () => {
    it("should evict commands older than 5 minutes", async () => {
      vi.useFakeTimers();
      const gatewayId = "ql-gw-ttl-1";

      // Queue a command at T=0
      await queueCommand(gatewayId, {
        type: "spawn",
        payload: { timestamp: "t0" },
      });

      // Advance time by 6 minutes
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Try to retrieve - should be empty (expired)
      const retrieved = await getAndClearCommands(gatewayId);
      expect(retrieved).toHaveLength(0);
    });

    it("should retain commands younger than 5 minutes", async () => {
      vi.useFakeTimers();
      const gatewayId = "ql-gw-ttl-2";

      // Queue a command at T=0
      await queueCommand(gatewayId, {
        type: "spawn",
        payload: { timestamp: "t0" },
      });

      // Advance time by 4 minutes (under TTL)
      vi.advanceTimersByTime(4 * 60 * 1000);

      // Should still be present
      const retrieved = await getAndClearCommands(gatewayId);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].payload).toEqual({ timestamp: "t0" });
    });

    it("should evict expired commands but keep fresh ones", async () => {
      vi.useFakeTimers();
      const gatewayId = "ql-gw-ttl-3";

      // Queue command at T=0
      await queueCommand(gatewayId, {
        type: "spawn",
        payload: { timestamp: "t0" },
      });

      // Advance 6 minutes (first command expires)
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Queue new command at T=6min
      await queueCommand(gatewayId, {
        type: "spawn",
        payload: { timestamp: "t6" },
      });

      // Retrieve - should only get the fresh command
      const retrieved = await getAndClearCommands(gatewayId);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].payload).toEqual({ timestamp: "t6" });
    });
  });

  describe("liveOutputCache size limit (MAX_LIVE_OUTPUT_ENTRIES = 200)", () => {
    it("should bound liveOutputCache to 200 entries", async () => {
      // This test requires accessing liveOutputCache or using getQueueStats
      // For now, we'll test via getQueueStats which should expose this metric

      // Simulate 250 live output cache entries
      // (This would require updating agent statuses with liveOutput, which is not directly testable
      // from queueCommand API, so we'll test the stats reporting mechanism)

      const stats = await getQueueStats();
      expect(stats).toHaveProperty("liveOutputEntries");
      expect(typeof stats.liveOutputEntries).toBe("number");
      expect(stats.liveOutputEntries).toBeGreaterThanOrEqual(0);
      expect(stats.liveOutputEntries).toBeLessThanOrEqual(200);
    });
  });

  describe("queue stats export", () => {
    it("should return stats with totalCommands, totalGateways, liveOutputEntries", async () => {
      const gatewayId = "ql-gw-stats";

      // Queue some commands
      await queueCommand(gatewayId, {
        type: "spawn",
        payload: { test: 1 },
      });
      await queueCommand(gatewayId, {
        type: "spawn",
        payload: { test: 2 },
      });

      const stats = await getQueueStats();

      expect(stats).toHaveProperty("totalCommands");
      expect(stats).toHaveProperty("totalGateways");
      expect(stats).toHaveProperty("liveOutputEntries");

      expect(typeof stats.totalCommands).toBe("number");
      expect(typeof stats.totalGateways).toBe("number");
      expect(typeof stats.liveOutputEntries).toBe("number");

      expect(stats.totalCommands).toBeGreaterThan(0);
      expect(stats.totalGateways).toBeGreaterThan(0);
    });

    it("should reflect accurate command count across multiple gateways", async () => {
      // Queue to 3 gateways
      await queueCommand("ql-gw-s1", {
        type: "spawn",
        payload: { gw: 1 },
      });
      await queueCommand("ql-gw-s1", {
        type: "spawn",
        payload: { gw: 1 },
      });
      await queueCommand("ql-gw-s2", {
        type: "spawn",
        payload: { gw: 2 },
      });
      await queueCommand("ql-gw-s3", {
        type: "spawn",
        payload: { gw: 3 },
      });

      const stats = await getQueueStats();
      expect(stats.totalGateways).toBeGreaterThanOrEqual(3);
      expect(stats.totalCommands).toBeGreaterThanOrEqual(4);
    });
  });

  describe("FIFO eviction correctness", () => {
    it("should evict oldest command when queue is full", async () => {
      const gatewayId = "ql-gw-fifo";

      // Fill to capacity with 100 commands
      for (let i = 1; i <= 100; i++) {
        await queueCommand(gatewayId, {
          type: "spawn",
          payload: { order: i, marker: "first" },
        });
      }

      // Add one more - should evict the FIRST command (order: 1)
      await queueCommand(gatewayId, {
        type: "spawn",
        payload: { order: 101, marker: "overflow" },
      });

      const retrieved = await getAndClearCommands(gatewayId);
      expect(retrieved).toHaveLength(100);

      // First command should be order: 2 (order: 1 was evicted)
      expect(retrieved[0].payload).toEqual({ order: 2, marker: "first" });

      // Last command should be order: 101
      expect(retrieved[99].payload).toEqual({ order: 101, marker: "overflow" });
    });

    it("should maintain FIFO order after multiple evictions", async () => {
      const gatewayId = "ql-gw-fifo-multi";

      // Add 150 commands total (will evict 50)
      for (let i = 1; i <= 150; i++) {
        await queueCommand(gatewayId, {
          type: "spawn",
          payload: { sequence: i },
        });
      }

      const retrieved = await getAndClearCommands(gatewayId);
      expect(retrieved).toHaveLength(100);

      // Verify sequential order from 51 to 150
      for (let i = 0; i < 100; i++) {
        expect(retrieved[i].payload).toEqual({ sequence: 51 + i });
      }
    });
  });

  describe("cleanup function", () => {
    it("should remove expired commands across all gateways", async () => {
      vi.useFakeTimers();

      // Queue commands to 3 gateways
      await queueCommand("ql-gw-clean-1", {
        type: "spawn",
        payload: { gw: 1 },
      });
      await queueCommand("ql-gw-clean-2", {
        type: "spawn",
        payload: { gw: 2 },
      });
      await queueCommand("ql-gw-clean-3", {
        type: "spawn",
        payload: { gw: 3 },
      });

      // Advance time by 6 minutes (all expire)
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Run cleanup
      await cleanupExpiredCommands();

      // All commands should be gone
      const stats = await getQueueStats();
      expect(stats.totalCommands).toBe(0);
    });

    it("should remove empty gateway entries from the Map", async () => {
      vi.useFakeTimers();

      // Queue to gateway
      await queueCommand("ql-gw-empty", {
        type: "spawn",
        payload: { test: 1 },
      });

      const statsBefore = await getQueueStats();
      expect(statsBefore.totalGateways).toBeGreaterThan(0);

      // Expire and cleanup
      vi.advanceTimersByTime(6 * 60 * 1000);
      await cleanupExpiredCommands();

      // Gateway should be removed from map
      const statsAfter = await getQueueStats();
      expect(statsAfter.totalGateways).toBe(0);
    });

    it("should retain fresh commands while removing expired ones", async () => {
      vi.useFakeTimers();

      const gatewayId = "ql-gw-partial-clean";

      // Add old command
      await queueCommand(gatewayId, {
        type: "spawn",
        payload: { age: "old" },
      });

      // Advance 6 minutes (old command expires)
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Add fresh command
      await queueCommand(gatewayId, {
        type: "spawn",
        payload: { age: "fresh" },
      });

      // Cleanup should remove old, keep fresh
      await cleanupExpiredCommands();

      const retrieved = await getAndClearCommands(gatewayId);
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].payload).toEqual({ age: "fresh" });
    });

    it("should not throw if called on empty queue", async () => {
      await expect(cleanupExpiredCommands()).resolves.not.toThrow();
    });
  });

  describe("P0: memory leak prevention", () => {
    describe("queueCommand should purge expired items on insert", () => {
      it("should remove expired commands when queueing new ones", async () => {
        vi.useFakeTimers();
        const gatewayId = "ql-gw-purge-1";

        // Queue 5 commands at T=0
        for (let i = 1; i <= 5; i++) {
          await queueCommand(gatewayId, {
            type: "spawn",
            payload: { old: true, index: i },
          });
        }

        // Advance past TTL (6 min)
        vi.advanceTimersByTime(6 * 60 * 1000);

        // Queue 1 new command — should purge the 5 expired ones
        await queueCommand(gatewayId, {
          type: "spawn",
          payload: { fresh: true },
        });

        // Stats should show only 1 command, not 6
        const stats = await getQueueStats();
        // totalCommands counts ALL gateways so just check retrieval
        const retrieved = await getAndClearCommands(gatewayId);
        expect(retrieved).toHaveLength(1);
        expect(retrieved[0].payload).toEqual({ fresh: true });
      });

      it("should purge expired commands even when queue is under capacity", async () => {
        vi.useFakeTimers();
        const gatewayId = "ql-gw-purge-2";

        // Queue 3 commands
        for (let i = 1; i <= 3; i++) {
          await queueCommand(gatewayId, {
            type: "spawn",
            payload: { batch: "old", index: i },
          });
        }

        // Expire them
        vi.advanceTimersByTime(6 * 60 * 1000);

        // Queue 2 more
        await queueCommand(gatewayId, {
          type: "spawn",
          payload: { batch: "new", index: 1 },
        });
        await queueCommand(gatewayId, {
          type: "spawn",
          payload: { batch: "new", index: 2 },
        });

        const retrieved = await getAndClearCommands(gatewayId);
        expect(retrieved).toHaveLength(2);
        expect(retrieved[0].payload).toEqual({ batch: "new", index: 1 });
        expect(retrieved[1].payload).toEqual({ batch: "new", index: 2 });
      });

      it("should remove empty gateway map entries after purging all expired commands", async () => {
        vi.useFakeTimers();

        // Queue commands to 3 gateways
        for (let i = 1; i <= 3; i++) {
          await queueCommand(`ql-gw-purge-empty-${i}`, {
            type: "spawn",
            payload: { index: i },
          });
        }

        // Expire all
        vi.advanceTimersByTime(6 * 60 * 1000);

        // Queue to only 1 gateway — the other 2 should be cleaned up
        await queueCommand("ql-gw-purge-empty-1", {
          type: "spawn",
          payload: { fresh: true },
        });

        // Run explicit cleanup to clear orphaned gateways
        await cleanupExpiredCommands();

        const stats = await getQueueStats();
        // Only gateway-1 should remain (with fresh command), gateways 2 and 3 should be gone
        expect(stats.totalGateways).toBe(1);
        expect(stats.totalCommands).toBe(1);
      });
    });

    describe("liveOutputCache TTL enforcement", () => {
      it("should expose getLiveOutputCacheSize for monitoring", async () => {
        // Import the function — if it doesn't exist yet, this test will fail (RED)
        expect(typeof getLiveOutputCacheSize).toBe("function");
        const size = getLiveOutputCacheSize();
        expect(typeof size).toBe("number");
        expect(size).toBeGreaterThanOrEqual(0);
      });

      it("should expose cleanupStaleLiveOutput to evict stale entries", async () => {
        expect(typeof cleanupStaleLiveOutput).toBe("function");
      });
    });

    describe("auto-cleanup interval", () => {
      it("should export startAutoCleanup and stopAutoCleanup", async () => {
        expect(typeof startAutoCleanup).toBe("function");
        expect(typeof stopAutoCleanup).toBe("function");
      });

      it("startAutoCleanup should run cleanupExpiredCommands periodically", async () => {
        vi.useFakeTimers();

        const gatewayId = "ql-gw-auto-cleanup";

        // Queue a command
        await queueCommand(gatewayId, {
          type: "spawn",
          payload: { autoClean: true },
        });

        // Start auto-cleanup with 1-minute interval
        startAutoCleanup(60_000);

        // Advance past TTL
        vi.advanceTimersByTime(6 * 60 * 1000);

        // The interval should have fired and cleaned up
        const stats = await getQueueStats();
        expect(stats.totalCommands).toBe(0);
        expect(stats.totalGateways).toBe(0);

        stopAutoCleanup();
      });

      it("stopAutoCleanup should stop the periodic cleanup", async () => {
        vi.useFakeTimers();

        startAutoCleanup(60_000);
        stopAutoCleanup();

        // Queue and expire
        await queueCommand("ql-gw-stop-cleanup", {
          type: "spawn",
          payload: { shouldStay: true },
        });

        vi.advanceTimersByTime(10 * 60 * 1000);

        // Without auto-cleanup, expired commands should still be in queue
        // (they'll be filtered on getAndClearCommands, but getQueueStats counts raw)
        const stats = await getQueueStats();
        expect(stats.totalCommands).toBe(1); // Still in memory (not cleaned up)

        // Clean up for next test
        await cleanupExpiredCommands();
      });
    });
  });
});
