import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock pg FIRST
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// Mock storage with messages and readStatus arrays
const mockStorage = {
  messages: [] as Array<{
    id: string;
    from_agent: string;
    to_agent: string | null;
    content: string;
    type: string;
    created_at: Date;
  }>,
  readStatus: [] as Array<{
    message_id: string;
    agent_id: string;
    read: boolean;
    read_at: Date | null;
  }>,
};

// Mock @/lib/db
vi.mock("@/lib/db", () => ({
  query: vi.fn((sql: string, params?: unknown[]) => {
    // INSERT INTO messages
    if (sql.includes("INSERT INTO messages")) {
      const [fromAgent, toAgent, content, type] = params as [
        string,
        string | null,
        string,
        string
      ];
      const id = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const created_at = new Date();
      mockStorage.messages.push({
        id,
        from_agent: fromAgent,
        to_agent: toAgent,
        content,
        type,
        created_at,
      });
      return Promise.resolve({
        rows: [{ id, from_agent: fromAgent, to_agent: toAgent, content, type, created_at }],
      });
    }

    // SELECT messages for getConversation
    if (sql.includes("SELECT m.*, lm.read, lm.read_at") && sql.includes("WHERE (")) {
      const limit = params?.[params.length - 1] as number;
      const [agent1, agent2] = params?.slice(0, 2) as [string, string];

      const filtered = mockStorage.messages
        .filter((m) => {
          const isDirectConvo =
            (m.from_agent === agent1 && m.to_agent === agent2) ||
            (m.from_agent === agent2 && m.to_agent === agent1);
          const isBroadcastToAgent1 = m.from_agent === agent2 && m.to_agent === null;
          const isBroadcastToAgent2 = m.from_agent === agent1 && m.to_agent === null;
          return isDirectConvo || isBroadcastToAgent1 || isBroadcastToAgent2;
        })
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime()) // DESC
        .slice(0, limit)
        .reverse(); // Then reverse

      return Promise.resolve({
        rows: filtered.map((m) => {
          const status = mockStorage.readStatus.find(
            (s) => s.message_id === m.id && s.agent_id === agent1
          );
          return {
            ...m,
            read: status?.read ?? false,
            read_at: status?.read_at ?? null,
          };
        }),
      });
    }

    // SELECT for getAllAgentsOverview
    if (sql.includes("SELECT DISTINCT")) {
      const agents = new Set<string>();
      mockStorage.messages.forEach((m) => {
        agents.add(m.from_agent);
        if (m.to_agent) agents.add(m.to_agent);
      });

      return Promise.resolve({
        rows: Array.from(agents).map((agentId) => {
          const messagesForAgent = mockStorage.messages.filter(
            (m) => m.from_agent === agentId || m.to_agent === agentId || m.to_agent === null
          );
          const latest = messagesForAgent.sort(
            (a, b) => b.created_at.getTime() - a.created_at.getTime()
          )[0];

          if (!latest) {
            return { agent_id: agentId, latest_message: null, latest_content: null, latest_read: null };
          }

          // BUG: Uses lm.read from messages table (always FALSE for broadcasts)
          // Should use message_read_status for broadcasts
          const isBroadcast = latest.to_agent === null;
          const latest_read = isBroadcast ? false : false; // Simplified bug simulation

          return {
            agent_id: agentId,
            latest_message: latest.created_at,
            latest_content: latest.content,
            latest_read,
          };
        }),
      });
    }

    return Promise.resolve({ rows: [] });
  }),
  queryOne: vi.fn(),
}));

// Mock @/lib/agents
vi.mock("@/lib/agents", () => ({
  AVAILABLE_AGENTS: [
    { id: "agent1", name: "Agent 1" },
    { id: "agent2", name: "Agent 2" },
  ],
}));

// Mock @/lib/attachments
vi.mock("@/lib/attachments", () => ({
  linkAttachmentsFromContent: vi.fn(),
}));

// Import AFTER mocks
import { sendMessage, getConversation, getAllAgentsOverview } from "@/lib/messages";

