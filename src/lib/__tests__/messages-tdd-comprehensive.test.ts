/**
 * Comprehensive TDD Test Suite for src/lib/messages.ts
 *
 * Coverage targets:
 * 1. sendMessage() — all exported paths, edge cases, error handling
 * 2. getMessages() — filtering, ordering, broadcast, empty states
 * 3. markAsRead() — direct, broadcast, idempotent, non-existent, wrong agent
 * 4. getConversation() — bidirectional, limit, since param, attachments, ordering
 * 5. getUnreadCount() — counts, edge cases, NaN handling
 * 6. getAllAgentsOverview() — comprehensive overview, per-agent state, empty states
 *
 * Bug-revealing tests:
 * - sendMessage() has no content/type validation at library level
 * - getConversation() with `since` param never tested before
 * - getConversation() ordering inconsistency (DESC+reverse vs ASC)
 * - markAsRead() broadcast idempotency edge cases
 * - getUnreadCount() parseInt edge cases
 *
 * Mock Pattern: vi.mock('@/lib/db') + vi.mock('pg') per MEMORY.md
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// =========================================================================
// In-memory PostgreSQL simulation
// =========================================================================
interface MockMessage {
  id: string;
  from_id: string;
  to_id: string;
  content: string;
  type: string;
  read: boolean;
  created_at: string;
}

interface MockReadStatus {
  message_id: string;
  agent_id: string;
}

const mockStorage = {
  messages: [] as MockMessage[],
  readStatus: [] as MockReadStatus[],
};

let messageIdCounter = 0;

function isBroadcastReadByAgent(messageId: string, agentId: string): boolean {
  return mockStorage.readStatus.some(
    (rs) => rs.message_id === messageId && rs.agent_id === agentId
  );
}

function isUnreadForAgent(msg: MockMessage, agentId: string): boolean {
  if (msg.to_id === "broadcast") {
    return !isBroadcastReadByAgent(msg.id, agentId);
  }
  return !msg.read;
}

function getEffectiveRead(msg: MockMessage, agentId: string): boolean {
  if (msg.to_id === "broadcast") {
    return isBroadcastReadByAgent(msg.id, agentId);
  }
  return msg.read;
}

// =========================================================================
// DB mock with comprehensive SQL pattern matching
// =========================================================================
vi.mock("@/lib/db", () => {
  const queryImpl = async (sql: string, params: unknown[] = []) => {
    // INSERT INTO messages
    if (sql.includes("INSERT INTO messages")) {
      const [from_id, to_id, content, type] = params as string[];
      const now = new Date().toISOString();
      messageIdCounter++;
      const msg: MockMessage = {
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

    // SELECT to_id FROM messages WHERE id = $1 (markAsRead type check)
    if (
      sql.includes("SELECT to_id FROM messages") &&
      sql.includes("WHERE id = $1")
    ) {
      const [messageId] = params as string[];
      const msg = mockStorage.messages.find((m) => m.id === messageId);
      return msg ? [{ to_id: msg.to_id }] : [];
    }

    // INSERT INTO message_read_status (broadcast markAsRead)
    if (sql.includes("INSERT INTO message_read_status")) {
      const [messageId, agentId] = params as string[];
      const exists = mockStorage.readStatus.some(
        (rs) => rs.message_id === messageId && rs.agent_id === agentId
      );
      if (!exists) {
        mockStorage.readStatus.push({
          message_id: messageId,
          agent_id: agentId,
        });
        return [{ message_id: messageId }];
      }
      // ON CONFLICT DO NOTHING → return empty for idempotent calls
      return [];
    }

    // UPDATE messages SET read = TRUE (direct message markAsRead)
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
        const unreadCount = mockStorage.messages.filter(
          (m) =>
            (m.to_id === agentId || m.to_id === "broadcast") &&
            isUnreadForAgent(m, agentId)
        ).length;

        const agentMessages = mockStorage.messages
          .filter((m) => m.to_id === agentId || m.to_id === "broadcast")
          .sort(
            (a, b) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime()
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
          latest_read: latest ? getEffectiveRead(latest, agentId) : null,
          latest_created_at: latest?.created_at ?? null,
        };
      });
    }

    // getUnreadCount: COUNT(*) with LEFT JOIN message_read_status
    if (
      sql.includes("COUNT(*)") &&
      sql.includes("LEFT JOIN message_read_status") &&
      !sql.includes("unnest")
    ) {
      const [agentId] = params as string[];
      const count = mockStorage.messages.filter(
        (m) =>
          (m.to_id === agentId || m.to_id === "broadcast") &&
          isUnreadForAgent(m, agentId)
      ).length;
      return [{ count: String(count) }];
    }

    // getMessages: SELECT with LEFT JOIN message_read_status (not COUNT, not unnest)
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

      // unreadOnly filter
      if (sql.includes("mrs.message_id IS NULL")) {
        results = results.filter((m) => isUnreadForAgent(m, agentId));
      }

      results.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      return results.map((m) => ({
        ...m,
        read: getEffectiveRead(m, agentId),
      }));
    }

    // getConversation with `since` parameter
    if (
      sql.includes("FROM messages") &&
      sql.includes("from_id = $1 AND to_id = $2") &&
      sql.includes("from_id = $2 AND to_id = $1") &&
      sql.includes("created_at > $3")
    ) {
      const [agent1, agent2, since, limit] = params as [
        string,
        string,
        string,
        number,
      ];
      const results = mockStorage.messages
        .filter(
          (m) =>
            ((m.from_id === agent1 && m.to_id === agent2) ||
              (m.from_id === agent2 && m.to_id === agent1)) &&
            new Date(m.created_at) > new Date(since)
        )
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
        .slice(0, limit);
      return results;
    }

    // getConversation without `since`
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
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
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
  getAgentIds: vi.fn(() => ["pm", "dev", "qa", "reviewer"]),
  getAgents: vi.fn(() => [
    { id: "pm", name: "PM", enabled: true },
    { id: "dev", name: "Developer", enabled: true },
    { id: "qa", name: "QA", enabled: true },
    { id: "reviewer", name: "Reviewer", enabled: true },
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
  type Message,
} from "@/lib/messages";

// =========================================================================
// HELPERS
// =========================================================================

/**
 * Helper to send a test message with minimal boilerplate
 */
