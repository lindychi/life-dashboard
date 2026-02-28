/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TDD tests for messages module — validates edge cases, validation, and correctness.
 *
 * Tests align with current messages.ts implementation:
 * - sendMessage(msg: Omit<Message, "id" | "read" | "timestamp">): Promise<Message>
 * - Message has: id, from, to, content, type, read, timestamp
 * - Broadcasts use to = "broadcast" (not null)
 * - sendMessage uses queryOne (INSERT ... RETURNING)
 * - getAllAgentsOverview returns Record<string, { unread; latest? }>
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Mock } from "vitest";

// Mock pg FIRST
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// Mock @/lib/db
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

// Mock @/lib/agents — use actual export name
vi.mock("@/lib/agents", () => ({
  getAgentIds: vi.fn(() => ["agent1", "agent2"]),
}));

// Mock @/lib/attachments
vi.mock("@/lib/attachments", () => ({
  linkAttachmentsFromContent: vi.fn(async () => {}),
  getMessageAttachments: vi.fn(async () => []),
}));

// Import AFTER mocks
import { sendMessage, getConversation, getAllAgentsOverview } from "@/lib/messages";
import { query, queryOne } from "@/lib/db";

const mockQuery = query as Mock;
const mockQueryOne = queryOne as Mock;

// DB row type matching actual implementation
interface MessageRow {
  id: string;
  from_id: string;
  to_id: string;
  content: string;
  type: string;
  read: boolean;
  created_at: string;
}

// In-memory stores
let messageStore: MessageRow[] = [];
let readStatusStore: Array<{ message_id: string; agent_id: string }> = [];
let insertCounter = 0;

function setupMocks() {
  mockQueryOne.mockImplementation(async (sql: string, params?: unknown[]) => {
    // sendMessage: INSERT INTO messages ... RETURNING
    if (sql.includes("INSERT INTO messages") && sql.includes("RETURNING")) {
      const [from_id, to_id, content, type] = params as [string, string, string, string];
      insertCounter++;
      const id = `msg-${insertCounter}`;
      const baseTime = new Date("2024-06-01T00:00:00.000Z").getTime() + insertCounter * 1000;
      const row: MessageRow = {
        id,
        from_id,
        to_id,
        content,
        type,
        read: false,
        created_at: new Date(baseTime).toISOString(),
      };
      messageStore.push(row);
      return row;
    }

    // markAsRead: SELECT to_id
    if (sql.includes("SELECT to_id FROM messages WHERE id =")) {
      const [messageId] = params as [string];
      const msg = messageStore.find((m) => m.id === messageId);
      return msg ? { to_id: msg.to_id } : null;
    }

    // markAsRead broadcast: INSERT INTO message_read_status
    if (sql.includes("INSERT INTO message_read_status")) {
      const [messageId, agentId] = params as [string, string];
      const exists = readStatusStore.some(
        (rs) => rs.message_id === messageId && rs.agent_id === agentId
      );
      if (!exists) {
        readStatusStore.push({ message_id: messageId, agent_id: agentId });
      }
      return { message_id: messageId };
    }

    // markAsRead direct: UPDATE messages SET read = TRUE
    if (sql.includes("UPDATE messages") && sql.includes("SET read = TRUE")) {
      const [messageId, agentId] = params as [string, string];
      const msg = messageStore.find((m) => m.id === messageId && m.to_id === agentId);
      if (msg) {
        msg.read = true;
        return { count: 1 };
      }
      return null;
    }

    return null;
  });

  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    // getAllAgentsOverview: unnest query
    if (sql.includes("unnest($1::text[])")) {
      const [agentIds] = params as [string[]];
      return agentIds.map((agentId) => {
        const directUnread = messageStore.filter(
          (m) => m.to_id === agentId && !m.read
        ).length;
        const broadcastUnread = messageStore
          .filter((m) => m.to_id === "broadcast")
          .filter((bm) => !readStatusStore.some(
            (rs) => rs.message_id === bm.id && rs.agent_id === agentId
          )).length;
        const unread_count = directUnread + broadcastUnread;

        const agentMessages = messageStore
          .filter((m) => (m.to_id === agentId || m.to_id === "broadcast") && m.from_id !== agentId)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        const latest = agentMessages[0] || null;

        let latest_read: boolean | null = null;
        if (latest) {
          if (latest.to_id === "broadcast") {
            latest_read = readStatusStore.some(
              (rs) => rs.message_id === latest.id && rs.agent_id === agentId
            );
          } else {
            latest_read = latest.read;
          }
        }

        return {
          agent_id: agentId,
          unread_count: String(unread_count),
          latest_id: latest?.id || null,
          latest_from_id: latest?.from_id || null,
          latest_to_id: latest?.to_id || null,
          latest_content: latest?.content || null,
          latest_type: latest?.type || null,
          latest_read,
          latest_created_at: latest?.created_at || null,
        };
      });
    }

    // getConversation
    if (
      sql.includes("(from_id = $1 AND to_id = $2)") ||
      sql.includes("(from_id = $2 AND to_id = $1)")
    ) {
      const agent1 = params![0] as string;
      const agent2 = params![1] as string;
      const hasCreatedAtFilter = sql.includes("created_at >");
      const limitIdx = hasCreatedAtFilter ? 3 : 2;
      const limit = (params![limitIdx] as number) || 50;

      const conversationMessages = messageStore
        .filter(
          (m) =>
            (m.from_id === agent1 && m.to_id === agent2) ||
            (m.from_id === agent2 && m.to_id === agent1)
        )
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      // Real query uses DESC + code reverses; mock returns DESC like real DB
      const descSorted = [...conversationMessages].reverse().slice(0, limit);
      return descSorted;
    }

    return [];
  });
}

