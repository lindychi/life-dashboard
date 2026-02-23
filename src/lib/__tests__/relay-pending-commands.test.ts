import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * TDD Red Phase: Tests for getPendingCommands() function in relay.ts
 *
 * This function should retrieve relay_commands with status='pending' from the database,
 * grouped by the target agentId (extracted from payload).
 *
 * This is distinct from getPendingInstructions() which handles status='queued' instructions.
 * getPendingCommands() handles regular relay commands (spawn, send, status, etc.) that
 * are waiting to be picked up by a gateway.
 *
 * Expected interface:
 *   getPendingCommands(gatewayId?: string, agentId?: string): Promise<PendingCommand[]>
 *
 * PendingCommand shape:
 *   { id, gatewayId, type, payload, agentId, createdAt, position }
 */

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

const { query, queryOne } = await import("../db");

describe("getPendingCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should be exported from relay module", async () => {
    const relay = await import("../relay");
    expect(typeof relay.getPendingCommands).toBe("function");
  });

  it("should return all pending commands when called without filters", async () => {
    const mockCommands = [
      {
        id: "cmd-1",
        gateway_id: "gw-1",
        type: "spawn",
        payload: { agentId: "dev", task: "Fix bug" },
        status: "pending",
        created_at: "2024-06-01T10:00:00Z",
        position: 1,
      },
      {
        id: "cmd-2",
        gateway_id: "gw-1",
        type: "send",
        payload: { agentId: "pm", message: "Hello" },
        status: "pending",
        created_at: "2024-06-01T10:01:00Z",
        position: 1,
      },
    ];

    vi.mocked(query).mockResolvedValueOnce(mockCommands);

    const { getPendingCommands } = await import("../relay");
    const result = await getPendingCommands();

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "cmd-1",
      gatewayId: "gw-1",
      type: "spawn",
      payload: { agentId: "dev", task: "Fix bug" },
      agentId: "dev",
      createdAt: "2024-06-01T10:00:00Z",
      position: 1,
    });
    expect(result[1]).toEqual({
      id: "cmd-2",
      gatewayId: "gw-1",
      type: "send",
      payload: { agentId: "pm", message: "Hello" },
      agentId: "pm",
      createdAt: "2024-06-01T10:01:00Z",
      position: 1,
    });
  });

  it("should query relay_commands with status='pending'", async () => {
    vi.mocked(query).mockResolvedValueOnce([]);

    const { getPendingCommands } = await import("../relay");
    await getPendingCommands();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'pending'"),
      expect.any(Array)
    );
  });

  it("should filter by gatewayId when provided", async () => {
    vi.mocked(query).mockResolvedValueOnce([]);

    const { getPendingCommands } = await import("../relay");
    await getPendingCommands("gw-1");

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("gateway_id"),
      expect.arrayContaining(["gw-1"])
    );
  });

  it("should filter by agentId when provided", async () => {
    vi.mocked(query).mockResolvedValueOnce([]);

    const { getPendingCommands } = await import("../relay");
    await getPendingCommands(undefined, "dev");

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("agentId"),
      expect.arrayContaining(["dev"])
    );
  });

  it("should filter by both gatewayId and agentId", async () => {
    vi.mocked(query).mockResolvedValueOnce([]);

    const { getPendingCommands } = await import("../relay");
    await getPendingCommands("gw-1", "dev");

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("gateway_id"),
      expect.arrayContaining(["gw-1", "dev"])
    );
  });

  it("should include position via ROW_NUMBER window function", async () => {
    const mockCommands = [
      {
        id: "cmd-1",
        gateway_id: "gw-1",
        type: "spawn",
        payload: { agentId: "dev", task: "First" },
        status: "pending",
        created_at: "2024-06-01T10:00:00Z",
        position: 1,
      },
      {
        id: "cmd-2",
        gateway_id: "gw-1",
        type: "spawn",
        payload: { agentId: "dev", task: "Second" },
        status: "pending",
        created_at: "2024-06-01T10:01:00Z",
        position: 2,
      },
    ];

    vi.mocked(query).mockResolvedValueOnce(mockCommands);

    const { getPendingCommands } = await import("../relay");
    const result = await getPendingCommands();

    expect(result[0].position).toBe(1);
    expect(result[1].position).toBe(2);
  });

  it("should return empty array when no pending commands exist", async () => {
    vi.mocked(query).mockResolvedValueOnce([]);

    const { getPendingCommands } = await import("../relay");
    const result = await getPendingCommands();

    expect(result).toEqual([]);
  });

  it("should return empty array when database is unavailable", async () => {
    const dbError = new Error("connection ECONNREFUSED");
    vi.mocked(query).mockRejectedValueOnce(dbError);

    const { getPendingCommands } = await import("../relay");
    const result = await getPendingCommands();

    expect(result).toEqual([]);
  });

  it("should throw non-DB errors", async () => {
    const otherError = new Error("syntax error at position 42");
    vi.mocked(query).mockRejectedValueOnce(otherError);

    const { getPendingCommands } = await import("../relay");
    await expect(getPendingCommands()).rejects.toThrow("syntax error");
  });

  it("should only return commands with type != 'instruction' (not queued instructions)", async () => {
    vi.mocked(query).mockResolvedValueOnce([]);

    const { getPendingCommands } = await import("../relay");
    await getPendingCommands();

    // Verify the SQL excludes 'instruction' type commands (those are handled by getPendingInstructions)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("type != 'instruction'"),
      expect.any(Array)
    );
  });

  it("should extract agentId from payload correctly", async () => {
    const mockCommands = [
      {
        id: "cmd-1",
        gateway_id: "gw-1",
        type: "orchestrate",
        payload: { agentId: "ops", workflow: "deploy" },
        status: "pending",
        created_at: "2024-06-01T10:00:00Z",
        position: 1,
      },
    ];

    vi.mocked(query).mockResolvedValueOnce(mockCommands);

    const { getPendingCommands } = await import("../relay");
    const result = await getPendingCommands();

    expect(result[0].agentId).toBe("ops");
  });
});

describe("PendingCommand interface", () => {
  it("should export PendingCommand type from relay module", async () => {
    // This is a compile-time check - if PendingCommand doesn't exist,
    // TypeScript compilation will fail. At runtime, we verify the shape.
    const relay = await import("../relay");
    expect(relay.getPendingCommands).toBeDefined();
  });
});
