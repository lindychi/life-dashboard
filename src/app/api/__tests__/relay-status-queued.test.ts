import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * TDD Red Phase: Tests for queued commands/instructions exposure in GET /api/relay/status
 *
 * These tests verify that the status endpoint properly exposes queued instructions
 * so the dashboard frontend can display pending work per agent.
 *
 * Expected response shape:
 * {
 *   gateways: [...],
 *   agents: { gatewayId: [...] },
 *   pendingInstructions: { agentId: [{ id, content, createdAt, position }] },
 *   pendingCount: number,
 *   queuedCommands: { agentId: [{ id, type, payload, createdAt, status }] },  // NEW
 *   queuedCommandsCount: number,  // NEW
 *   dbConnected: boolean,
 *   timestamp: string,
 * }
 */

// Mock db module
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
}));

// Mock auth to always return authenticated user
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ email: "test@test.com" }),
}));

function makeRelayRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    ...options,
    headers: {
      ...options?.headers,
      "x-relay-key": "dev-relay-key",
    },
  });
}

function makeAuthRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"));
}

describe("GET /api/relay/status - queued commands exposure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: empty results for all queries
    mockQuery.mockResolvedValue([]);
    mockQueryOne.mockResolvedValue(null);
  });

  describe("queuedCommands field in response", () => {
    it("should include queuedCommands field in status response", async () => {
      const { GET } = await import("@/app/api/relay/status/route");
      const request = makeRelayRequest("/api/relay/status");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("queuedCommands");
    });

    it("should include queuedCommandsCount field in status response", async () => {
      const { GET } = await import("@/app/api/relay/status/route");
      const request = makeRelayRequest("/api/relay/status");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("queuedCommandsCount");
      expect(typeof data.queuedCommandsCount).toBe("number");
    });

    it("should return empty queuedCommands when no commands are pending", async () => {
      const { GET } = await import("@/app/api/relay/status/route");
      const request = makeRelayRequest("/api/relay/status");
      const response = await GET(request);
      const data = await response.json();

      expect(data.queuedCommands).toEqual({});
      expect(data.queuedCommandsCount).toBe(0);
    });
  });

  describe("queuedCommands with pending data", () => {
    it("should return queued commands grouped by agentId", async () => {
      // Mock: getPendingCommands returns commands for 2 agents
      mockQuery.mockImplementation(async (sql: string) => {
        // Match the query that fetches pending relay commands (not instructions)
        if (sql.includes("status = 'pending'") && sql.includes("relay_commands") && !sql.includes("'queued'")) {
          return [
            {
              id: "cmd-1",
              gateway_id: "gw-1",
              type: "spawn",
              payload: { agentId: "dev", task: "Fix login bug" },
              status: "pending",
              created_at: "2024-06-01T10:00:00Z",
            },
            {
              id: "cmd-2",
              gateway_id: "gw-1",
              type: "spawn",
              payload: { agentId: "dev", task: "Add unit tests" },
              status: "pending",
              created_at: "2024-06-01T10:01:00Z",
            },
            {
              id: "cmd-3",
              gateway_id: "gw-1",
              type: "send",
              payload: { agentId: "pm", message: "Status update" },
              status: "pending",
              created_at: "2024-06-01T10:02:00Z",
            },
          ];
        }
        return [];
      });

      const { GET } = await import("@/app/api/relay/status/route");
      const request = makeRelayRequest("/api/relay/status");
      const response = await GET(request);
      const data = await response.json();

      expect(data.queuedCommands).toBeDefined();
      expect(data.queuedCommands["dev"]).toHaveLength(2);
      expect(data.queuedCommands["pm"]).toHaveLength(1);
      expect(data.queuedCommandsCount).toBe(3);
    });

    it("should include required fields in each queued command", async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes("status = 'pending'") && sql.includes("relay_commands") && !sql.includes("'queued'")) {
          return [
            {
              id: "cmd-1",
              gateway_id: "gw-1",
              type: "spawn",
              payload: { agentId: "dev", task: "Fix login bug" },
              status: "pending",
              created_at: "2024-06-01T10:00:00Z",
            },
          ];
        }
        return [];
      });

      const { GET } = await import("@/app/api/relay/status/route");
      const request = makeRelayRequest("/api/relay/status");
      const response = await GET(request);
      const data = await response.json();

      const devCommands = data.queuedCommands["dev"];
      expect(devCommands).toBeDefined();
      expect(devCommands[0]).toEqual(
        expect.objectContaining({
          id: "cmd-1",
          type: "spawn",
          payload: expect.objectContaining({ task: "Fix login bug" }),
          createdAt: "2024-06-01T10:00:00Z",
        })
      );
    });
  });

  describe("queuedCommands with DB errors", () => {
    it("should return empty queuedCommands when DB is down", async () => {
      const dbError = Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" });
      mockQuery.mockRejectedValue(dbError);
      mockQueryOne.mockRejectedValue(dbError);

      const { GET } = await import("@/app/api/relay/status/route");
      const request = makeRelayRequest("/api/relay/status");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.queuedCommands).toEqual({});
      expect(data.queuedCommandsCount).toBe(0);
      expect(data.dbConnected).toBe(false);
    });
  });

  describe("authentication for queuedCommands", () => {
    it("should expose queuedCommands to authenticated dashboard users", async () => {
      const { GET } = await import("@/app/api/relay/status/route");
      // Uses session auth (no relay key)
      const request = makeAuthRequest("/api/relay/status");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("queuedCommands");
    });

    it("should expose queuedCommands via relay key auth", async () => {
      const { GET } = await import("@/app/api/relay/status/route");
      const request = makeRelayRequest("/api/relay/status");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("queuedCommands");
    });
  });
});
