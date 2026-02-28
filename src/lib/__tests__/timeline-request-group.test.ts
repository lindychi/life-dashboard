import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// Shared mock for db query function
const mockQuery = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: vi.fn(),
  pool: {},
  isDbConnectionError: (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const err = error as { code?: string; errors?: Array<{ code?: string }> };
    const codes = ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT"];
    if (err.code && codes.includes(err.code)) return true;
    if (err.errors) {
      return err.errors.some((e) => e.code != null && codes.includes(e.code));
    }
    return false;
  },
}));

// ============================================================
// Part 1: Unit Tests - history.ts getFilteredHistory
// ============================================================
describe("Unit Tests: getFilteredHistory requestGroupId filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should include request_group_id condition when requestGroupId is provided", async () => {
    const { getFilteredHistory } = await import("@/lib/history");
    const testGroupId = "550e8400-e29b-41d4-a716-446655440000";

    // Mock: count query returns 1, entries query returns matching entry
    mockQuery
      .mockResolvedValueOnce([{ count: "1" }])  // COUNT query
      .mockResolvedValueOnce([{                  // SELECT entries
        id: "entry-1",
        agentId: "dev",
        type: "task_started",
        content: "Test task",
        metadata: null,
        timestamp: "2025-01-01T00:00:00Z",
        requestGroupId: testGroupId,
        requestTitle: "Test Group",
      }]);

    const result = await getFilteredHistory({ requestGroupId: testGroupId });

    // Verify COUNT query includes request_group_id filter
    const countCall = mockQuery.mock.calls[0];
    expect(countCall[0]).toContain("request_group_id = $");
    expect(countCall[1]).toContain(testGroupId);

    // Verify SELECT query includes request_group_id filter
    const selectCall = mockQuery.mock.calls[1];
    expect(selectCall[0]).toContain("request_group_id = $");
    expect(selectCall[1]).toContain(testGroupId);

    // Verify result structure
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].requestGroupId).toBe(testGroupId);
    expect(result.totalCount).toBe(1);
  });

  it("should NOT include request_group_id condition when requestGroupId is omitted", async () => {
    const { getFilteredHistory } = await import("@/lib/history");

    mockQuery
      .mockResolvedValueOnce([{ count: "0" }])
      .mockResolvedValueOnce([]);

    await getFilteredHistory({});

    // Neither query should contain request_group_id WHERE condition
    // (SELECT clause may include it for projection, which is fine)
    for (const call of mockQuery.mock.calls) {
      expect(call[0]).not.toContain("request_group_id = $");
    }
  });

  it("should combine requestGroupId with other filters correctly", async () => {
    const { getFilteredHistory } = await import("@/lib/history");
    const testGroupId = "550e8400-e29b-41d4-a716-446655440001";

    mockQuery
      .mockResolvedValueOnce([{ count: "2" }])
      .mockResolvedValueOnce([
        {
          id: "entry-1",
          agentId: "dev",
          type: "task_started",
          content: "Task A",
          metadata: null,
          timestamp: "2025-01-01T00:00:00Z",
          requestGroupId: testGroupId,
          requestTitle: "Combined Filter Test",
        },
        {
          id: "entry-2",
          agentId: "dev",
          type: "task_completed",
          content: "Task A done",
          metadata: null,
          timestamp: "2025-01-01T00:01:00Z",
          requestGroupId: testGroupId,
          requestTitle: "Combined Filter Test",
        },
      ]);

    const result = await getFilteredHistory({
      agentId: "dev",
      requestGroupId: testGroupId,
      types: ["task_started", "task_completed"],
    });

    // Verify SQL contains all three filters
    const selectCall = mockQuery.mock.calls[1];
    const sql = selectCall[0] as string;
    expect(sql).toContain("agent_id = $");
    expect(sql).toContain("type = ANY($");
    expect(sql).toContain("request_group_id = $");

    // Verify params contain all filter values
    const params = selectCall[1] as unknown[];
    expect(params).toContain("dev");
    expect(params).toContain(testGroupId);
    expect(params).toEqual(
      expect.arrayContaining([["task_started", "task_completed"]])
    );

    expect(result.entries).toHaveLength(2);
  });

  it("should use correct parameter index for requestGroupId in SQL", async () => {
    const { getFilteredHistory } = await import("@/lib/history");
    const testGroupId = "550e8400-e29b-41d4-a716-446655440002";

    mockQuery
      .mockResolvedValueOnce([{ count: "0" }])
      .mockResolvedValueOnce([]);

    await getFilteredHistory({
      agentId: "dev",
      search: "test",
      requestGroupId: testGroupId,
    });

    // Verify the SELECT query has proper parameterized query
    const selectCall = mockQuery.mock.calls[1];
    const sql = selectCall[0] as string;
    const params = selectCall[1] as unknown[];

    // agent_id = $1, content ILIKE $2, request_group_id = $3
    expect(sql).toMatch(/agent_id = \$1/);
    expect(sql).toMatch(/content ILIKE \$2/);
    expect(sql).toMatch(/request_group_id = \$3/);

    expect(params[0]).toBe("dev");
    expect(params[1]).toBe("%test%");
    expect(params[2]).toBe(testGroupId);
  });

  it("should return proper pagination info for requestGroupId queries", async () => {
    const { getFilteredHistory } = await import("@/lib/history");
    const testGroupId = "550e8400-e29b-41d4-a716-446655440003";

    // Return 3 entries (limit+1 to indicate hasMore)
    mockQuery
      .mockResolvedValueOnce([{ count: "5" }])
      .mockResolvedValueOnce([
        {
          id: "entry-1",
          agentId: "dev",
          type: "task_started",
          content: "Entry 1",
          metadata: null,
          timestamp: "2025-01-03T00:00:00Z",
          requestGroupId: testGroupId,
          requestTitle: "Pagination Test",
        },
        {
          id: "entry-2",
          agentId: "dev",
          type: "output",
          content: "Entry 2",
          metadata: null,
          timestamp: "2025-01-02T00:00:00Z",
          requestGroupId: testGroupId,
          requestTitle: "Pagination Test",
        },
        {
          id: "entry-3",
          agentId: "dev",
          type: "task_completed",
          content: "Entry 3",
          metadata: null,
          timestamp: "2025-01-01T00:00:00Z",
          requestGroupId: testGroupId,
          requestTitle: "Pagination Test",
        },
      ]);

    const result = await getFilteredHistory({
      requestGroupId: testGroupId,
      limit: 2,
    });

    expect(result.hasMore).toBe(true);
    expect(result.entries).toHaveLength(2);
    expect(result.nextCursor).toBeTruthy();
    expect(result.nextCursor).toContain("entry-2"); // composite cursor contains id
    expect(result.totalCount).toBe(5);
  });
});

