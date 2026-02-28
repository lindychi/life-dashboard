import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// In-memory storage for mock PostgreSQL
const mockStorage = {
  history: [] as Array<{
    id: string;
    agent_id: string;
    type: string;
    content: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
    request_group_id: string | null;
    request_title: string | null;
  }>,
};

let historyIdCounter = 0;

// Mock the db module
vi.mock("@/lib/db", () => {
  const queryImpl = async (sql: string, params: unknown[] = []) => {
    // getFilteredHistory - SELECT with filters + ORDER BY + LIMIT
    if (
      sql.includes("SELECT id, agent_id") &&
      sql.includes("FROM agent_history") &&
      sql.includes("ORDER BY created_at DESC, id DESC")
    ) {
      let results = [...mockStorage.history];
      let paramIndex = 0;

      // Parse WHERE conditions
      if (sql.includes("WHERE")) {
        // agentId filter
        if (sql.includes("agent_id = $")) {
          const agentId = params[paramIndex++] as string;
          results = results.filter((h) => h.agent_id === agentId);
        }

        // types filter (ANY)
        if (sql.includes("type = ANY($")) {
          const types = params[paramIndex++] as string[];
          results = results.filter((h) => types.includes(h.type));
        }

        // excludeTypes filter (ALL)
        if (sql.includes("type != ALL($")) {
          const excludeTypes = params[paramIndex++] as string[];
          results = results.filter((h) => !excludeTypes.includes(h.type));
        }

        // search filter (ILIKE)
        if (sql.includes("content ILIKE $")) {
          const searchPattern = params[paramIndex++] as string;
          const searchTerm = searchPattern.replace(/%/g, "");
          results = results.filter((h) =>
            h.content.toLowerCase().includes(searchTerm.toLowerCase())
          );
        }

        // requestGroupId filter
        if (sql.includes("request_group_id = $")) {
          const requestGroupId = params[paramIndex++] as string;
          results = results.filter((h) => h.request_group_id === requestGroupId);
        }

        // dateFrom filter
        if (sql.includes("created_at >= $")) {
          const dateFrom = params[paramIndex++] as string;
          results = results.filter(
            (h) => new Date(h.created_at) >= new Date(dateFrom)
          );
        }

        // dateTo filter
        if (sql.includes("created_at <= $")) {
          const dateTo = params[paramIndex++] as string;
          results = results.filter(
            (h) => new Date(h.created_at) <= new Date(dateTo)
          );
        }

        // cursor filter - composite (timestamp, id)
        if (sql.includes("(created_at, id) < ($")) {
          const cursorTimestamp = params[paramIndex++] as string;
          const cursorId = params[paramIndex++] as string;
          results = results.filter((h) => {
            if (h.created_at < cursorTimestamp) return true;
            if (h.created_at === cursorTimestamp && h.id < cursorId) return true;
            return false;
          });
        }
        // cursor filter - plain timestamp (backward compatible)
        else if (sql.includes("created_at < $")) {
          const cursorTimestamp = params[paramIndex++] as string;
          results = results.filter((h) => h.created_at < cursorTimestamp);
        }
      }

      // Sort DESC (latest first)
      results.sort((a, b) => {
        if (a.created_at !== b.created_at) {
          return b.created_at.localeCompare(a.created_at);
        }
        return b.id.localeCompare(a.id);
      });

      // Get limit (last param)
      const limit = params[params.length - 1] as number;
      results = results.slice(0, limit);

      // Map to response format
      return results.map((h) => ({
        id: h.id,
        agentId: h.agent_id,
        type: h.type,
        content: h.content,
        metadata: h.metadata,
        timestamp: h.created_at,
        requestGroupId: h.request_group_id,
        requestTitle: h.request_title,
      }));
    }

    // COUNT query for getFilteredHistory (totalCount)
    if (sql.includes("COUNT(*) as count") && sql.includes("FROM agent_history")) {
      let results = [...mockStorage.history];
      let paramIndex = 0;

      // Same filters as SELECT but without cursor
      if (sql.includes("WHERE")) {
        if (sql.includes("agent_id = $")) {
          const agentId = params[paramIndex++] as string;
          results = results.filter((h) => h.agent_id === agentId);
        }
        if (sql.includes("type = ANY($")) {
          const types = params[paramIndex++] as string[];
          results = results.filter((h) => types.includes(h.type));
        }
        if (sql.includes("type != ALL($")) {
          const excludeTypes = params[paramIndex++] as string[];
          results = results.filter((h) => !excludeTypes.includes(h.type));
        }
        if (sql.includes("content ILIKE $")) {
          const searchPattern = params[paramIndex++] as string;
          const searchTerm = searchPattern.replace(/%/g, "");
          results = results.filter((h) =>
            h.content.toLowerCase().includes(searchTerm.toLowerCase())
          );
        }
        if (sql.includes("request_group_id = $")) {
          const requestGroupId = params[paramIndex++] as string;
          results = results.filter((h) => h.request_group_id === requestGroupId);
        }
        if (sql.includes("created_at >= $")) {
          const dateFrom = params[paramIndex++] as string;
          results = results.filter(
            (h) => new Date(h.created_at) >= new Date(dateFrom)
          );
        }
        if (sql.includes("created_at <= $")) {
          const dateTo = params[paramIndex++] as string;
          results = results.filter(
            (h) => new Date(h.created_at) <= new Date(dateTo)
          );
        }
      }

      return [{ count: String(results.length) }];
    }

    // getGroupedHistory - CTE with group_summary + entries
    if (sql.includes("WITH group_summary AS") && sql.includes("LEFT JOIN")) {
      // Get groups ordered by last activity
      const groups = new Map<string, {
        requestGroupId: string;
        groupTitle: string;
        totalCount: number;
        completedCount: number;
        failedCount: number;
        inProgressCount: number;
        groupStartedAt: string;
        groupLastActivityAt: string;
        entries: typeof mockStorage.history;
      }>();

      for (const h of mockStorage.history) {
        if (!h.request_group_id) continue;

        if (!groups.has(h.request_group_id)) {
          const groupEntries = mockStorage.history.filter(
            (e) => e.request_group_id === h.request_group_id
          );

          const completedCount = groupEntries.filter(
            (e) => e.type === "task_completed"
          ).length;
          const failedCount = groupEntries.filter(
            (e) => e.type === "task_failed"
          ).length;
          const startedCount = groupEntries.filter(
            (e) => e.type === "task_started"
          ).length;
          const inProgressCount = Math.max(
            0,
            startedCount - completedCount - failedCount
          );

          groups.set(h.request_group_id, {
            requestGroupId: h.request_group_id,
            groupTitle: h.request_title || "제목 없음",
            totalCount: groupEntries.length,
            completedCount,
            failedCount,
            inProgressCount,
            groupStartedAt: groupEntries[0].created_at,
            groupLastActivityAt:
              groupEntries[groupEntries.length - 1].created_at,
            entries: groupEntries,
          });
        }
      }

      // Sort groups by last activity DESC
      const sortedGroups = Array.from(groups.values()).sort((a, b) =>
        b.groupLastActivityAt.localeCompare(a.groupLastActivityAt)
      );

      // Apply limit to groups
      const limit = params[0] as number;
      const limitedGroups = sortedGroups.slice(0, limit);

      // Flatten to row format
      const rows: Array<{
        id: string;
        agentId: string;
        type: string;
        content: string;
        metadata: Record<string, unknown> | null;
        timestamp: string;
        requestGroupId: string;
        requestTitle: string | null;
        total_count: string;
        completed_count: string;
        failed_count: string;
        in_progress_count: string;
        group_started_at: string;
        group_last_activity_at: string;
        group_title: string;
      }> = [];

      for (const group of limitedGroups) {
        for (const entry of group.entries) {
          rows.push({
            id: entry.id,
            agentId: entry.agent_id,
            type: entry.type,
            content: entry.content,
            metadata: entry.metadata,
            timestamp: entry.created_at,
            requestGroupId: entry.request_group_id!,
            requestTitle: entry.request_title,
            total_count: String(group.totalCount),
            completed_count: String(group.completedCount),
            failed_count: String(group.failedCount),
            in_progress_count: String(group.inProgressCount),
            group_started_at: group.groupStartedAt,
            group_last_activity_at: group.groupLastActivityAt,
            group_title: group.groupTitle,
          });
        }
      }

      return rows;
    }

    // getHistoryDetail - SELECT single entry with SUBSTRING
    if (sql.includes("SELECT id, agent_id") && sql.includes("WHERE id = $1")) {
      const entryId = params[0] as string;
      const entry = mockStorage.history.find((h) => h.id === entryId);
      if (!entry) return [];

      const useSubstring = sql.includes("SUBSTRING(content FROM");
      let content = entry.content;

      if (useSubstring) {
        const contentOffset = (params[1] as number) || 1; // SQL is 1-indexed
        const contentLimit = (params[2] as number) || 0;
        content = entry.content.substring(contentOffset - 1, contentOffset - 1 + contentLimit);
      }

      return [
        {
          id: entry.id,
          agentId: entry.agent_id,
          type: entry.type,
          content,
          metadata: entry.metadata,
          timestamp: entry.created_at,
          requestGroupId: entry.request_group_id,
          requestTitle: entry.request_title,
          content_total_length: String(entry.content.length),
        },
      ];
    }

    // getHistoryDetail - neighbors query
    if (
      sql.includes("FROM agent_history") &&
      sql.includes("WHERE request_group_id = $1 AND id != $2")
    ) {
      const requestGroupId = params[0] as string;
      const excludeId = params[1] as string;

      const neighbors = mockStorage.history
        .filter(
          (h) => h.request_group_id === requestGroupId && h.id !== excludeId
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, 50);

      return neighbors.map((h) => {
        let content = h.content;
        if (content.length > 500) {
          content = content.substring(0, 500) + "...[truncated]";
        }
        return {
          id: h.id,
          agentId: h.agent_id,
          type: h.type,
          content,
          metadata: h.metadata,
          timestamp: h.created_at,
          requestGroupId: h.request_group_id,
          requestTitle: h.request_title,
        };
      });
    }

    return [];
  };

  return {
    query: vi.fn(queryImpl),
    queryOne: vi.fn(async (sql: string, params: unknown[] = []) => {
      const results = await queryImpl(sql, params);
      return results[0] || null;
    }),
    pool: {},
    isDbConnectionError: vi.fn(() => false),
  };
});

