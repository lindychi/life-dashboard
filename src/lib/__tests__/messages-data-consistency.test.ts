/**
 * TDD Test Suite: Messages Data Consistency Fixes
 *
 * This test suite identifies and validates fixes for data inconsistency issues
 * in the messages system. Each test follows TDD principles:
 * 1. Write failing test that exposes the bug
 * 2. Implement minimal fix
 * 3. Verify test passes
 * 4. Add edge cases
 *
 * Based on QA analysis, the following issues exist:
 *
 * ISSUE 1: Race condition in concurrent sendMessage calls
 * - Multiple agents sending messages simultaneously may result in incorrect timestamps
 * - Database transaction isolation level may not be sufficient
 *
 * ISSUE 2: Timestamp ordering inconsistency in getConversation
 * - Messages with identical timestamps may have non-deterministic ordering
 * - DESC query + reverse() logic may produce inconsistent results
 *
 * ISSUE 3: Empty/whitespace-only content bypass
 * - trim() happens at API layer but not in library layer consistently
 * - Some code paths may accept empty strings after trimming
 *
 * ISSUE 4: Broadcast read status race condition
 * - Multiple agents marking same broadcast as read may cause duplicate inserts
 * - ON CONFLICT clause may not be working as expected
 *
 * ISSUE 5: getAllAgentsOverview latest message race condition
 * - Latest message determination may be inconsistent under concurrent writes
 * - LATERAL join timing may not reflect most recent state
 *
 * ISSUE 6: NULL handling in database responses
 * - Various functions may not handle NULL values from database gracefully
 * - Casting NULL to string/number may produce unexpected results
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Mock } from "vitest";

// Mock pg FIRST to prevent native module loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// In-memory storage
const mockStorage = {
  messages: [] as Array<{
    id: string;
    from_id: string;
    to_id: string;
    content: string;
    type: string;
    read: boolean;
    created_at: string;
  }>,
  readStatus: [] as Array<{
    message_id: string;
    agent_id: string;
  }>,
};

let messageIdCounter = 0;
let queryLog: Array<{ sql: string; params: unknown[] }> = [];

// Mock db module
vi.mock("@/lib/db", () => {
  const queryImpl = async (sql: string, params: unknown[] = []) => {
    queryLog.push({ sql: sql.trim().substring(0, 100), params });

    // INSERT INTO messages
    if (sql.includes("INSERT INTO messages") && sql.includes("RETURNING")) {
      const [from_id, to_id, content, type] = params as [string, string, string, string];
      messageIdCounter++;
      const id = `msg-${messageIdCounter}`;
      const now = new Date().toISOString();

      const msg = {
        id,
        from_id,
        to_id,
        content,
        type,
        read: false,
        created_at: now,
      };

      mockStorage.messages.push(msg);
      return [msg];
    }

    // SELECT to_id FROM messages WHERE id = $1 (for markAsRead)
    if (sql.includes("SELECT to_id FROM messages WHERE id =")) {
      const [messageId] = params as [string];
      const msg = mockStorage.messages.find((m) => m.id === messageId);
      return msg ? [{ to_id: msg.to_id }] : [];
    }

    // INSERT INTO message_read_status (broadcast read tracking)
    if (sql.includes("INSERT INTO message_read_status")) {
      const [messageId, agentId] = params as [string, string];

      // Check for duplicate
      const exists = mockStorage.readStatus.some(
        (rs) => rs.message_id === messageId && rs.agent_id === agentId
      );

      if (!exists) {
        mockStorage.readStatus.push({ message_id: messageId, agent_id: agentId });
      }

      return [{ message_id: messageId }];
    }

    // UPDATE messages SET read = TRUE (direct message read)
    if (sql.includes("UPDATE messages") && sql.includes("SET read = TRUE")) {
      const [messageId, agentId] = params as [string, string];
      const msg = mockStorage.messages.find(
        (m) => m.id === messageId && m.to_id === agentId
      );

      if (msg) {
        msg.read = true;
        return [{ count: 1 }];
      }

      return [];
    }

    // getAllAgentsOverview query (unnest + LATERAL)
    if (sql.includes("unnest($1::text[])") && sql.includes("LATERAL")) {
      const [agentIds] = params as [string[]];

      return agentIds.map((agentId) => {
        // Count unread messages for this agent
        const unreadCount = mockStorage.messages.filter((m) => {
          if (m.to_id === agentId) {
            return !m.read;
          }
          if (m.to_id === "broadcast") {
            return !mockStorage.readStatus.some(
              (rs) => rs.message_id === m.id && rs.agent_id === agentId
            );
          }
          return false;
        }).length;

        // Find latest message (not from self)
        const agentMessages = mockStorage.messages
          .filter((m) =>
            (m.to_id === agentId || m.to_id === "broadcast") &&
            m.from_id !== agentId
          )
          .sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );

        const latest = agentMessages[0] || null;

        let latest_read: boolean | null = null;
        if (latest) {
          if (latest.to_id === "broadcast") {
            latest_read = mockStorage.readStatus.some(
              (rs) => rs.message_id === latest.id && rs.agent_id === agentId
            );
          } else {
            latest_read = latest.read;
          }
        }

        return {
          agent_id: agentId,
          unread_count: String(unreadCount),
          latest_id: latest?.id ?? null,
          latest_from_id: latest?.from_id ?? null,
          latest_to_id: latest?.to_id ?? null,
          latest_content: latest?.content ?? null,
          latest_type: latest?.type ?? null,
          latest_read,
          latest_created_at: latest?.created_at ?? null,
        };
      });
    }

    // getMessages query
    if (sql.includes("LEFT JOIN message_read_status") && !sql.includes("COUNT(*)")) {
      const [agentId] = params as [string];

      let results = mockStorage.messages.filter(
        (m) => m.to_id === agentId || m.to_id === "broadcast"
      );

      // Check for unreadOnly filter
      if (sql.includes("mrs.message_id IS NULL")) {
        results = results.filter((m) => {
          if (m.to_id === "broadcast") {
            return !mockStorage.readStatus.some(
              (rs) => rs.message_id === m.id && rs.agent_id === agentId
            );
          }
          return !m.read;
        });
      }

      results.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      return results.map((m) => {
        let effectiveRead = m.read;
        if (m.to_id === "broadcast") {
          effectiveRead = mockStorage.readStatus.some(
            (rs) => rs.message_id === m.id && rs.agent_id === agentId
          );
        }

        return { ...m, read: effectiveRead };
      });
    }

    // getUnreadCount query
    if (sql.includes("LEFT JOIN message_read_status") && sql.includes("COUNT(*)")) {
      const [agentId] = params as [string];

      const count = mockStorage.messages.filter((m) => {
        if (m.to_id === agentId) {
          return !m.read;
        }
        if (m.to_id === "broadcast") {
          return !mockStorage.readStatus.some(
            (rs) => rs.message_id === m.id && rs.agent_id === agentId
          );
        }
        return false;
      }).length;

      return [{ count: String(count) }];
    }

    // getConversation query
    if (
      sql.includes("(from_id = $1 AND to_id = $2)") ||
      sql.includes("(from_id = $2 AND to_id = $1)")
    ) {
      const [agent1, agent2] = params as [string, string];
      const hasSince = sql.includes("created_at >");
      const limit = hasSince ? (params[3] as number) : (params[2] as number);
      const since = hasSince ? (params[2] as string) : undefined;

      let results = mockStorage.messages.filter(
        (m) =>
          (m.from_id === agent1 && m.to_id === agent2) ||
          (m.from_id === agent2 && m.to_id === agent1)
      );

      if (since) {
        results = results.filter(
          (m) => new Date(m.created_at).getTime() > new Date(since).getTime()
        );
      }

      // Real implementation: DESC query, then code reverses
      if (hasSince) {
        // since query uses ASC
        results.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      } else {
        // Default query uses DESC
        results.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      }

      return results.slice(0, limit);
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

vi.mock("@/lib/agents", () => ({
  getAgentIds: vi.fn(() => ["pm", "dev", "reviewer"]),
}));

vi.mock("@/lib/attachments", () => ({
  linkAttachmentsFromContent: vi.fn(async () => []),
  getMessageAttachments: vi.fn(async () => []),
  parseFileReferences: vi.fn(() => []),
}));

import {
  sendMessage,
  getMessages,
  markAsRead,
  getUnreadCount,
  getAllAgentsOverview,
  getConversation,
} from "@/lib/messages";

describe("ISSUE 1: Race condition in concurrent sendMessage", () => {
  beforeEach(() => {
    mockStorage.messages = [];
    mockStorage.readStatus = [];
    messageIdCounter = 0;
    queryLog = [];
    vi.clearAllMocks();
  });

  it("should handle concurrent sends with unique timestamps", async () => {
    // Simulate concurrent sends by calling sendMessage without awaiting
    const promises = [
      sendMessage({ from: "pm", to: "dev", content: "msg1", type: "text" }),
      sendMessage({ from: "pm", to: "dev", content: "msg2", type: "text" }),
      sendMessage({ from: "pm", to: "dev", content: "msg3", type: "text" }),
    ];

    const results = await Promise.all(promises);

    // All messages should have been created
    expect(results).toHaveLength(3);

    // Each should have unique ID
    const ids = results.map((r) => r.id);
    expect(new Set(ids).size).toBe(3);

    // Timestamps should be ordered (even if same millisecond, order should be preserved)
    const timestamps = results.map((r) => new Date(r.timestamp).getTime());
    expect(timestamps[0]).toBeLessThanOrEqual(timestamps[1]);
    expect(timestamps[1]).toBeLessThanOrEqual(timestamps[2]);
  });

  it("should preserve insertion order even with identical timestamps", async () => {
    // Force same timestamp by mocking Date
    const fixedTime = new Date("2024-01-01T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixedTime);

    await sendMessage({ from: "pm", to: "dev", content: "first", type: "text" });
    await sendMessage({ from: "pm", to: "dev", content: "second", type: "text" });
    await sendMessage({ from: "pm", to: "dev", content: "third", type: "text" });

    const messages = await getMessages("dev");

    // Should be in insertion order despite identical timestamps
    expect(messages[0].content).toBe("first");
    expect(messages[1].content).toBe("second");
    expect(messages[2].content).toBe("third");

    vi.useRealTimers();
  });
});

describe("ISSUE 2: Timestamp ordering inconsistency in getConversation", () => {
  beforeEach(() => {
    mockStorage.messages = [];
    mockStorage.readStatus = [];
    messageIdCounter = 0;
    queryLog = [];
    vi.clearAllMocks();
  });

  it("should return messages in stable chronological order", async () => {
    await sendMessage({ from: "pm", to: "dev", content: "msg1", type: "text" });
    await sendMessage({ from: "dev", to: "pm", content: "msg2", type: "text" });
    await sendMessage({ from: "pm", to: "dev", content: "msg3", type: "text" });

    const conversation = await getConversation("pm", "dev");

    expect(conversation).toHaveLength(3);
    expect(conversation[0].content).toBe("msg1");
    expect(conversation[1].content).toBe("msg2");
    expect(conversation[2].content).toBe("msg3");
  });

  it("should handle DESC query + reverse correctly for default query", async () => {
    // Create 5 messages
    for (let i = 1; i <= 5; i++) {
      await sendMessage({
        from: i % 2 === 0 ? "pm" : "dev",
        to: i % 2 === 0 ? "dev" : "pm",
        content: `msg${i}`,
        type: "text",
      });
    }

    const conversation = await getConversation("pm", "dev", 3);

    // Should get latest 3 messages in chronological order
    expect(conversation).toHaveLength(3);
    expect(conversation[0].content).toBe("msg3");
    expect(conversation[1].content).toBe("msg4");
    expect(conversation[2].content).toBe("msg5");
  });

  it("should handle since parameter with ASC query correctly", async () => {
    await sendMessage({ from: "pm", to: "dev", content: "old", type: "text" });

    // Get the timestamp after first message
    const firstMsg = mockStorage.messages[0];
    const sinceTime = firstMsg.created_at;

    // Wait a bit to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 10));

    await sendMessage({ from: "pm", to: "dev", content: "new1", type: "text" });
    await sendMessage({ from: "pm", to: "dev", content: "new2", type: "text" });

    const conversation = await getConversation("pm", "dev", 50, sinceTime);

    // Should only get messages after sinceTime, in chronological order
    expect(conversation).toHaveLength(2);
    expect(conversation[0].content).toBe("new1");
    expect(conversation[1].content).toBe("new2");
  });
});

describe("ISSUE 3: Empty/whitespace-only content validation", () => {
  beforeEach(() => {
    mockStorage.messages = [];
    mockStorage.readStatus = [];
    messageIdCounter = 0;
    queryLog = [];
    vi.clearAllMocks();
  });

  it("should reject completely empty content", async () => {
    await expect(
      sendMessage({ from: "pm", to: "dev", content: "", type: "text" })
    ).rejects.toThrow("missing required fields");
  });

  it("should reject whitespace-only content", async () => {
    // Library layer should reject whitespace-only after trim
    await expect(
      sendMessage({ from: "pm", to: "dev", content: "   ", type: "text" })
    ).rejects.toThrow();
  });

  it("should reject newline-only content", async () => {
    await expect(
      sendMessage({ from: "pm", to: "dev", content: "\n\n\n", type: "text" })
    ).rejects.toThrow();
  });

  it("should accept content with leading/trailing whitespace but non-empty core", async () => {
    const result = await sendMessage({
      from: "pm",
      to: "dev",
      content: "  valid message  ",
      type: "text",
    });

    // Content should be accepted (trimming happens at API layer if needed)
    expect(result.content).toBe("  valid message  ");
  });
});

describe("ISSUE 4: Broadcast read status race condition", () => {
  beforeEach(() => {
    mockStorage.messages = [];
    mockStorage.readStatus = [];
    messageIdCounter = 0;
    queryLog = [];
    vi.clearAllMocks();
  });

  it("should handle duplicate markAsRead calls idempotently", async () => {
    await sendMessage({ from: "pm", to: "broadcast", content: "announcement", type: "text" });
    const messageId = mockStorage.messages[0].id;

    // Call markAsRead multiple times
    await markAsRead("dev", messageId);
    await markAsRead("dev", messageId);
    await markAsRead("dev", messageId);

    // Should only have one read status entry
    const entries = mockStorage.readStatus.filter(
      (rs) => rs.message_id === messageId && rs.agent_id === "dev"
    );

    expect(entries).toHaveLength(1);
  });

  it("should handle concurrent markAsRead from different agents", async () => {
    await sendMessage({ from: "pm", to: "broadcast", content: "announcement", type: "text" });
    const messageId = mockStorage.messages[0].id;

    // Concurrent reads from different agents
    await Promise.all([
      markAsRead("pm", messageId),
      markAsRead("dev", messageId),
      markAsRead("reviewer", messageId),
    ]);

    // Each agent should have one entry
    expect(mockStorage.readStatus).toHaveLength(3);

    // Verify each agent has exactly one entry
    ["pm", "dev", "reviewer"].forEach((agentId) => {
      const agentEntries = mockStorage.readStatus.filter(
        (rs) => rs.message_id === messageId && rs.agent_id === agentId
      );
      expect(agentEntries).toHaveLength(1);
    });
  });
});

describe("ISSUE 5: getAllAgentsOverview latest message consistency", () => {
  beforeEach(() => {
    mockStorage.messages = [];
    mockStorage.readStatus = [];
    messageIdCounter = 0;
    queryLog = [];
    vi.clearAllMocks();
  });

  it("should show correct latest message under concurrent writes", async () => {
    // Send messages concurrently
    await Promise.all([
      sendMessage({ from: "pm", to: "dev", content: "msg1", type: "text" }),
      sendMessage({ from: "pm", to: "dev", content: "msg2", type: "text" }),
      sendMessage({ from: "pm", to: "dev", content: "msg3", type: "text" }),
    ]);

    const overview = await getAllAgentsOverview();

    // Latest should be the most recent message (highest timestamp)
    const latestContent = overview.dev.latest?.content;
    expect(latestContent).toBeDefined();

    // Verify it's actually the latest in storage
    const devMessages = mockStorage.messages
      .filter((m) => m.to_id === "dev")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    expect(latestContent).toBe(devMessages[0].content);
  });

  it("should not show agent's own sent messages as latest", async () => {
    // pm sends to dev
    await sendMessage({ from: "pm", to: "dev", content: "task", type: "text" });

    const overview = await getAllAgentsOverview();

    // pm should NOT see this as their latest (they sent it)
    expect(overview.pm.latest).toBeUndefined();

    // dev SHOULD see this as their latest
    expect(overview.dev.latest?.content).toBe("task");
  });

  it("should handle mixed broadcast and direct messages correctly", async () => {
    await sendMessage({ from: "pm", to: "broadcast", content: "broadcast1", type: "text" });
    await sendMessage({ from: "reviewer", to: "dev", content: "direct1", type: "text" });
    await sendMessage({ from: "pm", to: "broadcast", content: "broadcast2", type: "text" });

    const overview = await getAllAgentsOverview();

    // dev should see the direct message as latest (most recent)
    expect(overview.dev.latest?.content).toBe("broadcast2");
  });
});

describe("ISSUE 6: NULL handling in database responses", () => {
  beforeEach(() => {
    mockStorage.messages = [];
    mockStorage.readStatus = [];
    messageIdCounter = 0;
    queryLog = [];
    vi.clearAllMocks();
  });

  it("should handle parseInt of NULL count gracefully", async () => {
    const { queryOne } = await import("@/lib/db");

    // Mock returning NULL count
    (queryOne as Mock).mockResolvedValueOnce({ count: null });

    const count = await getUnreadCount("pm");

    // Should return 0 instead of NaN
    expect(count).toBe(0);
    expect(Number.isNaN(count)).toBe(false);
  });

  it("should handle undefined count gracefully", async () => {
    const { queryOne } = await import("@/lib/db");

    // Mock returning no result
    (queryOne as Mock).mockResolvedValueOnce(null);

    const count = await getUnreadCount("pm");

    // Should return 0 instead of throwing
    expect(count).toBe(0);
  });

  it("should handle getAllAgentsOverview with no messages for agent", async () => {
    const overview = await getAllAgentsOverview();

    // All agents should exist in result even with no messages
    expect(overview.pm).toBeDefined();
    expect(overview.dev).toBeDefined();
    expect(overview.reviewer).toBeDefined();

    // All should have unread: 0 and no latest
    Object.values(overview).forEach((agent) => {
      expect(agent.unread).toBe(0);
      expect(agent.latest).toBeUndefined();
    });
  });

  it("should handle NULL timestamps gracefully", async () => {
    // This is theoretical - timestamps should never be NULL
    // But we should handle it defensively
    const { query } = await import("@/lib/db");

    (query as Mock).mockResolvedValueOnce([
      {
        agent_id: "pm",
        unread_count: "0",
        latest_id: "msg-1",
        latest_from_id: "dev",
        latest_to_id: "pm",
        latest_content: "test",
        latest_type: "text",
        latest_read: false,
        latest_created_at: null, // NULL timestamp
      },
    ]);

    const overview = await getAllAgentsOverview();

    // Should not throw, but latest.timestamp should handle NULL
    expect(overview.pm).toBeDefined();
    // Implementation should handle this gracefully
  });
});

describe("EDGE CASE: Type coercion and validation", () => {
  beforeEach(() => {
    mockStorage.messages = [];
    mockStorage.readStatus = [];
    messageIdCounter = 0;
    queryLog = [];
    vi.clearAllMocks();
  });

  it("should handle very long content strings", async () => {
    const longContent = "a".repeat(100_000); // Exactly at MAX_CONTENT_LENGTH

    const result = await sendMessage({
      from: "pm",
      to: "dev",
      content: longContent,
      type: "text",
    });

    expect(result.content).toBe(longContent);
  });

  it("should reject content exceeding MAX_CONTENT_LENGTH", async () => {
    const tooLongContent = "a".repeat(100_001); // Over MAX_CONTENT_LENGTH

    await expect(
      sendMessage({
        from: "pm",
        to: "dev",
        content: tooLongContent,
        type: "text",
      })
    ).rejects.toThrow("exceeds maximum length");
  });

  it("should handle invalid message type gracefully", async () => {
    await expect(
      sendMessage({
        from: "pm",
        to: "dev",
        content: "test",
        type: "invalid_type" as any,
      })
    ).rejects.toThrow("invalid type");
  });

  it("should handle special characters in content", async () => {
    const specialContent = "Special chars: \n\t\r\0 emoji: 🚀 unicode: \u2665";

    const result = await sendMessage({
      from: "pm",
      to: "dev",
      content: specialContent,
      type: "text",
    });

    expect(result.content).toBe(specialContent);
  });
});