// ============================================================
// Part 2: Unit Tests - addHistoryEntry with requestGroupId
// ============================================================
describe("Unit Tests: addHistoryEntry with requestGroupId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should pass requestGroupId and requestTitle to INSERT query", async () => {
    const { addHistoryEntry } = await import("@/lib/history");
    const testGroupId = "660e8400-e29b-41d4-a716-446655440000";
    const testTitle = "Build UI Components";

    mockQuery.mockResolvedValueOnce([{
      id: "new-entry-1",
      agentId: "dev",
      type: "task_started",
      content: "Starting build",
      metadata: null,
      timestamp: "2025-01-01T00:00:00Z",
      requestGroupId: testGroupId,
      requestTitle: testTitle,
    }]);

    const result = await addHistoryEntry("dev", {
      type: "task_started",
      content: "Starting build",
      requestGroupId: testGroupId,
      requestTitle: testTitle,
    });

    const call = mockQuery.mock.calls[0];
    const sql = call[0] as string;
    const params = call[1] as unknown[];

    expect(sql).toContain("request_group_id");
    expect(sql).toContain("request_title");
    expect(params).toContain(testGroupId);
    expect(params).toContain(testTitle);

    expect(result.requestGroupId).toBe(testGroupId);
    expect(result.requestTitle).toBe(testTitle);
  });

  it("should pass null for requestGroupId when not provided", async () => {
    const { addHistoryEntry } = await import("@/lib/history");

    mockQuery.mockResolvedValueOnce([{
      id: "new-entry-2",
      agentId: "dev",
      type: "output",
      content: "Some output",
      metadata: null,
      timestamp: "2025-01-01T00:00:00Z",
      requestGroupId: null,
      requestTitle: null,
    }]);

    await addHistoryEntry("dev", {
      type: "output",
      content: "Some output",
    });

    const call = mockQuery.mock.calls[0];
    const params = call[1] as unknown[];
    // requestGroupId should be null (position 4)
    expect(params[4]).toBeNull();
    // requestTitle is auto-generated from content when not provided (position 5)
    expect(params[5]).toBe("Some output");
  });
});

