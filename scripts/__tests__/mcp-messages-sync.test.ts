import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({ Pool: vi.fn(() => ({ query: vi.fn() })) }));

// In-memory message store for simulating state
interface StoredMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  type: string;
  read: boolean;
  timestamp: string;
}

let messageStore: StoredMessage[] = [];
let messageIdCounter = 1;

const mockFetch = vi.fn(async (url: string, options?: RequestInit) => {
  const urlObj = new URL(url);
  const pathname = urlObj.pathname;

  // POST /api/relay/messages - Send message
  if (options?.method === "POST" && pathname === "/api/relay/messages") {
    const body = JSON.parse(options.body as string);
    const newMessage: StoredMessage = {
      id: `msg-${messageIdCounter++}`,
      from: body.from,
      to: body.to,
      content: body.content,
      type: body.type || "task",
      read: false,
      timestamp: new Date().toISOString(),
    };
    messageStore.push(newMessage);

    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: newMessage }),
    } as Response;
  }

  // PATCH /api/messages/[agentId] - Mark as read
  if (options?.method === "PATCH" && pathname.startsWith("/api/messages/")) {
    const agentId = pathname.split("/").pop();
    const body = JSON.parse(options.body as string);
    const messageIds = body.messageIds || [];

    messageStore = messageStore.map((msg) =>
      messageIds.includes(msg.id) && msg.to === agentId
        ? { ...msg, read: true }
        : msg
    );

    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response;
  }

  // GET /api/relay/messages - Get messages
  if (pathname === "/api/relay/messages") {
    const agentId = urlObj.searchParams.get("agentId");
    const unreadOnly = urlObj.searchParams.get("unreadOnly") === "true";

    let filtered = messageStore;
    if (agentId) {
      filtered = filtered.filter((msg) => msg.to === agentId);
    }
    if (unreadOnly) {
      filtered = filtered.filter((msg) => !msg.read);
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        messages: filtered,
        total: filtered.length,
      }),
    } as Response;
  }

  // Default 404
  return {
    ok: false,
    status: 404,
    json: async () => ({ error: "Not found" }),
  } as Response;
});

vi.stubGlobal("fetch", mockFetch);

// Import MCP server after mocking
const { server } = await import("../mcp-server.js");

// Helper to simulate MCP tool calls
async function callTool(name: string, args: Record<string, unknown>) {
  // Simulate a CallToolRequest
  const request = {
    method: "tools/call" as const,
    params: {
      name,
      arguments: args,
    },
  };

  // Use the server's request handler directly
  // @ts-expect-error - accessing private handler for testing
  const handler = server._requestHandlers?.get("tools/call");
  if (!handler) {
    throw new Error("CallTool handler not registered");
  }

  return await handler(request);
}

