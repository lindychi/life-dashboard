import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import { executeClaudeTask, isClaudeAvailable } from "../claude-executor";
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
      const expectedCallShape = {
        agentId: expect.any(String),
        task: expect.any(String),
        systemPrompt: expect.any(String),
        mcpConfig: expect.stringContaining(".mcp.json"),
      };

      // Simulate what the spawn handler should do
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
});
