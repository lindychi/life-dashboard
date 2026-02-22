import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { queueCommand, getAndClearCommands, getConnectedGateways, getAllAgentStatuses, isDbAvailable } from "../relay";

describe("relay in-memory fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("queueCommand with DB down", () => {
    it("should queue command in-memory when DB is unavailable", async () => {
      mockQueryOne.mockRejectedValue(createECONNREFUSED());

      const result = await queueCommand("gw1", {
        type: "orchestrate",
        payload: { task: "test task" },
      });

      expect(result).toBeDefined();
      expect(result.type).toBe("orchestrate");
      expect(result.payload).toEqual({ task: "test task" });
      expect(result.status).toBe("pending");
      expect(result.id).toBeTruthy();
    });

    it("should mark dbAvailable as false", async () => {
      mockQueryOne.mockRejectedValue(createECONNREFUSED());
      await queueCommand("gw1", { type: "spawn", payload: {} });
      expect(isDbAvailable()).toBe(false);
    });

    it("should still throw non-connection errors", async () => {
      mockQueryOne.mockRejectedValue(new Error("SQL syntax error"));
      await expect(
        queueCommand("gw1", { type: "spawn", payload: {} })
      ).rejects.toThrow("SQL syntax error");
    });
  });

  describe("getAndClearCommands with DB down", () => {
    it("should return in-memory commands when DB is unavailable", async () => {
      // First, queue a command in-memory
      mockQueryOne.mockRejectedValue(createECONNREFUSED());
      await queueCommand("gw2", { type: "orchestrate", payload: { task: "test" } });

      // Then try to get commands (also fails DB)
      mockQuery.mockRejectedValue(createECONNREFUSED());
      const commands = await getAndClearCommands("gw2");

      expect(commands).toHaveLength(1);
      expect(commands[0].type).toBe("orchestrate");
    });

    it("should drain in-memory queue (return once, empty next time)", async () => {
      mockQueryOne.mockRejectedValue(createECONNREFUSED());
      await queueCommand("gw3", { type: "orchestrate", payload: { task: "test" } });

      mockQuery.mockRejectedValue(createECONNREFUSED());
      const first = await getAndClearCommands("gw3");
      const second = await getAndClearCommands("gw3");

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0);
    });

    it("should merge DB and in-memory commands when DB recovers", async () => {
      // Queue in-memory while DB is down
      mockQueryOne.mockRejectedValue(createECONNREFUSED());
      await queueCommand("gw4", { type: "orchestrate", payload: { task: "in-memory" } });

      // DB recovers - getAndClearCommands succeeds
      mockQuery.mockResolvedValue([{
        id: "db-cmd-1",
        type: "spawn",
        payload: { agentId: "dev", task: "db task" },
        status: "processing",
        result: null,
        created_at: new Date().toISOString(),
      }]);

      const commands = await getAndClearCommands("gw4");

      expect(commands).toHaveLength(2);
      expect(commands[0].type).toBe("spawn"); // DB command first
      expect(commands[1].type).toBe("orchestrate"); // In-memory command second
    });
  });

  describe("getConnectedGateways with DB down", () => {
    it("should return empty array when DB is unavailable", async () => {
      mockQuery.mockRejectedValue(createECONNREFUSED());
      const gateways = await getConnectedGateways();
      expect(gateways).toEqual([]);
    });
  });

  describe("getAllAgentStatuses with DB down", () => {
    it("should return empty object when DB is unavailable", async () => {
      mockQuery.mockRejectedValue(createECONNREFUSED());
      const statuses = await getAllAgentStatuses();
      expect(statuses).toEqual({});
    });
  });

  describe("DB recovery", () => {
    it("should restore dbAvailable to true when DB recovers", async () => {
      // DB down
      mockQueryOne.mockRejectedValue(createECONNREFUSED());
      await queueCommand("gw5", { type: "spawn", payload: {} });
      expect(isDbAvailable()).toBe(false);

      // DB recovers
      mockQueryOne.mockResolvedValue({
        id: "1",
        gateway_id: "gw5",
        type: "spawn",
        payload: {},
        status: "pending",
        result: null,
        created_at: new Date().toISOString(),
      });
      await queueCommand("gw5", { type: "spawn", payload: {} });
      expect(isDbAvailable()).toBe(true);
    });
  });
});