describe("MCP dashboard_get_messages: 최신 상태 반환 (Fresh State Returns)", () => {
  beforeEach(() => {
    messageStore = [];
    messageIdCounter = 1;
    mockFetch.mockClear();
  });

  it("새 메시지 전송 후 MCP get이 최신 메시지를 반환", async () => {
    // Simulate sending a message via POST
    await mockFetch("http://localhost:3000/api/relay/messages", {
      method: "POST",
      body: JSON.stringify({
        from: "orchestrator",
        to: "executor-low",
        content: "Process this task",
        type: "task",
      }),
    });

    // MCP get_messages
    const result = (await callTool("dashboard_get_messages", {
      agentId: "executor-low",
    })) as CallToolResult;

    expect(result.content[0].type).toBe("text");
    const data = JSON.parse((result.content[0] as { text: string }).text);

    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].from).toBe("orchestrator");
    expect(data.messages[0].to).toBe("executor-low");
    expect(data.messages[0].content).toBe("Process this task");
    expect(data.messages[0].read).toBe(false);
  });

  it("markAsRead 후 MCP get with unreadOnly가 읽은 메시지를 제외", async () => {
    // Send message
    await mockFetch("http://localhost:3000/api/relay/messages", {
      method: "POST",
      body: JSON.stringify({
        from: "orchestrator",
        to: "qa-tester",
        content: "Run tests",
        type: "task",
      }),
    });

    // Get message ID
    const getResult1 = (await callTool("dashboard_get_messages", {
      agentId: "qa-tester",
    })) as CallToolResult;
    const data1 = JSON.parse((getResult1.content[0] as { text: string }).text);
    const messageId = data1.messages[0].id;

    // Mark as read
    await mockFetch("http://localhost:3000/api/messages/qa-tester", {
      method: "PATCH",
      body: JSON.stringify({ messageIds: [messageId] }),
    });

    // Get with unreadOnly=true
    const getResult2 = (await callTool("dashboard_get_messages", {
      agentId: "qa-tester",
      unreadOnly: true,
    })) as CallToolResult;
    const data2 = JSON.parse((getResult2.content[0] as { text: string }).text);

    expect(data2.messages).toHaveLength(0);
  });

  it("3개 메시지 전송 후 MCP get이 모두 반환", async () => {
    // Send 3 messages
    for (let i = 1; i <= 3; i++) {
      await mockFetch("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: JSON.stringify({
          from: "orchestrator",
          to: "architect",
          content: `Task ${i}`,
          type: "task",
        }),
      });
    }

    // MCP get_messages
    const result = (await callTool("dashboard_get_messages", {
      agentId: "architect",
    })) as CallToolResult;
    const data = JSON.parse((result.content[0] as { text: string }).text);

    expect(data.messages).toHaveLength(3);
    expect(data.messages[0].content).toBe("Task 1");
    expect(data.messages[1].content).toBe("Task 2");
    expect(data.messages[2].content).toBe("Task 3");
  });

  it("MCP 응답이 실시간 read 상태 변경 반영", async () => {
    // Send 2 messages
    await mockFetch("http://localhost:3000/api/relay/messages", {
      method: "POST",
      body: JSON.stringify({
        from: "orchestrator",
        to: "designer",
        content: "Message 1",
        type: "task",
      }),
    });
    await mockFetch("http://localhost:3000/api/relay/messages", {
      method: "POST",
      body: JSON.stringify({
        from: "orchestrator",
        to: "designer",
        content: "Message 2",
        type: "task",
      }),
    });

    // Get all messages
    const getResult1 = (await callTool("dashboard_get_messages", {
      agentId: "designer",
    })) as CallToolResult;
    const data1 = JSON.parse((getResult1.content[0] as { text: string }).text);
    expect(data1.messages).toHaveLength(2);
    expect(data1.messages.every((m: StoredMessage) => !m.read)).toBe(true);

    // Mark first message as read
    const messageId = data1.messages[0].id;
    await mockFetch("http://localhost:3000/api/messages/designer", {
      method: "PATCH",
      body: JSON.stringify({ messageIds: [messageId] }),
    });

    // Get again
    const getResult2 = (await callTool("dashboard_get_messages", {
      agentId: "designer",
    })) as CallToolResult;
    const data2 = JSON.parse((getResult2.content[0] as { text: string }).text);

    expect(data2.messages).toHaveLength(2);
    expect(data2.messages.find((m: StoredMessage) => m.id === messageId).read).toBe(true);
    expect(data2.messages.find((m: StoredMessage) => m.id !== messageId).read).toBe(false);
  });
});

