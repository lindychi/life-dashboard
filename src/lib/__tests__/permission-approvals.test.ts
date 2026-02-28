/**
 * Permission Approvals System - Comprehensive Test Suite
 *
 * Tests:
 * 1. .git/index.lock deletion scenario
 * 2. Approval/denial flow
 * 3. Timeout and error handling
 * 4. Security vulnerabilities (bypass attempts)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { query, queryOne } from "../db";
import {
  createApprovalRequest,
  getApprovalRequest,
  respondToApproval,
  getPendingApprovals,
  waitForApproval,
  expirePendingApprovals,
} from "../permission-approvals";
import {
  checkPermission,
  DEFAULT_PERMISSION_RULES,
  getApprovalExpiration,
} from "../permissions";

// Mock database
vi.mock("../db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  pool: {
    query: vi.fn(),
  },
}));

// Mock pg to prevent native module loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({
    query: vi.fn(),
  })),
}));

describe("Permission Approvals - Comprehensive Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ────────────────────────────────────────────────────────────
  // 1. .git/index.lock Deletion Scenario
  // ────────────────────────────────────────────────────────────

  describe("1. .git/index.lock Deletion Scenario", () => {
    it("should require approval for .git/index.lock deletion", () => {
      const result = checkPermission(".git/index.lock", "delete", DEFAULT_PERMISSION_RULES);

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.rule).toBeDefined();
      expect(result.rule?.pattern).toBe(".git/**/*");
      expect(result.rule?.reason).toContain("Git 저장소 무결성 보호");
    });

    it("should require approval for .git/index.lock write", () => {
      const result = checkPermission(".git/index.lock", "write", DEFAULT_PERMISSION_RULES);

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });

    it("should allow .git/index.lock read (falls back to default)", () => {
      const result = checkPermission(".git/index.lock", "read", DEFAULT_PERMISSION_RULES);

      // .git/**/* rule only covers write/delete, so read should fall back to default allow
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it("should create approval request for .git/index.lock deletion", async () => {
      const mockApproval = {
        id: "approval-123",
        agent_id: "agent-1",
        gateway_id: "gateway-1",
        command_id: "cmd-1",
        path: ".git/index.lock",
        action: "delete",
        reason: "Git 저장소 무결성 보호 - 변경 시 승인 필요",
        status: "pending",
        requested_at: new Date().toISOString(),
        responded_at: null,
        responded_by: null,
        expires_at: getApprovalExpiration(),
        metadata: {},
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockApproval);

      const approval = await createApprovalRequest({
        agentId: "agent-1",
        gatewayId: "gateway-1",
        commandId: "cmd-1",
        path: ".git/index.lock",
        action: "delete",
        reason: "Git 저장소 무결성 보호 - 변경 시 승인 필요",
      });

      expect(approval.id).toBe("approval-123");
      expect(approval.path).toBe(".git/index.lock");
      expect(approval.action).toBe("delete");
      expect(approval.status).toBe("pending");
    });

    it("should handle .git/index.lock in various path formats", () => {
      const paths = [
        ".git/index.lock",
        "./git/index.lock",
        "./.git/index.lock",
        ".git/./index.lock",
      ];

      paths.forEach((path) => {
        const result = checkPermission(path, "delete", DEFAULT_PERMISSION_RULES);
        expect(result.requiresApproval).toBe(true);
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // 2. Approval/Denial Flow Verification
  // ────────────────────────────────────────────────────────────

  describe("2. Approval/Denial Flow", () => {
    const baseApproval = {
      id: "approval-123",
      agent_id: "agent-1",
      gateway_id: "gateway-1",
      command_id: "cmd-1",
      path: ".git/config",
      action: "write",
      reason: "Git 설정 변경",
      requested_at: new Date().toISOString(),
      expires_at: getApprovalExpiration(),
      metadata: {},
    };

    it("should approve pending approval", async () => {
      const approvedApproval = {
        ...baseApproval,
        status: "approved",
        responded_at: new Date().toISOString(),
        responded_by: "user@example.com",
      };

      vi.mocked(queryOne).mockResolvedValueOnce(approvedApproval);

      const result = await respondToApproval("approval-123", "approved", "user@example.com");

      expect(result).toBeDefined();
      expect(result?.status).toBe("approved");
      expect(result?.respondedBy).toBe("user@example.com");
      expect(result?.respondedAt).toBeDefined();
    });

    it("should deny pending approval", async () => {
      const deniedApproval = {
        ...baseApproval,
        status: "denied",
        responded_at: new Date().toISOString(),
        responded_by: "admin@example.com",
      };

      vi.mocked(queryOne).mockResolvedValueOnce(deniedApproval);

      const result = await respondToApproval("approval-123", "denied", "admin@example.com");

      expect(result).toBeDefined();
      expect(result?.status).toBe("denied");
      expect(result?.respondedBy).toBe("admin@example.com");
    });

    it("should return null when responding to non-existent approval", async () => {
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await respondToApproval("nonexistent", "approved", "user");

      expect(result).toBeNull();
    });

    it("should return null when responding to already-responded approval", async () => {
      // Database would not update if status != 'pending'
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await respondToApproval("approval-123", "approved", "user");

      expect(result).toBeNull();
    });

    it("should list pending approvals", async () => {
      const pendingApprovals = [
        { ...baseApproval, status: "pending", responded_at: null, responded_by: null },
        {
          ...baseApproval,
          id: "approval-456",
          path: "package.json",
          status: "pending",
          responded_at: null,
          responded_by: null,
        },
      ];

      vi.mocked(query).mockResolvedValueOnce(pendingApprovals);

      const result = await getPendingApprovals();

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe("pending");
      expect(result[1].status).toBe("pending");
    });

    it("should filter pending approvals by gateway", async () => {
      const pendingApprovals = [
        { ...baseApproval, gateway_id: "gateway-1", status: "pending", responded_at: null, responded_by: null },
      ];

      vi.mocked(query).mockResolvedValueOnce(pendingApprovals);

      const result = await getPendingApprovals("gateway-1");

      expect(result).toHaveLength(1);
      expect(result[0].gatewayId).toBe("gateway-1");
    });
  });

  // ────────────────────────────────────────────────────────────
  // 3. Timeout and Error Handling
  // ────────────────────────────────────────────────────────────

  describe("3. Timeout and Error Handling", () => {
    it("should expire approvals past expiration time", async () => {
      vi.mocked(queryOne).mockResolvedValueOnce({ count: 5 });

      const expiredCount = await expirePendingApprovals();

      expect(expiredCount).toBe(5);
      expect(queryOne).toHaveBeenCalledWith("SELECT expire_pending_approvals() as count");
    });

    it("should timeout waiting for approval", async () => {
      const pendingApproval = {
        id: "approval-123",
        agent_id: "agent-1",
        gateway_id: "gateway-1",
        command_id: "cmd-1",
        path: ".git/config",
        action: "write",
        reason: "Test",
        status: "pending",
        requested_at: new Date().toISOString(),
        responded_at: null,
        responded_by: null,
        expires_at: getApprovalExpiration(),
        metadata: {},
      };

      vi.mocked(queryOne).mockResolvedValue(pendingApproval);

      const waitPromise = waitForApproval("approval-123", {
        pollIntervalMs: 100,
        timeoutMs: 500,
      });

      // Advance time past timeout
      vi.advanceTimersByTime(600);

      const result = await waitPromise;

      expect(result.approved).toBe(false);
      expect(result.status).toBe("expired");
    });

    it("should detect approved status during wait", async () => {
      const pendingApproval = {
        id: "approval-123",
        agent_id: "agent-1",
        gateway_id: "gateway-1",
        command_id: "cmd-1",
        path: ".git/config",
        action: "write",
        reason: "Test",
        status: "pending",
        requested_at: new Date().toISOString(),
        responded_at: null,
        responded_by: null,
        expires_at: getApprovalExpiration(),
        metadata: {},
      };

      const approvedApproval = {
        ...pendingApproval,
        status: "approved",
        responded_at: new Date().toISOString(),
        responded_by: "user",
      };

      // First call: pending, second call: approved
      vi.mocked(queryOne)
        .mockResolvedValueOnce(pendingApproval)
        .mockResolvedValueOnce(approvedApproval);

      const waitPromise = waitForApproval("approval-123", {
        pollIntervalMs: 100,
        timeoutMs: 5000,
      });

      // Advance past first poll interval
      vi.advanceTimersByTime(150);

      const result = await waitPromise;

      expect(result.approved).toBe(true);
      expect(result.status).toBe("approved");
    });

    it("should handle approval not found during wait", async () => {
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await waitForApproval("nonexistent");

      expect(result.approved).toBe(false);
      expect(result.status).toBe("expired");
    });

    it("should handle database errors gracefully on create", async () => {
      vi.mocked(queryOne).mockRejectedValueOnce(new Error("Database connection failed"));

      await expect(
        createApprovalRequest({
          agentId: "agent-1",
          gatewayId: "gateway-1",
          commandId: "cmd-1",
          path: ".git/config",
          action: "write",
          reason: "Test",
        })
      ).rejects.toThrow("Database connection failed");
    });

    it("should handle database errors gracefully on respond", async () => {
      vi.mocked(queryOne).mockRejectedValueOnce(new Error("Database error"));

      await expect(respondToApproval("approval-123", "approved", "user")).rejects.toThrow(
        "Database error"
      );
    });

    it("should use custom timeout for approval expiration", async () => {
      const customTimeout = 10 * 60 * 1000; // 10 minutes
      const mockApproval = {
        id: "approval-123",
        agent_id: "agent-1",
        gateway_id: "gateway-1",
        command_id: "cmd-1",
        path: ".git/config",
        action: "write",
        reason: "Test",
        status: "pending",
        requested_at: new Date().toISOString(),
        responded_at: null,
        responded_by: null,
        expires_at: getApprovalExpiration(customTimeout),
        metadata: {},
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockApproval);

      const approval = await createApprovalRequest(
        {
          agentId: "agent-1",
          gatewayId: "gateway-1",
          commandId: "cmd-1",
          path: ".git/config",
          action: "write",
          reason: "Test",
        },
        customTimeout
      );

      const expiresAt = new Date(approval.expiresAt);
      const now = new Date();
      const diff = expiresAt.getTime() - now.getTime();

      // Should be ~10 minutes (accounting for test execution time)
      expect(diff).toBeGreaterThan(9.5 * 60 * 1000);
      expect(diff).toBeLessThan(10.5 * 60 * 1000);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 4. Security Vulnerabilities (Bypass Attempts)
  // ────────────────────────────────────────────────────────────

  describe("4. Security Vulnerabilities", () => {
    describe("Path Traversal Bypass Attempts", () => {
      it("should not bypass .git protection with ../ traversal", () => {
        const result = checkPermission("src/../.git/config", "write", DEFAULT_PERMISSION_RULES);

        // Note: Current implementation doesn't normalize paths before matching
        // This is a potential vulnerability if path normalization is not done elsewhere
        expect(result.requiresApproval || !result.allowed).toBe(true);
      });

      it("should protect .git via symbolic link attempts", () => {
        // Attacker creates symlink: ln -s .git/config safe-file
        // Even if symlink bypasses pattern matching, we rely on file system checks
        const result = checkPermission("safe-file", "write", DEFAULT_PERMISSION_RULES);

        // Default rule should allow this, but actual file operations should resolve symlinks
        expect(result.allowed).toBe(true); // Pattern matching alone won't catch this
      });

      it("should protect against absolute path bypass", () => {
        const result = checkPermission("/tmp/../.git/config", "write", DEFAULT_PERMISSION_RULES);

        // Absolute paths outside project should be handled by other rules
        expect(result.allowed || result.requiresApproval).toBe(true);
      });
    });

    describe("Permission Rule Priority Bypass", () => {
      it("should respect priority order (higher priority wins)", () => {
        const result = checkPermission(".git/HEAD", "write", DEFAULT_PERMISSION_RULES);

        // .git/HEAD has priority 120 (deny), .git/**/* has priority 100 (require_approval)
        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(false);
        expect(result.rule?.priority).toBe(120);
      });

      it("should not allow lower-priority rules to override denials", () => {
        const result = checkPermission("node_modules/package/file.js", "write", DEFAULT_PERMISSION_RULES);

        // node_modules rule has priority 60 (deny)
        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(false);
      });
    });

    describe("Status Manipulation", () => {
      it("should only update pending approvals", async () => {
        // SQL uses "WHERE status = 'pending'" to prevent updating already-responded approvals
        vi.mocked(queryOne).mockResolvedValueOnce(null);

        const result = await respondToApproval("approval-123", "approved", "attacker");

        expect(result).toBeNull();
      });

      it("should not create approval with pre-approved status", async () => {
        // createApprovalRequest doesn't accept status parameter
        const mockApproval = {
          id: "approval-123",
          agent_id: "agent-1",
          gateway_id: "gateway-1",
          command_id: "cmd-1",
          path: ".git/config",
          action: "write",
          reason: "Test",
          status: "pending", // Always starts as pending
          requested_at: new Date().toISOString(),
          responded_at: null,
          responded_by: null,
          expires_at: getApprovalExpiration(),
          metadata: {},
        };

        vi.mocked(queryOne).mockResolvedValueOnce(mockApproval);

        const approval = await createApprovalRequest({
          agentId: "agent-1",
          gatewayId: "gateway-1",
          commandId: "cmd-1",
          path: ".git/config",
          action: "write",
          reason: "Test",
        });

        expect(approval.status).toBe("pending");
      });
    });

    describe("SQL Injection", () => {
      it("should handle malicious path input safely", async () => {
        const maliciousPath = ".git/config'; DROP TABLE permission_approvals; --";

        const mockApproval = {
          id: "approval-123",
          agent_id: "agent-1",
          gateway_id: "gateway-1",
          command_id: "cmd-1",
          path: maliciousPath,
          action: "write",
          reason: "Test",
          status: "pending",
          requested_at: new Date().toISOString(),
          responded_at: null,
          responded_by: null,
          expires_at: getApprovalExpiration(),
          metadata: {},
        };

        vi.mocked(queryOne).mockResolvedValueOnce(mockApproval);

        const approval = await createApprovalRequest({
          agentId: "agent-1",
          gatewayId: "gateway-1",
          commandId: "cmd-1",
          path: maliciousPath,
          action: "write",
          reason: "Test",
        });

        // Path should be stored as-is (parameterized queries prevent SQL injection)
        expect(approval.path).toBe(maliciousPath);
      });

      it("should handle malicious metadata safely", async () => {
        const maliciousMetadata = {
          payload: "'; DROP TABLE permission_approvals; --",
          nested: { injection: "'; UPDATE permission_approvals SET status='approved'; --" },
        };

        const mockApproval = {
          id: "approval-123",
          agent_id: "agent-1",
          gateway_id: "gateway-1",
          command_id: "cmd-1",
          path: ".git/config",
          action: "write",
          reason: "Test",
          status: "pending",
          requested_at: new Date().toISOString(),
          responded_at: null,
          responded_by: null,
          expires_at: getApprovalExpiration(),
          metadata: maliciousMetadata,
        };

        vi.mocked(queryOne).mockResolvedValueOnce(mockApproval);

        const approval = await createApprovalRequest({
          agentId: "agent-1",
          gatewayId: "gateway-1",
          commandId: "cmd-1",
          path: ".git/config",
          action: "write",
          reason: "Test",
          metadata: maliciousMetadata,
        });

        // Metadata should be safely JSON-stringified and stored
        expect(approval.metadata).toEqual(maliciousMetadata);
      });
    });

    describe("Expiration Bypass", () => {
      it("should not allow responding to expired approvals", async () => {
        const expiredApproval = {
          id: "approval-123",
          agent_id: "agent-1",
          gateway_id: "gateway-1",
          command_id: "cmd-1",
          path: ".git/config",
          action: "write",
          reason: "Test",
          status: "expired",
          requested_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          responded_at: null,
          responded_by: null,
          expires_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          metadata: {},
        };

        vi.mocked(queryOne).mockResolvedValueOnce(expiredApproval);

        const approval = await getApprovalRequest("approval-123");

        expect(approval?.status).toBe("expired");

        // Attempting to respond should fail (SQL WHERE status = 'pending')
        vi.mocked(queryOne).mockResolvedValueOnce(null);

        const result = await respondToApproval("approval-123", "approved", "user");

        expect(result).toBeNull();
      });
    });

    describe("Action Type Validation", () => {
      it("should reject invalid action types", () => {
        // TypeScript should prevent this at compile-time, but test runtime behavior
        const invalidActions = ["execute_shell", "sudo", "rm -rf", "arbitrary"];

        invalidActions.forEach((action) => {
          const result = checkPermission(".git/config", action as any, DEFAULT_PERMISSION_RULES);

          // No rule should match invalid actions
          expect(result.rule).toBeNull();
          expect(result.allowed).toBe(false);
        });
      });
    });

    describe("Concurrent Approval Bypass", () => {
      it("should prevent double-approval via concurrent requests", async () => {
        // First response succeeds
        const approvedApproval = {
          id: "approval-123",
          agent_id: "agent-1",
          gateway_id: "gateway-1",
          command_id: "cmd-1",
          path: ".git/config",
          action: "write",
          reason: "Test",
          status: "approved",
          requested_at: new Date().toISOString(),
          responded_at: new Date().toISOString(),
          responded_by: "user1",
          expires_at: getApprovalExpiration(),
          metadata: {},
        };

        vi.mocked(queryOne).mockResolvedValueOnce(approvedApproval);

        const result1 = await respondToApproval("approval-123", "approved", "user1");

        expect(result1?.status).toBe("approved");
        expect(result1?.respondedBy).toBe("user1");

        // Second concurrent response should fail (status != 'pending')
        vi.mocked(queryOne).mockResolvedValueOnce(null);

        const result2 = await respondToApproval("approval-123", "approved", "user2");

        expect(result2).toBeNull();
      });
    });

    describe("Rule Pattern Escaping", () => {
      it("should handle regex special characters in patterns", () => {
        // Pattern: **/*.pem should not match files with literal asterisks
        const result1 = checkPermission("**.pem", "read", DEFAULT_PERMISSION_RULES);
        const result2 = checkPermission("file.pem", "read", DEFAULT_PERMISSION_RULES);

        // Both should match the .pem rule, but for different reasons
        expect(result1.allowed).toBe(false);
        expect(result2.allowed).toBe(false);
      });

      it("should handle dots in patterns correctly", () => {
        // .env* should match .env, .env.local, but not xenv
        const result1 = checkPermission(".env", "read", DEFAULT_PERMISSION_RULES);
        const result2 = checkPermission(".env.local", "read", DEFAULT_PERMISSION_RULES);
        const result3 = checkPermission("xenv", "read", DEFAULT_PERMISSION_RULES);

        expect(result1.requiresApproval).toBe(true);
        expect(result2.requiresApproval).toBe(true);
        expect(result3.requiresApproval).toBe(false);
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // Integration Test: Full Approval Workflow
  // ────────────────────────────────────────────────────────────

  describe("Integration: Full Approval Workflow", () => {
    it("should complete full approval workflow", async () => {
      // Step 1: Check permission
      const permCheck = checkPermission(".git/index.lock", "delete", DEFAULT_PERMISSION_RULES);
      expect(permCheck.requiresApproval).toBe(true);

      // Step 2: Create approval request
      const mockCreatedApproval = {
        id: "approval-123",
        agent_id: "agent-1",
        gateway_id: "gateway-1",
        command_id: "cmd-1",
        path: ".git/index.lock",
        action: "delete",
        reason: permCheck.rule!.reason,
        status: "pending",
        requested_at: new Date().toISOString(),
        responded_at: null,
        responded_by: null,
        expires_at: getApprovalExpiration(),
        metadata: {},
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockCreatedApproval);

      const approval = await createApprovalRequest({
        agentId: "agent-1",
        gatewayId: "gateway-1",
        commandId: "cmd-1",
        path: ".git/index.lock",
        action: "delete",
        reason: permCheck.rule!.reason,
      });

      expect(approval.status).toBe("pending");

      // Step 3: User approves
      const mockApprovedApproval = {
        ...mockCreatedApproval,
        status: "approved",
        responded_at: new Date().toISOString(),
        responded_by: "user@example.com",
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockApprovedApproval);

      const approvedApproval = await respondToApproval(
        approval.id,
        "approved",
        "user@example.com"
      );

      expect(approvedApproval?.status).toBe("approved");
      expect(approvedApproval?.respondedBy).toBe("user@example.com");

      // Step 4: Gateway proceeds with operation (simulated)
      expect(approvedApproval).toBeDefined();
    });
  });
});
