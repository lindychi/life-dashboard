import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// Mock auth module
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

// Mock db module
vi.mock("@/lib/db", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  pool: {},
  isDbConnectionError: vi.fn(() => false),
}));

// Mock messages module
vi.mock("@/lib/messages", () => ({
  sendMessage: vi.fn(),
  getMessages: vi.fn(),
  getConversation: vi.fn(),
  markAsRead: vi.fn(),
  getAllAgentsOverview: vi.fn(),
  getUnreadCount: vi.fn(),
}));

// Mock attachments (transitive dependency)
vi.mock("@/lib/attachments", () => ({
  linkAttachmentsFromContent: vi.fn(async () => []),
  getMessageAttachments: vi.fn(async () => []),
  parseFileReferences: vi.fn(() => []),
}));

// Mock agents (transitive dependency)
vi.mock("@/lib/agents", () => ({
  getAgentIds: vi.fn(() => ["pm", "dev", "reviewer"]),
}));

import { getCurrentUser } from "@/lib/auth";
import {
  sendMessage,
  getMessages,
  getConversation,
  markAsRead,
  getAllAgentsOverview,
} from "@/lib/messages";
import { isDbConnectionError } from "@/lib/db";

// Helper to create NextRequest
function createRequest(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Request {
  const { method = "GET", body, headers = {} } = options;
  return new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// =========================================================================
// /api/messages (POST and GET)
// =========================================================================
describe("POST /api/messages", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamic import to get fresh module with mocks
    const mod = await import("@/app/api/messages/route");
    POST = mod.POST as unknown as (req: Request) => Promise<Response>;
  });

  it("should return 401 when user is not authenticated", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const req = createRequest("http://localhost:3000/api/messages", {
      method: "POST",
      body: { from: "dev", to: "pm", content: "test", type: "text" },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("should return 400 when required fields are missing", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@test.com",
    });

    const req = createRequest("http://localhost:3000/api/messages", {
      method: "POST",
      body: { from: "dev" }, // missing to, content, type
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Missing required fields");
  });

  it("should return 400 for invalid message type", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@test.com",
    });

    const req = createRequest("http://localhost:3000/api/messages", {
      method: "POST",
      body: { from: "dev", to: "pm", content: "test", type: "invalid_type" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("Invalid type");
  });

  it("should send message successfully with valid payload", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@test.com",
    });
    (sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "msg-1",
      from: "dev",
      to: "pm",
      content: "Build done",
      type: "text",
      read: false,
      timestamp: new Date().toISOString(),
    });

    const req = createRequest("http://localhost:3000/api/messages", {
      method: "POST",
      body: { from: "dev", to: "pm", content: "Build done", type: "text" },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.message.from).toBe("dev");
    expect(json.message.to).toBe("pm");
  });

  it("should return 503 when DB is unavailable", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@test.com",
    });
    const dbError = new Error("ECONNREFUSED");
    (sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(dbError);
    (isDbConnectionError as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const req = createRequest("http://localhost:3000/api/messages", {
      method: "POST",
      body: { from: "dev", to: "pm", content: "test", type: "text" },
    });

    const res = await POST(req);
    expect(res.status).toBe(503);

    const json = await res.json();
    expect(json.error).toBe("Database unavailable");
  });

  it("should return 500 for unexpected errors", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@test.com",
    });
    (sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Unexpected")
    );
    (isDbConnectionError as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const req = createRequest("http://localhost:3000/api/messages", {
      method: "POST",
      body: { from: "dev", to: "pm", content: "test", type: "text" },
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});

describe("GET /api/messages", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/messages/route");
    GET = mod.GET as unknown as (req: Request) => Promise<Response>;
  });

  it("should return 401 when user is not authenticated", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const req = createRequest("http://localhost:3000/api/messages");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("should return agents overview when authenticated", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@test.com",
    });
    (getAllAgentsOverview as ReturnType<typeof vi.fn>).mockResolvedValue({
      pm: { unread: 2, latest: { id: "msg-1", content: "test" } },
      dev: { unread: 0 },
      reviewer: { unread: 1 },
    });

    const req = createRequest("http://localhost:3000/api/messages");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.agents).toBeDefined();
    expect(json.agents.pm.unread).toBe(2);
  });

  it("should return empty agents on DB connection error (graceful fallback)", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@test.com",
    });
    const dbError = new Error("ECONNREFUSED");
    (getAllAgentsOverview as ReturnType<typeof vi.fn>).mockRejectedValue(dbError);
    (isDbConnectionError as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const req = createRequest("http://localhost:3000/api/messages");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.agents).toEqual({});
  });
});

