import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  queueInstruction,
  getPendingInstructions,
  consumeInstruction,
  isAgentBusy,
} from "../relay";

// Mock the db module
vi.mock("../db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  isDbConnectionError: vi.fn((error: unknown) => {
    return (
      error instanceof Error &&
      (error.message.includes("ECONNREFUSED") ||
        error.message.includes("connection"))
    );
  }),
}));

// Mock crypto for UUID generation
vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-123"),
}));

const { query, queryOne } = await import("../db");

describe("Relay Queue System", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("queueInstruction", () => {
    it("should queue an instruction successfully", async () => {
      const mockId = "instr-123";
      const mockCreatedAt = "2024-01-01T00:00:00Z";

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: mockId,
        created_at: mockCreatedAt,
      });

      vi.mocked(queryOne).mockResolvedValueOnce({
        position: 3,
      });

      const result = await queueInstruction(
        "gateway-1",
        "agent-1",
        "Do something important"
      );

      expect(result).toEqual({
        id: mockId,
        position: 3,
      });

      expect(queryOne).toHaveBeenCalledTimes(2);
      expect(queryOne).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("INSERT INTO relay_commands"),
        [
          "gateway-1",
          JSON.stringify({
            agentId: "agent-1",
            content: "Do something important",
            metadata: {},
          }),
        ]
      );
    });

    it("should include metadata when provided", async () => {
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: "instr-456",
        created_at: "2024-01-01T00:00:00Z",
      });

      vi.mocked(queryOne).mockResolvedValueOnce({
        position: 1,
      });

      await queueInstruction("gateway-1", "agent-1", "Test", {
        priority: "high",
      });

      expect(queryOne).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("INSERT INTO relay_commands"),
        [
          "gateway-1",
          JSON.stringify({
            agentId: "agent-1",
            content: "Test",
            metadata: { priority: "high" },
          }),
        ]
      );
    });

    it("should throw error when database is unavailable", async () => {
      const dbError = new Error("ECONNREFUSED");
      vi.mocked(queryOne).mockRejectedValueOnce(dbError);

      await expect(
        queueInstruction("gateway-1", "agent-1", "Test")
      ).rejects.toThrow("Database unavailable");
    });
  });

  describe("getPendingInstructions", () => {
    it("should return all pending instructions", async () => {
      const mockInstructions = [
        {
          id: "instr-1",
          payload: { agentId: "agent-1", content: "First task" },
          created_at: "2024-01-01T00:00:00Z",
          position: 1,
        },
        {
          id: "instr-2",
          payload: { agentId: "agent-2", content: "Second task" },
          created_at: "2024-01-01T00:01:00Z",
          position: 1,
        },
      ];

      vi.mocked(query).mockResolvedValueOnce(mockInstructions);

      const result = await getPendingInstructions();

      expect(result).toEqual([
        {
          id: "instr-1",
          agentId: "agent-1",
          content: "First task",
          createdAt: "2024-01-01T00:00:00Z",
          position: 1,
        },
        {
          id: "instr-2",
          agentId: "agent-2",
          content: "Second task",
          createdAt: "2024-01-01T00:01:00Z",
          position: 1,
        },
      ]);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE status = 'queued'"),
        []
      );
    });

    it("should filter by gateway ID", async () => {
      vi.mocked(query).mockResolvedValueOnce([]);

      await getPendingInstructions("gateway-1");

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("AND gateway_id = $1"),
        ["gateway-1"]
      );
    });

    it("should filter by agent ID", async () => {
      vi.mocked(query).mockResolvedValueOnce([]);

      await getPendingInstructions(undefined, "agent-1");

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("AND payload->>'agentId' = $1"),
        ["agent-1"]
      );
    });

    it("should filter by both gateway and agent ID", async () => {
      vi.mocked(query).mockResolvedValueOnce([]);

      await getPendingInstructions("gateway-1", "agent-1");

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("AND gateway_id = $1"),
        ["gateway-1", "agent-1"]
      );
    });

    it("should return empty array when database is unavailable", async () => {
      const dbError = new Error("connection failed");
      vi.mocked(query).mockRejectedValueOnce(dbError);

      const result = await getPendingInstructions();

      expect(result).toEqual([]);
    });
  });

  describe("consumeInstruction", () => {
    it("should mark instruction as processing", async () => {
      vi.mocked(query).mockResolvedValueOnce([]);

      await consumeInstruction("gateway-1", "instr-123");

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE relay_commands"),
        ["instr-123", "gateway-1"]
      );

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'processing'"),
        expect.any(Array)
      );
    });

    it("should throw error when database is unavailable", async () => {
      const dbError = new Error("ECONNREFUSED");
      vi.mocked(query).mockRejectedValueOnce(dbError);

      await expect(
        consumeInstruction("gateway-1", "instr-123")
      ).rejects.toThrow("Database unavailable");
    });
  });

  describe("isAgentBusy", () => {
    it("should return true when agent is running", async () => {
      vi.mocked(queryOne).mockResolvedValueOnce({
        status: "running",
      });

      const result = await isAgentBusy("gateway-1", "agent-1");

      expect(result).toBe(true);
      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining("SELECT status"),
        ["gateway-1", "agent-1"]
      );
    });

    it("should return false when agent is idle", async () => {
      vi.mocked(queryOne).mockResolvedValueOnce({
        status: "idle",
      });

      const result = await isAgentBusy("gateway-1", "agent-1");

      expect(result).toBe(false);
    });

    it("should return false when agent not found", async () => {
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await isAgentBusy("gateway-1", "agent-1");

      expect(result).toBe(false);
    });

    it("should return false when database is unavailable", async () => {
      const dbError = new Error("connection failed");
      vi.mocked(queryOne).mockRejectedValueOnce(dbError);

      const result = await isAgentBusy("gateway-1", "agent-1");

      expect(result).toBe(false);
    });
  });
});
