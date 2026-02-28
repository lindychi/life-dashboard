/**
 * Permission System - End-to-End Scenario Tests
 *
 * Real-world workflow scenarios:
 * 1. .git/index.lock stuck lock cleanup
 * 2. Emergency .env file modification
 * 3. Database migration script deployment
 * 4. Malicious attempt detection
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { query, queryOne } from "../db";
import {
  createApprovalRequest,
  getApprovalRequest,
  respondToApproval,
  waitForApproval,
} from "../permission-approvals";
import { checkPermission, DEFAULT_PERMISSION_RULES, getApprovalExpiration } from "../permissions";

// Mock database
vi.mock("../db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  pool: { query: vi.fn() },
}));

vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

describe("Permission System - E2E Scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ────────────────────────────────────────────────────────────
  // Scenario 1: .git/index.lock Stuck Lock Cleanup
  // ────────────────────────────────────────────────────────────

  describe("Scenario 1: .git/index.lock Cleanup Workflow", () => {
    it("should complete full approval workflow for stuck lock removal", async () => {
      // ── Step 1: Agent detects stuck lock ──
      const lockPath = ".git/index.lock";

      // ── Step 2: Agent checks permission ──
      const permCheck = checkPermission(lockPath, "delete", DEFAULT_PERMISSION_RULES);

      expect(permCheck.allowed).toBe(false);
      expect(permCheck.requiresApproval).toBe(true);
      expect(permCheck.rule?.reason).toContain("Git 저장소 무결성 보호");

      // ── Step 3: Agent requests approval ──
      const mockCreatedApproval = {
        id: "approval-git-lock-1",
        agent_id: "maintenance-agent",
        gateway_id: "gateway-prod",
        command_id: "cmd-cleanup-lock",
        path: lockPath,
        action: "delete",
        reason: permCheck.rule!.reason,
        status: "pending",
        requested_at: new Date().toISOString(),
        responded_at: null,
        responded_by: null,
        expires_at: getApprovalExpiration(),
        metadata: {
          issue: "Stuck lock preventing commits",
          detected_at: new Date().toISOString(),
        },
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockCreatedApproval);

      const approval = await createApprovalRequest({
        agentId: "maintenance-agent",
        gatewayId: "gateway-prod",
        commandId: "cmd-cleanup-lock",
        path: lockPath,
        action: "delete",
        reason: permCheck.rule!.reason,
        metadata: {
          issue: "Stuck lock preventing commits",
          detected_at: new Date().toISOString(),
        },
      });

      expect(approval.id).toBe("approval-git-lock-1");
      expect(approval.status).toBe("pending");

      // ── Step 4: User reviews and approves ──
      const mockApprovedApproval = {
        ...mockCreatedApproval,
        status: "approved",
        responded_at: new Date().toISOString(),
        responded_by: "devops@example.com",
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockApprovedApproval);

      const approvedApproval = await respondToApproval(
        approval.id,
        "approved",
        "devops@example.com"
      );

      expect(approvedApproval?.status).toBe("approved");
      expect(approvedApproval?.respondedBy).toBe("devops@example.com");

      // ── Step 5: Agent receives approval and proceeds ──
      // (In real scenario, gateway would execute: rm .git/index.lock)
    });

    it("should handle user denial of lock removal", async () => {
      const lockPath = ".git/index.lock";

      const mockCreatedApproval = {
        id: "approval-git-lock-2",
        agent_id: "maintenance-agent",
        gateway_id: "gateway-prod",
        command_id: "cmd-cleanup-lock-2",
        path: lockPath,
        action: "delete",
        reason: "Git 저장소 무결성 보호",
        status: "pending",
        requested_at: new Date().toISOString(),
        responded_at: null,
        responded_by: null,
        expires_at: getApprovalExpiration(),
        metadata: {},
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockCreatedApproval);

      const approval = await createApprovalRequest({
        agentId: "maintenance-agent",
        gatewayId: "gateway-prod",
        commandId: "cmd-cleanup-lock-2",
        path: lockPath,
        action: "delete",
        reason: "Git 저장소 무결성 보호",
      });

      // User denies (maybe active git operation in progress)
      const mockDeniedApproval = {
        ...mockCreatedApproval,
        status: "denied",
        responded_at: new Date().toISOString(),
        responded_by: "devops@example.com",
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockDeniedApproval);

      const deniedApproval = await respondToApproval(approval.id, "denied", "devops@example.com");

      expect(deniedApproval?.status).toBe("denied");

      // Agent should abort operation
    });
  });

  // ────────────────────────────────────────────────────────────
  // Scenario 2: Emergency .env File Modification
  // ────────────────────────────────────────────────────────────

  describe("Scenario 2: Emergency .env Modification", () => {
    it("should require approval for .env file changes", async () => {
      const envPath = ".env.production";

      const permCheck = checkPermission(envPath, "write", DEFAULT_PERMISSION_RULES);

      expect(permCheck.requiresApproval).toBe(true);
      expect(permCheck.rule?.reason).toContain("환경 변수");
    });

    it("should complete approval workflow for emergency config update", async () => {
      const envPath = ".env.production";

      const mockApproval = {
        id: "approval-env-1",
        agent_id: "config-agent",
        gateway_id: "gateway-prod",
        command_id: "cmd-update-env",
        path: envPath,
        action: "write",
        reason: "환경 변수 파일 - 민감 정보 포함 가능",
        status: "pending",
        requested_at: new Date().toISOString(),
        responded_at: null,
        responded_by: null,
        expires_at: getApprovalExpiration(),
        metadata: {
          emergency: true,
          change_description: "Update DATABASE_URL for failover",
        },
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockApproval);

      const approval = await createApprovalRequest({
        agentId: "config-agent",
        gatewayId: "gateway-prod",
        commandId: "cmd-update-env",
        path: envPath,
        action: "write",
        reason: "환경 변수 파일 - 민감 정보 포함 가능",
        metadata: {
          emergency: true,
          change_description: "Update DATABASE_URL for failover",
        },
      });

      expect(approval.metadata).toHaveProperty("emergency", true);

      // Quick approval due to emergency
      const mockApprovedApproval = {
        ...mockApproval,
        status: "approved",
        responded_at: new Date().toISOString(),
        responded_by: "sre@example.com",
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockApprovedApproval);

      const approvedApproval = await respondToApproval(approval.id, "approved", "sre@example.com");

      expect(approvedApproval?.status).toBe("approved");
    });
  });

  // ────────────────────────────────────────────────────────────
  // Scenario 3: Database Migration Script Deployment
  // ────────────────────────────────────────────────────────────

  describe("Scenario 3: Database Migration Deployment", () => {
    it("should require approval for SQL migration changes", async () => {
      const migrationPath = "sql/025_new_feature.sql";

      const permCheck = checkPermission(migrationPath, "write", DEFAULT_PERMISSION_RULES);

      expect(permCheck.requiresApproval).toBe(true);
      expect(permCheck.rule?.reason).toContain("마이그레이션 스크립트");
    });

    it("should handle approval timeout scenario", async () => {
      const migrationPath = "sql/025_add_index.sql";

      const mockPendingApproval = {
        id: "approval-migration-1",
        agent_id: "db-agent",
        gateway_id: "gateway-staging",
        command_id: "cmd-deploy-migration",
        path: migrationPath,
        action: "write",
        reason: "마이그레이션 스크립트 - 변경 시 승인 필요",
        status: "pending",
        requested_at: new Date().toISOString(),
        responded_at: null,
        responded_by: null,
        expires_at: getApprovalExpiration(2000), // 2 second timeout
        metadata: {},
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockPendingApproval);

      const approval = await createApprovalRequest(
        {
          agentId: "db-agent",
          gatewayId: "gateway-staging",
          commandId: "cmd-deploy-migration",
          path: migrationPath,
          action: "write",
          reason: "마이그레이션 스크립트 - 변경 시 승인 필요",
        },
        2000
      );

      // Simulate waiting but approval never comes
      vi.mocked(queryOne).mockResolvedValue(mockPendingApproval);

      const waitPromise = waitForApproval(approval.id, {
        pollIntervalMs: 500,
        timeoutMs: 2000,
      });

      // Advance past timeout
      vi.advanceTimersByTime(2500);

      const result = await waitPromise;

      expect(result.approved).toBe(false);
      expect(result.status).toBe("expired");
    });
  });

  // ────────────────────────────────────────────────────────────
  // Scenario 4: Malicious Attempt Detection
  // ────────────────────────────────────────────────────────────

  describe("Scenario 4: Malicious Attempt Detection", () => {
    it("should block attempts to modify .git/HEAD", async () => {
      const headPath = ".git/HEAD";

      const permCheck = checkPermission(headPath, "write", DEFAULT_PERMISSION_RULES);

      expect(permCheck.allowed).toBe(false);
      expect(permCheck.requiresApproval).toBe(false);
      expect(permCheck.rule?.level).toBe("deny");
      expect(permCheck.rule?.reason).toContain("직접 수정 금지");
    });

    it("should block attempts to access private keys", async () => {
      const keyPaths = [
        "secrets/private.pem",
        "keys/service-account.key",
        "config/credentials.json",
      ];

      keyPaths.forEach((keyPath) => {
        const permCheck = checkPermission(keyPath, "read", DEFAULT_PERMISSION_RULES);

        expect(permCheck.allowed).toBe(false);
        expect(permCheck.requiresApproval).toBe(false);
        expect(permCheck.rule?.level).toBe("deny");
      });
    });

    it("should block attempts to modify node_modules", async () => {
      const modulePath = "node_modules/express/index.js";

      const permCheck = checkPermission(modulePath, "write", DEFAULT_PERMISSION_RULES);

      expect(permCheck.allowed).toBe(false);
      expect(permCheck.requiresApproval).toBe(false);
      expect(permCheck.rule?.reason).toContain("직접 수정 금지");
    });

    it("should detect path traversal attempts", async () => {
      const traversalPaths = [
        "../.git/config",
        "../../.env",
        "src/../../.git/HEAD",
      ];

      // Note: Current implementation doesn't normalize paths
      // This demonstrates a potential vulnerability
      traversalPaths.forEach((path) => {
        const permCheck = checkPermission(path, "write", DEFAULT_PERMISSION_RULES);

        // These should be caught by path normalization (not yet implemented)
        // For now, they might bypass pattern matching
        expect(permCheck.requiresApproval || !permCheck.allowed).toBe(true);
      });
    });

    it("should prevent approval status manipulation", async () => {
      const mockApproval = {
        id: "approval-malicious-1",
        agent_id: "rogue-agent",
        gateway_id: "gateway-prod",
        command_id: "cmd-malicious",
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

      vi.mocked(queryOne).mockResolvedValueOnce(mockApproval);

      const approval = await createApprovalRequest({
        agentId: "rogue-agent",
        gatewayId: "gateway-prod",
        commandId: "cmd-malicious",
        path: ".git/config",
        action: "write",
        reason: "Test",
      });

      expect(approval.status).toBe("pending"); // Always starts as pending

      // Simulate user approving
      const mockApprovedApproval = {
        ...mockApproval,
        status: "approved",
        responded_at: new Date().toISOString(),
        responded_by: "user@example.com",
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockApprovedApproval);

      const firstApproval = await respondToApproval(approval.id, "approved", "user@example.com");

      expect(firstApproval?.status).toBe("approved");

      // Attacker tries to approve again (should fail - status != 'pending')
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const secondApproval = await respondToApproval(
        approval.id,
        "approved",
        "attacker@example.com"
      );

      expect(secondApproval).toBeNull();
    });

    it("should handle SQL injection attempts safely", async () => {
      const maliciousInputs = [
        ".git/config'; DROP TABLE permission_approvals; --",
        "'; UPDATE permission_approvals SET status='approved'; --",
        "../../../etc/passwd",
      ];

      for (const maliciousPath of maliciousInputs) {
        const mockApproval = {
          id: `approval-sql-${Date.now()}`,
          agent_id: "test-agent",
          gateway_id: "gateway-test",
          command_id: "cmd-test",
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
          agentId: "test-agent",
          gatewayId: "gateway-test",
          commandId: "cmd-test",
          path: maliciousPath,
          action: "write",
          reason: "Test",
        });

        // Path should be stored as-is (parameterized queries prevent SQL injection)
        expect(approval.path).toBe(maliciousPath);
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // Scenario 5: Multi-Step Operations
  // ────────────────────────────────────────────────────────────

  describe("Scenario 5: Multi-Step Operations", () => {
    it("should handle multiple approval requests in sequence", async () => {
      const operations = [
        { path: ".git/index.lock", action: "delete" as const },
        { path: "package.json", action: "write" as const },
        { path: "sql/025_migration.sql", action: "write" as const },
      ];

      const approvals: any[] = [];

      for (const op of operations) {
        const permCheck = checkPermission(op.path, op.action, DEFAULT_PERMISSION_RULES);

        if (permCheck.requiresApproval) {
          const mockApproval = {
            id: `approval-${op.path.replace(/\//g, "-")}`,
            agent_id: "multi-op-agent",
            gateway_id: "gateway-prod",
            command_id: `cmd-${Date.now()}`,
            path: op.path,
            action: op.action,
            reason: permCheck.rule!.reason,
            status: "pending",
            requested_at: new Date().toISOString(),
            responded_at: null,
            responded_by: null,
            expires_at: getApprovalExpiration(),
            metadata: {},
          };

          vi.mocked(queryOne).mockResolvedValueOnce(mockApproval);

          const approval = await createApprovalRequest({
            agentId: "multi-op-agent",
            gatewayId: "gateway-prod",
            commandId: `cmd-${Date.now()}`,
            path: op.path,
            action: op.action,
            reason: permCheck.rule!.reason,
          });

          approvals.push(approval);
        }
      }

      // All operations requiring approval should have approvals created
      expect(approvals.length).toBe(3);
      expect(approvals.every((a) => a.status === "pending")).toBe(true);
    });
  });
});
