/**
 * E2E-style test for frontend polling scenarios
 *
 * Simulates the actual polling behavior of the frontend:
 * - fetchMessageOverview() polls /api/messages every 3000ms
 * - fetchConversation(agentId) polls /api/messages/{agentId}?with=user every 3000ms
 * - After sendMessage, immediately refreshes conversation and overview
 *
 * All tests use the actual messages module functions to verify data flow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// Mock pg to prevent native Pool loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({
    query: vi.fn(),
  })),
}));

// Mock db
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

// Mock agents — use actual export name: getAgentIds
vi.mock("@/lib/agents", () => ({
  getAgentIds: vi.fn(() => ["pm", "dev", "qa"]),
}));

// Mock attachments
vi.mock("@/lib/attachments", () => ({
  linkAttachmentsFromContent: vi.fn(async () => {}),
  getMessageAttachments: vi.fn(async () => []),
}));

import {
  getAllAgentsOverview,
  getConversation,
  sendMessage,
  markAsRead,
} from "@/lib/messages";
import type { Message } from "@/lib/messages";
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

/**
 * Helper: set up mock implementations for the common message operations.
 * Uses a shared in-memory store to simulate PostgreSQL behavior.
 */
function setupMocks(
  messageStore: MessageRow[],
  readStatusStore: Array<{ message_id: string; agent_id: string }>
) {
  // Auto-incrementing counter for stable ordering
  let insertCounter = 0;

  // queryOne mock — used by sendMessage (INSERT RETURNING), markAsRead (SELECT, UPDATE, INSERT)
  mockQueryOne.mockImplementation(async (sql: string, params?: unknown[]) => {
    // sendMessage: INSERT INTO messages ... RETURNING
    if (sql.includes("INSERT INTO messages") && sql.includes("RETURNING")) {
      const [from_id, to_id, content, type] = params as [string, string, string, string];
      insertCounter++;
      const id = `msg-auto-${insertCounter}-${Math.random().toString(36).slice(2, 6)}`;
      // Use incrementing base time to guarantee stable ordering
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

    // markAsRead: SELECT to_id FROM messages WHERE id = $1
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

    // getUnreadCount
    if (sql.includes("COUNT(*)") && sql.includes("message_read_status")) {
      const [agentId] = params as [string];
      const directUnread = messageStore.filter(
        (m) => m.to_id === agentId && !m.read
      ).length;
      const broadcastUnread = messageStore
        .filter((m) => m.to_id === "broadcast")
        .filter((bm) => !readStatusStore.some(
          (rs) => rs.message_id === bm.id && rs.agent_id === agentId
        )).length;
      return { count: String(directUnread + broadcastUnread) };
    }

    return null;
  });

  // query mock — used by getMessages, getConversation, getAllAgentsOverview
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    // getAllAgentsOverview: unnest query
    if (sql.includes("unnest($1::text[])")) {
      const [agentIds] = params as [string[]];
      return agentIds.map((agentId) => {
        // Unread count: direct + broadcast not read
        const directUnread = messageStore.filter(
          (m) => m.to_id === agentId && !m.read
        ).length;
        const broadcastUnread = messageStore
          .filter((m) => m.to_id === "broadcast")
          .filter((bm) => !readStatusStore.some(
            (rs) => rs.message_id === bm.id && rs.agent_id === agentId
          )).length;
        const unread_count = directUnread + broadcastUnread;

        // Latest message (to this agent or broadcast)
        const agentMessages = messageStore
          .filter((m) => m.to_id === agentId || m.to_id === "broadcast")
          .sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        const latest = agentMessages[0] || null;

        // For broadcast latest, check read status
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

    // getConversation: (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)
    if (
      sql.includes("(from_id = $1 AND to_id = $2)") ||
      sql.includes("(from_id = $2 AND to_id = $1)")
    ) {
      const agent1 = params![0] as string;
      const agent2 = params![1] as string;
      // Param index for limit depends on whether 'since' variant is used
      const hasCreatedAtFilter = sql.includes("created_at >");
      const limitIdx = hasCreatedAtFilter ? 3 : 2;
      const limit = (params![limitIdx] as number) || 50;

      const conversationMessages = messageStore
        .filter(
          (m) =>
            (m.from_id === agent1 && m.to_id === agent2) ||
            (m.from_id === agent2 && m.to_id === agent1)
        )
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );

      // The real query uses ORDER BY created_at DESC LIMIT $3, then code reverses
      // Mock returns DESC order (like real DB), the actual code reverses it
      const descSorted = [...conversationMessages].reverse().slice(0, limit);
      return descSorted;
    }

    // getMessages: LEFT JOIN message_read_status
    if (sql.includes("LEFT JOIN message_read_status")) {
      const [agentId] = params as [string];
      const directMessages = messageStore.filter((m) => m.to_id === agentId);
      const broadcastMessages = messageStore.filter((m) => m.to_id === "broadcast");

      const allMessages = [
        ...directMessages,
        ...broadcastMessages.map((bm) => {
          const isRead = readStatusStore.some(
            (rs) => rs.message_id === bm.id && rs.agent_id === agentId
          );
          return { ...bm, read: isRead };
        }),
      ].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      return allMessages;
    }

    return [];
  });
}

describe("프론트엔드 폴링: fetchMessageOverview 시나리오", () => {
  let messageStore: MessageRow[] = [];
  let readStatusStore: Array<{ message_id: string; agent_id: string }> = [];

  beforeEach(() => {
    messageStore = [];
    readStatusStore = [];
    vi.clearAllMocks();
    setupMocks(messageStore, readStatusStore);
  });

  it("초기 상태: 모든 에이전트 unread = 0", async () => {
    const overview = await getAllAgentsOverview();

    expect(overview).toEqual({
      pm: { unread: 0 },
      dev: { unread: 0 },
      qa: { unread: 0 },
    });
  });

  it("dev → pm 메시지 전송 후: pm.unread = 1, latest 업데이트", async () => {
    await sendMessage({
      from: "dev",
      to: "pm",
      content: "Task completed",
      type: "text",
    });

    const overview = await getAllAgentsOverview();

    expect(overview.pm.unread).toBe(1);
    expect(overview.pm.latest).toMatchObject({
      from: "dev",
      to: "pm",
      content: "Task completed",
    });
    expect(overview.dev.unread).toBe(0);
    expect(overview.qa.unread).toBe(0);
  });

  it("qa → pm 추가 메시지 전송: pm.unread = 2", async () => {
    await sendMessage({
      from: "dev",
      to: "pm",
      content: "First message",
      type: "text",
    });

    await sendMessage({
      from: "qa",
      to: "pm",
      content: "Second message",
      type: "text",
    });

    const overview = await getAllAgentsOverview();

    expect(overview.pm.unread).toBe(2);
    expect(overview.pm.latest).toMatchObject({
      from: "qa",
      to: "pm",
      content: "Second message",
    });
  });

  it("markAsRead 후: pm.unread 감소", async () => {
    const msg1 = await sendMessage({
      from: "dev",
      to: "pm",
      content: "Message 1",
      type: "text",
    });

    const msg2 = await sendMessage({
      from: "qa",
      to: "pm",
      content: "Message 2",
      type: "text",
    });

    let overview = await getAllAgentsOverview();
    expect(overview.pm.unread).toBe(2);

    await markAsRead("pm", msg1.id);

    overview = await getAllAgentsOverview();
    expect(overview.pm.unread).toBe(1);

    await markAsRead("pm", msg2.id);

    overview = await getAllAgentsOverview();
    expect(overview.pm.unread).toBe(0);
  });

  it("모든 메시지 읽은 후: pm.unread = 0, latest는 유지", async () => {
    const msg = await sendMessage({
      from: "dev",
      to: "pm",
      content: "Final message",
      type: "text",
    });

    await markAsRead("pm", msg.id);

    const overview = await getAllAgentsOverview();

    expect(overview.pm.unread).toBe(0);
    expect(overview.pm.latest).toMatchObject({
      from: "dev",
      to: "pm",
      content: "Final message",
      read: true,
    });
  });
});

describe("프론트엔드 폴링: fetchConversation 시나리오", () => {
  let messageStore: MessageRow[] = [];
  let readStatusStore: Array<{ message_id: string; agent_id: string }> = [];

  beforeEach(() => {
    messageStore = [];
    readStatusStore = [];
    vi.clearAllMocks();
    setupMocks(messageStore, readStatusStore);
  });

  it("초기 상태: 대화 내역 없음", async () => {
    const conversation = await getConversation("pm", "user");
    expect(conversation).toEqual([]);
  });

  it("user → pm 메시지 전송 후: 대화에 표시", async () => {
    const sent = await sendMessage({
      from: "user",
      to: "pm",
      content: "Hello PM",
      type: "text",
    });

    const conversation = await getConversation("pm", "user");

    expect(conversation).toHaveLength(1);
    expect(conversation[0]).toMatchObject({
      id: sent.id,
      from: "user",
      to: "pm",
      content: "Hello PM",
    });
  });

  it("pm → user 응답 후: 대화에 시간순 정렬", async () => {
    // Use explicit created_at via store manipulation for ordering
    const msg1 = await sendMessage({
      from: "user",
      to: "pm",
      content: "Question",
      type: "text",
    });
    // Force ordering in store
    const row1 = messageStore.find((m) => m.id === msg1.id)!;
    row1.created_at = "2024-01-01T10:00:00.000Z";

    const msg2 = await sendMessage({
      from: "pm",
      to: "user",
      content: "Answer",
      type: "text",
    });
    const row2 = messageStore.find((m) => m.id === msg2.id)!;
    row2.created_at = "2024-01-01T10:01:00.000Z";

    const conversation = await getConversation("pm", "user");

    expect(conversation).toHaveLength(2);
    expect(conversation[0].id).toBe(msg1.id);
    expect(conversation[1].id).toBe(msg2.id);
  });

  it("브로드캐스트 메시지는 대화에 표시되지 않음", async () => {
    const msg1 = await sendMessage({
      from: "user",
      to: "pm",
      content: "Direct message",
      type: "text",
    });
    const row1 = messageStore.find((m) => m.id === msg1.id)!;
    row1.created_at = "2024-01-01T10:00:00.000Z";

    await sendMessage({
      from: "system",
      to: "broadcast",
      content: "System announcement",
      type: "text",
    });

    const msg3 = await sendMessage({
      from: "pm",
      to: "user",
      content: "Response",
      type: "text",
    });
    const row3 = messageStore.find((m) => m.id === msg3.id)!;
    row3.created_at = "2024-01-01T10:02:00.000Z";

    const conversation = await getConversation("pm", "user");

    expect(conversation).toHaveLength(2);
    expect(conversation[0].id).toBe(msg1.id);
    expect(conversation[1].id).toBe(msg3.id);
    // broadcast should not appear in pm<->user conversation
    expect(conversation.some((m) => m.content === "System announcement")).toBe(false);
  });

  it("다른 에이전트 메시지는 대화에 표시되지 않음", async () => {
    await sendMessage({
      from: "dev",
      to: "qa",
      content: "Dev to QA",
      type: "text",
    });

    await sendMessage({
      from: "user",
      to: "pm",
      content: "User to PM",
      type: "text",
    });

    const pmUserConversation = await getConversation("pm", "user");
    expect(pmUserConversation).toHaveLength(1);
    expect(pmUserConversation[0].content).toBe("User to PM");

    const devQaConversation = await getConversation("dev", "qa");
    expect(devQaConversation).toHaveLength(1);
    expect(devQaConversation[0].content).toBe("Dev to QA");
  });

  it("limit 파라미터 동작: 최신 N개만 반환", async () => {
    for (let i = 1; i <= 5; i++) {
      const msg = await sendMessage({
        from: "user",
        to: "pm",
        content: `Message ${i}`,
        type: "text",
      });
      const row = messageStore.find((m) => m.id === msg.id)!;
      row.created_at = `2024-01-01T10:0${i}:00.000Z`;
    }

    const conversation = await getConversation("pm", "user", 3);

    expect(conversation).toHaveLength(3);
    expect(conversation[0].content).toBe("Message 3");
    expect(conversation[1].content).toBe("Message 4");
    expect(conversation[2].content).toBe("Message 5");
  });
});

describe("프론트엔드 폴링: 새 메시지 감지", () => {
  let messageStore: MessageRow[] = [];
  let readStatusStore: Array<{ message_id: string; agent_id: string }> = [];

  beforeEach(() => {
    messageStore = [];
    readStatusStore = [];
    vi.clearAllMocks();
    setupMocks(messageStore, readStatusStore);
  });

  it("초기 폴링: 모든 에이전트 unread = 0", async () => {
    const overview = await getAllAgentsOverview();

    expect(overview.pm.unread).toBe(0);
    expect(overview.dev.unread).toBe(0);
    expect(overview.qa.unread).toBe(0);
  });

  it("다른 에이전트가 메시지 전송: 다음 폴링에서 감지", async () => {
    // 첫 번째 폴링
    let overview = await getAllAgentsOverview();
    expect(overview.pm.unread).toBe(0);

    // 다른 에이전트가 메시지 전송 (시뮬레이션)
    await sendMessage({
      from: "dev",
      to: "pm",
      content: "New task assigned",
      type: "task",
    });

    // 두 번째 폴링 (3초 후 시뮬레이션)
    overview = await getAllAgentsOverview();
    expect(overview.pm.unread).toBe(1);
    expect(overview.pm.latest?.content).toBe("New task assigned");
  });

  it("latest 필드 업데이트: 가장 최근 메시지로 교체", async () => {
    const msg1 = await sendMessage({
      from: "dev",
      to: "pm",
      content: "First message",
      type: "text",
    });
    const row1 = messageStore.find((m) => m.id === msg1.id)!;
    row1.created_at = "2024-01-01T10:00:00.000Z";

    let overview = await getAllAgentsOverview();
    expect(overview.pm.latest?.content).toBe("First message");

    const msg2 = await sendMessage({
      from: "qa",
      to: "pm",
      content: "Second message",
      type: "text",
    });
    const row2 = messageStore.find((m) => m.id === msg2.id)!;
    row2.created_at = "2024-01-01T10:01:00.000Z";

    overview = await getAllAgentsOverview();
    expect(overview.pm.latest?.content).toBe("Second message");
  });

  it("totalUnread 계산: 모든 에이전트 unread 합산", async () => {
    await sendMessage({ from: "user", to: "pm", content: "To PM 1", type: "text" });
    await sendMessage({ from: "user", to: "pm", content: "To PM 2", type: "text" });
    await sendMessage({ from: "user", to: "dev", content: "To Dev", type: "text" });
    await sendMessage({ from: "user", to: "qa", content: "To QA 1", type: "text" });
    await sendMessage({ from: "user", to: "qa", content: "To QA 2", type: "text" });
    await sendMessage({ from: "user", to: "qa", content: "To QA 3", type: "text" });

    const overview = await getAllAgentsOverview();

    const totalUnread =
      overview.pm.unread + overview.dev.unread + overview.qa.unread;

    expect(overview.pm.unread).toBe(2);
    expect(overview.dev.unread).toBe(1);
    expect(overview.qa.unread).toBe(3);
    expect(totalUnread).toBe(6);
  });

  it("브로드캐스트 메시지: 모든 에이전트에게 unread 증가", async () => {
    await sendMessage({
      from: "system",
      to: "broadcast",
      content: "System announcement",
      type: "text",
    });

    const overview = await getAllAgentsOverview();

    expect(overview.pm.unread).toBe(1);
    expect(overview.dev.unread).toBe(1);
    expect(overview.qa.unread).toBe(1);
    expect(overview.pm.latest?.content).toBe("System announcement");
    expect(overview.dev.latest?.content).toBe("System announcement");
    expect(overview.qa.latest?.content).toBe("System announcement");
  });
});

describe("프론트엔드 폴링: 메시지 전송 후 즉시 반영", () => {
  let messageStore: MessageRow[] = [];
  let readStatusStore: Array<{ message_id: string; agent_id: string }> = [];

  beforeEach(() => {
    messageStore = [];
    readStatusStore = [];
    vi.clearAllMocks();
    setupMocks(messageStore, readStatusStore);
  });

  it("sendMessage → fetchConversation: 즉시 표시", async () => {
    const sent = await sendMessage({
      from: "user",
      to: "pm",
      content: "New message",
      type: "text",
    });

    // 프론트엔드가 즉시 fetchConversation 호출
    const conversation = await getConversation("pm", "user");

    expect(conversation).toHaveLength(1);
    expect(conversation[0].id).toBe(sent.id);
    expect(conversation[0].content).toBe("New message");
  });

  it("sendMessage → fetchMessageOverview: 즉시 업데이트", async () => {
    await sendMessage({
      from: "user",
      to: "dev",
      content: "Task assigned",
      type: "task",
    });

    // 프론트엔드가 즉시 fetchMessageOverview 호출
    const overview = await getAllAgentsOverview();

    expect(overview.dev.unread).toBe(1);
    expect(overview.dev.latest?.content).toBe("Task assigned");
  });

  it("연속 빠른 전송: 모두 다음 폴링에 반영", async () => {
    // 빠르게 3개 메시지 전송
    const msgs = [];
    for (let i = 1; i <= 3; i++) {
      const msg = await sendMessage({
        from: "user",
        to: "pm",
        content: `Message ${i}`,
        type: "text",
      });
      const row = messageStore.find((m) => m.id === msg.id)!;
      row.created_at = `2024-01-01T10:00:0${i}.000Z`;
      msgs.push(msg);
    }

    // 즉시 폴링
    const conversation = await getConversation("pm", "user");
    const overview = await getAllAgentsOverview();

    expect(conversation).toHaveLength(3);
    expect(overview.pm.unread).toBe(3);
    expect(overview.pm.latest?.content).toBe("Message 3");
  });

  it("전송 후 markAsRead: 바로 unread 감소", async () => {
    const msg = await sendMessage({
      from: "dev",
      to: "pm",
      content: "Notification",
      type: "text",
    });

    let overview = await getAllAgentsOverview();
    expect(overview.pm.unread).toBe(1);

    await markAsRead("pm", msg.id);

    overview = await getAllAgentsOverview();
    expect(overview.pm.unread).toBe(0);
  });
});

describe("프론트엔드 폴링: 동시 폴링 간섭 없음", () => {
  let messageStore: MessageRow[] = [];
  let readStatusStore: Array<{ message_id: string; agent_id: string }> = [];

  beforeEach(() => {
    messageStore = [];
    readStatusStore = [];
    vi.clearAllMocks();
    setupMocks(messageStore, readStatusStore);
  });

  it("동시 폴링: overview와 conversation 일관성", async () => {
    await sendMessage({
      from: "user",
      to: "pm",
      content: "Test message",
      type: "text",
    });

    // 동시에 두 API 호출 시뮬레이션
    const [overview, conversation] = await Promise.all([
      getAllAgentsOverview(),
      getConversation("pm", "user"),
    ]);

    expect(overview.pm.unread).toBe(1);
    expect(overview.pm.latest?.content).toBe("Test message");
    expect(conversation).toHaveLength(1);
    expect(conversation[0].content).toBe("Test message");
  });

  it("폴링 중 markAsRead: 불일치 없음", async () => {
    const msg = await sendMessage({
      from: "dev",
      to: "pm",
      content: "Important",
      type: "text",
    });

    // 폴링과 markAsRead 동시 실행
    const [overviewBefore] = await Promise.all([
      getAllAgentsOverview(),
      markAsRead("pm", msg.id),
    ]);

    const overviewAfter = await getAllAgentsOverview();

    // markAsRead 전: unread = 1
    expect(overviewBefore.pm.unread).toBe(1);

    // markAsRead 후: unread = 0
    expect(overviewAfter.pm.unread).toBe(0);
  });

  it("여러 에이전트 동시 폴링: 각자 독립적", async () => {
    await sendMessage({
      from: "user",
      to: "pm",
      content: "To PM",
      type: "text",
    });

    await sendMessage({
      from: "user",
      to: "dev",
      content: "To Dev",
      type: "text",
    });

    // 여러 대화 동시 폴링
    const [pmConv, devConv, qaConv] = await Promise.all([
      getConversation("pm", "user"),
      getConversation("dev", "user"),
      getConversation("qa", "user"),
    ]);

    expect(pmConv).toHaveLength(1);
    expect(pmConv[0].content).toBe("To PM");

    expect(devConv).toHaveLength(1);
    expect(devConv[0].content).toBe("To Dev");

    expect(qaConv).toHaveLength(0);
  });

  it("고빈도 폴링: 데이터 안정성", async () => {
    await sendMessage({
      from: "user",
      to: "pm",
      content: "Message",
      type: "text",
    });

    // 10번 연속 폴링
    const results = await Promise.all(
      Array(10)
        .fill(null)
        .map(() => getAllAgentsOverview())
    );

    // 모든 결과가 동일해야 함
    results.forEach((overview) => {
      expect(overview.pm.unread).toBe(1);
      expect(overview.pm.latest?.content).toBe("Message");
    });
  });

  it("pollingInterval보다 빠른 메시지 전송: 모두 캡처", async () => {
    // 5개 메시지를 순서대로 전송
    for (let i = 1; i <= 5; i++) {
      const msg = await sendMessage({
        from: "dev",
        to: "pm",
        content: `Rapid message ${i}`,
        type: "text",
      });
      const row = messageStore.find((m) => m.id === msg.id)!;
      row.created_at = `2024-01-01T10:00:00.${String(i).padStart(3, "0")}Z`;
    }

    // 폴링 시뮬레이션 (3초 후)
    const overview = await getAllAgentsOverview();
    const conversation = await getConversation("pm", "dev");

    expect(overview.pm.unread).toBe(5);
    expect(conversation).toHaveLength(5);
    expect(overview.pm.latest?.content).toBe("Rapid message 5");
  });
});
