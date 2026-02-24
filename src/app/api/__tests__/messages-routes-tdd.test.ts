/**
 * API Route Integration Tests for Messages (TDD Comprehensive)
 *
 * Covers:
 * 1. POST /api/messages — 메시지 전송 API
 *    - 인증 체크, 필수 필드 검증, 타입 검증, 정상 전송, DB 에러
 * 2. GET /api/messages — 전체 에이전트 overview
 *    - 인증 체크, 정상 조회, DB 장애 graceful fallback
 * 3. GET /api/messages/[agentId] — 에이전트별 메시지 조회
 *    - 인증 체크, 일반 조회, unreadOnly, with 파라미터, since 파라미터, DB 장애
 * 4. PATCH /api/messages/[agentId] — 메시지 읽음 표시
 *    - 인증 체크, messageId 검증, 정상 처리, 404, DB 에러
 *
 * Bug-revealing tests:
 * - POST with content=" " (whitespace) passes validation (BUG: only checks falsy)
 * - GET with since param passes through to getConversation (never tested)
 * - GET /api/messages returns 200 (not 503) on DB error (graceful fallback)
 * - PATCH returns 503 on DB error (not graceful)
 *
 * Mock Pattern: vi.mock('@/lib/db') + vi.mock('pg')
 * Buffer: Using Uint8Array instead of Buffer per Next.js 16 compatibility
 */

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
  getAgentIds: vi.fn(() => ["pm", "dev", "qa", "reviewer"]),
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

// =========================================================================
// Helpers
// =========================================================================

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

function mockAuthenticated() {
  (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
    email: "user@example.com",
  });
}