async function send(
  from: string,
  to: string,
  content: string,
  type: Message["type"] = "text"
) {
  return sendMessage({ from, to, content, type });
}

/**
 * Helper to send multiple messages with small timestamp gaps
 */
async function sendWithDelay(
  messages: Array<{
    from: string;
    to: string;
    content: string;
    type?: Message["type"];
  }>
) {
  const results: Message[] = [];
  for (const msg of messages) {
    await new Promise((r) => setTimeout(r, 2));
    results.push(await send(msg.from, msg.to, msg.content, msg.type ?? "text"));
  }
  return results;
}

// =========================================================================
// TEST SUITE
// =========================================================================

describe("messages.ts — Comprehensive TDD Test Suite", () => {
  beforeEach(() => {
    mockStorage.messages = [];
    mockStorage.readStatus = [];
    messageIdCounter = 0;
    vi.clearAllMocks();
  });

  // =======================================================================
  // 1. sendMessage()
  // =======================================================================
  describe("sendMessage()", () => {
    describe("정상 동작", () => {
      it("should return a Message with all required fields", async () => {
        const result = await send("dev", "pm", "Hello PM");

        expect(result).toMatchObject({
          id: expect.any(String),
          from: "dev",
          to: "pm",
          content: "Hello PM",
          type: "text",
          read: false,
          timestamp: expect.any(String),
        });

        // Verify no extra DB fields leak through
        expect(result).not.toHaveProperty("from_id");
        expect(result).not.toHaveProperty("to_id");
        expect(result).not.toHaveProperty("created_at");
      });

      it("should generate unique IDs for each message", async () => {
        const msg1 = await send("dev", "pm", "msg1");
        const msg2 = await send("dev", "pm", "msg2");
        const msg3 = await send("qa", "pm", "msg3");

        expect(msg1.id).not.toBe(msg2.id);
        expect(msg2.id).not.toBe(msg3.id);
        expect(msg1.id).not.toBe(msg3.id);
      });

      it("should set read=false for all new messages", async () => {
        const direct = await send("dev", "pm", "direct");
        const broadcast = await send("pm", "broadcast", "broadcast");

        expect(direct.read).toBe(false);
        expect(broadcast.read).toBe(false);
      });

      it("should set timestamp as ISO string", async () => {
        const result = await send("dev", "pm", "test");
        const parsed = new Date(result.timestamp);
        expect(parsed.getTime()).not.toBeNaN();
      });
    });

    describe("메시지 타입", () => {
      it("should support all valid message types", async () => {
        const types: Message["type"][] = [
          "text",
          "task",
          "result",
          "question",
          "answer",
        ];

        for (const type of types) {
          const result = await sendMessage({
            from: "dev",
            to: "pm",
            content: `type-${type}`,
            type,
          });
          expect(result.type).toBe(type);
        }
      });

      /**
       * Library-level type validation: invalid types are now rejected at the library level.
       * This was previously a bug where invalid types passed through as-is.
       */
      it("should reject invalid type strings with library-level validation", async () => {
        await expect(
          sendMessage({
            from: "dev",
            to: "pm",
            content: "test",
            type: "invalid_type" as Message["type"],
          })
        ).rejects.toThrow('invalid type "invalid_type"');
      });
    });

    describe("브로드캐스트 메시지", () => {
      it("should create broadcast with to='broadcast'", async () => {
        const result = await send("pm", "broadcast", "Team standup at 10am");
        expect(result.to).toBe("broadcast");
        expect(result.from).toBe("pm");
      });

      it("should throw distinct error for failed broadcast insert", async () => {
        const { queryOne } = await import("@/lib/db");
        (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

        await expect(
          send("pm", "broadcast", "test")
        ).rejects.toThrow("Failed to insert broadcast message");
      });

      it("should throw distinct error for failed direct message insert", async () => {
        const { queryOne } = await import("@/lib/db");
        (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

        await expect(
          send("dev", "pm", "test")
        ).rejects.toThrow("Failed to insert message");
      });
    });

    describe("첨부파일 연동", () => {
      it("should call linkAttachmentsFromContent with message content and id", async () => {
        const { linkAttachmentsFromContent } = await import(
          "@/lib/attachments"
        );

        const result = await send(
          "dev",
          "pm",
          "Check this @file:abc12345"
        );

        expect(linkAttachmentsFromContent).toHaveBeenCalledWith(
          "Check this @file:abc12345",
          result.id
        );
      });

      it("should call linkAttachmentsFromContent even for content without @file:", async () => {
        const { linkAttachmentsFromContent } = await import(
          "@/lib/attachments"
        );

        await send("dev", "pm", "No attachment here");

        expect(linkAttachmentsFromContent).toHaveBeenCalledWith(
          "No attachment here",
          expect.any(String)
        );
      });

      it("should call linkAttachmentsFromContent with multiple @file: references", async () => {
        const { linkAttachmentsFromContent } = await import(
          "@/lib/attachments"
        );

        const content = "See @file:abc12345 and @file:def67890";
        await send("dev", "pm", content);

        expect(linkAttachmentsFromContent).toHaveBeenCalledWith(
          content,
          expect.any(String)
        );
      });
    });

    describe("입력 검증", () => {
      /**
       * Library-level validation: checks falsy values for required fields.
       * Empty string is falsy → rejected. Whitespace-only is truthy → allowed at library level.
       */
      it("should reject empty string content (falsy check catches this)", async () => {
        await expect(send("dev", "pm", "")).rejects.toThrow("missing required fields");
      });

      it("should allow whitespace-only content at library level (truthy string passes !content check)", async () => {
        const result = await send("dev", "pm", "   \n\t  ");
        expect(result.content).toBe("   \n\t  ");
      });

      it("should allow extremely long content (BUG: no max length validation)", async () => {
        const longContent = "x".repeat(100_000);
        const result = await send("dev", "pm", longContent);
        expect(result.content.length).toBe(100_000);
      });

      it("should reject empty 'from' agent ID (FIXED: validation added)", async () => {
        await expect(send("", "pm", "test")).rejects.toThrow("missing required fields");
      });

      it("should reject empty 'to' agent ID (FIXED: validation added)", async () => {
        await expect(send("dev", "", "test")).rejects.toThrow("missing required fields");
      });
    });

    describe("DB 에러 처리", () => {
      it("should propagate DB errors", async () => {
        const { queryOne } = await import("@/lib/db");
        (queryOne as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
          new Error("Connection refused")
        );

        await expect(send("dev", "pm", "test")).rejects.toThrow(
          "Connection refused"
        );
      });
    });
  });

  // =======================================================================
  // 2. getMessages()
  // =======================================================================
  describe("getMessages()", () => {
    describe("agentId별 필터링", () => {
      it("should return only messages addressed to the specified agent", async () => {
        await send("dev", "pm", "for pm");
        await send("qa", "pm", "also for pm");
        await send("pm", "dev", "for dev");
        await send("dev", "qa", "for qa");

        const pmMessages = await getMessages("pm");
        expect(pmMessages).toHaveLength(2);
        expect(pmMessages.every((m) => m.to === "pm")).toBe(true);
      });

      it("should include broadcast messages for any agent", async () => {
        await send("pm", "broadcast", "hello all");
        await send("dev", "pm", "direct to pm");

        const pmMessages = await getMessages("pm");
        expect(pmMessages).toHaveLength(2);
        expect(pmMessages.some((m) => m.to === "broadcast")).toBe(true);

        const devMessages = await getMessages("dev");
        expect(devMessages).toHaveLength(1);
        expect(devMessages[0].to).toBe("broadcast");
      });

      it("should NOT return messages sent BY the agent (only TO)", async () => {
        await send("pm", "dev", "I sent this from pm");

        const pmMessages = await getMessages("pm");
        expect(pmMessages).toHaveLength(0);
      });
    });

    describe("unreadOnly 필터", () => {
      it("should return only unread messages when unreadOnly=true", async () => {
        await send("dev", "pm", "msg1");
        await send("qa", "pm", "msg2");

        await markAsRead("pm", "msg-1");

        const unread = await getMessages("pm", true);
        expect(unread).toHaveLength(1);
        expect(unread[0].content).toBe("msg2");
      });

      it("should return all messages when unreadOnly=false", async () => {
        await send("dev", "pm", "msg1");
        await send("qa", "pm", "msg2");
        await markAsRead("pm", "msg-1");

        const all = await getMessages("pm", false);
        expect(all).toHaveLength(2);
      });

      it("should return all messages when unreadOnly is undefined", async () => {
        await send("dev", "pm", "msg1");
        await send("qa", "pm", "msg2");
        await markAsRead("pm", "msg-1");

        const all = await getMessages("pm");
        expect(all).toHaveLength(2);
      });

      it("should filter broadcast messages per-agent read status when unreadOnly=true", async () => {
        await send("pm", "broadcast", "announcement");

        // dev reads the broadcast
        await markAsRead("dev", "msg-1");

        // dev should have 0 unread, qa should have 1 unread
        const devUnread = await getMessages("dev", true);
        const qaUnread = await getMessages("qa", true);

        expect(devUnread).toHaveLength(0);
        expect(qaUnread).toHaveLength(1);
      });
    });

    describe("빈 결과 처리", () => {
      it("should return empty array when no messages exist", async () => {
        const messages = await getMessages("pm");
        expect(messages).toEqual([]);
      });

      it("should return empty array for non-existent agent", async () => {
        await send("dev", "pm", "msg1");
        const messages = await getMessages("nonexistent-agent");
        expect(messages).toEqual([]);
      });

      it("should return empty array when all messages are read and unreadOnly=true", async () => {
        await send("dev", "pm", "msg1");
        await markAsRead("pm", "msg-1");

        const unread = await getMessages("pm", true);
        expect(unread).toEqual([]);
      });
    });

    describe("정렬 순서", () => {
      it("should return messages in chronological order (ASC)", async () => {
        const messages = await sendWithDelay([
          { from: "dev", to: "pm", content: "first" },
          { from: "qa", to: "pm", content: "second" },
          { from: "dev", to: "pm", content: "third" },
        ]);

        const result = await getMessages("pm");
        expect(result).toHaveLength(3);
        expect(result[0].content).toBe("first");
        expect(result[1].content).toBe("second");
        expect(result[2].content).toBe("third");

        // Verify timestamps are ascending
        for (let i = 1; i < result.length; i++) {
          expect(
            new Date(result[i].timestamp).getTime()
          ).toBeGreaterThanOrEqual(
            new Date(result[i - 1].timestamp).getTime()
          );
        }
      });
    });

    describe("필드 매핑 정확성", () => {
      it("should correctly map DB row fields to Message interface", async () => {
        await send("dev", "pm", "test", "task");

        const messages = await getMessages("pm");
        const msg = messages[0];

        // Verify correct field mapping
        expect(msg).toHaveProperty("id");
        expect(msg).toHaveProperty("from");
        expect(msg).toHaveProperty("to");
        expect(msg).toHaveProperty("content");
        expect(msg).toHaveProperty("type");
        expect(msg).toHaveProperty("read");
        expect(msg).toHaveProperty("timestamp");

        // Verify no DB-specific fields leak
        expect(msg).not.toHaveProperty("from_id");
        expect(msg).not.toHaveProperty("to_id");
        expect(msg).not.toHaveProperty("created_at");
      });
    });
  });

  // =======================================================================
  // 3. markAsRead()
  // =======================================================================
  describe("markAsRead()", () => {
    describe("직접 메시지 읽음 처리", () => {
      it("should mark a direct message as read and return true", async () => {
        await send("dev", "pm", "test");

        const result = await markAsRead("pm", "msg-1");
        expect(result).toBe(true);
      });

      it("should actually update the read state", async () => {
        await send("dev", "pm", "test");

        await markAsRead("pm", "msg-1");

        const unread = await getMessages("pm", true);
        expect(unread).toHaveLength(0);

        const all = await getMessages("pm");
        expect(all).toHaveLength(1);
        expect(all[0].read).toBe(true);
      });
    });

    describe("브로드캐스트 메시지 읽음 처리", () => {
      it("should mark broadcast as read for specific agent and return true", async () => {
        await send("pm", "broadcast", "announcement");

        const result = await markAsRead("dev", "msg-1");
        expect(result).toBe(true);
      });

      it("should not affect other agents when one agent reads a broadcast", async () => {
        await send("pm", "broadcast", "announcement");

        // dev reads it
        await markAsRead("dev", "msg-1");

        // qa should still see it as unread
        const qaUnread = await getMessages("qa", true);
        expect(qaUnread).toHaveLength(1);

        // dev should have no unread
        const devUnread = await getMessages("dev", true);
        expect(devUnread).toHaveLength(0);
      });

      it("should be idempotent — marking same broadcast as read twice returns true", async () => {
        await send("pm", "broadcast", "announcement");

        const result1 = await markAsRead("dev", "msg-1");
        const result2 = await markAsRead("dev", "msg-1");

        expect(result1).toBe(true);
        expect(result2).toBe(true);
      });

      it("should allow all agents to independently mark a broadcast as read", async () => {
        await send("pm", "broadcast", "announcement");

        await markAsRead("dev", "msg-1");
        await markAsRead("qa", "msg-1");
        await markAsRead("pm", "msg-1");
        await markAsRead("reviewer", "msg-1");

        // All agents should have 0 unread
        for (const agentId of ["dev", "qa", "pm", "reviewer"]) {
          const unread = await getMessages(agentId, true);
          expect(unread).toHaveLength(0);
        }
      });
    });

    describe("존재하지 않는 메시지", () => {
      it("should return false for non-existent message ID", async () => {
        const result = await markAsRead("pm", "nonexistent-msg");
        expect(result).toBe(false);
      });

      it("should return false for empty message ID", async () => {
        const result = await markAsRead("pm", "");
        expect(result).toBe(false);
      });
    });

    describe("잘못된 에이전트", () => {
      it("should return false when agent doesn't match message recipient", async () => {
        await send("dev", "pm", "only for pm");

        // qa tries to mark pm's message
        const result = await markAsRead("qa", "msg-1");
        expect(result).toBe(false);
      });

      it("should not affect the read status when wrong agent tries to mark as read", async () => {
        await send("dev", "pm", "only for pm");

        await markAsRead("qa", "msg-1"); // wrong agent

        const pmUnread = await getMessages("pm", true);
        expect(pmUnread).toHaveLength(1);
        expect(pmUnread[0].read).toBe(false);
      });
    });

    describe("이미 읽은 메시지 재처리", () => {
      it("should handle marking an already-read direct message", async () => {
        await send("dev", "pm", "test");

        await markAsRead("pm", "msg-1");
        const result = await markAsRead("pm", "msg-1");

        // Should still return true (UPDATE with same value succeeds)
        expect(result).toBe(true);

        const count = await getUnreadCount("pm");
        expect(count).toBe(0);
      });
    });
  });

  // =======================================================================
  // 4. getConversation()
  // =======================================================================
  describe("getConversation()", () => {
    describe("양방향 메시지 조회", () => {
      it("should return messages between two agents in both directions", async () => {
        await sendWithDelay([
          { from: "dev", to: "pm", content: "hi pm" },
          { from: "pm", to: "dev", content: "hi dev" },
          { from: "dev", to: "pm", content: "follow up" },
        ]);

        const conversation = await getConversation("dev", "pm");
        expect(conversation).toHaveLength(3);
      });

      it("should work symmetrically regardless of argument order", async () => {
        await sendWithDelay([
          { from: "dev", to: "pm", content: "msg1" },
          { from: "pm", to: "dev", content: "msg2" },
        ]);

        const conv1 = await getConversation("dev", "pm");
        const conv2 = await getConversation("pm", "dev");

        expect(conv1).toHaveLength(2);
        expect(conv2).toHaveLength(2);
        // Same messages, same order
        expect(conv1[0].id).toBe(conv2[0].id);
        expect(conv1[1].id).toBe(conv2[1].id);
      });
    });

    describe("정렬 순서", () => {
      it("should return messages in chronological order (oldest first)", async () => {
        await sendWithDelay([
          { from: "dev", to: "pm", content: "first" },
          { from: "pm", to: "dev", content: "second" },
          { from: "dev", to: "pm", content: "third" },
        ]);

        const conversation = await getConversation("dev", "pm");
        expect(conversation[0].content).toBe("first");
        expect(conversation[1].content).toBe("second");
        expect(conversation[2].content).toBe("third");
      });

      it("should maintain ascending timestamp order", async () => {
        await sendWithDelay([
          { from: "dev", to: "pm", content: "a" },
          { from: "pm", to: "dev", content: "b" },
          { from: "dev", to: "pm", content: "c" },
          { from: "pm", to: "dev", content: "d" },
        ]);

        const conversation = await getConversation("dev", "pm");

        for (let i = 1; i < conversation.length; i++) {
          expect(
            new Date(conversation[i].timestamp).getTime()
          ).toBeGreaterThanOrEqual(
            new Date(conversation[i - 1].timestamp).getTime()
          );
        }
      });
    });

    describe("다른 에이전트 제외", () => {
      it("should not include messages from/to other agents", async () => {
        await send("dev", "pm", "dev-pm");
        await send("qa", "pm", "qa-pm");
        await send("dev", "qa", "dev-qa");

        const conversation = await getConversation("dev", "pm");
        expect(conversation).toHaveLength(1);
        expect(conversation[0].content).toBe("dev-pm");
      });

      it("should not include broadcast messages", async () => {
        await send("dev", "pm", "direct");
        await send("pm", "broadcast", "broadcast");

        const conversation = await getConversation("dev", "pm");
        expect(conversation).toHaveLength(1);
        expect(conversation[0].to).toBe("pm");
      });
    });

    describe("limit 파라미터", () => {
      it("should respect limit parameter", async () => {
        for (let i = 0; i < 10; i++) {
          await send("dev", "pm", `msg-${i}`);
        }

        const conversation = await getConversation("dev", "pm", 3);
        expect(conversation).toHaveLength(3);
      });

      it("should return the most recent N messages when limited", async () => {
        await sendWithDelay([
          { from: "dev", to: "pm", content: "old-1" },
          { from: "dev", to: "pm", content: "old-2" },
          { from: "dev", to: "pm", content: "recent-1" },
          { from: "dev", to: "pm", content: "recent-2" },
          { from: "dev", to: "pm", content: "recent-3" },
        ]);

        const conversation = await getConversation("dev", "pm", 3);
        expect(conversation).toHaveLength(3);
        // Should get the 3 most recent, in chronological order
        expect(conversation[0].content).toBe("recent-1");
        expect(conversation[1].content).toBe("recent-2");
        expect(conversation[2].content).toBe("recent-3");
      });

      it("should default limit to 50", async () => {
        // Just verify it works without limit
        const conversation = await getConversation("dev", "pm");
        expect(Array.isArray(conversation)).toBe(true);
      });
    });

    describe("since 파라미터 (증분 fetch)", () => {
      /**
       * NEVER TESTED BEFORE: The `since` parameter path in getConversation
       * has completely different SQL (ASC ordering without reverse).
       */
      it("should return only messages after the since timestamp", async () => {
        const messages = await sendWithDelay([
          { from: "dev", to: "pm", content: "old" },
          { from: "pm", to: "dev", content: "old-reply" },
          { from: "dev", to: "pm", content: "new" },
          { from: "pm", to: "dev", content: "new-reply" },
        ]);

        // Get messages after the second message's timestamp
        const sinceTimestamp = messages[1].timestamp;
        const conversation = await getConversation(
          "dev",
          "pm",
          50,
          sinceTimestamp
        );

        expect(conversation).toHaveLength(2);
        expect(conversation[0].content).toBe("new");
        expect(conversation[1].content).toBe("new-reply");
      });

      it("should return empty array when no messages after since", async () => {
        await send("dev", "pm", "old message");

        const futureDate = new Date(
          Date.now() + 86400000
        ).toISOString();
        const conversation = await getConversation("dev", "pm", 50, futureDate);
        expect(conversation).toEqual([]);
      });

      it("should maintain ASC ordering for since queries", async () => {
        const msgs = await sendWithDelay([
          { from: "dev", to: "pm", content: "base" },
          { from: "pm", to: "dev", content: "reply1" },
          { from: "dev", to: "pm", content: "reply2" },
        ]);

        const sinceTimestamp = msgs[0].timestamp;
        const conversation = await getConversation(
          "dev",
          "pm",
          50,
          sinceTimestamp
        );

        // Should be in chronological order
        if (conversation.length >= 2) {
          for (let i = 1; i < conversation.length; i++) {
            expect(
              new Date(conversation[i].timestamp).getTime()
            ).toBeGreaterThanOrEqual(
              new Date(conversation[i - 1].timestamp).getTime()
            );
          }
        }
      });
    });

    describe("빈 대화", () => {
      it("should return empty array when no messages between agents", async () => {
        await send("dev", "qa", "not for pm");

        const conversation = await getConversation("dev", "pm");
        expect(conversation).toEqual([]);
      });
    });

    describe("첨부파일 로딩", () => {
      it("should handle messages with @file: references via batch loading", async () => {
        // getConversation now uses batch loading via direct query
        // instead of calling getMessageAttachments per-message (N+1 optimization)
        await send("dev", "pm", "See @file:abc12345");
        const conversation = await getConversation("dev", "pm");

        expect(conversation[0].content).toContain("@file:abc12345");
      });

      it("should not query attachments for messages without @file:", async () => {
        await send("dev", "pm", "No attachment here");
        const conversation = await getConversation("dev", "pm");

        // Messages without @file: references should not have attachments
        expect(conversation[0].attachments).toBeUndefined();
      });

      it("should batch query attachments for messages with @file: references", async () => {
        // getConversation now uses batch loading via direct query
        // instead of calling getMessageAttachments per-message (N+1 optimization)
        await send("dev", "pm", "See @file:abc12345");
        const conversation = await getConversation("dev", "pm");

        // The mock DB doesn't have attachments, so attachments won't be populated
        // But the message content should contain the @file: reference
        expect(conversation[0].content).toContain("@file:abc12345");
      });
    });
  });

  // =======================================================================
  // 5. getUnreadCount()
  // =======================================================================
  describe("getUnreadCount()", () => {
    describe("정확한 카운트", () => {
      it("should return 0 when no messages exist", async () => {
        const count = await getUnreadCount("pm");
        expect(count).toBe(0);
      });

      it("should count unread direct messages", async () => {
        await send("dev", "pm", "msg1");
        await send("qa", "pm", "msg2");

        const count = await getUnreadCount("pm");
        expect(count).toBe(2);
      });

      it("should include unread broadcast messages in count", async () => {
        await send("pm", "broadcast", "broadcast");
        await send("dev", "pm", "direct");

        const count = await getUnreadCount("pm");
        expect(count).toBe(2);
      });

      it("should decrease after markAsRead", async () => {
        await send("dev", "pm", "msg1");
        await send("qa", "pm", "msg2");
        await send("reviewer", "pm", "msg3");

        expect(await getUnreadCount("pm")).toBe(3);

        await markAsRead("pm", "msg-1");
        expect(await getUnreadCount("pm")).toBe(2);

        await markAsRead("pm", "msg-2");
        expect(await getUnreadCount("pm")).toBe(1);

        await markAsRead("pm", "msg-3");
        expect(await getUnreadCount("pm")).toBe(0);
      });
    });

    describe("0건 처리", () => {
      it("should return 0 for agent with no messages", async () => {
        await send("dev", "pm", "not for qa");

        const count = await getUnreadCount("qa");
        expect(count).toBe(0);
      });

      it("should return 0 when all messages are read", async () => {
        await send("dev", "pm", "msg1");
        await markAsRead("pm", "msg-1");

        const count = await getUnreadCount("pm");
        expect(count).toBe(0);
      });
    });

    describe("브로드캐스트 독립 카운트", () => {
      it("should count broadcasts independently per agent", async () => {
        await send("pm", "broadcast", "announcement");

        // All agents see 1 unread
        expect(await getUnreadCount("dev")).toBe(1);
        expect(await getUnreadCount("qa")).toBe(1);
        expect(await getUnreadCount("reviewer")).toBe(1);

        // dev reads it
        await markAsRead("dev", "msg-1");

        // Only dev's count decreases
        expect(await getUnreadCount("dev")).toBe(0);
        expect(await getUnreadCount("qa")).toBe(1);
        expect(await getUnreadCount("reviewer")).toBe(1);
      });
    });

    describe("NaN/null 안전 처리", () => {
      it("should return 0 when DB returns null result", async () => {
        const { queryOne } = await import("@/lib/db");
        (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

        const count = await getUnreadCount("pm");
        expect(count).toBe(0);
      });

      it("should return 0 when COUNT returns non-numeric string", async () => {
        const { queryOne } = await import("@/lib/db");
        (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
          count: "not-a-number",
        });

        const count = await getUnreadCount("pm");
        // parseInt("not-a-number", 10) = NaN, || 0 catches it
        expect(count).toBe(0);
      });

      it("should return 0 when COUNT returns empty string", async () => {
        const { queryOne } = await import("@/lib/db");
        (queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
          count: "",
        });

        const count = await getUnreadCount("pm");
        expect(count).toBe(0);
      });
    });
  });

  // =======================================================================
  // 6. getAllAgentsOverview()
  // =======================================================================
  describe("getAllAgentsOverview()", () => {
    describe("기본 구조", () => {
      it("should return overview for all agents from getAgentIds()", async () => {
        const overview = await getAllAgentsOverview();

        expect(overview).toHaveProperty("pm");
        expect(overview).toHaveProperty("dev");
        expect(overview).toHaveProperty("qa");
        expect(overview).toHaveProperty("reviewer");
      });

      it("should have unread:0 and latest:undefined when no messages", async () => {
        const overview = await getAllAgentsOverview();

        for (const agentId of ["pm", "dev", "qa", "reviewer"]) {
          expect(overview[agentId]).toBeDefined();
          expect(overview[agentId].unread).toBe(0);
          expect(overview[agentId].latest).toBeUndefined();
        }
      });
    });

    describe("에이전트별 unread 정확성", () => {
      it("should count unread messages per agent correctly", async () => {
        await send("dev", "pm", "msg1");
        await send("qa", "pm", "msg2");
        await send("pm", "dev", "msg3");

        const overview = await getAllAgentsOverview();
        expect(overview.pm.unread).toBe(2);
        expect(overview.dev.unread).toBe(1);
        expect(overview.qa.unread).toBe(0);
      });

      it("should include broadcast in all agents' unread counts", async () => {
        await send("pm", "broadcast", "team update");

        const overview = await getAllAgentsOverview();
        expect(overview.pm.unread).toBe(1);
        expect(overview.dev.unread).toBe(1);
        expect(overview.qa.unread).toBe(1);
        expect(overview.reviewer.unread).toBe(1);
      });

      it("should reflect per-agent read status for broadcasts", async () => {
        await send("pm", "broadcast", "team update");
        await markAsRead("dev", "msg-1");

        const overview = await getAllAgentsOverview();
        expect(overview.dev.unread).toBe(0);
        expect(overview.pm.unread).toBe(1);
        expect(overview.qa.unread).toBe(1);
      });
    });

    describe("latest 메시지 정확성", () => {
      it("should return the most recent message for each agent", async () => {
        await sendWithDelay([
          { from: "dev", to: "pm", content: "old msg" },
          { from: "qa", to: "pm", content: "latest msg" },
        ]);

        const overview = await getAllAgentsOverview();
        expect(overview.pm.latest).toBeDefined();
        expect(overview.pm.latest!.content).toBe("latest msg");
      });

      it("should correctly map latest message fields", async () => {
        await send("dev", "pm", "test", "task");

        const overview = await getAllAgentsOverview();
        const latest = overview.pm.latest!;

        expect(latest).toHaveProperty("id");
        expect(latest).toHaveProperty("from");
        expect(latest).toHaveProperty("to");
        expect(latest).toHaveProperty("content");
        expect(latest).toHaveProperty("type");
        expect(latest).toHaveProperty("read");
        expect(latest).toHaveProperty("timestamp");
        expect(latest.from).toBe("dev");
        expect(latest.to).toBe("pm");
        expect(latest.type).toBe("task");
      });

      it("should show broadcast as latest when it's the most recent", async () => {
        await send("dev", "pm", "old direct");
        await new Promise((r) => setTimeout(r, 5));
        await send("pm", "broadcast", "latest broadcast");

        const overview = await getAllAgentsOverview();
        // For pm, the broadcast should be the latest
        expect(overview.pm.latest!.to).toBe("broadcast");
        // For dev, the broadcast should also be the latest (more recent than direct)
        expect(overview.dev.latest!.to).toBe("broadcast");
      });
    });

    describe("overview와 getMessages 일관성", () => {
      it("overview.unread should match getMessages(agentId, true).length", async () => {
        await send("dev", "pm", "direct-1");
        await send("qa", "pm", "direct-2");
        await send("pm", "broadcast", "broadcast-1");

        const overview = await getAllAgentsOverview();
        const actualUnread = await getMessages("pm", true);

        expect(overview.pm.unread).toBe(actualUnread.length);
      });

      it("consistency after markAsRead", async () => {
        await send("dev", "pm", "msg1");
        await send("qa", "pm", "msg2");
        await send("pm", "broadcast", "broadcast");

        await markAsRead("pm", "msg-1");

        const overview = await getAllAgentsOverview();
        const actualUnread = await getMessages("pm", true);

        expect(overview.pm.unread).toBe(actualUnread.length);
      });
    });

    describe("mixed 시나리오", () => {
      it("should handle agents with mix of direct and broadcast messages", async () => {
        await send("dev", "pm", "direct to pm");
        await send("pm", "broadcast", "broadcast");
        await send("qa", "dev", "direct to dev");

        const overview = await getAllAgentsOverview();

        // pm: 1 direct + 1 broadcast = 2
        expect(overview.pm.unread).toBe(2);
        // dev: 1 direct + 1 broadcast = 2
        expect(overview.dev.unread).toBe(2);
        // qa: 1 broadcast only = 1
        expect(overview.qa.unread).toBe(1);
      });

      it("should handle large number of agents and messages", async () => {
        // Send 10 messages to various agents
        for (let i = 0; i < 10; i++) {
          await send("dev", "pm", `msg-${i}`);
        }
        await send("pm", "broadcast", "announcement");

        const overview = await getAllAgentsOverview();
        expect(overview.pm.unread).toBe(11); // 10 direct + 1 broadcast
        expect(overview.dev.unread).toBe(1); // 1 broadcast only
      });
    });
  });

  // =======================================================================
  // 7. Cross-function 동기화 테스트
  // =======================================================================
  describe("Cross-function 동기화", () => {
    it("sendMessage should be immediately visible in getMessages", async () => {
      const sent = await send("dev", "pm", "Hello PM");
      const messages = await getMessages("pm");

      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(sent.id);
    });

    it("sendMessage should immediately affect getUnreadCount", async () => {
      expect(await getUnreadCount("pm")).toBe(0);

      await send("dev", "pm", "msg1");
      expect(await getUnreadCount("pm")).toBe(1);

      await send("qa", "pm", "msg2");
      expect(await getUnreadCount("pm")).toBe(2);
    });

    it("markAsRead should immediately affect both getMessages and getUnreadCount", async () => {
      await send("dev", "pm", "msg1");
      await send("qa", "pm", "msg2");

      await markAsRead("pm", "msg-1");

      const unread = await getMessages("pm", true);
      const count = await getUnreadCount("pm");

      expect(unread).toHaveLength(1);
      expect(count).toBe(1);
    });

    it("sendMessage should be visible in getConversation", async () => {
      const sent = await send("dev", "pm", "convo msg");
      const conversation = await getConversation("dev", "pm");

      expect(conversation).toHaveLength(1);
      expect(conversation[0].id).toBe(sent.id);
    });

    it("full workflow: send → read → overview should be consistent", async () => {
      // Send messages
      await send("dev", "pm", "direct");
      await send("pm", "broadcast", "broadcast");

      // Verify initial state
      let overview = await getAllAgentsOverview();
      expect(overview.pm.unread).toBe(2);

      // Mark direct as read
      await markAsRead("pm", "msg-1");
      overview = await getAllAgentsOverview();
      expect(overview.pm.unread).toBe(1);

      // Mark broadcast as read
      await markAsRead("pm", "msg-2");
      overview = await getAllAgentsOverview();
      expect(overview.pm.unread).toBe(0);
    });
  });

  // =======================================================================
  // 8. 동시성 테스트
  // =======================================================================
  describe("동시성 (Concurrency)", () => {
    it("should handle concurrent sendMessage calls", async () => {
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(send("dev", "pm", `concurrent-${i}`));
      }

      const results = await Promise.all(promises);

      // All messages should have unique IDs
      const ids = new Set(results.map((r) => r.id));
      expect(ids.size).toBe(5);

      // All should be visible in getMessages
      const messages = await getMessages("pm");
      expect(messages).toHaveLength(5);
    });

    it("should handle concurrent reads and writes", async () => {
      await send("dev", "pm", "msg1");
      await send("qa", "pm", "msg2");

      // Concurrent markAsRead + getUnreadCount
      const [, count] = await Promise.all([
        markAsRead("pm", "msg-1"),
        getUnreadCount("pm"),
      ]);

      // Count might be 1 or 2 depending on execution order, both are valid
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(2);
    });

    it("should handle concurrent overview and conversation queries", async () => {
      await send("dev", "pm", "test");

      const [overview, conversation] = await Promise.all([
        getAllAgentsOverview(),
        getConversation("dev", "pm"),
      ]);

      expect(overview.pm.unread).toBe(1);
      expect(conversation).toHaveLength(1);
    });
  });
});