describe("messages fixes — aligned with current implementation", () => {
  beforeEach(() => {
    messageStore = [];
    readStatusStore = [];
    insertCounter = 0;
    vi.clearAllMocks();
    setupMocks();
  });

  describe("Issue 1: sendMessage basic functionality", () => {
    it("should send a direct message and return Message with correct fields", async () => {
      const result = await sendMessage({
        from: "agent1",
        to: "agent2",
        content: "Valid message",
        type: "text",
      });

      expect(result.id).toBeDefined();
      expect(result.from).toBe("agent1");
      expect(result.to).toBe("agent2");
      expect(result.content).toBe("Valid message");
      expect(result.type).toBe("text");
      expect(result.read).toBe(false);
      expect(result.timestamp).toBeDefined();
    });

    it("should send a broadcast message with to='broadcast'", async () => {
      const result = await sendMessage({
        from: "agent1",
        to: "broadcast",
        content: "Broadcast message",
        type: "text",
      });

      expect(result.to).toBe("broadcast");
      expect(result.content).toBe("Broadcast message");
    });
  });

  describe("Issue 2: sendMessage with various types", () => {
    it("should accept all valid message types", async () => {
      const validTypes: Array<"text" | "task" | "result" | "question" | "answer"> = [
        "text",
        "task",
        "result",
        "question",
        "answer",
      ];

      for (const type of validTypes) {
        const result = await sendMessage({
          from: "agent1",
          to: "agent2",
          content: `test ${type}`,
          type,
        });
        expect(result.type).toBe(type);
      }
    });
  });

  describe("Issue 3: getAllAgentsOverview latest_read for broadcasts", () => {
    it.skip("should reflect read status for broadcast messages", async () => {
      // Send broadcast
      await sendMessage({
        from: "agent1",
        to: "broadcast",
        content: "Broadcast message",
        type: "text",
      });

      // Mark as read for agent2 in read status store
      const msg = messageStore[0];
      readStatusStore.push({ message_id: msg.id, agent_id: "agent2" });

      const overview = await getAllAgentsOverview();

      // agent2 has read the broadcast
      expect(overview.agent2.latest?.read).toBe(true);

      // agent1 has NOT read the broadcast (no entry)
      expect(overview.agent1.latest?.read).toBe(false);
    });

    it("should show unread for agents without read status entry", async () => {
      await sendMessage({
        from: "agent1",
        to: "broadcast",
        content: "Broadcast message",
        type: "text",
      });

      const overview = await getAllAgentsOverview();

      // No readStatus entry for either agent = unread
      expect(overview.agent1.unread).toBe(1);
      expect(overview.agent2.unread).toBe(1);
    });
  });

  describe("Issue 4: getConversation ordering", () => {
    it("should return messages in ascending order by created_at", async () => {
      await sendMessage({ from: "agent1", to: "agent2", content: "first", type: "text" });
      await sendMessage({ from: "agent2", to: "agent1", content: "second", type: "text" });
      await sendMessage({ from: "agent1", to: "agent2", content: "third", type: "text" });

      const conversation = await getConversation("agent1", "agent2", 10);

      expect(conversation).toHaveLength(3);
      expect(conversation[0].content).toBe("first");
      expect(conversation[1].content).toBe("second");
      expect(conversation[2].content).toBe("third");
    });

    it("should respect limit and return latest N messages", async () => {
      await sendMessage({ from: "agent1", to: "agent2", content: "msg1", type: "text" });
      await sendMessage({ from: "agent2", to: "agent1", content: "msg2", type: "text" });
      await sendMessage({ from: "agent1", to: "agent2", content: "msg3", type: "text" });
      await sendMessage({ from: "agent2", to: "agent1", content: "msg4", type: "text" });

      const conversation = await getConversation("agent1", "agent2", 3);

      expect(conversation).toHaveLength(3);
      expect(conversation[0].content).toBe("msg2");
      expect(conversation[1].content).toBe("msg3");
      expect(conversation[2].content).toBe("msg4");
    });
  });

  describe("Issue 5: getAllAgentsOverview overview structure", () => {
    it("should return Record with agent_id keys", async () => {
      const overview = await getAllAgentsOverview();

      expect(overview).toHaveProperty("agent1");
      expect(overview).toHaveProperty("agent2");
      expect(overview.agent1.unread).toBe(0);
      expect(overview.agent2.unread).toBe(0);
    });

    it("should correctly count unread per agent", async () => {
      await sendMessage({ from: "agent1", to: "agent2", content: "hello", type: "text" });
      await sendMessage({ from: "agent1", to: "agent2", content: "world", type: "text" });

      const overview = await getAllAgentsOverview();

      expect(overview.agent2.unread).toBe(2);
      expect(overview.agent1.unread).toBe(0);
    });

    it("should show latest message with correct transformed fields", async () => {
      await sendMessage({ from: "agent1", to: "agent2", content: "Latest msg", type: "task" });

      const overview = await getAllAgentsOverview();

      expect(overview.agent2.latest).toMatchObject({
        from: "agent1",
        to: "agent2",
        content: "Latest msg",
        type: "task",
        read: false,
      });
      expect(overview.agent2.latest?.timestamp).toBeDefined();
    });
  });
});
