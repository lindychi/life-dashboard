/**
 * Permission Approvals API Routes - Test Suite
 *
 * Tests API endpoints for creating and managing approval requests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../route";
import * as auth from "@/lib/auth";
import * as relay from "@/lib/relay";
import * as permissionApprovals from "@/lib/permission-approvals";

// Mock dependencies
vi.mock("@/lib/auth");
vi.mock("@/lib/relay");
vi.mock("@/lib/permission-approvals");
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  pool: { query: vi.fn() },
}));
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

describe("Permission Approvals API - GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should require authentication", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({ authenticated: false });
    vi.mocked(relay.validateRelayKey).mockReturnValueOnce(false);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals");
    const response = await GET(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("should allow session auth", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "user@example.com",
    });
    vi.mocked(permissionApprovals.getPendingApprovals).mockResolvedValueOnce([]);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.approvals).toEqual([]);
  });

  it("should allow relay key auth", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({ authenticated: false });
    vi.mocked(relay.validateRelayKey).mockReturnValueOnce(true);
    vi.mocked(permissionApprovals.getPendingApprovals).mockResolvedValueOnce([]);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals", {
      headers: { "x-relay-key": "valid-key" },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
  });

  it("should return pending approvals by default", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "user@example.com",
    });

    const mockApprovals = [
      {
        id: "approval-1",
        agentId: "agent-1",
        gatewayId: "gateway-1",
        commandId: "cmd-1",
        path: ".git/config",
        action: "write" as const,
        reason: "Test",
        status: "pending" as const,
        requestedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      },
    ];

    vi.mocked(permissionApprovals.getPendingApprovals).mockResolvedValueOnce(mockApprovals);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.approvals).toEqual(mockApprovals);
  });

  it("should filter pending approvals by gateway", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "user@example.com",
    });
    vi.mocked(permissionApprovals.getPendingApprovals).mockResolvedValueOnce([]);

    const request = new NextRequest(
      "http://localhost:3000/api/permissions/approvals?gatewayId=gateway-1"
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(permissionApprovals.getPendingApprovals).toHaveBeenCalledWith("gateway-1");
  });

  it("should return approval history when mode=history", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "user@example.com",
    });

    const mockHistory = [
      {
        id: "approval-1",
        agentId: "agent-1",
        gatewayId: "gateway-1",
        commandId: "cmd-1",
        path: ".git/config",
        action: "write" as const,
        reason: "Test",
        status: "approved" as const,
        requestedAt: new Date().toISOString(),
        respondedAt: new Date().toISOString(),
        respondedBy: "user@example.com",
        expiresAt: new Date().toISOString(),
      },
    ];

    vi.mocked(permissionApprovals.getApprovalHistory).mockResolvedValueOnce(mockHistory);

    const request = new NextRequest(
      "http://localhost:3000/api/permissions/approvals?mode=history"
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.approvals).toEqual(mockHistory);
  });

  it("should handle query params for history mode", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "user@example.com",
    });
    vi.mocked(permissionApprovals.getApprovalHistory).mockResolvedValueOnce([]);

    const request = new NextRequest(
      "http://localhost:3000/api/permissions/approvals?mode=history&agentId=agent-1&status=approved&limit=50"
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(permissionApprovals.getApprovalHistory).toHaveBeenCalledWith({
      agentId: "agent-1",
      gatewayId: undefined,
      status: "approved",
      limit: 50,
    });
  });

  it("should handle errors gracefully", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "user@example.com",
    });
    vi.mocked(permissionApprovals.getPendingApprovals).mockRejectedValueOnce(
      new Error("Database error")
    );

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals");
    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to fetch approvals");
  });
});

describe("Permission Approvals API - POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should require relay key authentication", async () => {
    vi.mocked(relay.validateRelayKey).mockReturnValueOnce(false);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const response = await POST(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("should validate required fields", async () => {
    vi.mocked(relay.validateRelayKey).mockReturnValueOnce(true);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals", {
      method: "POST",
      headers: { "x-relay-key": "valid-key" },
      body: JSON.stringify({
        agentId: "agent-1",
        // Missing other required fields
      }),
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Missing required fields");
  });

  it("should create approval request with valid data", async () => {
    vi.mocked(relay.validateRelayKey).mockReturnValueOnce(true);

    const mockApproval = {
      id: "approval-123",
      agentId: "agent-1",
      gatewayId: "gateway-1",
      commandId: "cmd-1",
      path: ".git/config",
      action: "write" as const,
      reason: "Git 설정 변경",
      status: "pending" as const,
      requestedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    };

    vi.mocked(permissionApprovals.createApprovalRequest).mockResolvedValueOnce(mockApproval);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals", {
      method: "POST",
      headers: { "x-relay-key": "valid-key" },
      body: JSON.stringify({
        agentId: "agent-1",
        gatewayId: "gateway-1",
        commandId: "cmd-1",
        path: ".git/config",
        action: "write",
        reason: "Git 설정 변경",
      }),
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.approval).toEqual(mockApproval);
  });

  it("should pass custom timeout to createApprovalRequest", async () => {
    vi.mocked(relay.validateRelayKey).mockReturnValueOnce(true);

    const mockApproval = {
      id: "approval-123",
      agentId: "agent-1",
      gatewayId: "gateway-1",
      commandId: "cmd-1",
      path: ".git/config",
      action: "write" as const,
      reason: "Test",
      status: "pending" as const,
      requestedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    };

    vi.mocked(permissionApprovals.createApprovalRequest).mockResolvedValueOnce(mockApproval);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals", {
      method: "POST",
      headers: { "x-relay-key": "valid-key" },
      body: JSON.stringify({
        agentId: "agent-1",
        gatewayId: "gateway-1",
        commandId: "cmd-1",
        path: ".git/config",
        action: "write",
        reason: "Test",
        timeoutMs: 600000, // 10 minutes
      }),
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(permissionApprovals.createApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        path: ".git/config",
      }),
      600000
    );
  });

  it("should handle metadata", async () => {
    vi.mocked(relay.validateRelayKey).mockReturnValueOnce(true);

    const mockApproval = {
      id: "approval-123",
      agentId: "agent-1",
      gatewayId: "gateway-1",
      commandId: "cmd-1",
      path: ".git/config",
      action: "write" as const,
      reason: "Test",
      status: "pending" as const,
      requestedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      metadata: { source: "auto-detector" },
    };

    vi.mocked(permissionApprovals.createApprovalRequest).mockResolvedValueOnce(mockApproval);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals", {
      method: "POST",
      headers: { "x-relay-key": "valid-key" },
      body: JSON.stringify({
        agentId: "agent-1",
        gatewayId: "gateway-1",
        commandId: "cmd-1",
        path: ".git/config",
        action: "write",
        reason: "Test",
        metadata: { source: "auto-detector" },
      }),
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.approval.metadata).toEqual({ source: "auto-detector" });
  });

  it("should handle errors gracefully", async () => {
    vi.mocked(relay.validateRelayKey).mockReturnValueOnce(true);
    vi.mocked(permissionApprovals.createApprovalRequest).mockRejectedValueOnce(
      new Error("Database error")
    );

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals", {
      method: "POST",
      headers: { "x-relay-key": "valid-key" },
      body: JSON.stringify({
        agentId: "agent-1",
        gatewayId: "gateway-1",
        commandId: "cmd-1",
        path: ".git/config",
        action: "write",
        reason: "Test",
      }),
    });
    const response = await POST(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to create approval request");
  });
});