describe("messages fixes (TDD RED phase)", () => {
  beforeEach(() => {
    mockStorage.messages = [];
    mockStorage.readStatus = [];
    vi.clearAllMocks();
  });

  describe("Issue 1: sendMessage validation - empty content", () => {
    it("should reject empty string content", async () => {
      await expect(
        sendMessage({ from: "agent1", to: "agent2", content: "" })
      ).rejects.toThrow("Message content cannot be empty");
    });

    it("should reject whitespace-only content", async () => {
      await expect(
        sendMessage({ from: "agent1", to: "agent2", content: "   \n\t  " })
      ).rejects.toThrow("Message content cannot be empty");
    });

    it("should accept non-empty content", async () => {
      const result = await sendMessage({
        from: "agent1",
        to: "agent2",
        content: "Valid message",
      });
      expect(result.content).toBe("Valid message");
    });
  });

  describe("Issue 2: sendMessage validation - max length", () => {
    it("should reject content exceeding 10000 characters", async () => {
      const longContent = "a".repeat(10001);
      await expect(
        sendMessage({ from: "agent1", to: "agent2", content: longContent })
      ).rejects.toThrow("Message content exceeds maximum length");
    });

    it("should accept content exactly at 10000 characters", async () => {
      const maxContent = "a".repeat(10000);
      const result = await sendMessage({
        from: "agent1",
        to: "agent2",
        content: maxContent,
      });
      expect(result.content).toBe(maxContent);
    });

    it("should accept content under 10000 characters", async () => {
      const content = "a".repeat(9999);
      const result = await sendMessage({
        from: "agent1",
        to: "agent2",
        content,
      });
      expect(result.content).toBe(content);
    });
  });

  describe("Issue 3: toMessage type validation", () => {
    it("should handle invalid message type gracefully", async () => {
      // Simulate DB returning invalid type
      const { query } = await import("@/lib/db");
      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          {
            id: "msg1",
            from_agent: "agent1",
            to_agent: "agent2",
            content: "test",
            type: "INVALID_TYPE", // Not in Message["type"]
            created_at: new Date(),
          },
        ],
      });

      await expect(
        sendMessage({ from: "agent1", to: "agent2", content: "test" })
      ).resolves.toMatchObject({
        type: "text", // Should default to "text" or throw
      });
    });

    it("should accept valid message types", async () => {
      const validTypes = ["text", "error", "success", "command"];
      for (const type of validTypes) {
        const result = await sendMessage({
          from: "agent1",
          to: "agent2",
          content: "test",
          type: type as "text" | "error" | "success" | "command",
        });
        expect(result.type).toBe(type);
      }
    });
  });

  describe("Issue 4: getAllAgentsOverview latest_read for broadcasts", () => {
    it("should reflect message_read_status for broadcast messages, not messages.read", async () => {
      // Send broadcast from agent1
      await sendMessage({
        from: "agent1",
        to: null,
        content: "Broadcast message",
      });

      // Mark as read for agent2 in message_read_status
      const msg = mockStorage.messages[0];
      mockStorage.readStatus.push({
        message_id: msg.id,
        agent_id: "agent2",
        read: true,
        read_at: new Date(),
      });

      const overview = await getAllAgentsOverview();
      const agent2Overview = overview.find((a) => a.agent_id === "agent2");

      // EXPECTED: latest_read should be TRUE (from message_read_status)
      // ACTUAL BUG: Will be FALSE (from messages.read via lm.read)
      expect(agent2Overview?.latest_read).toBe(true);
    });

    it("should show unread for agents without message_read_status entry", async () => {
      // Send broadcast from agent1
      await sendMessage({
        from: "agent1",
        to: null,
        content: "Broadcast message",
      });

      const overview = await getAllAgentsOverview();
      const agent2Overview = overview.find((a) => a.agent_id === "agent2");

      // No readStatus entry = unread
      expect(agent2Overview?.latest_read).toBe(false);
    });
  });

  describe("Issue 5: getConversation ordering efficiency", () => {
    it("should use ORDER BY ASC with subquery instead of DESC+reverse", async () => {
      // Insert messages in order
      await sendMessage({ from: "agent1", to: "agent2", content: "msg1" });
      await sendMessage({ from: "agent2", to: "agent1", content: "msg2" });
      await sendMessage({ from: "agent1", to: "agent2", content: "msg3" });
      await sendMessage({ from: "agent2", to: "agent1", content: "msg4" });

      const { query } = await import("@/lib/db");
      const querySpy = vi.mocked(query);

      const conversation = await getConversation("agent1", "agent2", 3);

      // Check SQL call
      const sqlCall = querySpy.mock.calls.find((call) =>
        call[0].includes("SELECT m.*, lm.read, lm.read_at")
      );

      // EXPECTED: Should use ASC ordering with subquery like:
      // SELECT * FROM (SELECT ... ORDER BY created_at DESC LIMIT N) sub ORDER BY created_at ASC
      // ACTUAL BUG: Uses DESC then reverses in JS
      expect(sqlCall?.[0]).toMatch(/ORDER BY.*created_at ASC/i);
      expect(sqlCall?.[0]).not.toMatch(/\.reverse\(\)/);

      // Conversation should still be in correct order (oldest to newest)
      expect(conversation).toHaveLength(3);
      expect(conversation[0].content).toBe("msg2");
      expect(conversation[1].content).toBe("msg3");
      expect(conversation[2].content).toBe("msg4");
    });

    it("should return messages in ascending order by created_at", async () => {
      await sendMessage({ from: "agent1", to: "agent2", content: "first" });
      await new Promise((resolve) => setTimeout(resolve, 10)); // Ensure different timestamps
      await sendMessage({ from: "agent2", to: "agent1", content: "second" });
      await new Promise((resolve) => setTimeout(resolve, 10));
      await sendMessage({ from: "agent1", to: "agent2", content: "third" });

      const conversation = await getConversation("agent1", "agent2", 10);

      expect(conversation).toHaveLength(3);
      expect(conversation[0].content).toBe("first");
      expect(conversation[1].content).toBe("second");
      expect(conversation[2].content).toBe("third");

      // Verify timestamps are in ascending order
      for (let i = 1; i < conversation.length; i++) {
        expect(conversation[i].created_at.getTime()).toBeGreaterThanOrEqual(
          conversation[i - 1].created_at.getTime()
        );
      }
    });
  });
});