import {
  getFilteredHistory,
  getGroupedHistory,
  getHistoryDetail,
  type HistoryEntry,
} from "@/lib/history";

// Helper to add mock history entry
function addMockEntry(
  agentId: string,
  type: string,
  content: string,
  options?: {
    timestamp?: string;
    requestGroupId?: string;
    requestTitle?: string;
    metadata?: Record<string, unknown>;
  }
): HistoryEntry {
  historyIdCounter++;
  const entry = {
    id: `hist-${historyIdCounter}`,
    agent_id: agentId,
    type,
    content,
    metadata: options?.metadata || null,
    created_at: options?.timestamp || new Date().toISOString(),
    request_group_id: options?.requestGroupId || null,
    request_title: options?.requestTitle || null,
  };
  mockStorage.history.push(entry);
  return {
    id: entry.id,
    agentId: entry.agent_id,
    type: entry.type as HistoryEntry["type"],
    content: entry.content,
    metadata: entry.metadata,
    timestamp: entry.created_at,
    requestGroupId: entry.request_group_id,
    requestTitle: entry.request_title,
  };
}

describe("history timeline module", () => {
  beforeEach(() => {
    mockStorage.history = [];
    historyIdCounter = 0;
    vi.clearAllMocks();
  });

  // =========================================================================
  // getFilteredHistory()
  // =========================================================================
  describe("getFilteredHistory", () => {
    it("should return entries with default limit 50 and DESC order", async () => {
      addMockEntry("dev", "task_started", "Task 1", {
        timestamp: "2025-01-01T10:00:00Z",
      });
      addMockEntry("dev", "task_completed", "Task 2", {
        timestamp: "2025-01-01T11:00:00Z",
      });

      const result = await getFilteredHistory({});

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].content).toBe("Task 2"); // Latest first
      expect(result.entries[1].content).toBe("Task 1");
      expect(result.totalCount).toBe(2);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it("should filter by agentId", async () => {
      addMockEntry("dev", "task_started", "Dev task");
      addMockEntry("pm", "task_started", "PM task");
      addMockEntry("dev", "task_completed", "Dev done");

      const result = await getFilteredHistory({ agentId: "dev" });

      expect(result.entries).toHaveLength(2);
      expect(result.entries.every((e) => e.agentId === "dev")).toBe(true);
      expect(result.totalCount).toBe(2);
    });

    it("should filter by types array", async () => {
      addMockEntry("dev", "task_started", "Started");
      addMockEntry("dev", "task_completed", "Completed");
      addMockEntry("dev", "task_failed", "Failed");
      addMockEntry("dev", "output", "Output");

      const result = await getFilteredHistory({
        types: ["task_completed", "task_failed"],
      });

      expect(result.entries).toHaveLength(2);
      expect(result.entries.every((e) => ["task_completed", "task_failed"].includes(e.type))).toBe(true);
    });

    it("should filter by excludeTypes array", async () => {
      addMockEntry("dev", "task_started", "Started");
      addMockEntry("dev", "output", "Output 1");
      addMockEntry("dev", "output", "Output 2");
      addMockEntry("dev", "task_completed", "Completed");

      const result = await getFilteredHistory({
        excludeTypes: ["output"],
      });

      expect(result.entries).toHaveLength(2);
      expect(result.entries.every((e) => e.type !== "output")).toBe(true);
    });

    it("should filter by search text (ILIKE)", async () => {
      addMockEntry("dev", "task_started", "Build frontend");
      addMockEntry("dev", "task_started", "Build backend");
      addMockEntry("dev", "task_started", "Deploy application");

      const result = await getFilteredHistory({ search: "build" });

      expect(result.entries).toHaveLength(2);
      expect(result.entries.every((e) => e.content.toLowerCase().includes("build"))).toBe(true);
    });

    it("should filter by dateFrom", async () => {
      addMockEntry("dev", "task_started", "Task 1", {
        timestamp: "2025-01-01T10:00:00Z",
      });
      addMockEntry("dev", "task_started", "Task 2", {
        timestamp: "2025-01-02T10:00:00Z",
      });
      addMockEntry("dev", "task_started", "Task 3", {
        timestamp: "2025-01-03T10:00:00Z",
      });

      const result = await getFilteredHistory({
        dateFrom: "2025-01-02T00:00:00Z",
      });

      expect(result.entries).toHaveLength(2);
      expect(result.entries.every((e) => e.timestamp >= "2025-01-02T00:00:00Z")).toBe(true);
    });

    it("should filter by dateTo", async () => {
      addMockEntry("dev", "task_started", "Task 1", {
        timestamp: "2025-01-01T10:00:00Z",
      });
      addMockEntry("dev", "task_started", "Task 2", {
        timestamp: "2025-01-02T10:00:00Z",
      });
      addMockEntry("dev", "task_started", "Task 3", {
        timestamp: "2025-01-03T10:00:00Z",
      });

      const result = await getFilteredHistory({
        dateTo: "2025-01-02T23:59:59Z",
      });

      expect(result.entries).toHaveLength(2);
      expect(result.entries.every((e) => e.timestamp <= "2025-01-02T23:59:59Z")).toBe(true);
    });

    it("should filter by requestGroupId", async () => {
      addMockEntry("dev", "task_started", "Task 1", {
        requestGroupId: "group-1",
      });
      addMockEntry("dev", "task_completed", "Task 2", {
        requestGroupId: "group-1",
      });
      addMockEntry("dev", "task_started", "Task 3", {
        requestGroupId: "group-2",
      });

      const result = await getFilteredHistory({
        requestGroupId: "group-1",
      });

      expect(result.entries).toHaveLength(2);
      expect(result.entries.every((e) => e.requestGroupId === "group-1")).toBe(true);
    });

    it("should support cursor-based pagination with composite cursor (timestamp|id)", async () => {
      const entries = [
        addMockEntry("dev", "task_started", "Task 1", {
          timestamp: "2025-01-01T10:00:00Z",
        }),
        addMockEntry("dev", "task_started", "Task 2", {
          timestamp: "2025-01-01T11:00:00Z",
        }),
        addMockEntry("dev", "task_started", "Task 3", {
          timestamp: "2025-01-01T12:00:00Z",
        }),
      ];

      // First page
      const page1 = await getFilteredHistory({ limit: 2 });
      expect(page1.entries).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBe(`${entries[1].timestamp}|${entries[1].id}`);

      // Second page with composite cursor
      const page2 = await getFilteredHistory({
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.entries).toHaveLength(1);
      expect(page2.entries[0].id).toBe(entries[0].id);
      expect(page2.hasMore).toBe(false);
      expect(page2.nextCursor).toBeNull();
    });

    it("should support backward compatible plain timestamp cursor", async () => {
      addMockEntry("dev", "task_started", "Task 1", {
        timestamp: "2025-01-01T10:00:00Z",
      });
      addMockEntry("dev", "task_started", "Task 2", {
        timestamp: "2025-01-01T11:00:00Z",
      });
      addMockEntry("dev", "task_started", "Task 3", {
        timestamp: "2025-01-01T12:00:00Z",
      });

      // Use plain timestamp cursor (no pipe)
      const result = await getFilteredHistory({
        cursor: "2025-01-01T11:00:00Z",
      });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].content).toBe("Task 1");
    });

    it("should combine multiple filters", async () => {
      addMockEntry("dev", "task_started", "Build frontend", {
        timestamp: "2025-01-01T10:00:00Z",
      });
      addMockEntry("dev", "task_completed", "Build backend", {
        timestamp: "2025-01-02T10:00:00Z",
      });
      addMockEntry("pm", "task_started", "Build API", {
        timestamp: "2025-01-02T11:00:00Z",
      });
      addMockEntry("dev", "output", "Build logs", {
        timestamp: "2025-01-02T12:00:00Z",
      });

      const result = await getFilteredHistory({
        agentId: "dev",
        types: ["task_started", "task_completed"],
        search: "build",
        dateFrom: "2025-01-01T00:00:00Z",
        dateTo: "2025-01-03T00:00:00Z",
      });

      expect(result.entries).toHaveLength(2);
      expect(result.entries.every((e) => e.agentId === "dev")).toBe(true);
      expect(result.entries.every((e) => e.content.toLowerCase().includes("build"))).toBe(true);
    });

    it("should calculate hasMore correctly when entries exceed limit", async () => {
      for (let i = 0; i < 10; i++) {
        addMockEntry("dev", "task_started", `Task ${i}`);
      }

      const result = await getFilteredHistory({ limit: 5 });

      expect(result.entries).toHaveLength(5);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).not.toBeNull();
    });

    it("should format nextCursor as 'timestamp|id'", async () => {
      addMockEntry("dev", "task_started", "Task 1", {
        timestamp: "2025-01-01T10:00:00Z",
      });
      addMockEntry("dev", "task_started", "Task 2", {
        timestamp: "2025-01-01T11:00:00Z",
      });

      const result = await getFilteredHistory({ limit: 1 });

      expect(result.nextCursor).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|hist-\d+$/);
      expect(result.nextCursor!.includes("|")).toBe(true);
    });

    it("should return empty array when no entries match filters", async () => {
      addMockEntry("dev", "task_started", "Task 1");

      const result = await getFilteredHistory({ agentId: "nonexistent" });

      expect(result.entries).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });
  });

  // =========================================================================
  // getGroupedHistory()
  // =========================================================================
  describe("getGroupedHistory", () => {
    it("should group entries by requestGroupId", async () => {
      addMockEntry("dev", "task_started", "Task 1", {
        requestGroupId: "group-1",
        requestTitle: "Build Feature A",
      });
      addMockEntry("dev", "task_completed", "Task 2", {
        requestGroupId: "group-1",
        requestTitle: "Build Feature A",
      });
      addMockEntry("pm", "task_started", "Task 3", {
        requestGroupId: "group-2",
        requestTitle: "Review PR",
      });

      const result = await getGroupedHistory(20);

      expect(result).toHaveLength(2);
      expect(result[0].requestGroupId).toBeDefined();
      expect(result[0].entries.length).toBeGreaterThan(0);
    });

    it("should calculate group statistics correctly", async () => {
      addMockEntry("dev", "task_started", "Task 1", {
        requestGroupId: "group-1",
      });
      addMockEntry("dev", "task_started", "Task 2", {
        requestGroupId: "group-1",
      });
      addMockEntry("dev", "task_completed", "Task 3", {
        requestGroupId: "group-1",
      });
      addMockEntry("dev", "task_failed", "Task 4", {
        requestGroupId: "group-1",
      });

      const result = await getGroupedHistory(20);

      expect(result).toHaveLength(1);
      const group = result[0];
      expect(group.totalCount).toBe(4);
      expect(group.completedCount).toBe(1);
      expect(group.failedCount).toBe(1);
      expect(group.inProgressCount).toBe(0); // 2 started - 1 completed - 1 failed = 0
    });

    it("should calculate inProgressCount correctly", async () => {
      addMockEntry("dev", "task_started", "Task 1", {
        requestGroupId: "group-1",
      });
      addMockEntry("dev", "task_started", "Task 2", {
        requestGroupId: "group-1",
      });
      addMockEntry("dev", "task_started", "Task 3", {
        requestGroupId: "group-1",
      });
      addMockEntry("dev", "task_completed", "Task 4", {
        requestGroupId: "group-1",
      });

      const result = await getGroupedHistory(20);

      expect(result[0].inProgressCount).toBe(2); // 3 started - 1 completed = 2
    });

    it("should sort groups by lastActivityAt DESC", async () => {
      addMockEntry("dev", "task_started", "Old group", {
        requestGroupId: "group-1",
        timestamp: "2025-01-01T10:00:00Z",
      });
      addMockEntry("dev", "task_completed", "Old group done", {
        requestGroupId: "group-1",
        timestamp: "2025-01-01T11:00:00Z",
      });
      addMockEntry("pm", "task_started", "New group", {
        requestGroupId: "group-2",
        timestamp: "2025-01-02T10:00:00Z",
      });

      const result = await getGroupedHistory(20);

      expect(result).toHaveLength(2);
      expect(result[0].requestGroupId).toBe("group-2"); // Latest activity first
      expect(result[1].requestGroupId).toBe("group-1");
    });

    it("should sort entries within group by timestamp ASC", async () => {
      addMockEntry("dev", "task_started", "First", {
        requestGroupId: "group-1",
        timestamp: "2025-01-01T10:00:00Z",
      });
      addMockEntry("dev", "output", "Second", {
        requestGroupId: "group-1",
        timestamp: "2025-01-01T11:00:00Z",
      });
      addMockEntry("dev", "task_completed", "Third", {
        requestGroupId: "group-1",
        timestamp: "2025-01-01T12:00:00Z",
      });

      const result = await getGroupedHistory(20);

      expect(result[0].entries).toHaveLength(3);
      expect(result[0].entries[0].content).toBe("First");
      expect(result[0].entries[1].content).toBe("Second");
      expect(result[0].entries[2].content).toBe("Third");
    });

    it("should respect limit parameter for number of groups", async () => {
      for (let i = 0; i < 5; i++) {
        addMockEntry("dev", "task_started", `Group ${i} task`, {
          requestGroupId: `group-${i}`,
          timestamp: `2025-01-0${i + 1}T10:00:00Z`,
        });
      }

      const result = await getGroupedHistory(3);

      expect(result).toHaveLength(3);
    });

    it("should use requestTitle from entries", async () => {
      addMockEntry("dev", "task_started", "Task 1", {
        requestGroupId: "group-1",
        requestTitle: "Build Feature A",
      });

      const result = await getGroupedHistory(20);

      expect(result[0].requestTitle).toBe("Build Feature A");
    });

    it("should use '제목 없음' when requestTitle is missing", async () => {
      addMockEntry("dev", "task_started", "Task 1", {
        requestGroupId: "group-1",
        requestTitle: null,
      });

      const result = await getGroupedHistory(20);

      expect(result[0].requestTitle).toBe("제목 없음");
    });

    it("should include startedAt and lastActivityAt timestamps", async () => {
      addMockEntry("dev", "task_started", "Task 1", {
        requestGroupId: "group-1",
        timestamp: "2025-01-01T10:00:00Z",
      });
      addMockEntry("dev", "task_completed", "Task 2", {
        requestGroupId: "group-1",
        timestamp: "2025-01-01T12:00:00Z",
      });

      const result = await getGroupedHistory(20);

      expect(result[0].startedAt).toBe("2025-01-01T10:00:00Z");
      expect(result[0].lastActivityAt).toBe("2025-01-01T12:00:00Z");
    });

    it("should return empty array when no grouped entries exist", async () => {
      addMockEntry("dev", "task_started", "Ungrouped task", {
        requestGroupId: null,
      });

      const result = await getGroupedHistory(20);

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // getHistoryDetail()
  // =========================================================================
  describe("getHistoryDetail", () => {
    it("should return full entry by default", async () => {
      const entry = addMockEntry("dev", "output", "Full content here");

      const result = await getHistoryDetail(entry.id);

      expect(result).not.toBeNull();
      expect(result!.entry.id).toBe(entry.id);
      expect(result!.entry.content).toBe("Full content here");
      expect(result!.contentTotalLength).toBe("Full content here".length);
      expect(result!.contentOffset).toBe(0);
      expect(result!.hasMoreContent).toBe(false);
    });

    it("should support partial content with contentOffset and contentLimit", async () => {
      const longContent = "A".repeat(1000);
      const entry = addMockEntry("dev", "output", longContent);

      const result = await getHistoryDetail(entry.id, {
        contentOffset: 10,
        contentLimit: 50,
      });

      expect(result).not.toBeNull();
      expect(result!.entry.content).toHaveLength(50);
      expect(result!.contentTotalLength).toBe(1000);
      expect(result!.contentOffset).toBe(10);
      expect(result!.hasMoreContent).toBe(true);
    });

    it("should calculate hasMoreContent correctly", async () => {
      const content = "A".repeat(100);
      const entry = addMockEntry("dev", "output", content);

      // Read first 50 chars
      const result1 = await getHistoryDetail(entry.id, {
        contentOffset: 0,
        contentLimit: 50,
      });
      expect(result1!.hasMoreContent).toBe(true);

      // Read last 50 chars
      const result2 = await getHistoryDetail(entry.id, {
        contentOffset: 50,
        contentLimit: 50,
      });
      expect(result2!.hasMoreContent).toBe(false);
    });

    it("should include neighbors from same request group", async () => {
      const entry1 = addMockEntry("dev", "task_started", "Task started", {
        requestGroupId: "group-1",
      });
      addMockEntry("dev", "output", "Output 1", {
        requestGroupId: "group-1",
      });
      const entry3 = addMockEntry("dev", "task_completed", "Task completed", {
        requestGroupId: "group-1",
      });

      const result = await getHistoryDetail(entry1.id);

      expect(result!.neighbors).toHaveLength(2);
      expect(result!.neighbors.some((n) => n.id === entry3.id)).toBe(true);
      expect(result!.neighbors.every((n) => n.id !== entry1.id)).toBe(true);
    });

    it("should exclude current entry from neighbors", async () => {
      const entry1 = addMockEntry("dev", "task_started", "Task 1", {
        requestGroupId: "group-1",
      });
      addMockEntry("dev", "task_completed", "Task 2", {
        requestGroupId: "group-1",
      });

      const result = await getHistoryDetail(entry1.id);

      expect(result!.neighbors.every((n) => n.id !== entry1.id)).toBe(true);
    });

    it("should truncate neighbor content to 500 chars", async () => {
      const shortEntry = addMockEntry("dev", "task_started", "Short", {
        requestGroupId: "group-1",
      });
      addMockEntry("dev", "output", "A".repeat(1000), {
        requestGroupId: "group-1",
      });

      const result = await getHistoryDetail(shortEntry.id);

      const longNeighbor = result!.neighbors.find((n) =>
        n.content.includes("...[truncated]")
      );
      expect(longNeighbor).toBeDefined();
      expect(longNeighbor!.content).toHaveLength(515); // 500 + "...[truncated]"
    });

    it("should support includeNeighbors: false option", async () => {
      const entry1 = addMockEntry("dev", "task_started", "Task 1", {
        requestGroupId: "group-1",
      });
      addMockEntry("dev", "task_completed", "Task 2", {
        requestGroupId: "group-1",
      });

      const result = await getHistoryDetail(entry1.id, {
        includeNeighbors: false,
      });

      expect(result!.neighbors).toEqual([]);
    });

    it("should return empty neighbors when no request group", async () => {
      const entry = addMockEntry("dev", "task_started", "Ungrouped task", {
        requestGroupId: null,
      });

      const result = await getHistoryDetail(entry.id);

      expect(result!.neighbors).toEqual([]);
    });

    it("should return null for non-existent entryId", async () => {
      const result = await getHistoryDetail("nonexistent-id");

      expect(result).toBeNull();
    });

    it("should limit neighbors to 50 entries", async () => {
      const entry1 = addMockEntry("dev", "task_started", "Main task", {
        requestGroupId: "group-1",
      });
      for (let i = 0; i < 60; i++) {
        addMockEntry("dev", "output", `Output ${i}`, {
          requestGroupId: "group-1",
        });
      }

      const result = await getHistoryDetail(entry1.id);

      expect(result!.neighbors.length).toBeLessThanOrEqual(50);
    });

    it("should sort neighbors by timestamp ASC", async () => {
      const entry1 = addMockEntry("dev", "task_started", "First", {
        requestGroupId: "group-1",
        timestamp: "2025-01-01T10:00:00Z",
      });
      addMockEntry("dev", "output", "Second", {
        requestGroupId: "group-1",
        timestamp: "2025-01-01T11:00:00Z",
      });
      addMockEntry("dev", "task_completed", "Third", {
        requestGroupId: "group-1",
        timestamp: "2025-01-01T12:00:00Z",
      });

      const result = await getHistoryDetail(entry1.id);

      expect(result!.neighbors).toHaveLength(2);
      expect(result!.neighbors[0].content).toBe("Second");
      expect(result!.neighbors[1].content).toBe("Third");
    });
  });
});