// ============================================================
// Part 3: API Route Tests - Timeline endpoint
// ============================================================
describe("API Route Tests: /api/history/timeline with requestGroupId", () => {
  // Mock auth
  vi.mock("@/lib/auth", () => ({
    getCurrentUser: vi.fn().mockResolvedValue({ email: "test@test.com" }),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeRequest(url: string): NextRequest {
    return new NextRequest(new URL(url, "http://localhost:3000"));
  }

  it("should pass requestGroupId query param to getFilteredHistory", async () => {
    const { GET } = await import("@/app/api/history/timeline/route");
    const testGroupId = "770e8400-e29b-41d4-a716-446655440000";

    mockQuery
      .mockResolvedValueOnce([{ count: "1" }])
      .mockResolvedValueOnce([{
        id: "entry-1",
        agentId: "qa",
        type: "task_started",
        content: "QA task",
        metadata: null,
        timestamp: "2025-01-01T00:00:00Z",
        requestGroupId: testGroupId,
        requestTitle: "API Test Group",
      }]);

    const req = makeRequest(
      `/api/history/timeline?requestGroupId=${testGroupId}`
    );
    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].requestGroupId).toBe(testGroupId);

    // Verify SQL was called with the group ID
    const selectCall = mockQuery.mock.calls[1];
    expect(selectCall[0]).toContain("request_group_id = $");
    expect(selectCall[1]).toContain(testGroupId);
  });

  it("should return filtered timeline when requestGroupId is combined with other params", async () => {
    const { GET } = await import("@/app/api/history/timeline/route");
    const testGroupId = "770e8400-e29b-41d4-a716-446655440001";

    mockQuery
      .mockResolvedValueOnce([{ count: "0" }])
      .mockResolvedValueOnce([]);

    const req = makeRequest(
      `/api/history/timeline?requestGroupId=${testGroupId}&agentId=dev&limit=10`
    );
    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.entries).toEqual([]);
    expect(body.totalCount).toBe(0);

    // Verify both filters were applied
    const selectCall = mockQuery.mock.calls[1];
    const sql = selectCall[0] as string;
    expect(sql).toContain("agent_id = $");
    expect(sql).toContain("request_group_id = $");
  });

  it("should not include requestGroupId filter when param is absent", async () => {
    const { GET } = await import("@/app/api/history/timeline/route");

    mockQuery
      .mockResolvedValueOnce([{ count: "0" }])
      .mockResolvedValueOnce([]);

    const req = makeRequest("/api/history/timeline");
    await GET(req);

    // Verify no WHERE clause filtering by request_group_id
    // (SELECT clause may include it for projection, which is fine)
    for (const call of mockQuery.mock.calls) {
      expect(call[0]).not.toContain("request_group_id = $");
    }
  });
});

