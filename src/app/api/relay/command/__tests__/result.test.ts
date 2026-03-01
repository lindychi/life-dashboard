/**
 * result.test.ts
 *
 * Tests for Fix 2: POST /api/relay/command/result
 * — Gateway reports command completion/failure to the dashboard.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any @/ imports
// ---------------------------------------------------------------------------

vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  isDbConnectionError: vi.fn().mockReturnValue(false),
  pool: {},
}));

vi.mock("@/lib/relay", () => ({
  validateRelayKey: vi.fn(),
  updateCommandResult: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST } from "@/app/api/relay/command/result/route";
import * as relay from "@/lib/relay";

const mockUpdateCommandResult = vi.mocked(relay.updateCommandResult);
const mockValidateRelayKey = vi.mocked(relay.validateRelayKey);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_KEY = "test-relay-key";
const GATEWAY_ID = "gw-test-001";

function makeRequest(body: Record<string, unknown>, apiKey?: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/relay/command/result", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey !== undefined ? { "x-relay-key": apiKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/relay/command/result", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: valid key
    mockValidateRelayKey.mockImplementation((key: string) => key === VALID_KEY);
  });

  describe("authentication", () => {
    it("returns 401 when no x-relay-key header is present", async () => {
      const reqNoKey = new NextRequest("http://localhost:3000/api/relay/command/result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gatewayId: GATEWAY_ID, commandId: "cmd-1", status: "completed" }),
      });

      const res = await POST(reqNoKey);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("returns 401 when an invalid relay key is provided", async () => {
      const req = makeRequest(
        { gatewayId: GATEWAY_ID, commandId: "cmd-1", status: "completed" },
        "wrong-key"
      );

      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it("proceeds with valid relay key", async () => {
      mockUpdateCommandResult.mockResolvedValue(true);
      const req = makeRequest(
        { gatewayId: GATEWAY_ID, commandId: "cmd-1", status: "completed" },
        VALID_KEY
      );

      const res = await POST(req);
      expect(res.status).toBe(200);
    });
  });

  describe("input validation", () => {
    it("returns 400 when commandId is missing", async () => {
      const req = makeRequest(
        { gatewayId: GATEWAY_ID, status: "completed" },
        VALID_KEY
      );

      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("returns 400 when gatewayId is missing", async () => {
      const req = makeRequest(
        { commandId: "cmd-1", status: "completed" },
        VALID_KEY
      );

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when status is missing", async () => {
      const req = makeRequest(
        { gatewayId: GATEWAY_ID, commandId: "cmd-1" },
        VALID_KEY
      );

      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it("returns 400 when status is an invalid value", async () => {
      const req = makeRequest(
        { gatewayId: GATEWAY_ID, commandId: "cmd-1", status: "pending" },
        VALID_KEY
      );

      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/completed|failed/);
    });
  });

  describe("successful updates", () => {
    it("updates command status to completed and returns success:true", async () => {
      mockUpdateCommandResult.mockResolvedValue(true);

      const req = makeRequest(
        { gatewayId: GATEWAY_ID, commandId: "cmd-abc", status: "completed" },
        VALID_KEY
      );

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      expect(mockUpdateCommandResult).toHaveBeenCalledWith(
        GATEWAY_ID,
        "cmd-abc",
        "completed",
        undefined
      );
    });

    it("updates command status to failed and returns success:true", async () => {
      mockUpdateCommandResult.mockResolvedValue(true);

      const req = makeRequest(
        { gatewayId: GATEWAY_ID, commandId: "cmd-xyz", status: "failed" },
        VALID_KEY
      );

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      expect(mockUpdateCommandResult).toHaveBeenCalledWith(
        GATEWAY_ID,
        "cmd-xyz",
        "failed",
        undefined
      );
    });

    it("passes optional result payload to updateCommandResult", async () => {
      mockUpdateCommandResult.mockResolvedValue(true);
      const resultPayload = { error: "Claude CLI timed out" };

      const req = makeRequest(
        {
          gatewayId: GATEWAY_ID,
          commandId: "cmd-fail",
          status: "failed",
          result: resultPayload,
        },
        VALID_KEY
      );

      const res = await POST(req);
      expect(res.status).toBe(200);

      expect(mockUpdateCommandResult).toHaveBeenCalledWith(
        GATEWAY_ID,
        "cmd-fail",
        "failed",
        resultPayload
      );
    });

    it("returns success:false when command is not found (non-existent commandId)", async () => {
      // updateCommandResult returns false when no row is updated
      mockUpdateCommandResult.mockResolvedValue(false);

      const req = makeRequest(
        { gatewayId: GATEWAY_ID, commandId: "does-not-exist", status: "completed" },
        VALID_KEY
      );

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(false);
    });
  });

  describe("error handling", () => {
    it("returns 500 when updateCommandResult throws an unexpected error", async () => {
      mockUpdateCommandResult.mockRejectedValue(new Error("DB exploded"));

      const req = makeRequest(
        { gatewayId: GATEWAY_ID, commandId: "cmd-1", status: "completed" },
        VALID_KEY
      );

      const res = await POST(req);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });
  });
});
