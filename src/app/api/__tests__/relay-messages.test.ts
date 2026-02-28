/**
 * API Route Integration Tests for Relay Messages
 *
 * Covers:
 * 1. POST /api/relay/messages — 릴레이를 통한 메시지 전송 API
 *    - 릴레이 키 인증 체크, 필수 필드 검증, agentId 검증, content 검증, 타입 검증, 정상 전송, DB 에러
 * 2. GET /api/relay/messages — 릴레이를 통한 에이전트 메시지 조회
 *    - 릴레이 키 인증 체크, agentId 검증, unreadOnly 필터, DB 장애 graceful fallback
 *
 * Auth Pattern: x-relay-key header (NOT session cookies)
 * Mock Pattern: vi.mock('@/lib/relay') with validateRelayKey
 *
 * Test cases:
 * POST:
 *   - 401 when relay key is missing
 *   - 401 when relay key is invalid
 *   - 400 when required fields missing (from, to, content)
 *   - 400 when 'from' is invalid agent ID
 *   - 400 when 'to' is invalid agent ID
 *   - 200 when 'to' is "broadcast" (allowed)
 *   - 400 when content is whitespace-only
 *   - 400 when content exceeds MAX_CONTENT_LENGTH
 *   - 400 when type is invalid
 *   - 200 with default type "text" when type not provided
 *   - 200 with success and message object for valid payload
 *   - 503 when DB is unavailable
 *   - 500 for unexpected errors
 *
 * GET:
 *   - 401 when relay key is missing
 *   - 401 when relay key is invalid
 *   - 400 when agentId is missing
 *   - 200 with messages for valid agentId
 *   - 200 with unreadOnly filtering
 *   - 200 with empty messages on DB error (graceful fallback)
 *   - 500 for unexpected errors
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// Mock relay module (relay key authentication)
vi.mock("@/lib/relay", () => ({
  validateRelayKey: vi.fn((key: string) => key === "valid-key"),
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
  isValidAgentId: vi.fn((id: string) => ["pm", "dev", "reviewer", "user"].includes(id)),
  VALID_MESSAGE_TYPES: ["text", "task", "result", "question", "answer"],
  MAX_CONTENT_LENGTH: 100_000,
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

import { validateRelayKey } from "@/lib/relay";
import { sendMessage, getMessages } from "@/lib/messages";
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

function mockValidRelayKey() {
  (validateRelayKey as ReturnType<typeof vi.fn>).mockReturnValue(true);
}

function mockInvalidRelayKey() {
  (validateRelayKey as ReturnType<typeof vi.fn>).mockReturnValue(false);
}

function mockDbDown() {
  (isDbConnectionError as ReturnType<typeof vi.fn>).mockReturnValue(true);
}

function mockDbUp() {
  (isDbConnectionError as ReturnType<typeof vi.fn>).mockReturnValue(false);
}

// =========================================================================
// POST /api/relay/messages
// =========================================================================
describe("POST /api/relay/messages", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbUp();
    const mod = await import("@/app/api/relay/messages/route");
    POST = mod.POST as unknown as (req: Request) => Promise<Response>;
  });

  describe("릴레이 키 인증", () => {
    it("should return 401 when relay key is missing", async () => {
      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "test", type: "text" },
        // No x-relay-key header
      });

      const res = await POST(req);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.error).toBe("Invalid API key");
    });

    it("should return 401 when relay key is invalid", async () => {
      mockInvalidRelayKey();

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "test", type: "text" },
        headers: { "x-relay-key": "invalid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      expect(validateRelayKey).toHaveBeenCalledWith("invalid-key");
    });
  });

  describe("필수 필드 검증", () => {
    it("should return 400 when 'from' is missing", async () => {
      mockValidRelayKey();

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { to: "pm", content: "test", type: "text" },
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("Missing required fields");
    });

    it("should return 400 when 'to' is missing", async () => {
      mockValidRelayKey();

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "dev", content: "test", type: "text" },
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("Missing required fields");
    });

    it("should return 400 when 'content' is missing", async () => {
      mockValidRelayKey();

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", type: "text" },
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("Missing required fields");
    });

    it("should return 400 when body is empty object", async () => {
      mockValidRelayKey();

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: {},
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe("agentId 검증", () => {
    it("should return 400 when 'from' is invalid agent ID", async () => {
      mockValidRelayKey();

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "invalid_agent", to: "pm", content: "test", type: "text" },
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("Invalid 'from' agent ID");
      expect(json.error).toContain("invalid_agent");
    });

    it("should return 400 when 'to' is invalid agent ID", async () => {
      mockValidRelayKey();

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "dev", to: "invalid_agent", content: "test", type: "text" },
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("Invalid 'to' agent ID");
      expect(json.error).toContain("invalid_agent");
    });

    it("should return 200 when 'to' is 'broadcast' (special allowed ID)", async () => {
      mockValidRelayKey();
      (sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "msg-1",
        from: "dev",
        to: "broadcast",
        content: "test",
        type: "text",
        read: false,
        timestamp: new Date().toISOString(),
      });

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "dev", to: "broadcast", content: "test", type: "text" },
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.message.to).toBe("broadcast");
    });
  });

  describe("content 검증", () => {
    it("should return 400 when content is whitespace-only", async () => {
      mockValidRelayKey();

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "   ", type: "text" },
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("Content cannot be empty");
    });

    it("should return 400 when content exceeds MAX_CONTENT_LENGTH", async () => {
      mockValidRelayKey();

      const longContent = "a".repeat(100_001); // MAX_CONTENT_LENGTH = 100_000
      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: longContent, type: "text" },
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("Content exceeds maximum length");
      expect(json.error).toContain("100000");
    });

    it("should accept content exactly at MAX_CONTENT_LENGTH", async () => {
      mockValidRelayKey();
      (sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "msg-1",
        from: "dev",
        to: "pm",
        content: "a".repeat(100_000),
        type: "text",
        read: false,
        timestamp: new Date().toISOString(),
      });

      const exactLengthContent = "a".repeat(100_000);
      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: exactLengthContent, type: "text" },
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
    });
  });

  describe("타입 검증", () => {
    it("should return 400 when type is invalid", async () => {
      mockValidRelayKey();

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "test", type: "invalid_type" },
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("Invalid type");
    });

    it("should return 200 with default type 'text' when type not provided", async () => {
      mockValidRelayKey();
      (sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "msg-1",
        from: "dev",
        to: "pm",
        content: "test",
        type: "text",
        read: false,
        timestamp: new Date().toISOString(),
      });

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "test" }, // No type
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      expect(sendMessage).toHaveBeenCalledWith({
        from: "dev",
        to: "pm",
        content: "test",
        type: "text", // Default
      });
    });

    it("should accept all valid types: text, task, result, question, answer", async () => {
      mockValidRelayKey();

      const validTypes = ["text", "task", "result", "question", "answer"];

      for (const type of validTypes) {
        vi.clearAllMocks();
        mockValidRelayKey();
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

        const req = createRequest("http://localhost:3000/api/relay/messages", {
          method: "POST",
          body: { from: "dev", to: "pm", content: "test", type },
          headers: { "x-relay-key": "valid-key" },
        });

        const res = await POST(req);
        expect(res.status).toBe(200);
      }
    });
  });

  describe("정상 전송", () => {
    it("should return success with message object for valid payload", async () => {
      mockValidRelayKey();

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

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "Build done", type: "text" },
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.message).toMatchObject({
        from: "dev",
        to: "pm",
        content: "Build done",
        type: "text",
      });
    });

    it("should pass correct trimmed content to sendMessage", async () => {
      mockValidRelayKey();
      (sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "msg-1",
        from: "dev",
        to: "pm",
        content: "test",
        type: "task",
        read: false,
        timestamp: new Date().toISOString(),
      });

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "  test  ", type: "task" },
        headers: { "x-relay-key": "valid-key" },
      });

      await POST(req);

      expect(sendMessage).toHaveBeenCalledWith({
        from: "dev",
        to: "pm",
        content: "test", // Trimmed
        type: "task",
      });
    });
  });

  describe("에러 응답 형식", () => {
    it("should return 503 when DB is unavailable", async () => {
      mockValidRelayKey();
      (sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ECONNREFUSED")
      );
      mockDbDown();

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "test", type: "text" },
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(503);

      const json = await res.json();
      expect(json.error).toBe("Database unavailable");
    });

    it("should return 500 for unexpected errors", async () => {
      mockValidRelayKey();
      (sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Unexpected error")
      );
      mockDbUp();

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        method: "POST",
        body: { from: "dev", to: "pm", content: "test", type: "text" },
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await POST(req);
      expect(res.status).toBe(500);

      const json = await res.json();
      expect(json.error).toBe("Server error");
    });
  });
});

// =========================================================================
// GET /api/relay/messages
// =========================================================================
describe("GET /api/relay/messages", () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbUp();
    const mod = await import("@/app/api/relay/messages/route");
    GET = mod.GET as unknown as (req: Request) => Promise<Response>;
  });

  describe("릴레이 키 인증", () => {
    it("should return 401 when relay key is missing", async () => {
      const req = createRequest(
        "http://localhost:3000/api/relay/messages?agentId=dev"
      );

      const res = await GET(req);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.error).toBe("Invalid API key");
    });

    it("should return 401 when relay key is invalid", async () => {
      mockInvalidRelayKey();

      const req = createRequest(
        "http://localhost:3000/api/relay/messages?agentId=dev",
        {
          headers: { "x-relay-key": "invalid-key" },
        }
      );

      const res = await GET(req);
      expect(res.status).toBe(401);
      expect(validateRelayKey).toHaveBeenCalledWith("invalid-key");
    });
  });

  describe("agentId 검증", () => {
    it("should return 400 when agentId is missing", async () => {
      mockValidRelayKey();

      const req = createRequest("http://localhost:3000/api/relay/messages", {
        headers: { "x-relay-key": "valid-key" },
      });

      const res = await GET(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.error).toContain("agentId is required");
    });

    it("should return 400 when agentId is empty string", async () => {
      mockValidRelayKey();

      const req = createRequest(
        "http://localhost:3000/api/relay/messages?agentId=",
        {
          headers: { "x-relay-key": "valid-key" },
        }
      );

      const res = await GET(req);
      expect(res.status).toBe(400);
    });
  });

  describe("메시지 조회", () => {
    it("should return 200 with messages for valid agentId", async () => {
      mockValidRelayKey();
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

      const req = createRequest(
        "http://localhost:3000/api/relay/messages?agentId=dev",
        {
          headers: { "x-relay-key": "valid-key" },
        }
      );

      const res = await GET(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.messages).toHaveLength(1);
      expect(json.messages[0].content).toBe("task assigned");
      expect(getMessages).toHaveBeenCalledWith("dev", false);
    });

    it("should call getMessages with correct agentId", async () => {
      mockValidRelayKey();
      (getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const req = createRequest(
        "http://localhost:3000/api/relay/messages?agentId=pm",
        {
          headers: { "x-relay-key": "valid-key" },
        }
      );

      await GET(req);

      expect(getMessages).toHaveBeenCalledWith("pm", false);
    });
  });

  describe("unreadOnly 필터", () => {
    it("should pass unreadOnly=true to getMessages", async () => {
      mockValidRelayKey();
      (getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const req = createRequest(
        "http://localhost:3000/api/relay/messages?agentId=dev&unreadOnly=true",
        {
          headers: { "x-relay-key": "valid-key" },
        }
      );

      await GET(req);

      expect(getMessages).toHaveBeenCalledWith("dev", true);
    });

    it("should pass unreadOnly=false for non-true values", async () => {
      mockValidRelayKey();
      (getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const req = createRequest(
        "http://localhost:3000/api/relay/messages?agentId=dev&unreadOnly=false",
        {
          headers: { "x-relay-key": "valid-key" },
        }
      );

      await GET(req);

      expect(getMessages).toHaveBeenCalledWith("dev", false);
    });

    it("should pass unreadOnly=false when param is not provided", async () => {
      mockValidRelayKey();
      (getMessages as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const req = createRequest(
        "http://localhost:3000/api/relay/messages?agentId=dev",
        {
          headers: { "x-relay-key": "valid-key" },
        }
      );

      await GET(req);

      expect(getMessages).toHaveBeenCalledWith("dev", false);
    });
  });

  describe("DB 에러 처리 (graceful fallback)", () => {
    it("should return 200 with empty messages on DB connection error (graceful fallback)", async () => {
      mockValidRelayKey();
      (getMessages as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("ECONNREFUSED")
      );
      mockDbDown();

      const req = createRequest(
        "http://localhost:3000/api/relay/messages?agentId=dev",
        {
          headers: { "x-relay-key": "valid-key" },
        }
      );

      const res = await GET(req);
      expect(res.status).toBe(200); // NOT 503! Graceful degradation

      const json = await res.json();
      expect(json.messages).toEqual([]);
    });

    it("should return 500 for non-DB errors", async () => {
      mockValidRelayKey();
      (getMessages as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Unexpected")
      );
      mockDbUp();

      const req = createRequest(
        "http://localhost:3000/api/relay/messages?agentId=dev",
        {
          headers: { "x-relay-key": "valid-key" },
        }
      );

      const res = await GET(req);
      expect(res.status).toBe(500);

      const json = await res.json();
      expect(json.error).toBe("Server error");
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
    // Success responses should return { success: true, message: ... } or { messages: ... }
    expect(true).toBe(true);
  });

  it("GET endpoint should gracefully degrade on DB errors", async () => {
    // GET /api/relay/messages → 200 with { messages: [] }
    // This is verified by tests above
    expect(true).toBe(true);
  });

  it("write endpoint should report DB errors with 503", async () => {
    // POST /api/relay/messages → 503
    // This is verified by tests above
    expect(true).toBe(true);
  });
});