describe("MCP dashboard_get_messages: 엔드-투-엔드 데이터 동기화 (E2E Data Sync)", () => {
  beforeEach(() => {
    messageStore = [];
    messageIdCounter = 1;
    mockFetch.mockClear();
  });

  it("dashboard_send_message → dashboard_get_messages 전체 라운드트립", async () => {
    // Send message via MCP
    const sendResult = (await callTool("dashboard_send_message", {
      from: "orchestrator",
      to: "executor",
      content: "Build the feature",
      type: "task",
    })) as CallToolResult;

    const sendData = JSON.parse((sendResult.content[0] as { text: string }).text);
    expect(sendData.success).toBe(true);

    // Get messages via MCP
    const getResult = (await callTool("dashboard_get_messages", {
      agentId: "executor",
    })) as CallToolResult;
    const getData = JSON.parse((getResult.content[0] as { text: string }).text);

    expect(getData.messages).toHaveLength(1);
    expect(getData.messages[0].from).toBe("orchestrator");
    expect(getData.messages[0].to).toBe("executor");
    expect(getData.messages[0].content).toBe("Build the feature");
    expect(getData.messages[0].type).toBe("task");
  });

  it("agentId 필터링: pm에 보낸 메시지가 dev에 보이지 않음", async () => {
    // Send to pm
    await callTool("dashboard_send_message", {
      from: "orchestrator",
      to: "pm",
      content: "Plan this feature",
      type: "task",
    });

    // Send to dev
    await callTool("dashboard_send_message", {
      from: "orchestrator",
      to: "dev",
      content: "Implement this feature",
      type: "task",
    });

    // Get messages for dev
    const devResult = (await callTool("dashboard_get_messages", {
      agentId: "dev",
    })) as CallToolResult;
    const devData = JSON.parse((devResult.content[0] as { text: string }).text);

    expect(devData.messages).toHaveLength(1);
    expect(devData.messages[0].to).toBe("dev");
    expect(devData.messages[0].content).toBe("Implement this feature");

    // Get messages for pm
    const pmResult = (await callTool("dashboard_get_messages", {
      agentId: "pm",
    })) as CallToolResult;
    const pmData = JSON.parse((pmResult.content[0] as { text: string }).text);

    expect(pmData.messages).toHaveLength(1);
    expect(pmData.messages[0].to).toBe("pm");
    expect(pmData.messages[0].content).toBe("Plan this feature");
  });

  it("unreadOnly 파라미터: markAsRead 후 필터링", async () => {
    // Send message
    await callTool("dashboard_send_message", {
      from: "orchestrator",
      to: "writer",
      content: "Write docs",
      type: "task",
    });

    // Get message to obtain ID
    const getResult1 = (await callTool("dashboard_get_messages", {
      agentId: "writer",
    })) as CallToolResult;
    const data1 = JSON.parse((getResult1.content[0] as { text: string }).text);
    const messageId = data1.messages[0].id;

    // Mark as read
    await mockFetch("http://localhost:3000/api/messages/writer", {
      method: "PATCH",
      body: JSON.stringify({ messageIds: [messageId] }),
    });

    // Get with unreadOnly=true
    const getResult2 = (await callTool("dashboard_get_messages", {
      agentId: "writer",
      unreadOnly: true,
    })) as CallToolResult;
    const data2 = JSON.parse((getResult2.content[0] as { text: string }).text);

    expect(data2.messages).toHaveLength(0);

    // Get with unreadOnly=false (default)
    const getResult3 = (await callTool("dashboard_get_messages", {
      agentId: "writer",
    })) as CallToolResult;
    const data3 = JSON.parse((getResult3.content[0] as { text: string }).text);

    expect(data3.messages).toHaveLength(1);
    expect(data3.messages[0].read).toBe(true);
  });

  it("MCP content format이 모든 메시지 필드를 보존", async () => {
    // Send message with all fields
    await callTool("dashboard_send_message", {
      from: "planner",
      to: "executor-high",
      content: "Complex refactoring task",
      type: "task",
    });

    // Get messages
    const result = (await callTool("dashboard_get_messages", {
      agentId: "executor-high",
    })) as CallToolResult;

    expect(result.content[0].type).toBe("text");
    const data = JSON.parse((result.content[0] as { text: string }).text);

    expect(data.messages).toHaveLength(1);
    const msg = data.messages[0];
    expect(msg).toHaveProperty("id");
    expect(msg).toHaveProperty("from");
    expect(msg).toHaveProperty("to");
    expect(msg).toHaveProperty("content");
    expect(msg).toHaveProperty("type");
    expect(msg).toHaveProperty("read");
    expect(msg).toHaveProperty("timestamp");

    expect(msg.from).toBe("planner");
    expect(msg.to).toBe("executor-high");
    expect(msg.content).toBe("Complex refactoring task");
    expect(msg.type).toBe("task");
    expect(msg.read).toBe(false);
  });
});

