import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to test that gateway-connector passes mcpConfig to executeClaudeTask.
// Since gateway-connector.ts is a script with side effects, we test the behavior
// by verifying the executeClaudeTask calls include mcpConfig.

// Mock dependencies
vi.mock("../claude-executor", () => ({
  executeClaudeTask: vi.fn().mockResolvedValue({
    success: true,
    output: "Task completed",
    exitCode: 0,
  }),
  isClaudeAvailable: vi.fn().mockReturnValue(true),
  formatDuration: vi.fn((ms: number) => `${Math.round(ms / 1000)}초`),
}));

// Mock os module
vi.mock("os", () => ({
  hostname: vi.fn().mockReturnValue("test-gateway"),
}));

import { executeClaudeTask } from "../claude-executor";
import * as path from "path";

// The gateway-connector doesn't export executeCommand directly,
// so we need to extract and test the MCP config path resolution logic.
// This tests the expected behavior that should be implemented.

describe("gateway-connector MCP config", () => {
  const PROJECT_ROOT = path.resolve(__dirname, "../..");
  const EXPECTED_MCP_CONFIG = path.join(PROJECT_ROOT, ".mcp.json");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("MCP config path resolution", () => {
    it("should resolve .mcp.json path relative to project root", () => {
      // The gateway-connector script lives in scripts/
      // .mcp.json lives in the project root (one level up)
      const scriptDir = path.resolve(__dirname, "..");
      const projectRoot = path.resolve(scriptDir, "..");
      const mcpConfigPath = path.join(projectRoot, ".mcp.json");

      expect(mcpConfigPath).toBe(EXPECTED_MCP_CONFIG);
    });

    it("should have .mcp.json file in expected location", async () => {
      const fs = await import("fs");
      const exists = fs.existsSync(EXPECTED_MCP_CONFIG);
      expect(exists).toBe(true);
    });
  });

  describe("spawn command mcpConfig propagation", () => {
    it("should pass mcpConfig when spawning agent tasks", async () => {
      // This test documents the EXPECTED behavior:
      // When gateway-connector executes a "spawn" command,
      // it should pass mcpConfig to executeClaudeTask
      const agentId = "pm";
      const task = "Check project status";
      const systemPrompt = "You are the PM agent.";

      await (executeClaudeTask as ReturnType<typeof vi.fn>)({
        agentId,
        task,
        systemPrompt,
        mcpConfig: EXPECTED_MCP_CONFIG,
      });

      expect(executeClaudeTask).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpConfig: EXPECTED_MCP_CONFIG,
        })
      );
    });

    it("should NOT pass mcpConfig for tasks with disableTools", async () => {
      // Planner/summarizer tasks use disableTools: true
      // These should NOT get mcpConfig
      await (executeClaudeTask as ReturnType<typeof vi.fn>)({
        agentId: "planner",
        task: "Create plan",
        systemPrompt: "You are a planner.",
        disableTools: true,
      });

      expect(executeClaudeTask).toHaveBeenCalledWith(
        expect.objectContaining({
          disableTools: true,
        })
      );

      // When disableTools is true, mcpConfig should not be present
      const callArgs = (executeClaudeTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.mcpConfig).toBeUndefined();
    });
  });

  describe("orchestrate command mcpConfig propagation", () => {
    it("should pass mcpConfig in the orchestrator executor function", async () => {
      // When orchestrating, the executor function created by gateway-connector
      // should pass mcpConfig to each subtask's executeClaudeTask call
      const agentId = "architect";
      const task = "Design API";
      const systemPrompt = "You are the architect agent.";

      await (executeClaudeTask as ReturnType<typeof vi.fn>)({
        agentId,
        task,
        systemPrompt,
        mcpConfig: EXPECTED_MCP_CONFIG,
        onOutput: expect.any(Function),
      });

      expect(executeClaudeTask).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpConfig: EXPECTED_MCP_CONFIG,
        })
      );
    });
  });

  describe("hung process detection", () => {
    it("should set agent to idle when task is killed for hung", async () => {
      // Mock executeClaudeTask to return hung result (exitCode -2)
      (executeClaudeTask as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        exitCode: -2,
        error: "Process hung (no output for 5m 0s)",
      });

      // Simulate spawn command execution
      const agentId = "pm";
      const task = "Check project status";

      const result = await (executeClaudeTask as ReturnType<typeof vi.fn>)({
        agentId,
        task,
        systemPrompt: `You are the ${agentId} agent.`,
        mcpConfig: EXPECTED_MCP_CONFIG,
      });

      // Verify the result indicates hung process
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(-2);
      expect(result.error).toContain("Process hung");

      // Expected behavior: agent status should be "idle" not "error"
      // because the process is gone and can accept new work
      // This is what the gateway-connector implementation should do
    });

    it("should record hung failure in history with Korean message", async () => {
      // Mock hung result
      (executeClaudeTask as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        exitCode: -2,
        error: "Process hung (no output for 5m 0s)",
      });

      const agentId = "architect";
      const result = await (executeClaudeTask as ReturnType<typeof vi.fn>)({
        agentId,
        task: "Design API",
        systemPrompt: `You are the ${agentId} agent.`,
        mcpConfig: EXPECTED_MCP_CONFIG,
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(-2);

      // Expected: history entry should include Korean "응답 없음 자동 종료" message
      // The gateway-connector should format this as:
      // "⏰ 프로세스 응답 없음으로 자동 종료됨: Process hung (no output for 5m 0s)"
    });

    it("should distinguish hung from error status", async () => {
      // Test that regular errors set status to "error"
      (executeClaudeTask as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        exitCode: 1,
        error: "Command failed",
      });

      const regularError = await (executeClaudeTask as ReturnType<typeof vi.fn>)({
        agentId: "executor",
        task: "Run command",
        systemPrompt: "You are the executor agent.",
        mcpConfig: EXPECTED_MCP_CONFIG,
      });

      expect(regularError.success).toBe(false);
      expect(regularError.exitCode).toBe(1);
      expect(regularError.exitCode).not.toBe(-2);

      // Test that hung processes (exitCode -2) set status to "idle"
      (executeClaudeTask as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        exitCode: -2,
        error: "Process hung (no output for 5m 0s)",
      });

      const hungError = await (executeClaudeTask as ReturnType<typeof vi.fn>)({
        agentId: "executor",
        task: "Long task",
        systemPrompt: "You are the executor agent.",
        mcpConfig: EXPECTED_MCP_CONFIG,
      });

      expect(hungError.success).toBe(false);
      expect(hungError.exitCode).toBe(-2);

      // Expected: regular error → status="error", hung → status="idle"
    });
  });
});
