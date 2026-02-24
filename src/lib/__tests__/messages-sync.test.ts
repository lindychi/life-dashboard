/**
 * Message Synchronization Tests
 *
 * Tests real-time consistency between sendMessage → getMessages,
 * markAsRead → getUnreadCount, and concurrent message ordering.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock pg
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

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

/**
 * Helper: check if broadcast message has been read by a specific agent
 */
function isBroadcastReadByAgent(messageId: string, agentId: string): boolean {
  return mockStorage.readStatus.some(
    (rs) => rs.message_id === messageId && rs.agent_id === agentId
  );
}

/**
 * Helper: check if a message is unread for a specific agent
 */
function isUnreadForAgent(
  msg: (typeof mockStorage.messages)[0],
  agentId: string
): boolean {
  if (msg.to_id === "broadcast") {
    return !isBroadcastReadByAgent(msg.id, agentId);
  }
  return !msg.read;
}

/**
 * Helper: get the effective read status for a message + agent
 */
function getEffectiveRead(
  msg: (typeof mockStorage.messages)[0],
  agentId: string
): boolean {
  if (msg.to_id === "broadcast") {
    return isBroadcastReadByAgent(msg.id, agentId);
  }
  return msg.read;
}

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

    // SELECT to_id FROM messages WHERE id = $1 (markAsRead broadcast check)
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
      }
      return [{ message_id: messageId }];
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

    // SELECT with LEFT JOIN message_read_status (getUnreadCount)
    if (
      sql.includes("LEFT JOIN message_read_status") &&
      sql.includes("COUNT(*)")
    ) {
      const [agentId] = params as string[];
      const count = mockStorage.messages.filter(
        (m) =>
          (m.to_id === agentId || m.to_id === "broadcast") &&
          isUnreadForAgent(m, agentId)
      ).length;
      return [{ count: String(count) }];
    }

    // SELECT with LEFT JOIN message_read_status (getMessages)
    if (
      sql.includes("LEFT JOIN message_read_status") &&
      !sql.includes("COUNT(*)")
    ) {
      const [agentId] = params as string[];
      let results = mockStorage.messages.filter(
        (m) => m.to_id === agentId || m.to_id === "broadcast"
      );

      // Check if unreadOnly filter is applied
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
} from "@/lib/messages";