describe("MCP dashboard_get_messages: 동시성 일관성 (Concurrency Consistency)", () => {
  beforeEach(() => {
    messageStore = [];
    messageIdCounter = 1;
    mockFetch.mockClear();
  });

  it("동일 에이전트에 대한 동시 MCP get_messages 호출이 같은 데이터 반환", async () => {
    // Send 2 messages
    await callTool("dashboard_send_message", {
      from: "orchestrator",
      to: "scientist",
      content: "Message 1",
      type: "task",
    });
    await callTool("dashboard_send_message", {
      from: "orchestrator",
      to: "scientist",
      content: "Message 2",
      type: "task",
    });

    // Concurrent get calls
    const [result1, result2, result3] = await Promise.all([
      callTool("dashboard_get_messages", {
        agentId: "scientist",
      }),
      callTool("dashboard_get_messages", {
        agentId: "scientist",
      }),
      callTool("dashboard_get_messages", {
        agentId: "scientist",
      }),
    ]);

    const data1 = JSON.parse(((result1 as CallToolResult).content[0] as { text: string }).text);
    const data2 = JSON.parse(((result2 as CallToolResult).content[0] as { text: string }).text);
    const data3 = JSON.parse(((result3 as CallToolResult).content[0] as { text: string }).text);

    expect(data1.messages).toHaveLength(2);
    expect(data2.messages).toHaveLength(2);
    expect(data3.messages).toHaveLength(2);

    // All should return same message IDs
    const ids1 = data1.messages.map((m: StoredMessage) => m.id).sort();
    const ids2 = data2.messages.map((m: StoredMessage) => m.id).sort();
    const ids3 = data3.messages.map((m: StoredMessage) => m.id).sort();

    expect(ids1).toEqual(ids2);
    expect(ids2).toEqual(ids3);
  });

  it("send + get 동시 발생 시 get이 최종적으로 sent 메시지를 반환", async () => {
    // Start with 1 message
    await callTool("dashboard_send_message", {
      from: "orchestrator",
      to: "vision",
      content: "Initial message",
      type: "task",
    });

    // Concurrent send and get
    await Promise.all([
      callTool("dashboard_send_message", {
        from: "orchestrator",
        to: "vision",
        content: "Concurrent message",
        type: "task",
      }),
      callTool("dashboard_get_messages", {
        agentId: "vision",
      }),
    ]);

    // Final get should see both messages
    const finalResult = (await callTool("dashboard_get_messages", {
      agentId: "vision",
    })) as CallToolResult;
    const finalData = JSON.parse((finalResult.content[0] as { text: string }).text);

    expect(finalData.messages).toHaveLength(2);
    const contents = finalData.messages.map((m: StoredMessage) => m.content);
    expect(contents).toContain("Initial message");
    expect(contents).toContain("Concurrent message");
  });

  it("여러 에이전트에 동시 전송 후 각각 독립적으로 조회", async () => {
    // Send to multiple agents concurrently
    await Promise.all([
      callTool("dashboard_send_message", {
        from: "orchestrator",
        to: "agent-a",
        content: "Task for A",
        type: "task",
      }),
      callTool("dashboard_send_message", {
        from: "orchestrator",
        to: "agent-b",
        content: "Task for B",
        type: "task",
      }),
      callTool("dashboard_send_message", {
        from: "orchestrator",
        to: "agent-c",
        content: "Task for C",
        type: "task",
      }),
    ]);

    // Get messages for each agent
    const [resultA, resultB, resultC] = await Promise.all([
      callTool("dashboard_get_messages", {
        agentId: "agent-a",
      }),
      callTool("dashboard_get_messages", {
        agentId: "agent-b",
      }),
      callTool("dashboard_get_messages", {
        agentId: "agent-c",
      }),
    ]);

    const dataA = JSON.parse(((resultA as CallToolResult).content[0] as { text: string }).text);
    const dataB = JSON.parse(((resultB as CallToolResult).content[0] as { text: string }).text);
    const dataC = JSON.parse(((resultC as CallToolResult).content[0] as { text: string }).text);

    expect(dataA.messages).toHaveLength(1);
    expect(dataA.messages[0].content).toBe("Task for A");

    expect(dataB.messages).toHaveLength(1);
    expect(dataB.messages[0].content).toBe("Task for B");

    expect(dataC.messages).toHaveLength(1);
    expect(dataC.messages[0].content).toBe("Task for C");
  });
});