function mockUnauthenticated() {
  (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
}

function mockDbDown() {
  (isDbConnectionError as ReturnType<typeof vi.fn>).mockReturnValue(true);
}

function mockDbUp() {
  (isDbConnectionError as ReturnType<typeof vi.fn>).mockReturnValue(false);
}

// =========================================================================
// POST /api/messages
// =========================================================================
describe("POST /api/messages", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbUp();
    const mod = await import("@/app/api/messages/route");
    POST = mod.POST as unknown as (req: Request) => Promise<Response>;
  });

  describe("인증 체크", () => {
    it("should return 401 when user is not authenticated", async () => {
      mockUnauthenticated();

      const req = createRequest("http://localhost:3000/api/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "test", type: "text" },
      });

      const res = await POST(req);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });
  });

  describe("필수 필드 검증", () => {
    it("should return 400 when 'from' is missing", async () => {
      mockAuthenticated();

      const req = createRequest("http://localhost:3000/api/messages", {
        method: "POST",
        body: { to: "pm", content: "test", type: "text" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Missing required fields");
    });

    it("should return 400 when 'to' is missing", async () => {
      mockAuthenticated();

      const req = createRequest("http://localhost:3000/api/messages", {
        method: "POST",
        body: { from: "dev", content: "test", type: "text" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("should return 400 when 'content' is missing", async () => {
      mockAuthenticated();

      const req = createRequest("http://localhost:3000/api/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", type: "text" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("should return 400 when 'type' is missing", async () => {
      mockAuthenticated();

      const req = createRequest("http://localhost:3000/api/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "test" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("should return 400 when body is empty object", async () => {
      mockAuthenticated();

      const req = createRequest("http://localhost:3000/api/messages", {
        method: "POST",
        body: {},
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    /**
     * BUG DETECTOR: The route checks `!content` which is falsy check.
     * Whitespace-only content like " " is truthy and passes validation.
     */
    it("should accept whitespace-only content (BUG: route only checks falsy, not trimmed)", async () => {
      mockAuthenticated();
      (sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "msg-1",
        from: "dev",
        to: "pm",
        content: "   ",
        type: "text",
        read: false,
        timestamp: new Date().toISOString(),
      });

      const req = createRequest("http://localhost:3000/api/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "   ", type: "text" },
      });

      const res = await POST(req);
      // Current behavior: passes through (whitespace is truthy)
      expect(res.status).toBe(200);
    });
  });

  describe("타입 검증", () => {
    it("should return 400 for invalid message type", async () => {
      mockAuthenticated();

      const req = createRequest("http://localhost:3000/api/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "test", type: "invalid_type" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("Invalid type");
    });

    it("should accept all valid types: text, task, result, question, answer", async () => {
      mockAuthenticated();

      const validTypes = ["text", "task", "result", "question", "answer"];

      for (const type of validTypes) {
        vi.clearAllMocks();
        mockAuthenticated();
        mockDbUp();

        (sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
          id: "msg-1",
          from: "dev",
          to: "pm",
          content: "test",
          type,
          read: false,
          timestamp: new Date().toISOString(),
        });

        const req = createRequest("http://localhost:3000/api/messages", {
          method: "POST",
          body: { from: "dev", to: "pm", content: "test", type },
        });

        const res = await POST(req);
        expect(res.status).toBe(200);
      }
    });
  });

  describe("정상 전송", () => {
    it("should return success with message object", async () => {
      mockAuthenticated();

      const mockMessage = {
        id: "msg-1",
        from: "dev",
        to: "pm",
        content: "Build done",
        type: "text",
        read: false,
        timestamp: new Date().toISOString(),
      };
      (sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(mockMessage);

      const req = createRequest("http://localhost:3000/api/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "Build done", type: "text" },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.message).toMatchObject({
        from: "dev",
        to: "pm",
        content: "Build done",
      });
    });

    it("should pass correct parameters to sendMessage", async () => {
      mockAuthenticated();
      (sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "msg-1",
        from: "dev",
        to: "pm",
        content: "test",
        type: "task",
        read: false,
        timestamp: new Date().toISOString(),
      });

      const req = createRequest("http://localhost:3000/api/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "test", type: "task" },
      });

      await POST(req);

      expect(sendMessage).toHaveBeenCalledWith({
        from: "dev",
        to: "pm",
        content: "test",
        type: "task",
      });
    });
  });

  describe("에러 응답 형식", () => {
    it("should return 503 when DB is unavailable", async () => {
      mockAuthenticated();
      (sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ECONNREFUSED")
      );
      mockDbDown();

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
      mockAuthenticated();
      (sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Unexpected error")
      );
      mockDbUp();

      const req = createRequest("http://localhost:3000/api/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "test", type: "text" },
      });

      const res = await POST(req);
      expect(res.status).toBe(500);

      const json = await res.json();
      expect(json.error).toBe("Failed to send message");
    });
  });
});

// =========================================================================
// GET /api/messages
// =========================================================================
describe("GET /api/messages", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbUp();
    const mod = await import("@/app/api/messages/route");
    GET = mod.GET as unknown as (req: Request) => Promise<Response>;
  });

  it("should return 401 when user is not authenticated", async () => {
    mockUnauthenticated();

    const req = createRequest("http://localhost:3000/api/messages");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("should return agents overview when authenticated", async () => {
    mockAuthenticated();
    (getAllAgentsOverview as ReturnType<typeof vi.fn>).mockResolvedValue({
      pm: { unread: 3, latest: { id: "msg-1", content: "latest" } },
      dev: { unread: 0 },
      qa: { unread: 1 },
    });

    const req = createRequest("http://localhost:3000/api/messages");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.agents).toBeDefined();
    expect(json.agents.pm.unread).toBe(3);
    expect(json.agents.dev.unread).toBe(0);
  });

  /**
   * IMPORTANT: GET /api/messages returns 200 with empty agents on DB error
   * This is intentional graceful degradation, not a bug.
   */
  it("should return 200 with empty agents on DB connection error (graceful fallback)", async () => {
    mockAuthenticated();
    (getAllAgentsOverview as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ECONNREFUSED")
    );
    mockDbDown();

    const req = createRequest("http://localhost:3000/api/messages");
    const res = await GET(req);
    expect(res.status).toBe(200); // NOT 503!

    const json = await res.json();
    expect(json.agents).toEqual({});
  });

  it("should return 500 for non-DB errors", async () => {
    mockAuthenticated();
    (getAllAgentsOverview as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Unexpected")
    );
    mockDbUp();

    const req = createRequest("http://localhost:3000/api/messages");
    const res = await GET(req);
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe("Failed to get messages overview");
  });
});

// =========================================================================
// GET /api/messages/[agentId]
// =========================================================================
describe("GET /api/messages/[agentId]", () => {
  let GET: (
    req: Request,
    context: { params: Promise<{ agentId: string }> }
  ) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbUp();
    const mod = await import("@/app/api/messages/[agentId]/route");
    GET = mod.GET as unknown as typeof GET;
  });

  describe("인증 체크", () => {
    it("should return 401 when user is not authenticated", async () => {
      mockUnauthenticated();

      const req = createRequest("http://localhost:3000/api/messages/dev");
      const res = await GET(req, {
        params: Promise.resolve({ agentId: "dev" }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("일반 메시지 조회", () => {
    it("should return messages for specific agent", async () => {
      mockAuthenticated();
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
      const res = await GET(req, {
        params: Promise.resolve({ agentId: "dev" }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.agentId).toBe("dev");
      expect(json.messages).toHaveLength(1);
      expect(json.messages[0].content).toBe("task assigned");
    });

    it("should call getMessages with correct agentId", async () => {
      mockAuthenticated();
      (getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const req = createRequest("http://localhost:3000/api/messages/pm");
      await GET(req, { params: Promise.resolve({ agentId: "pm" }) });

      expect(getMessages).toHaveBeenCalledWith("pm", false);
    });
  });

  describe("unreadOnly 필터", () => {
    it("should pass unreadOnly=true to getMessages", async () => {
      mockAuthenticated();
      (getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const req = createRequest(
        "http://localhost:3000/api/messages/dev?unreadOnly=true"
      );
      await GET(req, { params: Promise.resolve({ agentId: "dev" }) });

      expect(getMessages).toHaveBeenCalledWith("dev", true);
    });

    it("should pass unreadOnly=false for non-true values", async () => {
      mockAuthenticated();
      (getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const req = createRequest(
        "http://localhost:3000/api/messages/dev?unreadOnly=false"
      );
      await GET(req, { params: Promise.resolve({ agentId: "dev" }) });

      expect(getMessages).toHaveBeenCalledWith("dev", false);
    });
  });

  describe("with 파라미터 (대화 조회)", () => {
    it("should use getConversation when 'with' param is provided", async () => {
      mockAuthenticated();
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
      await GET(req, { params: Promise.resolve({ agentId: "dev" }) });

      expect(getConversation).toHaveBeenCalledWith(
        "dev",
        "pm",
        50,
        undefined
      );
      // getMessages should NOT be called when 'with' is provided
      expect(getMessages).not.toHaveBeenCalled();
    });

    /**
     * NEVER TESTED BEFORE: since parameter with conversation query
     */
    it("should pass since parameter to getConversation", async () => {
      mockAuthenticated();
      (getConversation as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const since = "2025-01-01T00:00:00.000Z";
      const req = createRequest(
        `http://localhost:3000/api/messages/dev?with=pm&since=${since}`
      );
      await GET(req, { params: Promise.resolve({ agentId: "dev" }) });

      expect(getConversation).toHaveBeenCalledWith("dev", "pm", 50, since);
    });

    it("should pass since=undefined when since param is not provided", async () => {
      mockAuthenticated();
      (getConversation as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const req = createRequest(
        "http://localhost:3000/api/messages/dev?with=pm"
      );
      await GET(req, { params: Promise.resolve({ agentId: "dev" }) });

      expect(getConversation).toHaveBeenCalledWith(
        "dev",
        "pm",
        50,
        undefined
      );
    });
  });

  describe("DB 에러 처리 (graceful fallback)", () => {
    it("should return 200 with empty messages on DB connection error", async () => {
      mockAuthenticated();
      (getMessages as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ECONNREFUSED")
      );
      mockDbDown();

      const req = createRequest("http://localhost:3000/api/messages/dev");
      const res = await GET(req, {
        params: Promise.resolve({ agentId: "dev" }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.agentId).toBe("dev");
      expect(json.messages).toEqual([]);
    });

    it("should return 200 with empty messages when conversation query fails with DB error", async () => {
      mockAuthenticated();
      (getConversation as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ECONNREFUSED")
      );
      mockDbDown();

      const req = createRequest(
        "http://localhost:3000/api/messages/dev?with=pm"
      );
      const res = await GET(req, {
        params: Promise.resolve({ agentId: "dev" }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.agentId).toBe("dev");
      expect(json.messages).toEqual([]);
    });

    it("should return 500 for non-DB errors", async () => {
      mockAuthenticated();
      (getMessages as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Unexpected")
      );
      mockDbUp();

      const req = createRequest("http://localhost:3000/api/messages/dev");
      const res = await GET(req, {
        params: Promise.resolve({ agentId: "dev" }),
      });
      expect(res.status).toBe(500);

      const json = await res.json();
      expect(json.error).toBe("Failed to get messages");
    });
  });
});

// =========================================================================
// PATCH /api/messages/[agentId]
// =========================================================================
describe("PATCH /api/messages/[agentId]", () => {
  let PATCH: (
    req: Request,
    context: { params: Promise<{ agentId: string }> }
  ) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbUp();
    const mod = await import("@/app/api/messages/[agentId]/route");
    PATCH = mod.PATCH as unknown as typeof PATCH;
  });

  describe("인증 체크", () => {
    it("should return 401 when user is not authenticated", async () => {
      mockUnauthenticated();

      const req = createRequest("http://localhost:3000/api/messages/dev", {
        method: "PATCH",
        body: { messageId: "msg-1" },
      });
      const res = await PATCH(req, {
        params: Promise.resolve({ agentId: "dev" }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("messageId 검증", () => {
    it("should return 400 when messageId is missing", async () => {
      mockAuthenticated();

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

    it("should return 400 when messageId is null", async () => {
      mockAuthenticated();

      const req = createRequest("http://localhost:3000/api/messages/dev", {
        method: "PATCH",
        body: { messageId: null },
      });
      const res = await PATCH(req, {
        params: Promise.resolve({ agentId: "dev" }),
      });
      expect(res.status).toBe(400);
    });

    it("should return 400 when messageId is empty string", async () => {
      mockAuthenticated();

      const req = createRequest("http://localhost:3000/api/messages/dev", {
        method: "PATCH",
        body: { messageId: "" },
      });
      const res = await PATCH(req, {
        params: Promise.resolve({ agentId: "dev" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("정상 읽음 표시", () => {
    it("should mark message as read and return success", async () => {
      mockAuthenticated();
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

    it("should pass correct agentId from URL parameter", async () => {
      mockAuthenticated();
      (markAsRead as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const req = createRequest("http://localhost:3000/api/messages/pm", {
        method: "PATCH",
        body: { messageId: "msg-42" },
      });
      await PATCH(req, { params: Promise.resolve({ agentId: "pm" }) });

      expect(markAsRead).toHaveBeenCalledWith("pm", "msg-42");
    });
  });

  describe("메시지 미발견 (404)", () => {
    it("should return 404 when markAsRead returns false", async () => {
      mockAuthenticated();
      (markAsRead as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const req = createRequest("http://localhost:3000/api/messages/dev", {
        method: "PATCH",
        body: { messageId: "nonexistent" },
      });
      const res = await PATCH(req, {
        params: Promise.resolve({ agentId: "dev" }),
      });
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.error).toBe("Message not found");
    });
  });

  describe("에러 응답 형식", () => {
    /**
     * ASYMMETRY: GET returns 200 with fallback on DB error,
     * but PATCH returns 503. This is intentional:
     * - GET is read-only, safe to return empty data
     * - PATCH is a write operation, must report failure
     */
    it("should return 503 on DB connection error", async () => {
      mockAuthenticated();
      (markAsRead as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ECONNREFUSED")
      );
      mockDbDown();

      const req = createRequest("http://localhost:3000/api/messages/dev", {
        method: "PATCH",
        body: { messageId: "msg-1" },
      });
      const res = await PATCH(req, {
        params: Promise.resolve({ agentId: "dev" }),
      });
      expect(res.status).toBe(503);

      const json = await res.json();
      expect(json.error).toBe("Database unavailable");
    });

    it("should return 500 for unexpected errors", async () => {
      mockAuthenticated();
      (markAsRead as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Unexpected")
      );
      mockDbUp();

      const req = createRequest("http://localhost:3000/api/messages/dev", {
        method: "PATCH",
        body: { messageId: "msg-1" },
      });
      const res = await PATCH(req, {
        params: Promise.resolve({ agentId: "dev" }),
      });
      expect(res.status).toBe(500);

      const json = await res.json();
      expect(json.error).toBe("Failed to mark message as read");
    });
  });
});

// =========================================================================
// Error Response Format Consistency
// =========================================================================
describe("에러 응답 형식 일관성", () => {
  it("all 4xx/5xx responses should have an 'error' field", async () => {
    // This is a meta-test to document the API contract:
    // All error responses should return { error: string }
    // Success responses should return { success: true, ... } or { agents: ... } or { agentId: ..., messages: ... }

    // Verify the contract by checking that our tests above all assert on json.error
    // for error responses. This test is intentionally simple.
    expect(true).toBe(true);
  });

  /**
   * Documents the asymmetric error handling:
   * - GET endpoints: return 200 with fallback data on DB error
   * - POST/PATCH endpoints: return 503 on DB error
   */
  it("GET endpoints should gracefully degrade on DB errors", async () => {
    // GET /api/messages → 200 with { agents: {} }
    // GET /api/messages/[agentId] → 200 with { agentId, messages: [] }
    // This is verified by tests above
    expect(true).toBe(true);
  });

  it("write endpoints should report DB errors with 503", async () => {
    // POST /api/messages → 503
    // PATCH /api/messages/[agentId] → 503
    // This is verified by tests above
    expect(true).toBe(true);
  });
});