describe("sendMessage → getMessages 동기화", () => {
  beforeEach(() => {
    mockStorage.messages = [];
    mockStorage.readStatus = [];
    messageIdCounter = 0;
    vi.clearAllMocks();
  });

  it("should immediately see message after sendMessage", async () => {
    // Send message from dev to pm
    const sent = await sendMessage({
      from: "dev",
      to: "pm",
      content: "Hello PM",
      type: "text",
    });

    // Immediately fetch messages for pm
    const messages = await getMessages("pm");

    // Should contain the exact message we just sent
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(sent.id);
    expect(messages[0].from).toBe("dev");
    expect(messages[0].to).toBe("pm");
    expect(messages[0].content).toBe("Hello PM");
    expect(messages[0].read).toBe(false);
  });

  it("should broadcast message visible to all recipients immediately", async () => {
    // Send broadcast message
    await sendMessage({
      from: "pm",
      to: "broadcast",
      content: "Team update",
      type: "text",
    });

    // Check that both pm and dev see it
    const pmMessages = await getMessages("pm");
    const devMessages = await getMessages("dev");

    expect(pmMessages).toHaveLength(1);
    expect(pmMessages[0].content).toBe("Team update");
    expect(pmMessages[0].to).toBe("broadcast");

    expect(devMessages).toHaveLength(1);
    expect(devMessages[0].content).toBe("Team update");
    expect(devMessages[0].to).toBe("broadcast");
  });

  it("should return all messages in chronological order", async () => {
    // Send 3 messages to pm
    await sendMessage({
      from: "dev",
      to: "pm",
      content: "First message",
      type: "text",
    });
    await sendMessage({
      from: "reviewer",
      to: "pm",
      content: "Second message",
      type: "text",
    });
    await sendMessage({
      from: "dev",
      to: "pm",
      content: "Third message",
      type: "text",
    });

    const messages = await getMessages("pm");

    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe("First message");
    expect(messages[1].content).toBe("Second message");
    expect(messages[2].content).toBe("Third message");

    // Verify chronological ordering
    const timestamps = messages.map((m) => new Date(m.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it("should include new message in unreadOnly results", async () => {
    await sendMessage({
      from: "dev",
      to: "pm",
      content: "Unread message",
      type: "text",
    });

    const unreadMessages = await getMessages("pm", true);

    expect(unreadMessages).toHaveLength(1);
    expect(unreadMessages[0].content).toBe("Unread message");
    expect(unreadMessages[0].read).toBe(false);
  });

  it("should NOT see message sent to different recipient", async () => {
    // Send message from dev to pm
    await sendMessage({
      from: "dev",
      to: "pm",
      content: "Private to PM",
      type: "text",
    });

    // dev should not see it (dev is sender, not recipient)
    const devMessages = await getMessages("dev");
    expect(devMessages).toHaveLength(0);

    // reviewer should not see it either
    const reviewerMessages = await getMessages("reviewer");
    expect(reviewerMessages).toHaveLength(0);
  });
});

describe("markAsRead → getUnreadCount 동기화", () => {
  beforeEach(() => {
    mockStorage.messages = [];
    mockStorage.readStatus = [];
    messageIdCounter = 0;
    vi.clearAllMocks();
  });

  it("should decrease unread count after markAsRead on direct messages", async () => {
    // Send 3 messages to pm
    const msg1 = await sendMessage({
      from: "dev",
      to: "pm",
      content: "Message 1",
      type: "text",
    });
    const msg2 = await sendMessage({
      from: "dev",
      to: "pm",
      content: "Message 2",
      type: "text",
    });
    const msg3 = await sendMessage({
      from: "dev",
      to: "pm",
      content: "Message 3",
      type: "text",
    });

    // Verify initial unread count
    expect(await getUnreadCount("pm")).toBe(3);

    // Mark msg1 as read
    await markAsRead("pm", msg1.id);
    expect(await getUnreadCount("pm")).toBe(2);

    // Mark msg2 as read
    await markAsRead("pm", msg2.id);
    expect(await getUnreadCount("pm")).toBe(1);

    // Mark msg3 as read
    await markAsRead("pm", msg3.id);
    expect(await getUnreadCount("pm")).toBe(0);
  });

  it("should handle broadcast markAsRead per-agent independently", async () => {
    // Send broadcast
    const broadcast = await sendMessage({
      from: "pm",
      to: "broadcast",
      content: "Team announcement",
      type: "text",
    });

    // Verify both agents see 1 unread
    expect(await getUnreadCount("pm")).toBe(1);
    expect(await getUnreadCount("dev")).toBe(1);

    // dev marks as read
    await markAsRead("dev", broadcast.id);

    // dev should have 0 unread, pm should still have 1
    expect(await getUnreadCount("dev")).toBe(0);
    expect(await getUnreadCount("pm")).toBe(1);

    // pm marks as read
    await markAsRead("pm", broadcast.id);
    expect(await getUnreadCount("pm")).toBe(0);
  });

  it("should not change count when marking already-read message", async () => {
    const msg = await sendMessage({
      from: "dev",
      to: "pm",
      content: "Test",
      type: "text",
    });

    // Mark as read once
    await markAsRead("pm", msg.id);
    expect(await getUnreadCount("pm")).toBe(0);

    // Mark as read again (idempotent)
    await markAsRead("pm", msg.id);
    expect(await getUnreadCount("pm")).toBe(0);
  });

  it("should not change count when markAsRead with wrong agentId", async () => {
    const msg = await sendMessage({
      from: "dev",
      to: "pm",
      content: "For PM only",
      type: "text",
    });

    expect(await getUnreadCount("pm")).toBe(1);

    // reviewer tries to mark pm's message as read
    await markAsRead("reviewer", msg.id);

    // pm's unread count should remain unchanged
    expect(await getUnreadCount("pm")).toBe(1);
  });

  it("should reflect multiple broadcasts with different read states", async () => {
    const broadcast1 = await sendMessage({
      from: "pm",
      to: "broadcast",
      content: "Broadcast 1",
      type: "text",
    });
    const broadcast2 = await sendMessage({
      from: "pm",
      to: "broadcast",
      content: "Broadcast 2",
      type: "text",
    });

    // Both pm and dev have 2 unread
    expect(await getUnreadCount("pm")).toBe(2);
    expect(await getUnreadCount("dev")).toBe(2);

    // dev reads broadcast1 only
    await markAsRead("dev", broadcast1.id);

    expect(await getUnreadCount("dev")).toBe(1);
    expect(await getUnreadCount("pm")).toBe(2); // unchanged

    // pm reads both
    await markAsRead("pm", broadcast1.id);
    await markAsRead("pm", broadcast2.id);

    expect(await getUnreadCount("pm")).toBe(0);
    expect(await getUnreadCount("dev")).toBe(1); // still has broadcast2 unread
  });
});

describe("동시 다발적 sendMessage 순서 보장", () => {
  beforeEach(() => {
    mockStorage.messages = [];
    mockStorage.readStatus = [];
    messageIdCounter = 0;
    vi.clearAllMocks();
  });

  it("should preserve order when sending messages concurrently", async () => {
    // Send 5 messages concurrently with small delays to ensure different timestamps
    const sends = [];
    for (let i = 0; i < 5; i++) {
      sends.push(
        (async () => {
          await new Promise((r) => setTimeout(r, i)); // stagger by i milliseconds
          return sendMessage({
            from: i % 2 === 0 ? "dev" : "reviewer",
            to: "pm",
            content: `Message ${i}`,
            type: "text",
          });
        })()
      );
    }

    await Promise.all(sends);

    // Fetch all messages
    const messages = await getMessages("pm");

    // Should have all 5 messages
    expect(messages).toHaveLength(5);

    // Verify chronological ordering by timestamp
    const timestamps = messages.map((m) => new Date(m.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it("should handle 10 concurrent messages without duplicates", async () => {
    const sends = [];
    for (let i = 0; i < 10; i++) {
      sends.push(
        (async () => {
          await new Promise((r) => setTimeout(r, i));
          return sendMessage({
            from: "dev",
            to: "pm",
            content: `Concurrent ${i}`,
            type: "text",
          });
        })()
      );
    }

    const results = await Promise.all(sends);

    // All messages should have unique IDs
    const ids = results.map((r) => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(10);

    // Verify all messages present in getMessages
    const messages = await getMessages("pm");
    expect(messages).toHaveLength(10);

    // Verify no duplicates
    const messageIds = messages.map((m) => m.id);
    const uniqueMessageIds = new Set(messageIds);
    expect(uniqueMessageIds.size).toBe(10);
  });

  it("should maintain consistent ordering with staggered timing", async () => {
    // Send messages with intentional delays
    const delays = [5, 2, 8, 1, 4]; // random delays in ms
    const sends = delays.map((delay, i) =>
      (async () => {
        await new Promise((r) => setTimeout(r, delay));
        return sendMessage({
          from: "dev",
          to: "pm",
          content: `Delayed ${i}`,
          type: "text",
        });
      })()
    );

    await Promise.all(sends);

    const messages = await getMessages("pm");
    expect(messages).toHaveLength(5);

    // Timestamps should be in ascending order
    const timestamps = messages.map((m) => new Date(m.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  it("should handle mixed broadcast and direct messages concurrently", async () => {
    const sends = [
      sendMessage({ from: "dev", to: "pm", content: "Direct 1", type: "text" }),
      sendMessage({
        from: "pm",
        to: "broadcast",
        content: "Broadcast 1",
        type: "text",
      }),
      sendMessage({
        from: "dev",
        to: "pm",
        content: "Direct 2",
        type: "text",
      }),
      sendMessage({
        from: "pm",
        to: "broadcast",
        content: "Broadcast 2",
        type: "text",
      }),
      sendMessage({
        from: "reviewer",
        to: "pm",
        content: "Direct 3",
        type: "text",
      }),
    ];

    // Add small delays
    for (let i = 0; i < sends.length; i++) {
      sends[i] = sends[i].then(async (result) => {
        await new Promise((r) => setTimeout(r, i));
        return result;
      });
    }

    await Promise.all(sends);

    // pm should see all 5 messages (3 direct + 2 broadcast)
    const pmMessages = await getMessages("pm");
    expect(pmMessages).toHaveLength(5);

    // dev should see 2 broadcasts only
    const devMessages = await getMessages("dev");
    expect(devMessages).toHaveLength(2);
    expect(devMessages.every((m) => m.to === "broadcast")).toBe(true);

    // All messages should be in chronological order
    const pmTimestamps = pmMessages.map((m) =>
      new Date(m.timestamp).getTime()
    );
    for (let i = 1; i < pmTimestamps.length; i++) {
      expect(pmTimestamps[i]).toBeGreaterThanOrEqual(pmTimestamps[i - 1]);
    }
  });

  it("should handle concurrent sends from multiple agents to same target", async () => {
    const sends = [
      sendMessage({
        from: "dev",
        to: "pm",
        content: "From dev 1",
        type: "text",
      }),
      sendMessage({
        from: "reviewer",
        to: "pm",
        content: "From reviewer 1",
        type: "text",
      }),
      sendMessage({
        from: "dev",
        to: "pm",
        content: "From dev 2",
        type: "text",
      }),
      sendMessage({
        from: "reviewer",
        to: "pm",
        content: "From reviewer 2",
        type: "text",
      }),
    ];

    // Stagger by 1ms each
    for (let i = 0; i < sends.length; i++) {
      sends[i] = sends[i].then(async (result) => {
        await new Promise((r) => setTimeout(r, i));
        return result;
      });
    }

    await Promise.all(sends);

    const messages = await getMessages("pm");
    expect(messages).toHaveLength(4);

    // Verify senders alternate or maintain order
    const senders = messages.map((m) => m.from);
    expect(senders).toContain("dev");
    expect(senders).toContain("reviewer");

    // Timestamps must be ascending
    const timestamps = messages.map((m) => new Date(m.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });
});
