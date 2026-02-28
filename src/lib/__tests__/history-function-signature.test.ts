import { describe, it, expect, vi, beforeEach } from "vitest";
import { addHistoryEntry } from "../history";
import type { HistoryEntry } from "../history";

// Mock database
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  isDbConnectionError: vi.fn(() => false),
}));

vi.mock("pg", () => ({
  Pool: vi.fn(() => ({
    query: vi.fn(),
  })),
}));

// Mock request-group module
vi.mock("@/lib/request-group", () => ({
  generateRequestTitle: vi.fn((content: string) => `Test: ${content.slice(0, 20)}`),
}));

describe("addHistoryEntry function signature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should accept agentId as first parameter and entry object as second parameter", async () => {
    const { query } = await import("@/lib/db");
    const mockQuery = query as unknown as ReturnType<typeof vi.fn>;

    mockQuery.mockResolvedValueOnce([
      {
        id: "test-id",
        agentId: "dev",
        type: "task_started",
        content: "Starting task",
        metadata: null,
        timestamp: "2024-01-01T00:00:00Z",
        requestGroupId: null,
        requestTitle: "Test: Starting task",
      },
    ]);

    // CORRECT: Two separate parameters
    const result = await addHistoryEntry("dev", {
      type: "task_started",
      content: "Starting task",
    });

    expect(result).toBeDefined();
    expect(result.agentId).toBe("dev");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_history"),
      expect.arrayContaining(["dev", "task_started", "Starting task"])
    );
  });

  it("should reject when agentId is inside the entry object (WRONG usage)", () => {
    // WRONG: Single object parameter with agentId inside
    // This should fail TypeScript compilation
    // @ts-expect-error - Testing wrong signature
    const wrongCall = () => addHistoryEntry({
      agentId: "dev",
      type: "task_started",
      content: "Starting task",
    });

    // This test documents the WRONG way - it should not compile
    expect(wrongCall).toBeDefined();
  });

  it("should work with all optional fields", async () => {
    const { query } = await import("@/lib/db");
    const mockQuery = query as unknown as ReturnType<typeof vi.fn>;

    mockQuery.mockResolvedValueOnce([
      {
        id: "test-id-2",
        agentId: "qa",
        type: "output",
        content: "Test output",
        metadata: { testKey: "testValue" },
        timestamp: "2024-01-01T00:00:00Z",
        requestGroupId: "group-123",
        requestTitle: "Custom title",
      },
    ]);

    const result = await addHistoryEntry("qa", {
      type: "output",
      content: "Test output",
      metadata: { testKey: "testValue" },
      requestGroupId: "group-123",
      requestTitle: "Custom title",
    });

    expect(result).toBeDefined();
    expect(result.agentId).toBe("qa");
    expect(result.metadata).toEqual({ testKey: "testValue" });
  });
});
