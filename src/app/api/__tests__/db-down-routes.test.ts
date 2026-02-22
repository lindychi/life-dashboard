import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Create a reusable ECONNREFUSED error
function createDbConnectionError(): Error {
  const inner = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
    code: "ECONNREFUSED",
  });
  return new AggregateError([inner], "AggregateError");
}

// Mock db module to simulate connection failure
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  pool: {},
  isDbConnectionError: (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    const err = error as any;
    const codes = ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT"];
    if (err.code && codes.includes(err.code)) return true;
    if (err.errors) {
      return err.errors.some((e: any) => e.code && codes.includes(e.code));
    }
    return false;
  },
  withDbFallback: async (fn: () => Promise<any>, fallback: any) => {
    try {
      return await fn();
    } catch (error: any) {
      const codes = ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT"];
      const isConn = (error.code && codes.includes(error.code)) ||
        (error.errors?.some((e: any) => e.code && codes.includes(e.code)));
      if (isConn) return fallback;
      throw error;
    }
  },
}));

// Mock auth to always return authenticated user
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ email: "test@test.com" }),
}));

// Mock agents
vi.mock("@/lib/agents", () => ({
  getAgents: () => [],
  getAllAgents: () => [],
  getAgentsByCategory: () => [],
  getAgentIds: () => ["dev", "pm"],
}));

function makeRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), options);
}

function makeRelayRequest(url: string, options?: RequestInit): NextRequest {
  const req = new NextRequest(new URL(url, "http://localhost:3000"), options);
  // Relay requests need x-relay-key header
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    ...options,
    headers: {
      ...options?.headers,
      "x-relay-key": "dev-relay-key",
    },
  });
}

describe("API routes when database is down", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const dbError = createDbConnectionError();
    mockQuery.mockRejectedValue(dbError);
    mockQueryOne.mockRejectedValue(dbError);
  });

  describe("GET /api/history", () => {
    it("should return empty history instead of 500 when DB is down", async () => {
      const { GET } = await import("@/app/api/history/route");
      const request = makeRequest("/api/history");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.history).toEqual({});
    });
  });

  describe("GET /api/relay/status", () => {
    it("should return empty state with dbConnected: false when DB is down", async () => {
      const { GET } = await import("@/app/api/relay/status/route");
      const request = makeRelayRequest("/api/relay/status");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.gateways).toEqual([]);
      expect(data.agents).toEqual({});
      expect(data.dbConnected).toBe(false);
    });
  });

  describe("POST /api/relay/command", () => {
    it("should return 503 when DB is down", async () => {
      const { POST } = await import("@/app/api/relay/command/route");
      const request = makeRelayRequest("/api/relay/command", {
        method: "POST",
        body: JSON.stringify({
          type: "spawn",
          payload: { agentId: "dev", task: "test" },
        }),
      });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toContain("unavailable");
    });
  });

  describe("GET /api/messages", () => {
    it("should return empty overview instead of 500 when DB is down", async () => {
      const { GET } = await import("@/app/api/messages/route");
      const request = makeRequest("/api/messages");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.agents).toEqual({});
    });
  });
});
