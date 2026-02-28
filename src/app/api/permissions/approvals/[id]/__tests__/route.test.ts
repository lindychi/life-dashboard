/**
 * Single Approval Request API - Test Suite
 *
 * Tests GET and PATCH endpoints for individual approval requests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, PATCH } from "../route";
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

describe("Single Approval API - GET", () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should require authentication", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({ authenticated: false });
    vi.mocked(relay.validateRelayKey).mockReturnValueOnce(false);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals/approval-123");
    const response = await GET(request, { params: Promise.resolve({ id: "approval-123" }) });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("should allow session auth", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "user@example.com",
    });
    vi.mocked(permissionApprovals.getApprovalRequest).mockResolvedValueOnce(mockApproval);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals/approval-123");
    const response = await GET(request, { params: Promise.resolve({ id: "approval-123" }) });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.approval).toEqual(mockApproval);
  });

  it("should allow relay key auth", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({ authenticated: false });
    vi.mocked(relay.validateRelayKey).mockReturnValueOnce(true);
    vi.mocked(permissionApprovals.getApprovalRequest).mockResolvedValueOnce(mockApproval);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals/approval-123", {
      headers: { "x-relay-key": "valid-key" },
    });
    const response = await GET(request, { params: Promise.resolve({ id: "approval-123" }) });

    expect(response.status).toBe(200);
  });

  it("should return 404 for non-existent approval", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "user@example.com",
    });
    vi.mocked(permissionApprovals.getApprovalRequest).mockResolvedValueOnce(null);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals/nonexistent");
    const response = await GET(request, { params: Promise.resolve({ id: "nonexistent" }) });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Approval not found");
  });

  it("should handle errors gracefully", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "user@example.com",
    });
    vi.mocked(permissionApprovals.getApprovalRequest).mockRejectedValueOnce(
      new Error("Database error")
    );

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals/approval-123");
    const response = await GET(request, { params: Promise.resolve({ id: "approval-123" }) });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to fetch approval");
  });
});

describe("Single Approval API - PATCH", () => {
  const mockApproval = {
    id: "approval-123",
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should require session authentication (not relay key)", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({ authenticated: false });

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals/approval-123", {
      method: "PATCH",
      headers: { "x-relay-key": "valid-key" },
      body: JSON.stringify({ status: "approved" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "approval-123" }) });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("should validate status field", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "user@example.com",
    });

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals/approval-123", {
      method: "PATCH",
      body: JSON.stringify({ status: "invalid" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "approval-123" }) });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Invalid status");
  });

  it("should approve approval request", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "user@example.com",
    });
    vi.mocked(permissionApprovals.respondToApproval).mockResolvedValueOnce(mockApproval);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals/approval-123", {
      method: "PATCH",
      body: JSON.stringify({ status: "approved" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "approval-123" }) });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.approval.status).toBe("approved");
    expect(data.approval.respondedBy).toBe("user@example.com");
  });

  it("should deny approval request", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "admin@example.com",
    });

    const deniedApproval = {
      ...mockApproval,
      status: "denied" as const,
      respondedBy: "admin@example.com",
    };

    vi.mocked(permissionApprovals.respondToApproval).mockResolvedValueOnce(deniedApproval);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals/approval-123", {
      method: "PATCH",
      body: JSON.stringify({ status: "denied" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "approval-123" }) });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.approval.status).toBe("denied");
  });

  it("should use custom respondedBy if provided", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "user@example.com",
    });

    const customApproval = {
      ...mockApproval,
      respondedBy: "custom-user",
    };

    vi.mocked(permissionApprovals.respondToApproval).mockResolvedValueOnce(customApproval);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals/approval-123", {
      method: "PATCH",
      body: JSON.stringify({
        status: "approved",
        respondedBy: "custom-user",
      }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "approval-123" }) });

    expect(response.status).toBe(200);
    expect(permissionApprovals.respondToApproval).toHaveBeenCalledWith(
      "approval-123",
      "approved",
      "custom-user"
    );
  });

  it("should use auth email if respondedBy not provided", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "auth-user@example.com",
    });
    vi.mocked(permissionApprovals.respondToApproval).mockResolvedValueOnce(mockApproval);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals/approval-123", {
      method: "PATCH",
      body: JSON.stringify({ status: "approved" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "approval-123" }) });

    expect(response.status).toBe(200);
    expect(permissionApprovals.respondToApproval).toHaveBeenCalledWith(
      "approval-123",
      "approved",
      "auth-user@example.com"
    );
  });

  it("should return 404 for non-existent approval", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "user@example.com",
    });
    vi.mocked(permissionApprovals.respondToApproval).mockResolvedValueOnce(null);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals/nonexistent", {
      method: "PATCH",
      body: JSON.stringify({ status: "approved" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "nonexistent" }) });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain("Approval not found");
  });

  it("should return 404 for already-responded approval", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "user@example.com",
    });
    // respondToApproval returns null if status != 'pending'
    vi.mocked(permissionApprovals.respondToApproval).mockResolvedValueOnce(null);

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals/approval-123", {
      method: "PATCH",
      body: JSON.stringify({ status: "approved" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "approval-123" }) });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toContain("already responded");
  });

  it("should handle errors gracefully", async () => {
    vi.mocked(auth.verifyAuth).mockResolvedValueOnce({
      authenticated: true,
      email: "user@example.com",
    });
    vi.mocked(permissionApprovals.respondToApproval).mockRejectedValueOnce(
      new Error("Database error")
    );

    const request = new NextRequest("http://localhost:3000/api/permissions/approvals/approval-123", {
      method: "PATCH",
      body: JSON.stringify({ status: "approved" }),
    });
    const response = await PATCH(request, { params: Promise.resolve({ id: "approval-123" }) });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to respond to approval");
  });
});
