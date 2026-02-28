import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// In-memory storage for mock PostgreSQL
const mockStorage = {
  conversations: [] as Array<{
    id: string;
    title: string;
    participants: string[];
    context: Record<string, unknown>;
    status: string;
    created_by: string;
    created_at: string;
    updated_at: string;
    archived_at: string | null;
  }>,
  conversationMessages: [] as Array<{
    id: string;
    conversation_id: string;
    from_id: string;
    content: string;
    type: string;
    metadata: Record<string, unknown>;
    parent_message_id: string | null;
    created_at: string;
  }>,
  conversationReadStatus: [] as Array<{
    conversation_id: string;
    agent_id: string;
    last_read_message_id: string | null;
    last_read_at: string;
    unread_count: number;
  }>,
};

let conversationIdCounter = 0;
let messageIdCounter = 0;

// Mock the db module
vi.mock("@/lib/db", () => {
  const queryImpl = async (sql: string, params: unknown[] = []) => {
    // ===== CONVERSATIONS TABLE =====

    // INSERT INTO conversations
    if (sql.includes("INSERT INTO conversations")) {
      const [title, participants, contextJson, createdBy] = params as [
        string,
        string[],
        string,
        string
      ];
      const now = new Date().toISOString();
      conversationIdCounter++;
      const conversation = {
        id: `conv-${conversationIdCounter}`,
        title,
        participants,
        context: JSON.parse(contextJson),
        status: "active",
        created_by: createdBy,
        created_at: now,
        updated_at: now,
        archived_at: null,
      };
      mockStorage.conversations.push(conversation);
      return [conversation];
    }

    // SELECT conversation by id
    if (
      sql.includes("SELECT id, title, participants, context, status") &&
      sql.includes("FROM conversations") &&
      sql.includes("WHERE id = $1") &&
      !sql.includes("UPDATE")
    ) {
      const [conversationId] = params as string[];
      const conv = mockStorage.conversations.find((c) => c.id === conversationId);
      return conv ? [conv] : [];
    }

    // SELECT conversations list with filters
    if (
      sql.includes("SELECT id, title, participants, context, status") &&
      sql.includes("FROM conversations") &&
      sql.includes("WHERE 1=1") &&
      sql.includes("ORDER BY updated_at DESC")
    ) {
      let results = [...mockStorage.conversations];

      // Filter by participant
      if (sql.includes("ANY(participants)")) {
        const participantId = params[0] as string;
        results = results.filter((c) => c.participants.includes(participantId));
      }

      // Filter by status
      if (sql.includes("status = $")) {
        const statusParam = params.find((p) => ["active", "archived", "completed"].includes(p as string));
        if (statusParam) {
          results = results.filter((c) => c.status === statusParam);
        }
      }

      // Filter by createdBy
      if (sql.includes("created_by = $")) {
        const createdByIndex = sql.includes("ANY(participants)") ? 1 : 0;
        const createdBy = params[createdByIndex] as string;
        if (createdBy && createdBy !== "active" && createdBy !== "archived") {
          results = results.filter((c) => c.created_by === createdBy);
        }
      }

      // Apply limit
      if (sql.includes("LIMIT")) {
        const limit = params[params.length - 1] as number;
        results = results.slice(0, limit);
      }

      results.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      return results;
    }

    // UPDATE conversations
    if (sql.includes("UPDATE conversations") && sql.includes("SET")) {
      const conversationId = params[params.length - 1] as string;
      const conv = mockStorage.conversations.find((c) => c.id === conversationId);
      if (!conv) return [];

      // Parse SET clauses
      if (sql.includes("title = $")) {
        conv.title = params[0] as string;
      }
      if (sql.includes("context = $")) {
        const contextIdx = sql.includes("title = $") ? 1 : 0;
        conv.context = JSON.parse(params[contextIdx] as string);
      }
      if (sql.includes("status = $")) {
        const statusIdx = [sql.includes("title = $"), sql.includes("context = $")].filter(Boolean).length;
        conv.status = params[statusIdx] as string;
        if (conv.status === "archived") {
          conv.archived_at = new Date().toISOString();
        }
      }
      if (sql.includes("context || $1::jsonb")) {
        // Merge context
        const updates = JSON.parse(params[0] as string);
        conv.context = { ...conv.context, ...updates };
      }

      conv.updated_at = new Date().toISOString();
      return [conv];
    }

    // DELETE FROM conversations
    if (sql.includes("DELETE FROM conversations WHERE id")) {
      const [conversationId] = params as string[];
      const index = mockStorage.conversations.findIndex((c) => c.id === conversationId);
      if (index === -1) return [];

      // Cascade delete messages and read status
      mockStorage.conversationMessages = mockStorage.conversationMessages.filter(
        (m) => m.conversation_id !== conversationId
      );
      mockStorage.conversationReadStatus = mockStorage.conversationReadStatus.filter(
        (r) => r.conversation_id !== conversationId
      );
      mockStorage.conversations.splice(index, 1);
      return [{ count: 1 }];
    }

    // ===== CONVERSATION_MESSAGES TABLE =====

    // INSERT INTO conversation_messages
    if (sql.includes("INSERT INTO conversation_messages")) {
      const [conversationId, fromId, content, type, metadataJson, parentMessageId] = params as [
        string,
        string,
        string,
        string,
        string,
        string | null
      ];
      const now = new Date().toISOString();
      messageIdCounter++;
      const message = {
        id: `msg-${messageIdCounter}`,
        conversation_id: conversationId,
        from_id: fromId,
        content,
        type,
        metadata: JSON.parse(metadataJson),
        parent_message_id: parentMessageId,
        created_at: now,
      };
      mockStorage.conversationMessages.push(message);

      // Update conversation updated_at (trigger simulation)
      const conv = mockStorage.conversations.find((c) => c.id === conversationId);
      if (conv) {
        conv.updated_at = now;
      }

      // Update unread counts (trigger simulation)
      updateUnreadCountsMock(conversationId, fromId);

      return [message];
    }

    // SELECT conversation messages
    if (
      sql.includes("SELECT id, conversation_id, from_id, content, type, metadata") &&
      sql.includes("FROM conversation_messages") &&
      sql.includes("WHERE conversation_id = $1")
    ) {
      const [conversationId] = params as string[];
      let results = mockStorage.conversationMessages.filter((m) => m.conversation_id === conversationId);

      // Filter by since timestamp
      if (sql.includes("created_at > $")) {
        const since = params[1] as string;
        results = results.filter((m) => new Date(m.created_at) > new Date(since));
      }

      // Filter by parentMessageId
      if (sql.includes("parent_message_id IS NULL")) {
        results = results.filter((m) => m.parent_message_id === null);
      } else if (sql.includes("parent_message_id = $")) {
        const parentIdIndex = sql.includes("created_at > $") ? 2 : 1;
        const parentId = params[parentIdIndex] as string;
        results = results.filter((m) => m.parent_message_id === parentId);
      }

      // Apply limit
      if (sql.includes("LIMIT")) {
        const limit = params[params.length - 1] as number;
        results = results.slice(0, limit);
      }

      results.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return results;
    }

    // SELECT message thread (recursive CTE)
    if (sql.includes("WITH RECURSIVE message_tree")) {
      const [messageId] = params as string[];
      const rootMessage = mockStorage.conversationMessages.find((m) => m.id === messageId);
      if (!rootMessage) return [];

      // Simulate recursive traversal
      const getDescendants = (parentId: string): typeof mockStorage.conversationMessages => {
        const children = mockStorage.conversationMessages.filter((m) => m.parent_message_id === parentId);
        return children.concat(...children.map((c) => getDescendants(c.id)));
      };

      return [rootMessage, ...getDescendants(messageId)];
    }

    // ===== CONVERSATION_READ_STATUS TABLE =====

    // INSERT INTO conversation_read_status (init participant)
    if (
      sql.includes("INSERT INTO conversation_read_status") &&
      sql.includes("ON CONFLICT (conversation_id, agent_id) DO NOTHING")
    ) {
      const [conversationId, agentId] = params as [string, string];
      const existing = mockStorage.conversationReadStatus.find(
        (r) => r.conversation_id === conversationId && r.agent_id === agentId
      );
      if (!existing) {
        mockStorage.conversationReadStatus.push({
          conversation_id: conversationId,
          agent_id: agentId,
          last_read_message_id: null,
          last_read_at: new Date().toISOString(),
          unread_count: 0,
        });
      }
      return [];
    }

    // INSERT/UPDATE conversation_read_status (mark as read)
    if (
      sql.includes("INSERT INTO conversation_read_status") &&
      sql.includes("ON CONFLICT (conversation_id, agent_id)") &&
      sql.includes("DO UPDATE SET")
    ) {
      const [conversationId, agentId, lastReadMessageId] = params as [string, string, string];
      const existing = mockStorage.conversationReadStatus.find(
        (r) => r.conversation_id === conversationId && r.agent_id === agentId
      );

      const now = new Date().toISOString();
      if (existing) {
        existing.last_read_message_id = lastReadMessageId;
        existing.last_read_at = now;
        return [existing];
      } else {
        const newStatus = {
          conversation_id: conversationId,
          agent_id: agentId,
          last_read_message_id: lastReadMessageId,
          last_read_at: now,
          unread_count: 0,
        };
        mockStorage.conversationReadStatus.push(newStatus);
        return [newStatus];
      }
    }

    // SELECT conversation_read_status
    if (
      sql.includes("SELECT conversation_id, agent_id, last_read_message_id, last_read_at, unread_count") &&
      sql.includes("FROM conversation_read_status")
    ) {
      const [conversationId, agentId] = params as [string, string];
      const status = mockStorage.conversationReadStatus.find(
        (r) => r.conversation_id === conversationId && r.agent_id === agentId
      );
      return status ? [status] : [];
    }

    // SELECT update_conversation_unread_counts (function call)
    if (sql.includes("SELECT update_conversation_unread_counts")) {
      const [conversationId] = params as string[];
      updateUnreadCountsMock(conversationId, undefined);
      return [];
    }

    // ===== CONVERSATION_STATS VIEW =====

    // SELECT from conversation_stats (view)
    if (sql.includes("FROM conversation_stats WHERE id")) {
      const [conversationId] = params as string[];
      const conv = mockStorage.conversations.find((c) => c.id === conversationId);
      if (!conv) return [];

      const messages = mockStorage.conversationMessages.filter((m) => m.conversation_id === conversationId);
      const messageCount = messages.length;
      const lastMessageAt = messages.length > 0
        ? messages.reduce((latest, m) =>
            new Date(m.created_at) > new Date(latest) ? m.created_at : latest,
          messages[0].created_at)
        : null;

      const readStatus: Record<string, { unread: number; last_read_at: string }> = {};
      const statuses = mockStorage.conversationReadStatus.filter((r) => r.conversation_id === conversationId);
      statuses.forEach((s) => {
        readStatus[s.agent_id] = {
          unread: s.unread_count,
          last_read_at: s.last_read_at,
        };
      });

      return [
        {
          id: conv.id,
          title: conv.title,
          participants: conv.participants,
          status: conv.status,
          created_by: conv.created_by,
          created_at: conv.created_at,
          updated_at: conv.updated_at,
          message_count: String(messageCount),
          last_message_at: lastMessageAt,
          read_status: readStatus,
        },
      ];
    }

    // SELECT from conversation_stats (unread conversations)
    if (sql.includes("FROM conversation_stats cs") && sql.includes("LEFT JOIN conversation_read_status crs")) {
      const [agentId] = params as string[];
      const results = mockStorage.conversations
        .filter(
          (c) => c.status === "active" && c.participants.includes(agentId)
        )
        .map((conv) => {
          const messages = mockStorage.conversationMessages.filter((m) => m.conversation_id === conv.id);
          const messageCount = messages.length;
          const lastMessageAt = messages.length > 0
            ? messages.reduce((latest, m) =>
                new Date(m.created_at) > new Date(latest) ? m.created_at : latest,
              messages[0].created_at)
            : null;

          const readStatus: Record<string, { unread: number; last_read_at: string }> = {};
          const statuses = mockStorage.conversationReadStatus.filter((r) => r.conversation_id === conv.id);
          statuses.forEach((s) => {
            readStatus[s.agent_id] = {
              unread: s.unread_count,
              last_read_at: s.last_read_at,
            };
          });

          const agentStatus = mockStorage.conversationReadStatus.find(
            (r) => r.conversation_id === conv.id && r.agent_id === agentId
          );
          const agentUnreadCount = agentStatus?.unread_count ?? 0;

          return {
            id: conv.id,
            title: conv.title,
            participants: conv.participants,
            status: conv.status,
            created_by: conv.created_by,
            created_at: conv.created_at,
            updated_at: conv.updated_at,
            message_count: String(messageCount),
            last_message_at: lastMessageAt,
            read_status: readStatus,
            agent_unread_count: agentUnreadCount,
          };
        })
        .filter((c) => c.agent_unread_count > 0);

      results.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      return results;
    }

    return [];
  };

  // Helper: Simulate PostgreSQL unread count update function
  function updateUnreadCountsMock(conversationId: string, excludeAgentId?: string) {
    const conv = mockStorage.conversations.find((c) => c.id === conversationId);
    if (!conv) return;

    conv.participants.forEach((participantId) => {
      if (excludeAgentId && participantId === excludeAgentId) return;

      let status = mockStorage.conversationReadStatus.find(
        (r) => r.conversation_id === conversationId && r.agent_id === participantId
      );

      // Create status if it doesn't exist
      if (!status) {
        status = {
          conversation_id: conversationId,
          agent_id: participantId,
          last_read_message_id: null,
          last_read_at: new Date().toISOString(),
          unread_count: 0,
        };
        mockStorage.conversationReadStatus.push(status);
      }

      const lastReadMessageId = status.last_read_message_id;
      const messages = mockStorage.conversationMessages
        .filter((m) => m.conversation_id === conversationId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      let unread = 0;
      if (!lastReadMessageId) {
        // No messages read yet - count all messages not from this participant
        unread = messages.filter((m) => m.from_id !== participantId).length;
      } else {
        // Find the index of the last read message
        const lastReadIndex = messages.findIndex((m) => m.id === lastReadMessageId);
        if (lastReadIndex !== -1) {
          // Count messages after the last read message (by index, not timestamp)
          unread = messages
            .slice(lastReadIndex + 1)
            .filter((m) => m.from_id !== participantId).length;
        } else {
          // Last read message not found - count all messages
          unread = messages.filter((m) => m.from_id !== participantId).length;
        }
      }

      status.unread_count = unread;
    });
  }

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

// Mock messages module for isValidAgentId
vi.mock("@/lib/messages", () => ({
  isValidAgentId: vi.fn((id: string) => ["user", "pm", "dev", "qa", "designer"].includes(id)),
}));

import {
  createConversation,
  getConversation,
  getConversations,
  updateConversation,
  deleteConversation,
  addConversationMessage,
  getConversationMessages,
  getMessageThread,
  updateConversationReadStatus,
  getConversationStats,
  getUnreadConversations,
  updateConversationContext,
  type Conversation,
  type ConversationMessage,
} from "@/lib/conversations";

describe("conversations module", () => {
  beforeEach(() => {
    mockStorage.conversations = [];
    mockStorage.conversationMessages = [];
    mockStorage.conversationReadStatus = [];
    conversationIdCounter = 0;
    messageIdCounter = 0;
    vi.clearAllMocks();
  });

  // =========================================================================
  // 세션 생성/전환/삭제 시나리오
  // =========================================================================
  describe("Session Creation/Switching/Deletion Scenarios", () => {
    it("should create a new conversation session with participants", async () => {
      const result = await createConversation({
        title: "Project Alpha Planning",
        participants: ["user", "pm", "dev"],
        context: { projectId: "alpha-001", goal: "MVP planning" },
        createdBy: "user",
      });

      expect(result).toMatchObject({
        id: expect.any(String),
        title: "Project Alpha Planning",
        participants: ["user", "pm", "dev"],
        context: { projectId: "alpha-001", goal: "MVP planning" },
        status: "active",
        createdBy: "user",
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it("should initialize read status for all participants on creation", async () => {
      await createConversation({
        title: "Team Sync",
        participants: ["user", "pm", "dev"],
        createdBy: "user",
      });

      // Verify read status was initialized
      expect(mockStorage.conversationReadStatus).toHaveLength(3);
      expect(mockStorage.conversationReadStatus.map((r) => r.agent_id).sort()).toEqual(["dev", "pm", "user"]);
    });

    it("should remove duplicate participants automatically", async () => {
      const result = await createConversation({
        title: "Test",
        participants: ["user", "pm", "pm", "dev", "user"],
        createdBy: "user",
      });

      expect(result.participants).toEqual(["user", "pm", "dev"]);
    });

    it("should create multiple sessions and allow switching between them", async () => {
      const session1 = await createConversation({
        title: "Session 1",
        participants: ["user", "pm"],
        createdBy: "user",
      });

      const session2 = await createConversation({
        title: "Session 2",
        participants: ["user", "dev"],
        createdBy: "user",
      });

      // Add messages to each session
      await addConversationMessage({
        conversationId: session1.id,
        from: "user",
        content: "Message in session 1",
      });

      await addConversationMessage({
        conversationId: session2.id,
        from: "user",
        content: "Message in session 2",
      });

      // Retrieve messages from each session independently
      const messages1 = await getConversationMessages(session1.id);
      const messages2 = await getConversationMessages(session2.id);

      expect(messages1).toHaveLength(1);
      expect(messages1[0].content).toBe("Message in session 1");
      expect(messages2).toHaveLength(1);
      expect(messages2[0].content).toBe("Message in session 2");
    });

    it("should delete conversation and cascade delete messages and read status", async () => {
      const session = await createConversation({
        title: "To Delete",
        participants: ["user", "pm"],
        createdBy: "user",
      });

      await addConversationMessage({
        conversationId: session.id,
        from: "user",
        content: "Test message",
      });

      // Delete conversation
      const deleted = await deleteConversation(session.id);
      expect(deleted).toBe(true);

      // Verify cascade deletion
      expect(mockStorage.conversations).toHaveLength(0);
      expect(mockStorage.conversationMessages).toHaveLength(0);
      expect(mockStorage.conversationReadStatus).toHaveLength(0);
    });

    it("should return false when deleting non-existent conversation", async () => {
      const deleted = await deleteConversation("non-existent-id");
      expect(deleted).toBe(false);
    });

    it("should throw error when creating conversation with invalid participant", async () => {
      await expect(
        createConversation({
          title: "Invalid",
          participants: ["user", "invalid-agent"],
          createdBy: "user",
        })
      ).rejects.toThrow('Invalid participant ID: "invalid-agent"');
    });

    it("should throw error when creating conversation with invalid createdBy", async () => {
      await expect(
        createConversation({
          title: "Invalid",
          participants: ["user", "pm"],
          createdBy: "invalid-creator",
        })
      ).rejects.toThrow('Invalid createdBy: "invalid-creator"');
    });
  });

  // =========================================================================
  // 동시 세션 관리 테스트
  // =========================================================================
  describe("Concurrent Session Management", () => {
    it("should handle multiple active sessions per user", async () => {
      const sessions = await Promise.all([
        createConversation({
          title: "Session A",
          participants: ["user", "pm"],
          createdBy: "user",
        }),
        createConversation({
          title: "Session B",
          participants: ["user", "dev"],
          createdBy: "user",
        }),
        createConversation({
          title: "Session C",
          participants: ["user", "qa"],
          createdBy: "user",
        }),
      ]);

      expect(sessions).toHaveLength(3);
      expect(mockStorage.conversations).toHaveLength(3);

      // Retrieve user's conversations
      const userConvs = await getConversations({ participantId: "user" });
      expect(userConvs).toHaveLength(3);
    });

    it("should isolate messages between concurrent sessions", async () => {
      const sessionA = await createConversation({
        title: "Session A",
        participants: ["user", "pm"],
        createdBy: "user",
      });

      const sessionB = await createConversation({
        title: "Session B",
        participants: ["user", "pm"],
        createdBy: "user",
      });

      // Add messages to both sessions
      await addConversationMessage({
        conversationId: sessionA.id,
        from: "user",
        content: "Message A1",
      });

      await addConversationMessage({
        conversationId: sessionB.id,
        from: "user",
        content: "Message B1",
      });

      await addConversationMessage({
        conversationId: sessionA.id,
        from: "pm",
        content: "Message A2",
      });

      // Verify isolation
      const messagesA = await getConversationMessages(sessionA.id);
      const messagesB = await getConversationMessages(sessionB.id);

      expect(messagesA).toHaveLength(2);
      expect(messagesB).toHaveLength(1);
      expect(messagesA.every((m) => m.conversationId === sessionA.id)).toBe(true);
      expect(messagesB.every((m) => m.conversationId === sessionB.id)).toBe(true);
    });

    it("should maintain separate read status per session", async () => {
      const sessionA = await createConversation({
        title: "Session A",
        participants: ["user", "pm"],
        createdBy: "user",
      });

      const sessionB = await createConversation({
        title: "Session B",
        participants: ["user", "pm"],
        createdBy: "user",
      });

      // Add messages
      const msgA1 = await addConversationMessage({
        conversationId: sessionA.id,
        from: "pm",
        content: "Message A1",
      });

      const msgB1 = await addConversationMessage({
        conversationId: sessionB.id,
        from: "pm",
        content: "Message B1",
      });

      // Mark session A as read
      await updateConversationReadStatus(sessionA.id, "user", msgA1.id);

      // Check unread status
      const statusA = mockStorage.conversationReadStatus.find(
        (r) => r.conversation_id === sessionA.id && r.agent_id === "user"
      );
      const statusB = mockStorage.conversationReadStatus.find(
        (r) => r.conversation_id === sessionB.id && r.agent_id === "user"
      );

      expect(statusA?.unread_count).toBe(0);
      expect(statusB?.unread_count).toBe(1);
    });

    it("should list conversations with filters", async () => {
      await createConversation({
        title: "PM Session",
        participants: ["user", "pm"],
        status: "active",
        createdBy: "user",
      });

      await createConversation({
        title: "Dev Session",
        participants: ["user", "dev"],
        status: "active",
        createdBy: "pm",
      });

      const session3 = await createConversation({
        title: "Archived Session",
        participants: ["user", "pm"],
        createdBy: "user",
      });

      await updateConversation(session3.id, { status: "archived" });

      // Filter by participant
      const pmConvs = await getConversations({ participantId: "pm" });
      expect(pmConvs).toHaveLength(2);

      // Filter by status
      const activeConvs = await getConversations({ status: "active" });
      expect(activeConvs).toHaveLength(2);

      // Filter by createdBy
      const userCreated = await getConversations({ createdBy: "user" });
      expect(userCreated).toHaveLength(2);

      // Limit results
      const limited = await getConversations({ limit: 1 });
      expect(limited).toHaveLength(1);
    });
  });

  // =========================================================================
  // 메시지 저장/조회 정합성 검증
  // =========================================================================
  describe("Message Storage/Retrieval Consistency", () => {
    let testSession: Conversation;

    beforeEach(async () => {
      testSession = await createConversation({
        title: "Test Session",
        participants: ["user", "pm", "dev"],
        createdBy: "user",
      });
    });

    it("should store and retrieve messages in correct order", async () => {
      const msg1 = await addConversationMessage({
        conversationId: testSession.id,
        from: "user",
        content: "First message",
      });

      await new Promise((resolve) => setTimeout(resolve, 5));

      const msg2 = await addConversationMessage({
        conversationId: testSession.id,
        from: "pm",
        content: "Second message",
      });

      await new Promise((resolve) => setTimeout(resolve, 5));

      const msg3 = await addConversationMessage({
        conversationId: testSession.id,
        from: "dev",
        content: "Third message",
      });

      const messages = await getConversationMessages(testSession.id);

      expect(messages).toHaveLength(3);
      expect(messages[0].id).toBe(msg1.id);
      expect(messages[1].id).toBe(msg2.id);
      expect(messages[2].id).toBe(msg3.id);
    });

    it("should enforce participant validation when adding messages", async () => {
      await expect(
        addConversationMessage({
          conversationId: testSession.id,
          from: "qa", // Not a participant
          content: "Invalid message",
        })
      ).rejects.toThrow('Sender "qa" is not a participant in this conversation');
    });

    it("should throw error when adding message to non-existent conversation", async () => {
      await expect(
        addConversationMessage({
          conversationId: "non-existent",
          from: "user",
          content: "Test",
        })
      ).rejects.toThrow("Conversation not found: non-existent");
    });

    it("should throw error when sender is invalid agent", async () => {
      await expect(
        addConversationMessage({
          conversationId: testSession.id,
          from: "invalid-agent",
          content: "Test",
        })
      ).rejects.toThrow('Invalid sender: "invalid-agent"');
    });

    it("should support different message types", async () => {
      const types = ["text", "task", "result", "question", "answer", "system"] as const;

      for (const type of types) {
        await addConversationMessage({
          conversationId: testSession.id,
          from: "user",
          content: `Message type: ${type}`,
          type,
        });
      }

      const messages = await getConversationMessages(testSession.id);
      expect(messages).toHaveLength(6);
      expect(messages.map((m) => m.type)).toEqual([...types]);
    });

    it("should store and retrieve message metadata", async () => {
      const msg = await addConversationMessage({
        conversationId: testSession.id,
        from: "user",
        content: "Message with metadata",
        metadata: { model: "sonnet", tokens: 450, priority: "high" },
      });

      const messages = await getConversationMessages(testSession.id);
      expect(messages[0].metadata).toEqual({
        model: "sonnet",
        tokens: 450,
        priority: "high",
      });
    });

    it("should filter messages by since timestamp", async () => {
      await addConversationMessage({
        conversationId: testSession.id,
        from: "user",
        content: "Old message",
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      const cutoffTime = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 10));

      await addConversationMessage({
        conversationId: testSession.id,
        from: "pm",
        content: "New message",
      });

      const recentMessages = await getConversationMessages(testSession.id, {
        since: cutoffTime,
      });

      expect(recentMessages).toHaveLength(1);
      expect(recentMessages[0].content).toBe("New message");
    });

    it("should filter messages by parent (thread support)", async () => {
      const rootMsg = await addConversationMessage({
        conversationId: testSession.id,
        from: "user",
        content: "Root message",
      });

      await addConversationMessage({
        conversationId: testSession.id,
        from: "pm",
        content: "Reply to root",
        parentMessageId: rootMsg.id,
      });

      await addConversationMessage({
        conversationId: testSession.id,
        from: "dev",
        content: "Another root message",
      });

      // Get only root messages
      const rootMessages = await getConversationMessages(testSession.id, {
        parentMessageId: null,
      });
      expect(rootMessages).toHaveLength(2);

      // Get replies to root
      const replies = await getConversationMessages(testSession.id, {
        parentMessageId: rootMsg.id,
      });
      expect(replies).toHaveLength(1);
      expect(replies[0].content).toBe("Reply to root");
    });

    it("should respect limit parameter", async () => {
      for (let i = 0; i < 10; i++) {
        await addConversationMessage({
          conversationId: testSession.id,
          from: "user",
          content: `Message ${i}`,
        });
      }

      const limited = await getConversationMessages(testSession.id, { limit: 3 });
      expect(limited).toHaveLength(3);
    });

    it("should retrieve message thread recursively", async () => {
      const root = await addConversationMessage({
        conversationId: testSession.id,
        from: "user",
        content: "Root",
      });

      const child1 = await addConversationMessage({
        conversationId: testSession.id,
        from: "pm",
        content: "Child 1",
        parentMessageId: root.id,
      });

      const child2 = await addConversationMessage({
        conversationId: testSession.id,
        from: "dev",
        content: "Child 2",
        parentMessageId: root.id,
      });

      const grandchild = await addConversationMessage({
        conversationId: testSession.id,
        from: "user",
        content: "Grandchild",
        parentMessageId: child1.id,
      });

      const thread = await getMessageThread(root.id);

      expect(thread).toHaveLength(4);
      expect(thread.map((m) => m.id)).toEqual([root.id, child1.id, child2.id, grandchild.id]);
    });
  });

  // =========================================================================
  // 세션 컨텍스트 격리 확인
  // =========================================================================
  describe("Session Context Isolation", () => {
    it("should maintain separate context for each session", async () => {
      const sessionA = await createConversation({
        title: "Project Alpha",
        participants: ["user", "pm"],
        context: { projectId: "alpha", budget: 10000 },
        createdBy: "user",
      });

      const sessionB = await createConversation({
        title: "Project Beta",
        participants: ["user", "dev"],
        context: { projectId: "beta", budget: 20000 },
        createdBy: "user",
      });

      // Verify context isolation
      const convA = await getConversation(sessionA.id);
      const convB = await getConversation(sessionB.id);

      expect(convA?.context).toEqual({ projectId: "alpha", budget: 10000 });
      expect(convB?.context).toEqual({ projectId: "beta", budget: 20000 });
    });

    it("should update conversation context without affecting other fields", async () => {
      const session = await createConversation({
        title: "Test",
        participants: ["user", "pm"],
        context: { step: 1 },
        createdBy: "user",
      });

      const updated = await updateConversation(session.id, {
        context: { step: 2, milestone: "Planning complete" },
      });

      expect(updated?.context).toEqual({ step: 2, milestone: "Planning complete" });
      expect(updated?.title).toBe("Test");
      expect(updated?.participants).toEqual(["user", "pm"]);
    });

    it("should merge context updates using updateConversationContext", async () => {
      const session = await createConversation({
        title: "Test",
        participants: ["user", "pm"],
        context: { projectId: "alpha", step: 1 },
        createdBy: "user",
      });

      const updated = await updateConversationContext(session.id, {
        step: 2,
        milestone: "Design phase",
      });

      expect(updated?.context).toEqual({
        projectId: "alpha",
        step: 2,
        milestone: "Design phase",
      });
    });

    it("should update conversation title and status independently", async () => {
      const session = await createConversation({
        title: "Old Title",
        participants: ["user", "pm"],
        createdBy: "user",
      });

      const updated1 = await updateConversation(session.id, { title: "New Title" });
      expect(updated1?.title).toBe("New Title");
      expect(updated1?.status).toBe("active");

      const updated2 = await updateConversation(session.id, { status: "completed" });
      expect(updated2?.status).toBe("completed");
      expect(updated2?.title).toBe("New Title");
    });

    it("should set archived_at when status changes to archived", async () => {
      const session = await createConversation({
        title: "Test",
        participants: ["user", "pm"],
        createdBy: "user",
      });

      const updated = await updateConversation(session.id, { status: "archived" });

      expect(updated?.status).toBe("archived");
      expect(updated?.archivedAt).toBeDefined();
      expect(new Date(updated!.archivedAt!).getTime()).toBeGreaterThan(0);
    });

    it("should return null when updating non-existent conversation", async () => {
      const result = await updateConversation("non-existent", { title: "Test" });
      expect(result).toBeNull();
    });

    it("should return current conversation when no updates provided", async () => {
      const session = await createConversation({
        title: "Test",
        participants: ["user", "pm"],
        createdBy: "user",
      });

      const result = await updateConversation(session.id, {});
      expect(result?.id).toBe(session.id);
    });
  });

  // =========================================================================
  // 읽음 상태 및 통계
  // =========================================================================
  describe("Read Status and Statistics", () => {
    let testSession: Conversation;

    beforeEach(async () => {
      testSession = await createConversation({
        title: "Test Session",
        participants: ["user", "pm", "dev"],
        createdBy: "user",
      });
    });

    it("should automatically update unread count when message is added", async () => {
      await addConversationMessage({
        conversationId: testSession.id,
        from: "pm",
        content: "Message from PM",
      });

      // user and dev should have unread count = 1, pm should have 0
      const userStatus = mockStorage.conversationReadStatus.find(
        (r) => r.conversation_id === testSession.id && r.agent_id === "user"
      );
      const pmStatus = mockStorage.conversationReadStatus.find(
        (r) => r.conversation_id === testSession.id && r.agent_id === "pm"
      );

      expect(userStatus?.unread_count).toBe(1);
      expect(pmStatus?.unread_count).toBe(0); // Sender doesn't count their own messages
    });

    it("should update read status and recalculate unread count", async () => {
      const msg1 = await addConversationMessage({
        conversationId: testSession.id,
        from: "pm",
        content: "Message 1",
      });

      await addConversationMessage({
        conversationId: testSession.id,
        from: "pm",
        content: "Message 2",
      });

      // user has 2 unread
      let userStatus = mockStorage.conversationReadStatus.find(
        (r) => r.conversation_id === testSession.id && r.agent_id === "user"
      );
      expect(userStatus?.unread_count).toBe(2);

      // Mark first message as read
      await updateConversationReadStatus(testSession.id, "user", msg1.id);

      // Should now have 1 unread
      userStatus = mockStorage.conversationReadStatus.find(
        (r) => r.conversation_id === testSession.id && r.agent_id === "user"
      );
      expect(userStatus?.unread_count).toBe(1);
    });

    it("should throw error when updating read status for non-participant", async () => {
      await expect(
        updateConversationReadStatus(testSession.id, "qa", "msg-1")
      ).rejects.toThrow('Agent "qa" is not a participant');
    });

    it("should throw error when updating read status for non-existent conversation", async () => {
      await expect(
        updateConversationReadStatus("non-existent", "user", "msg-1")
      ).rejects.toThrow("Conversation not found: non-existent");
    });

    it("should get conversation statistics with message count and read status", async () => {
      await addConversationMessage({
        conversationId: testSession.id,
        from: "user",
        content: "Message 1",
      });

      await addConversationMessage({
        conversationId: testSession.id,
        from: "pm",
        content: "Message 2",
      });

      const stats = await getConversationStats(testSession.id);

      expect(stats).toMatchObject({
        id: testSession.id,
        title: testSession.title,
        messageCount: 2,
        lastMessageAt: expect.any(String),
      });

      expect(stats?.readStatus).toBeDefined();
      expect(stats?.readStatus["user"]).toBeDefined();
      expect(stats?.readStatus["pm"]).toBeDefined();
      expect(stats?.readStatus["dev"]).toBeDefined();
    });

    it("should return null for stats of non-existent conversation", async () => {
      const stats = await getConversationStats("non-existent");
      expect(stats).toBeNull();
    });

    it("should get unread conversations for specific agent", async () => {
      const session1 = await createConversation({
        title: "Session 1",
        participants: ["user", "pm"],
        createdBy: "user",
      });

      const session2 = await createConversation({
        title: "Session 2",
        participants: ["user", "dev"],
        createdBy: "user",
      });

      // Add messages
      await addConversationMessage({
        conversationId: session1.id,
        from: "pm",
        content: "Unread for user",
      });

      await addConversationMessage({
        conversationId: session2.id,
        from: "dev",
        content: "Also unread for user",
      });

      const unreadConvs = await getUnreadConversations("user");

      expect(unreadConvs).toHaveLength(2);
      expect(unreadConvs.every((c) => c.unreadCount > 0)).toBe(true);
      expect(unreadConvs.every((c) => c.status === "active")).toBe(true);
    });

    it("should not include archived conversations in unread list", async () => {
      const session = await createConversation({
        title: "To Archive",
        participants: ["user", "pm"],
        createdBy: "user",
      });

      await addConversationMessage({
        conversationId: session.id,
        from: "pm",
        content: "Unread message",
      });

      await updateConversation(session.id, { status: "archived" });

      const unreadConvs = await getUnreadConversations("user");
      expect(unreadConvs).toHaveLength(0);
    });
  });

  // =========================================================================
  // Edge Cases & Error Handling
  // =========================================================================
  describe("Edge Cases and Error Handling", () => {
    it("should handle empty participant list gracefully", async () => {
      // Empty participants should still create conversation
      const result = await createConversation({
        title: "No Participants",
        participants: [],
        createdBy: "user",
      });

      expect(result.participants).toEqual([]);
    });

    it("should handle conversation with no messages", async () => {
      const session = await createConversation({
        title: "Empty Session",
        participants: ["user", "pm"],
        createdBy: "user",
      });

      const messages = await getConversationMessages(session.id);
      expect(messages).toEqual([]);

      const stats = await getConversationStats(session.id);
      expect(stats?.messageCount).toBe(0);
      expect(stats?.lastMessageAt).toBeUndefined();
    });

    it("should handle message thread with no children", async () => {
      const session = await createConversation({
        title: "Test",
        participants: ["user", "pm"],
        createdBy: "user",
      });

      const msg = await addConversationMessage({
        conversationId: session.id,
        from: "user",
        content: "Lone message",
      });

      const thread = await getMessageThread(msg.id);
      expect(thread).toHaveLength(1);
      expect(thread[0].id).toBe(msg.id);
    });

    it("should return empty array for thread of non-existent message", async () => {
      const thread = await getMessageThread("non-existent-msg");
      expect(thread).toEqual([]);
    });

    it("should handle getConversation with null result", async () => {
      const result = await getConversation("non-existent-id");
      expect(result).toBeNull();
    });

    it("should handle updateConversationContext for non-existent conversation", async () => {
      const result = await updateConversationContext("non-existent", { key: "value" });
      expect(result).toBeNull();
    });
  });
});
