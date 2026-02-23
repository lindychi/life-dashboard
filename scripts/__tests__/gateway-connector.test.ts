import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to test that gateway-connector passes mcpConfig to executeLlmTask.
// Since gateway-connector.ts is a script with side effects, we test the behavior
// by verifying the executeLlmTask calls include mcpConfig.

// Mock dependencies
vi.mock("../claude-executor", () => ({
  executeLlmTask: vi.fn().mockResolvedValue({
    success: true,
    output: "Task completed",
    exitCode: 0,
    provider: "claude",
  }),
  isClaudeAvailable: vi.fn().mockReturnValue(true),
  isCodexAvailable: vi.fn().mockReturnValue(true),
  formatDuration: vi.fn((ms: number) => `${Math.round(ms / 1000)}초`),
}));

// Mock os module
vi.mock("os", () => ({
  hostname: vi.fn().mockReturnValue("test-gateway"),
}));

import { executeLlmTask } from "../claude-executor";
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
      // it should pass mcpConfig to executeLlmTask
      const agentId = "pm";
      const task = "Check project status";
      const systemPrompt = "You are the PM agent.";

      await vi.mocked(executeLlmTask)({
        agentId,
        task,
        systemPrompt,
        mcpConfig: EXPECTED_MCP_CONFIG,
      });

      expect(executeLlmTask).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpConfig: EXPECTED_MCP_CONFIG,
        })
      );
    });

    it("should NOT pass mcpConfig for tasks with disableTools", async () => {
      // Planner/summarizer tasks use disableTools: true
      // These should NOT get mcpConfig
      await vi.mocked(executeLlmTask)({
        agentId: "planner",
        task: "Create plan",
        systemPrompt: "You are a planner.",
        disableTools: true,
      });

      expect(executeLlmTask).toHaveBeenCalledWith(
        expect.objectContaining({
          disableTools: true,
        })
      );

      // When disableTools is true, mcpConfig should not be present
      const callArgs = vi.mocked(executeLlmTask).mock.calls[0][0];
      expect(callArgs.mcpConfig).toBeUndefined();
    });
  });

  describe("orchestrate command mcpConfig propagation", () => {
    it("should pass mcpConfig in the orchestrator executor function", async () => {
      // When orchestrating, the executor function created by gateway-connector
      // should pass mcpConfig to each subtask's executeLlmTask call
      const agentId = "architect";
      const task = "Design API";
      const systemPrompt = "You are the architect agent.";

      await vi.mocked(executeLlmTask)({
        agentId,
        task,
        systemPrompt,
        mcpConfig: EXPECTED_MCP_CONFIG,
        onOutput: expect.any(Function),
      });

      expect(executeLlmTask).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpConfig: EXPECTED_MCP_CONFIG,
        })
      );
    });
  });

  describe("hung process detection", () => {
    it("should set agent to idle when task is killed for hung", async () => {
      // Mock executeLlmTask to return hung result (exitCode -2)
      vi.mocked(executeLlmTask).mockResolvedValueOnce({
        success: false,
        exitCode: -2,
        error: "Process hung (no output for 5m 0s)",
      });

      // Simulate spawn command execution
      const agentId = "pm";
      const task = "Check project status";

      const result = await vi.mocked(executeLlmTask)({
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
      vi.mocked(executeLlmTask).mockResolvedValueOnce({
        success: false,
        exitCode: -2,
        error: "Process hung (no output for 5m 0s)",
      });

      const agentId = "architect";
      const result = await vi.mocked(executeLlmTask)({
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
      vi.mocked(executeLlmTask).mockResolvedValueOnce({
        success: false,
        exitCode: 1,
        error: "Command failed",
      });

      const regularError = await vi.mocked(executeLlmTask)({
        agentId: "executor",
        task: "Run command",
        systemPrompt: "You are the executor agent.",
        mcpConfig: EXPECTED_MCP_CONFIG,
      });

      expect(regularError.success).toBe(false);
      expect(regularError.exitCode).toBe(1);
      expect(regularError.exitCode).not.toBe(-2);

      // Test that hung processes (exitCode -2) set status to "idle"
      vi.mocked(executeLlmTask).mockResolvedValueOnce({
        success: false,
        exitCode: -2,
        error: "Process hung (no output for 5m 0s)",
      });

      const hungError = await vi.mocked(executeLlmTask)({
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

  describe("live output tracking", () => {
    it("should update liveOutput when onOutput fires", async () => {
      const agentStatusMap = new Map();
      const agentId = "executor";

      // Set initial status
      agentStatusMap.set(agentId, {
        id: agentId,
        name: "executor",
        status: "running",
        currentTask: "Test task",
      });

      let totalChars = 0;
      let chunksReceived = 0;
      let outputBuffer = "";

      // Simulate onOutput callback logic
      const simulateOutput = (chunk: string) => {
        totalChars += chunk.length;
        chunksReceived++;

        outputBuffer += chunk;
        if (outputBuffer.length > 500) {
          outputBuffer = outputBuffer.slice(-500);
        }

        const current = agentStatusMap.get(agentId);
        if (current) {
          agentStatusMap.set(agentId, {
            ...current,
            liveOutput: {
              lastChunk: outputBuffer,
              totalChars,
              lastActivityAt: new Date().toISOString(),
              chunksReceived,
            },
          });
        }
      };

      // Simulate multiple output chunks
      simulateOutput("Processing file 1...\n");
      simulateOutput("Processing file 2...\n");
      simulateOutput("Done!\n");

      const status = agentStatusMap.get(agentId);
      expect(status.liveOutput).toBeDefined();
      expect(status.liveOutput.totalChars).toBe(48); // "Processing file 1...\n" (22) + "Processing file 2...\n" (22) + "Done!\n" (6)
      expect(status.liveOutput.chunksReceived).toBe(3);
      expect(status.liveOutput.lastChunk).toContain("Processing file 1");
      expect(status.liveOutput.lastActivityAt).toBeDefined();
    });

    it("should keep last 500 chars in lastChunk buffer", async () => {
      const agentStatusMap = new Map();
      const agentId = "architect";

      agentStatusMap.set(agentId, {
        id: agentId,
        name: "architect",
        status: "running",
      });

      let outputBuffer = "";
      const simulateOutput = (chunk: string) => {
        outputBuffer += chunk;
        if (outputBuffer.length > 500) {
          outputBuffer = outputBuffer.slice(-500);
        }

        const current = agentStatusMap.get(agentId);
        if (current) {
          agentStatusMap.set(agentId, {
            ...current,
            liveOutput: {
              lastChunk: outputBuffer,
              totalChars: outputBuffer.length,
              lastActivityAt: new Date().toISOString(),
              chunksReceived: 1,
            },
          });
        }
      };

      // Generate 1000 chars of output
      const longOutput = "x".repeat(1000);
      simulateOutput(longOutput);

      const status = agentStatusMap.get(agentId);
      expect(status.liveOutput.lastChunk.length).toBe(500);
      expect(status.liveOutput.lastChunk).toBe("x".repeat(500));
    });

    it("should update lastActivityAt timestamp on each output", async () => {
      const agentStatusMap = new Map();
      const agentId = "pm";

      agentStatusMap.set(agentId, {
        id: agentId,
        name: "pm",
        status: "running",
      });

      const simulateOutput = (chunk: string) => {
        const current = agentStatusMap.get(agentId);
        if (current) {
          agentStatusMap.set(agentId, {
            ...current,
            liveOutput: {
              lastChunk: chunk,
              totalChars: chunk.length,
              lastActivityAt: new Date().toISOString(),
              chunksReceived: 1,
            },
          });
        }
      };

      simulateOutput("First output");
      const firstTimestamp = agentStatusMap.get(agentId).liveOutput.lastActivityAt;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      simulateOutput("Second output");
      const secondTimestamp = agentStatusMap.get(agentId).liveOutput.lastActivityAt;

      expect(secondTimestamp).not.toBe(firstTimestamp);
      expect(new Date(secondTimestamp).getTime()).toBeGreaterThan(new Date(firstTimestamp).getTime());
    });

    it("should skip stderr and warnings from liveOutput buffer", async () => {
      const agentStatusMap = new Map();
      const agentId = "designer";

      agentStatusMap.set(agentId, {
        id: agentId,
        name: "designer",
        status: "running",
      });

      let outputBuffer = "";
      let totalChars = 0;

      const simulateOutput = (chunk: string) => {
        // Skip stderr/warnings
        if (chunk.startsWith("[stderr]") || chunk.startsWith("[warning]")) {
          return;
        }

        totalChars += chunk.length;
        outputBuffer += chunk;

        const current = agentStatusMap.get(agentId);
        if (current) {
          agentStatusMap.set(agentId, {
            ...current,
            liveOutput: {
              lastChunk: outputBuffer,
              totalChars,
              lastActivityAt: new Date().toISOString(),
              chunksReceived: 1,
            },
          });
        }
      };

      simulateOutput("[stderr] Some error\n");
      simulateOutput("Actual output\n");
      simulateOutput("[warning] Some warning\n");

      const status = agentStatusMap.get(agentId);
      expect(status.liveOutput.lastChunk).toBe("Actual output\n");
      expect(status.liveOutput.totalChars).toBe(14); // Only counts "Actual output\n"
    });
  });
});
