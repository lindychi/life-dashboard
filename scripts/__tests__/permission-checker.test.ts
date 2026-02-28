/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-function-type */
/**
 * Permission Checker - Integration Test Suite
 *
 * Tests gateway connector integration with permission system
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  checkAndRequestPermission,
  waitForApprovalDecision,
  extractPathsFromToolCall,
} from "../permission-checker";
import * as permissions from "../../src/lib/permissions";

// Mock HTTP calls
const mockApiCall = vi.fn();

vi.mock("http", () => ({
  request: (...args: any[]) => {
    const callback = args[1];
    const req = {
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(() => {
        // Simulate immediate response
        const res = {
          on: (event: string, handler: Function) => {
            if (event === "data") {
              handler(JSON.stringify(mockApiCall()));
            } else if (event === "end") {
              setTimeout(() => handler(), 0);
            }
          },
        };
        callback(res);
      }),
    };
    return req;
  },
}));

vi.mock("https", () => ({
  request: (...args: any[]) => {
    const callback = args[1];
    const req = {
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(() => {
        const res = {
          on: (event: string, handler: Function) => {
            if (event === "data") {
              handler(JSON.stringify(mockApiCall()));
            } else if (event === "end") {
              setTimeout(() => handler(), 0);
            }
          },
        };
        callback(res);
      }),
    };
    return req;
  },
}));

describe("Permission Checker - Gateway Integration", () => {
  const context = {
    agentId: "agent-1",
    gatewayId: "gateway-1",
    commandId: "cmd-1",
    relayUrl: "http://localhost:3000",
    relayApiKey: "test-key",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiCall.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("checkAndRequestPermission", () => {
    it("should allow operations that don't require approval", async () => {
      const result = await checkAndRequestPermission("src/lib/auth.ts", "write", context);

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
      expect(result.approvalId).toBeUndefined();
    });

    it("should deny operations outright", async () => {
      const result = await checkAndRequestPermission(".git/HEAD", "write", context);

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(false);
      expect(result.reason).toContain("직접 수정 금지");
    });

    it.skip("should request approval for .git/index.lock deletion", async () => {
      const mockApproval = {
        approval: {
          id: "approval-123",
          agentId: context.agentId,
          gatewayId: context.gatewayId,
          commandId: context.commandId,
          path: ".git/index.lock",
          action: "delete",
          reason: "Git 저장소 무결성 보호",
          status: "pending",
          requestedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
      };

      mockApiCall.mockReturnValueOnce(mockApproval);

      const result = await checkAndRequestPermission(".git/index.lock", "delete", context);

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.approvalId).toBe("approval-123");
      expect(result.reason).toContain("Git 저장소 무결성 보호");
    });

    it("should request approval for .git/config write", async () => {
      const mockApproval = {
        approval: {
          id: "approval-456",
          agentId: context.agentId,
          gatewayId: context.gatewayId,
          commandId: context.commandId,
          path: ".git/config",
          action: "write",
          reason: "Git 설정 파일",
          status: "pending",
          requestedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
      };

      mockApiCall.mockReturnValueOnce(mockApproval);

      const result = await checkAndRequestPermission(".git/config", "write", context);

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.approvalId).toBe("approval-456");
    });

    it("should handle API errors gracefully", async () => {
      // Mock API failure by throwing error
      mockApiCall.mockImplementationOnce(() => {
        throw new Error("Network error");
      });

      const result = await checkAndRequestPermission(".git/config", "write", context);

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(false);
      expect(result.reason).toBe("Failed to request approval");
    });
  });

  describe("waitForApprovalDecision", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("should detect approved status", async () => {
      const pendingApproval = {
        approval: {
          id: "approval-123",
          status: "pending",
          requestedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
      };

      const approvedApproval = {
        approval: {
          id: "approval-123",
          status: "approved",
          respondedBy: "user@example.com",
          respondedAt: new Date().toISOString(),
          requestedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
      };

      // First call: pending, second call: approved
      mockApiCall.mockReturnValueOnce(pendingApproval).mockReturnValueOnce(approvedApproval);

      const waitPromise = waitForApprovalDecision("approval-123", {
        relayUrl: context.relayUrl,
        relayApiKey: context.relayApiKey,
        pollIntervalMs: 100,
        timeoutMs: 5000,
      });

      // Advance time past first poll
      await vi.advanceTimersByTimeAsync(150);

      const result = await waitPromise;

      expect(result.approved).toBe(true);
      expect(result.status).toBe("approved");
    });

    it("should detect denied status", async () => {
      const deniedApproval = {
        approval: {
          id: "approval-123",
          status: "denied",
          respondedBy: "admin@example.com",
          respondedAt: new Date().toISOString(),
          requestedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
      };

      mockApiCall.mockReturnValueOnce(deniedApproval);

      const waitPromise = waitForApprovalDecision("approval-123", {
        relayUrl: context.relayUrl,
        relayApiKey: context.relayApiKey,
      });

      await vi.advanceTimersByTimeAsync(1);

      const result = await waitPromise;

      expect(result.approved).toBe(false);
      expect(result.status).toBe("denied");
    });

    it("should timeout if no response", async () => {
      const pendingApproval = {
        approval: {
          id: "approval-123",
          status: "pending",
          requestedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
      };

      mockApiCall.mockReturnValue(pendingApproval);

      const waitPromise = waitForApprovalDecision("approval-123", {
        relayUrl: context.relayUrl,
        relayApiKey: context.relayApiKey,
        pollIntervalMs: 1000,
        timeoutMs: 5000,
      });

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(6000);

      const result = await waitPromise;

      expect(result.approved).toBe(false);
      expect(result.status).toBe("timeout");
    });

    it("should handle API errors during polling", async () => {
      mockApiCall.mockImplementationOnce(() => {
        throw new Error("Network error");
      });

      const approvedApproval = {
        approval: {
          id: "approval-123",
          status: "approved",
          respondedBy: "user@example.com",
          respondedAt: new Date().toISOString(),
          requestedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
      };

      mockApiCall.mockReturnValueOnce(approvedApproval);

      const waitPromise = waitForApprovalDecision("approval-123", {
        relayUrl: context.relayUrl,
        relayApiKey: context.relayApiKey,
        pollIntervalMs: 100,
        timeoutMs: 5000,
      });

      // First poll fails, second succeeds
      await vi.advanceTimersByTimeAsync(150);

      const result = await waitPromise;

      expect(result.approved).toBe(true);
      expect(result.status).toBe("approved");
    });
  });

  describe("extractPathsFromToolCall", () => {
    it("should extract path from Read tool", () => {
      const paths = extractPathsFromToolCall("Read", { file_path: "src/lib/auth.ts" });

      expect(paths).toEqual([{ path: "src/lib/auth.ts", action: "read" }]);
    });

    it("should extract path from Write tool", () => {
      const paths = extractPathsFromToolCall("Write", { file_path: ".git/config" });

      expect(paths).toEqual([{ path: ".git/config", action: "write" }]);
    });

    it("should extract path from Edit tool", () => {
      const paths = extractPathsFromToolCall("Edit", { file_path: "package.json" });

      expect(paths).toEqual([{ path: "package.json", action: "write" }]);
    });

    it("should extract path from Bash rm command", () => {
      const paths = extractPathsFromToolCall("Bash", {
        command: "rm .git/index.lock",
      });

      expect(paths).toEqual([{ path: ".git/index.lock", action: "write" }]);
    });

    it("should extract path from Bash git command", () => {
      const paths = extractPathsFromToolCall("Bash", {
        command: "git config user.name 'Test'",
      });

      expect(paths).toHaveLength(1);
      expect(paths[0].action).toBe("write");
    });

    it("should handle Bash commands without dangerous operations", () => {
      const paths = extractPathsFromToolCall("Bash", {
        command: "ls -la",
      });

      expect(paths).toEqual([]);
    });

    it("should handle missing file_path", () => {
      const paths = extractPathsFromToolCall("Read", {});

      expect(paths).toEqual([]);
    });

    it("should handle unknown tool", () => {
      const paths = extractPathsFromToolCall("UnknownTool", { path: "test" });

      expect(paths).toEqual([]);
    });
  });
});