// ============================================================
// Part 4: API Route Tests - Relay timeline endpoint
// ============================================================
describe("API Route Tests: /api/relay/timeline with requestGroupId", () => {
  // Mock relay validation
  vi.mock("@/lib/relay", () => ({
    validateRelayKey: (key: string) => key === "test-relay-key",
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeRelayRequest(url: string): NextRequest {
    return new NextRequest(new URL(url, "http://localhost:3000"), {
      headers: { "x-relay-key": "test-relay-key" },
    });
  }

  it("should pass requestGroupId to getFilteredHistory via relay endpoint", async () => {
    const { GET } = await import("@/app/api/relay/timeline/route");
    const testGroupId = "880e8400-e29b-41d4-a716-446655440000";

    mockQuery
      .mockResolvedValueOnce([{ count: "2" }])
      .mockResolvedValueOnce([
        {
          id: "r-entry-1",
          agentId: "dev",
          type: "task_started",
          content: "Relay task 1",
          metadata: null,
          timestamp: "2025-01-01T00:00:00Z",
          requestGroupId: testGroupId,
          requestTitle: "Relay Group",
        },
        {
          id: "r-entry-2",
          agentId: "dev",
          type: "task_completed",
          content: "Relay task 1 done",
          metadata: null,
          timestamp: "2025-01-01T00:01:00Z",
          requestGroupId: testGroupId,
          requestTitle: "Relay Group",
        },
      ]);

    const req = makeRelayRequest(
      `/api/relay/timeline?requestGroupId=${testGroupId}`
    );
    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].requestGroupId).toBe(testGroupId);
    expect(body.entries[1].requestGroupId).toBe(testGroupId);

    // Verify the SQL query includes requestGroupId
    const selectCall = mockQuery.mock.calls[1];
    expect(selectCall[0]).toContain("request_group_id = $");
    expect(selectCall[1]).toContain(testGroupId);
  });

  it("should reject unauthenticated relay requests", async () => {
    const { GET } = await import("@/app/api/relay/timeline/route");
    const testGroupId = "880e8400-e29b-41d4-a716-446655440001";

    const req = new NextRequest(
      new URL(
        `/api/relay/timeline?requestGroupId=${testGroupId}`,
        "http://localhost:3000"
      )
    );
    // No x-relay-key header

    const response = await GET(req);
    expect(response.status).toBe(401);

    // Should not have queried DB at all
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ============================================================
// Part 5: MCP Tool Tests - Schema validation & query param building
// ============================================================
describe("MCP Tool Tests: GetTimelineSchema requestGroupId validation", () => {
  it("should accept valid UUID for requestGroupId", async () => {
    // Import the zod module used in MCP server for schema validation
    const { z } = await import("zod");

    // Recreate the schema as defined in mcp-server.ts
    const GetTimelineSchema = z.object({
      agentId: z.string().optional(),
      types: z.array(z.string()).optional(),
      excludeTypes: z.array(z.string()).optional(),
      search: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      requestGroupId: z.string().uuid().optional(),
      cursor: z.string().optional(),
      limit: z.number().default(50),
    });

    const validUUID = "550e8400-e29b-41d4-a716-446655440000";
    const parsed = GetTimelineSchema.parse({ requestGroupId: validUUID });
    expect(parsed.requestGroupId).toBe(validUUID);
  });

  it("should reject non-UUID string for requestGroupId", async () => {
    const { z } = await import("zod");

    const GetTimelineSchema = z.object({
      requestGroupId: z.string().uuid().optional(),
      limit: z.number().default(50),
    });

    expect(() => {
      GetTimelineSchema.parse({ requestGroupId: "not-a-uuid" });
    }).toThrow();
  });

  it("should allow requestGroupId to be omitted", async () => {
    const { z } = await import("zod");

    const GetTimelineSchema = z.object({
      requestGroupId: z.string().uuid().optional(),
      limit: z.number().default(50),
    });

    const parsed = GetTimelineSchema.parse({});
    expect(parsed.requestGroupId).toBeUndefined();
    expect(parsed.limit).toBe(50);
  });

  it("should build correct query params when requestGroupId is provided", () => {
    const testGroupId = "990e8400-e29b-41d4-a716-446655440000";

    // Simulate what mcp-server.ts dashboard_get_timeline does
    const params = {
      agentId: "dev",
      requestGroupId: testGroupId,
      limit: 50,
    };

    const queryParams = new URLSearchParams();
    if (params.agentId) queryParams.set("agentId", params.agentId);
    if (params.requestGroupId) queryParams.set("requestGroupId", params.requestGroupId);
    queryParams.set("limit", params.limit.toString());

    const url = `/api/relay/timeline?${queryParams}`;

    expect(url).toContain(`requestGroupId=${testGroupId}`);
    expect(url).toContain("agentId=dev");
    expect(url).toContain("limit=50");
  });

  it("should NOT include requestGroupId in query params when not provided", () => {
    const params: { agentId?: string; requestGroupId?: string; limit: number } = {
      agentId: "dev",
      limit: 50,
    };

    const queryParams = new URLSearchParams();
    if (params.agentId) queryParams.set("agentId", params.agentId);
    if (params.requestGroupId) queryParams.set("requestGroupId", params.requestGroupId);
    queryParams.set("limit", params.limit.toString());

    const url = `/api/relay/timeline?${queryParams}`;

    expect(url).not.toContain("requestGroupId");
    expect(url).toContain("agentId=dev");
  });
});

// ============================================================
// Part 6: Edge Case Tests
// ============================================================
describe("Edge Case Tests: requestGroupId boundary conditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty entries for non-existent requestGroupId", async () => {
    const { getFilteredHistory } = await import("@/lib/history");
    const nonExistentGroupId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    mockQuery
      .mockResolvedValueOnce([{ count: "0" }])
      .mockResolvedValueOnce([]);

    const result = await getFilteredHistory({
      requestGroupId: nonExistentGroupId,
    });

    expect(result.entries).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("should handle entries without requestGroupId in mixed results", async () => {
    const { getFilteredHistory } = await import("@/lib/history");

    // When no requestGroupId filter, all entries returned including those without groupId
    mockQuery
      .mockResolvedValueOnce([{ count: "2" }])
      .mockResolvedValueOnce([
        {
          id: "entry-no-group",
          agentId: "dev",
          type: "output",
          content: "Ungrouped entry",
          metadata: null,
          timestamp: "2025-01-01T00:00:00Z",
          requestGroupId: null,
          requestTitle: null,
        },
        {
          id: "entry-with-group",
          agentId: "dev",
          type: "task_started",
          content: "Grouped entry",
          metadata: null,
          timestamp: "2025-01-01T00:01:00Z",
          requestGroupId: "550e8400-e29b-41d4-a716-446655440099",
          requestTitle: "Some Group",
        },
      ]);

    const result = await getFilteredHistory({});

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].requestGroupId).toBeNull();
    expect(result.entries[1].requestGroupId).toBe("550e8400-e29b-41d4-a716-446655440099");
  });

  it("should handle requestGroupId with cursor pagination correctly", async () => {
    const { getFilteredHistory } = await import("@/lib/history");
    const testGroupId = "550e8400-e29b-41d4-a716-446655440000";

    mockQuery
      .mockResolvedValueOnce([{ count: "3" }])
      .mockResolvedValueOnce([{
        id: "entry-page2",
        agentId: "dev",
        type: "output",
        content: "Page 2 entry",
        metadata: null,
        timestamp: "2025-01-01T00:00:00Z",
        requestGroupId: testGroupId,
        requestTitle: "Cursor Test",
      }]);

    const result = await getFilteredHistory({
      requestGroupId: testGroupId,
      cursor: "2025-01-02T00:00:00Z|entry-page1",
      limit: 5,
    });

    // Verify both requestGroupId AND cursor conditions are in SQL
    const selectCall = mockQuery.mock.calls[1];
    const sql = selectCall[0] as string;
    expect(sql).toContain("request_group_id = $");
    expect(sql).toContain("(created_at, id) < ($");

    // Verify params order: requestGroupId before cursor params
    const params = selectCall[1] as unknown[];
    const groupIdIndex = params.indexOf(testGroupId);
    const cursorTimestampIndex = params.indexOf("2025-01-02T00:00:00Z");
    expect(groupIdIndex).toBeLessThan(cursorTimestampIndex);

    expect(result.entries).toHaveLength(1);
    expect(result.hasMore).toBe(false);
  });

  it("should handle requestGroupId with date range filters", async () => {
    const { getFilteredHistory } = await import("@/lib/history");
    const testGroupId = "550e8400-e29b-41d4-a716-446655440000";

    mockQuery
      .mockResolvedValueOnce([{ count: "1" }])
      .mockResolvedValueOnce([{
        id: "entry-date",
        agentId: "dev",
        type: "task_started",
        content: "Date filtered",
        metadata: null,
        timestamp: "2025-06-15T12:00:00Z",
        requestGroupId: testGroupId,
        requestTitle: "Date Range Test",
      }]);

    await getFilteredHistory({
      requestGroupId: testGroupId,
      dateFrom: "2025-06-01T00:00:00Z",
      dateTo: "2025-06-30T23:59:59Z",
    });

    const selectCall = mockQuery.mock.calls[1];
    const sql = selectCall[0] as string;

    // All three conditions should be present
    expect(sql).toContain("request_group_id = $");
    expect(sql).toContain("created_at >= $");
    expect(sql).toContain("created_at <= $");
  });

  it("should handle requestGroupId with excludeTypes filter", async () => {
    const { getFilteredHistory } = await import("@/lib/history");
    const testGroupId = "550e8400-e29b-41d4-a716-446655440000";

    mockQuery
      .mockResolvedValueOnce([{ count: "2" }])
      .mockResolvedValueOnce([
        {
          id: "entry-1",
          agentId: "dev",
          type: "task_started",
          content: "Started",
          metadata: null,
          timestamp: "2025-01-01T00:00:00Z",
          requestGroupId: testGroupId,
          requestTitle: "Exclude Test",
        },
        {
          id: "entry-2",
          agentId: "dev",
          type: "task_completed",
          content: "Completed",
          metadata: null,
          timestamp: "2025-01-01T00:01:00Z",
          requestGroupId: testGroupId,
          requestTitle: "Exclude Test",
        },
      ]);

    await getFilteredHistory({
      requestGroupId: testGroupId,
      excludeTypes: ["output"],
    });

    const selectCall = mockQuery.mock.calls[1];
    const sql = selectCall[0] as string;
    expect(sql).toContain("request_group_id = $");
    expect(sql).toContain("type != ALL($");
  });

  it("should handle empty string requestGroupId as undefined (no filter)", async () => {
    const { getFilteredHistory } = await import("@/lib/history");

    mockQuery
      .mockResolvedValueOnce([{ count: "0" }])
      .mockResolvedValueOnce([]);

    // Pass empty string - the falsy check in getFilteredHistory should skip it
    await getFilteredHistory({ requestGroupId: "" });

    // Verify no WHERE clause filtering by request_group_id
    // (SELECT clause may include it for projection, which is fine)
    for (const call of mockQuery.mock.calls) {
      expect(call[0]).not.toContain("request_group_id = $");
    }
  });

  it("should return hasMore=false and null cursor for exact-limit requestGroupId results", async () => {
    const { getFilteredHistory } = await import("@/lib/history");
    const testGroupId = "550e8400-e29b-41d4-a716-446655440000";

    // Return exactly limit entries (not limit+1), meaning no more pages
    mockQuery
      .mockResolvedValueOnce([{ count: "2" }])
      .mockResolvedValueOnce([
        {
          id: "entry-1",
          agentId: "dev",
          type: "task_started",
          content: "Entry 1",
          metadata: null,
          timestamp: "2025-01-02T00:00:00Z",
          requestGroupId: testGroupId,
          requestTitle: "Exact Limit Test",
        },
        {
          id: "entry-2",
          agentId: "dev",
          type: "task_completed",
          content: "Entry 2",
          metadata: null,
          timestamp: "2025-01-01T00:00:00Z",
          requestGroupId: testGroupId,
          requestTitle: "Exact Limit Test",
        },
      ]);

    const result = await getFilteredHistory({
      requestGroupId: testGroupId,
      limit: 2,
    });

    expect(result.entries).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});

// ============================================================
// Part 7: getGroupedHistory tests
// ============================================================
describe("Unit Tests: getGroupedHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should group entries by requestGroupId with proper summary counts", async () => {
    const { getGroupedHistory } = await import("@/lib/history");
    const groupId = "550e8400-e29b-41d4-a716-446655440000";

    mockQuery.mockResolvedValueOnce([
      {
        id: "e1",
        agentId: "dev",
        type: "task_started",
        content: "Started",
        metadata: null,
        timestamp: "2025-01-01T00:00:00Z",
        requestGroupId: groupId,
        requestTitle: "Test Group",
        total_count: "3",
        completed_count: "1",
        failed_count: "0",
        in_progress_count: "1",
        group_started_at: "2025-01-01T00:00:00Z",
        group_last_activity_at: "2025-01-01T00:02:00Z",
        group_title: "Test Group",
      },
      {
        id: "e2",
        agentId: "dev",
        type: "output",
        content: "Processing...",
        metadata: null,
        timestamp: "2025-01-01T00:01:00Z",
        requestGroupId: groupId,
        requestTitle: "Test Group",
        total_count: "3",
        completed_count: "1",
        failed_count: "0",
        in_progress_count: "1",
        group_started_at: "2025-01-01T00:00:00Z",
        group_last_activity_at: "2025-01-01T00:02:00Z",
        group_title: "Test Group",
      },
      {
        id: "e3",
        agentId: "dev",
        type: "task_completed",
        content: "Done",
        metadata: null,
        timestamp: "2025-01-01T00:02:00Z",
        requestGroupId: groupId,
        requestTitle: "Test Group",
        total_count: "3",
        completed_count: "1",
        failed_count: "0",
        in_progress_count: "1",
        group_started_at: "2025-01-01T00:00:00Z",
        group_last_activity_at: "2025-01-01T00:02:00Z",
        group_title: "Test Group",
      },
    ]);

    const result = await getGroupedHistory(20);

    expect(result).toHaveLength(1);
    expect(result[0].requestGroupId).toBe(groupId);
    expect(result[0].requestTitle).toBe("Test Group");
    expect(result[0].totalCount).toBe(3);
    expect(result[0].completedCount).toBe(1);
    expect(result[0].failedCount).toBe(0);
    expect(result[0].inProgressCount).toBe(1);
    expect(result[0].entries).toHaveLength(3);
  });

  it("should return empty array when no grouped entries exist", async () => {
    const { getGroupedHistory } = await import("@/lib/history");

    mockQuery.mockResolvedValueOnce([]);

    const result = await getGroupedHistory(20);
    expect(result).toEqual([]);
  });
});
