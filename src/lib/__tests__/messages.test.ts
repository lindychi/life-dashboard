import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// In-memory storage for mock PostgreSQL
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
};

let messageIdCounter = 0;

// Mock the db module
vi.mock("@/lib/db", () => {
  const queryImpl = async (sql: string, params: unknown[] = []) => {
    // INSERT INTO messages
    if (sql.includes("INSERT INTO messages")) {
      const [from_id, to_id, content, type] = params as string[];
      const now = new Date().toISOString();
      messageIdCounter++;
      const msg = {
        id: `msg-${messageIdCounter}`,
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

    // SELECT messages for getMessages (uses LEFT JOIN message_read_status)
    if (
      sql.includes("SELECT") &&
      sql.includes("FROM messages") &&
      sql.includes("LEFT JOIN message_read_status") &&
      !sql.includes("COUNT") &&
      !sql.includes("unnest")
    ) {
      const [agentId] = params as string[];
      let results = mockStorage.messages.filter(
        (m) => m.to_id === agentId || m.to_id === "broadcast"
      );

      // Handle unreadOnly filter (CASE WHEN logic in SQL)
      if (sql.includes("mrs.message_id IS NULL")) {
        // Unread only mode
        results = results.filter((m) => !m.read);
      }

      // Normal ASC ordering (getMessages default)
      results.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      return results;
    }

    // COUNT for getUnreadCount (uses LEFT JOIN message_read_status)
    if (sql.includes("COUNT(*)") && sql.includes("LEFT JOIN message_read_status") && !sql.includes("unnest")) {
      const [agentId] = params as string[];
      const count = mockStorage.messages.filter(
        (m) =>
          (m.to_id === agentId || m.to_id === "broadcast") && m.read === false
      ).length;
      return [{ count: String(count) }];
    }

    // SELECT to_id for markAsRead (check message type)
    if (sql.includes("SELECT to_id FROM messages WHERE id")) {
      const [messageId] = params as string[];
      const msg = mockStorage.messages.find((m) => m.id === messageId);
      return msg ? [{ to_id: msg.to_id }] : [];
    }

    // INSERT INTO message_read_status (markAsRead for broadcast)
    if (sql.includes("INSERT INTO message_read_status")) {
      // Mock success - broadcasts use read status table
      return [{ message_id: params[0] }];
    }

    // UPDATE messages SET read = TRUE (markAsRead for direct messages)
    if (sql.includes("UPDATE messages") && sql.includes("SET read = TRUE")) {
      const [messageId, agentId] = params as string[];
      const msg = mockStorage.messages.find(
        (m) => m.id === messageId && m.to_id === agentId
      );
      if (msg) {
        msg.read = true;
        return [{ count: 1 }];
      }
      return [];
    }

    // getAllAgentsOverview: unnest + LATERAL query
    if (sql.includes("unnest")) {
      const agentIds = params[0] as string[];
      return agentIds.map((agentId) => {
        // Count unread: direct unread + broadcast unread
        const unreadCount = mockStorage.messages.filter(
          (m) =>
            (m.to_id === agentId || m.to_id === "broadcast") && m.read === false
        ).length;

        // Latest message for this agent
        const agentMessages = mockStorage.messages
          .filter((m) => (m.to_id === agentId || m.to_id === "broadcast") && m.from_id !== agentId)
          .sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        const latest = agentMessages[0] || null;

        return {
          agent_id: agentId,
          unread_count: String(unreadCount),
          latest_id: latest?.id ?? null,
          latest_from_id: latest?.from_id ?? null,
          latest_to_id: latest?.to_id ?? null,
          latest_content: latest?.content ?? null,
          latest_type: latest?.type ?? null,
          latest_read: latest?.read ?? null,
          latest_created_at: latest?.created_at ?? null,
        };
      });
    }

    // SELECT for getConversation (between two agents)
    if (
      sql.includes("FROM messages") &&
      sql.includes("from_id = $1 AND to_id = $2") &&
      sql.includes("from_id = $2 AND to_id = $1")
    ) {
      const [agent1, agent2, limit] = params as [string, string, number];
      const results = mockStorage.messages
        .filter(
          (m) =>
            (m.from_id === agent1 && m.to_id === agent2) ||
            (m.from_id === agent2 && m.to_id === agent1)
        )
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        )
        .slice(0, limit);
      return results;
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

// Mock agents module
vi.mock("@/lib/agents", () => ({
  getAgentIds: vi.fn(() => ["pm", "dev", "qa"]),
  getAgents: vi.fn(() => [
    { id: "pm", name: "PM", enabled: true },
    { id: "dev", name: "Developer", enabled: true },
    { id: "qa", name: "QA", enabled: true },
  ]),
}));

// Mock attachments module
vi.mock("@/lib/attachments", () => ({
  linkAttachmentsFromContent: vi.fn(async () => []),
  getMessageAttachments: vi.fn(async () => []),
  parseFileReferences: vi.fn(() => []),
}));

import {
  sendMessage,
  getMessages,
  markAsRead,
  getConversation,
  getUnreadCount,
  getAllAgentsOverview,
} from "@/lib/messages";

describe("messages module", () => {
  beforeEach(() => {
    mockStorage.messages = [];
    messageIdCounter = 0;
    vi.clearAllMocks();
  });

  // =========================================================================
  // sendMessage()
  // =========================================================================
  describe("sendMessage", () => {
    it("should insert a direct message and return correct structure", async () => {
      const result = await sendMessage({
        from: "dev",
        to: "pm",
        content: "Build complete",
        type: "text",
      });

      expect(result).toMatchObject({
        id: expect.any(String),
        from: "dev",
        to: "pm",
        content: "Build complete",
        type: "text",
        read: false,
        timestamp: expect.any(String),
      });
    });

    it("should insert a broadcast message with to='broadcast'", async () => {
      const result = await sendMessage({
        from: "pm",
        to: "broadcast",
        content: "Team standup at 10am",
        type: "text",
      });

      expect(result.to).toBe("broadcast");
      expect(result.from).toBe("pm");
      expect(result.read).toBe(false);
    });

    it("should call linkAttachmentsFromContent after insert", async () => {
      const { linkAttachmentsFromContent } = await import(
        "@/lib/attachments"
      );

      await sendMessage({
        from: "dev",
        to: "pm",
        content: "Here is the file @file:abc123",
        type: "text",
      });

      expect(linkAttachmentsFromContent).toHaveBeenCalledWith(
        "Here is the file @file:abc123",
        expect.any(String)
      );
    });

    it("should throw error when DB insert fails", async () => {
      const { queryOne } = await import("@/lib/db");
      (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await expect(
        sendMessage({
          from: "dev",
          to: "pm",
          content: "test",
          type: "text",
        })
      ).rejects.toThrow("Failed to insert message");
    });

    it("should throw error when broadcast DB insert fails", async () => {
      const { queryOne } = await import("@/lib/db");
      (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await expect(
        sendMessage({
          from: "pm",
          to: "broadcast",
          content: "test",
          type: "text",
        })
      ).rejects.toThrow("Failed to insert broadcast message");
    });

    it("should support all valid message types", async () => {
      const types = ["text", "task", "result", "question", "answer"] as const;

      for (const type of types) {
        const result = await sendMessage({
          from: "dev",
          to: "pm",
          content: `msg type ${type}`,
          type,
        });
        expect(result.type).toBe(type);
      }
    });
  });

  // =========================================================================
  // getMessages()
  // =========================================================================
  describe("getMessages", () => {
    it("should return messages addressed to a specific agent", async () => {
      await sendMessage({ from: "dev", to: "pm", content: "msg1", type: "text" });
      await sendMessage({ from: "qa", to: "pm", content: "msg2", type: "text" });
      await sendMessage({ from: "pm", to: "dev", content: "not for pm", type: "text" });

      const messages = await getMessages("pm");
      expect(messages).toHaveLength(2);
      expect(messages.every((m) => m.to === "pm" || m.to === "broadcast")).toBe(true);
    });

    it("should include broadcast messages", async () => {
      await sendMessage({ from: "pm", to: "broadcast", content: "hello all", type: "text" });
      await sendMessage({ from: "dev", to: "pm", content: "direct", type: "text" });

      const messages = await getMessages("pm");
      // Should include both broadcast and direct messages
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages.some((m) => m.to === "broadcast")).toBe(true);
    });

    it("should filter unread messages when unreadOnly=true", async () => {
      await sendMessage({ from: "dev", to: "pm", content: "msg1", type: "text" });
      await sendMessage({ from: "qa", to: "pm", content: "msg2", type: "text" });

      // Mark the first as read
      await markAsRead("pm", "msg-1");

      const unread = await getMessages("pm", true);
      expect(unread).toHaveLength(1);
      expect(unread[0].content).toBe("msg2");
    });

    it("should return messages in chronological order (ASC)", async () => {
      await sendMessage({ from: "dev", to: "pm", content: "first", type: "text" });
      // Ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));
      await sendMessage({ from: "qa", to: "pm", content: "second", type: "text" });

      const messages = await getMessages("pm");
      expect(messages[0].content).toBe("first");
      expect(messages[1].content).toBe("second");
    });

    it("should return empty array when no messages exist", async () => {
      const messages = await getMessages("nonexistent-agent");
      expect(messages).toEqual([]);
    });

    it("should map DB row fields to Message interface correctly", async () => {
      await sendMessage({ from: "dev", to: "pm", content: "test", type: "task" });

      const messages = await getMessages("pm");
      const msg = messages[0];

      // Verify field mapping: from_id -> from, to_id -> to, created_at -> timestamp
      expect(msg).toHaveProperty("from");
      expect(msg).toHaveProperty("to");
      expect(msg).toHaveProperty("timestamp");
      expect(msg).not.toHaveProperty("from_id");
      expect(msg).not.toHaveProperty("to_id");
      expect(msg).not.toHaveProperty("created_at");
    });
  });

  // =========================================================================
  // markAsRead()
  // =========================================================================
  describe("markAsRead", () => {
    it("should mark a direct message as read and return true", async () => {
      await sendMessage({ from: "dev", to: "pm", content: "test", type: "text" });

      const result = await markAsRead("pm", "msg-1");
      expect(result).toBe(true);

      // Verify it's actually read
      const messages = await getMessages("pm", true); // unreadOnly
      expect(messages).toHaveLength(0);
    });

    it("should mark a broadcast message as read for specific agent", async () => {
      await sendMessage({
        from: "pm",
        to: "broadcast",
        content: "announcement",
        type: "text",
      });

      const result = await markAsRead("dev", "msg-1");
      expect(result).toBe(true);
    });

    it("should return false for non-existent message", async () => {
      const result = await markAsRead("pm", "nonexistent-msg");
      expect(result).toBe(false);
    });

    it("should return false when agent doesn't match message recipient", async () => {
      await sendMessage({ from: "dev", to: "pm", content: "test", type: "text" });

      // Try to mark as read by wrong agent
      const result = await markAsRead("qa", "msg-1");
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // getConversation()
  // =========================================================================
  describe("getConversation", () => {
    it("should return messages between two agents in chronological order", async () => {
      await sendMessage({ from: "dev", to: "pm", content: "hi pm", type: "text" });
      await new Promise((r) => setTimeout(r, 5));
      await sendMessage({ from: "pm", to: "dev", content: "hi dev", type: "text" });
      await new Promise((r) => setTimeout(r, 5));
      await sendMessage({ from: "dev", to: "pm", content: "follow up", type: "text" });

      const conversation = await getConversation("dev", "pm");
      expect(conversation).toHaveLength(3);
      // Chronological order (ASC after reverse)
      expect(conversation[0].content).toBe("hi pm");
      expect(conversation[2].content).toBe("follow up");
    });

    it("should not include messages from/to other agents", async () => {
      await sendMessage({ from: "dev", to: "pm", content: "dev-pm", type: "text" });
      await sendMessage({ from: "qa", to: "pm", content: "qa-pm", type: "text" });

      const conversation = await getConversation("dev", "pm");
      expect(conversation).toHaveLength(1);
      expect(conversation[0].content).toBe("dev-pm");
    });

    it("should respect limit parameter", async () => {
      for (let i = 0; i < 10; i++) {
        await sendMessage({
          from: "dev",
          to: "pm",
          content: `msg-${i}`,
          type: "text",
        });
      }

      const conversation = await getConversation("dev", "pm", 3);
      expect(conversation).toHaveLength(3);
    });

    it("should default limit to 50", async () => {
      // Just verify the function signature accepts no limit
      const conversation = await getConversation("dev", "pm");
      expect(Array.isArray(conversation)).toBe(true);
    });

    it("should batch load attachments for messages with @file: references", async () => {
      await sendMessage({
        from: "dev",
        to: "pm",
        content: "Here is @file:abc123",
        type: "text",
      });

      // getConversation now uses batch loading via direct query
      // instead of calling getMessageAttachments per-message (N+1 optimization)
      const conversation = await getConversation("dev", "pm");
      expect(conversation).toHaveLength(1);
      expect(conversation[0].content).toContain("@file:abc123");
    });
  });

  // =========================================================================
  // getUnreadCount()
  // =========================================================================
  describe("getUnreadCount", () => {
    it("should return 0 when no messages exist", async () => {
      const count = await getUnreadCount("pm");
      expect(count).toBe(0);
    });

    it("should count unread direct messages", async () => {
      await sendMessage({ from: "dev", to: "pm", content: "msg1", type: "text" });
      await sendMessage({ from: "qa", to: "pm", content: "msg2", type: "text" });

      const count = await getUnreadCount("pm");
      expect(count).toBe(2);
    });

    it("should include unread broadcast messages in count", async () => {
      await sendMessage({ from: "pm", to: "broadcast", content: "broadcast", type: "text" });
      await sendMessage({ from: "dev", to: "pm", content: "direct", type: "text" });

      const count = await getUnreadCount("pm");
      expect(count).toBe(2);
    });

    it("should not count read messages", async () => {
      await sendMessage({ from: "dev", to: "pm", content: "msg1", type: "text" });
      await sendMessage({ from: "qa", to: "pm", content: "msg2", type: "text" });

      await markAsRead("pm", "msg-1");

      const count = await getUnreadCount("pm");
      expect(count).toBe(1);
    });

    it("should return 0 when result is null", async () => {
      const { queryOne } = await import("@/lib/db");
      (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const count = await getUnreadCount("pm");
      expect(count).toBe(0);
    });
  });

  // =========================================================================
  // getAllAgentsOverview()
  // =========================================================================
  describe("getAllAgentsOverview", () => {
    it("should return overview for all agents from getAgentIds()", async () => {
      const overview = await getAllAgentsOverview();

      // Should have entries for pm, dev, qa (from mock getAgentIds)
      expect(overview).toHaveProperty("pm");
      expect(overview).toHaveProperty("dev");
      expect(overview).toHaveProperty("qa");
    });

    it("should include unread count for each agent", async () => {
      await sendMessage({ from: "dev", to: "pm", content: "msg1", type: "text" });
      await sendMessage({ from: "qa", to: "pm", content: "msg2", type: "text" });

      const overview = await getAllAgentsOverview();

      expect(overview.pm.unread).toBe(2);
      expect(overview.dev.unread).toBe(0);
      expect(overview.qa.unread).toBe(0);
    });

    it("should include latest message for each agent", async () => {
      await sendMessage({ from: "dev", to: "pm", content: "old msg", type: "text" });
      await new Promise((r) => setTimeout(r, 5));
      await sendMessage({ from: "qa", to: "pm", content: "latest msg", type: "text" });

      const overview = await getAllAgentsOverview();

      expect(overview.pm.latest).toBeDefined();
      expect(overview.pm.latest!.content).toBe("latest msg");
    });

    it("should set latest to undefined when no messages exist for agent", async () => {
      const overview = await getAllAgentsOverview();

      expect(overview.pm.latest).toBeUndefined();
      expect(overview.pm.unread).toBe(0);
    });

    it("should include broadcast messages in each agent's overview", async () => {
      await sendMessage({
        from: "pm",
        to: "broadcast",
        content: "team update",
        type: "text",
      });

      const overview = await getAllAgentsOverview();

      // Broadcast should appear for all agents
      expect(overview.pm.unread).toBe(1);
      expect(overview.dev.unread).toBe(1);
      expect(overview.qa.unread).toBe(1);
    });

    it("should correctly map latest message fields", async () => {
      await sendMessage({ from: "dev", to: "pm", content: "test", type: "task" });

      const overview = await getAllAgentsOverview();
      const latest = overview.pm.latest!;

      expect(latest).toHaveProperty("id");
      expect(latest).toHaveProperty("from");
      expect(latest).toHaveProperty("to");
      expect(latest).toHaveProperty("content");
      expect(latest).toHaveProperty("type");
      expect(latest).toHaveProperty("read");
      expect(latest).toHaveProperty("timestamp");
    });
  });
});