// =========================================================================
// /api/messages/[agentId] (GET and PATCH)
// =========================================================================
describe("GET /api/messages/[agentId]", () => {
  let GET: (
    req: Request,
    context: { params: Promise<{ agentId: string }> }
  ) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/messages/[agentId]/route");
    GET = mod.GET as unknown as typeof GET;
  });

  it("should return 401 when user is not authenticated", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const req = createRequest("http://localhost:3000/api/messages/dev");
    const res = await GET(req, { params: Promise.resolve({ agentId: "dev" }) });
    expect(res.status).toBe(401);
  });

  it("should return messages for specific agent", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@test.com",
    });
    (getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "msg-1",
        from: "pm",
        to: "dev",
        content: "task assigned",
        type: "task",
        read: false,
        timestamp: new Date().toISOString(),
      },
    ]);

    const req = createRequest("http://localhost:3000/api/messages/dev");
    const res = await GET(req, { params: Promise.resolve({ agentId: "dev" }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.agentId).toBe("dev");
    expect(json.messages).toHaveLength(1);
    expect(json.messages[0].content).toBe("task assigned");
  });

  it("should filter unread messages with unreadOnly param", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@test.com",
    });
    (getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const req = createRequest(
      "http://localhost:3000/api/messages/dev?unreadOnly=true"
    );
    const res = await GET(req, { params: Promise.resolve({ agentId: "dev" }) });

    expect(getMessages).toHaveBeenCalledWith("dev", true);
  });

  it("should use getConversation when 'with' param is provided", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@test.com",
    });
    (getConversation as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "msg-1",
        from: "dev",
        to: "pm",
        content: "conversation msg",
        type: "text",
        read: false,
        timestamp: new Date().toISOString(),
      },
    ]);

    const req = createRequest(
      "http://localhost:3000/api/messages/dev?with=pm"
    );
    const res = await GET(req, { params: Promise.resolve({ agentId: "dev" }) });

    expect(getConversation).toHaveBeenCalledWith("dev", "pm");
    const json = await res.json();
    expect(json.messages[0].content).toBe("conversation msg");
  });

  it("should return empty messages on DB connection error (graceful fallback)", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@test.com",
    });
    const dbError = new Error("ECONNREFUSED");
    (getMessages as ReturnType<typeof vi.fn>).mockRejectedValue(dbError);
    (isDbConnectionError as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const req = createRequest("http://localhost:3000/api/messages/dev");
    const res = await GET(req, { params: Promise.resolve({ agentId: "dev" }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.agentId).toBe("dev");
    expect(json.messages).toEqual([]);
  });
});

describe("PATCH /api/messages/[agentId]", () => {
  let PATCH: (
    req: Request,
    context: { params: Promise<{ agentId: string }> }
  ) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/messages/[agentId]/route");
    PATCH = mod.PATCH as unknown as typeof PATCH;
  });

  it("should return 401 when user is not authenticated", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const req = createRequest("http://localhost:3000/api/messages/dev", {
      method: "PATCH",
      body: { messageId: "msg-1" },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ agentId: "dev" }),
    });
    expect(res.status).toBe(401);
  });

  it("should return 400 when messageId is missing", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@test.com",
    });

    const req = createRequest("http://localhost:3000/api/messages/dev", {
      method: "PATCH",
      body: {},
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ agentId: "dev" }),
    });
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain("messageId");
  });

  it("should mark message as read successfully", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@test.com",
    });
    (markAsRead as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const req = createRequest("http://localhost:3000/api/messages/dev", {
      method: "PATCH",
      body: { messageId: "msg-1" },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ agentId: "dev" }),
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);

    expect(markAsRead).toHaveBeenCalledWith("dev", "msg-1");
  });

  it("should return 404 when message not found", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@test.com",
    });
    (markAsRead as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const req = createRequest("http://localhost:3000/api/messages/dev", {
      method: "PATCH",
      body: { messageId: "nonexistent" },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ agentId: "dev" }),
    });
    expect(res.status).toBe(404);
  });

  it("should return 503 on DB connection error", async () => {
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@test.com",
    });
    const dbError = new Error("ECONNREFUSED");
    (markAsRead as ReturnType<typeof vi.fn>).mockRejectedValue(dbError);
    (isDbConnectionError as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const req = createRequest("http://localhost:3000/api/messages/dev", {
      method: "PATCH",
      body: { messageId: "msg-1" },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ agentId: "dev" }),
    });
    expect(res.status).toBe(503);
  });
});
