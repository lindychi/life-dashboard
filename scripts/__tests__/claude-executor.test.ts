import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChildProcess } from "child_process";
import { EventEmitter } from "events";

// Mock child_process before importing the module
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

import { execFileSync, spawn } from "child_process";
import {
  isClaudeAvailable,
  executeClaudeTask,
  executeLlmTask,
  type ClaudeExecutorOptions,
} from "../claude-executor";

function createMockProcess(): ChildProcess & EventEmitter {
  const proc = new EventEmitter() as ChildProcess & EventEmitter;
  proc.stdout = new EventEmitter() as unknown as ChildProcess["stdout"];
  proc.stderr = new EventEmitter() as unknown as ChildProcess["stderr"];
  proc.kill = vi.fn().mockReturnValue(true);
  Object.defineProperty(proc, "pid", { value: 12345 });
  return proc;
}

describe("claude-executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isClaudeAvailable", () => {
    it("should return true when claude CLI exists", () => {
      vi.mocked(execFileSync).mockReturnValue(Buffer.from("/usr/local/bin/claude\n"));
      expect(isClaudeAvailable()).toBe(true);
      expect(execFileSync).toHaveBeenCalledWith("which", ["claude"], {
        stdio: "pipe",
      });
    });

    it("should return false when claude CLI is not found", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("not found");
      });
      expect(isClaudeAvailable()).toBe(false);
    });
  });

  describe("executeClaudeTask", () => {
    it("should spawn claude with correct arguments", async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const options: ClaudeExecutorOptions = {
        agentId: "pm",
        task: "Review Q1 metrics",
        systemPrompt: "You are the PM agent.",
      };

      const promise = executeClaudeTask(options);

      // Verify spawn was called with correct args
      expect(spawn).toHaveBeenCalledWith(
        "claude",
        ["--print", "--allowedTools", "Read,Write,Edit,Glob,Grep,mcp__life-dashboard", "--no-session-persistence", "--system-prompt", "You are the PM agent.", "Review Q1 metrics"],
        expect.objectContaining({
          stdio: ["ignore", "pipe", "pipe"],
        })
      );

      // Simulate successful completion
      mockProc.stdout!.emit("data", Buffer.from("Task completed successfully"));
      mockProc.emit("close", 0);

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.output).toBe("Task completed successfully");
      expect(result.exitCode).toBe(0);
    });

    it("should capture stdout as output on success", async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "dev",
        task: "Fix bug",
        systemPrompt: "You are the Dev agent.",
      });

      mockProc.stdout!.emit("data", Buffer.from("Line 1\n"));
      mockProc.stdout!.emit("data", Buffer.from("Line 2\n"));
      mockProc.stdout!.emit("data", Buffer.from("Done"));
      mockProc.emit("close", 0);

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.output).toBe("Line 1\nLine 2\nDone");
    });

    it("should return error on non-zero exit code", async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "dev",
        task: "Broken task",
        systemPrompt: "You are the Dev agent.",
      });

      mockProc.stderr!.emit("data", Buffer.from("Error: something went wrong"));
      mockProc.emit("close", 1);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toBe("Error: something went wrong");
      expect(result.exitCode).toBe(1);
    });

    it("should flag rate-limited errors", async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "dev",
        task: "Rate limited task",
        systemPrompt: "Prompt",
      });

      mockProc.stderr!.emit("data", Buffer.from("Rate limit exceeded"));
      mockProc.emit("close", 1);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.rateLimited).toBe(true);
      expect(result.error).toContain("rate limit");
    });

    it("should handle spawn errors (ENOENT)", async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "dev",
        task: "Task",
        systemPrompt: "Prompt",
      });

      mockProc.emit("error", new Error("spawn claude ENOENT"));

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toBe("spawn claude ENOENT");
      expect(result.exitCode).toBe(-1);
    });

    it("should respect timeout option", async () => {
      vi.useFakeTimers();
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "dev",
        task: "Long task",
        systemPrompt: "Prompt",
        timeout: 5000,
      });

      // Advance time past timeout
      vi.advanceTimersByTime(5001);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toContain("Timeout");
      expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");

      vi.useRealTimers();
    });

    it("should use default timeout of 0 (no timeout)", async () => {
      vi.useFakeTimers();
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "dev",
        task: "Task",
        systemPrompt: "Prompt",
        staleTimeout: 0, // Disable stale timeout for this test
      });

      // Should not timeout even after a very long time
      vi.advanceTimersByTime(999_999_999);

      // Manually close the process to resolve the promise
      mockProc.emit("close", 0);

      const result = await promise;
      expect(result.success).toBe(true);
      expect(mockProc.kill).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("should respect custom workDir", async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "dev",
        task: "Task",
        systemPrompt: "Prompt",
        workDir: "/custom/path",
      });

      expect(spawn).toHaveBeenCalledWith(
        "claude",
        expect.any(Array),
        expect.objectContaining({ cwd: "/custom/path" })
      );

      mockProc.emit("close", 0);
      await promise;
    });

    it("should handle null exit code", async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "dev",
        task: "Task",
        systemPrompt: "Prompt",
      });

      mockProc.emit("close", null);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(-1);
    });

    it("should pass --mcp-config when mcpConfig is provided", async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "pm",
        task: "Check status",
        systemPrompt: "You are PM.",
        mcpConfig: "/path/to/.mcp.json",
      });

      expect(spawn).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining(["--mcp-config", "/path/to/.mcp.json"]),
        expect.any(Object)
      );

      mockProc.emit("close", 0);
      await promise;
    });

    it("should not pass --mcp-config when mcpConfig is not provided", async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "pm",
        task: "Check status",
        systemPrompt: "You are PM.",
      });

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      expect(args).not.toContain("--mcp-config");

      mockProc.emit("close", 0);
      await promise;
    });

    it("should not pass --mcp-config when disableTools is true even if mcpConfig is provided", async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "pm",
        task: "Plan something",
        systemPrompt: "You are PM.",
        mcpConfig: "/path/to/.mcp.json",
        disableTools: true,
      });

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];
      expect(args).not.toContain("--mcp-config");

      mockProc.emit("close", 0);
      await promise;
    });

    it("should include both --allowedTools and --mcp-config in correct order", async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "pm",
        task: "Task",
        systemPrompt: "Prompt",
        mcpConfig: "/project/.mcp.json",
      });

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const args = spawnCall[1] as string[];

      // Should have both flags
      expect(args).toContain("--allowedTools");
      expect(args).toContain("Read,Write,Edit,Glob,Grep,mcp__life-dashboard");
      expect(args).toContain("--mcp-config");
      expect(args).toContain("/project/.mcp.json");

      // --mcp-config should come after --allowedTools
      const skipIndex = args.indexOf("--allowedTools");
      const mcpIndex = args.indexOf("--mcp-config");
      expect(mcpIndex).toBeGreaterThan(skipIndex);

      mockProc.emit("close", 0);
      await promise;
    });

    it("should kill hung process when no output for staleTimeout", async () => {
      vi.useFakeTimers();
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "dev",
        task: "Hung task",
        systemPrompt: "Prompt",
        staleTimeout: 120000, // 2 minutes
      });

      // Initial output
      mockProc.stdout!.emit("data", Buffer.from("Starting...\n"));

      // Advance time but no output
      await vi.advanceTimersByTimeAsync(30000); // 30s - check interval
      expect(mockProc.kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30000); // 60s total
      expect(mockProc.kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30000); // 90s total
      expect(mockProc.kill).not.toHaveBeenCalled();

      // Advance past stale timeout - should trigger kill
      await vi.advanceTimersByTimeAsync(30001); // 120s+ total - should detect hung

      // Run all pending timers to ensure promise resolution
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toContain("Process hung (no activity for");
      expect(result.error).toContain("2분");
      expect(result.exitCode).toBe(-2);
      expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");

      vi.useRealTimers();
    }, 10000); // Increase test timeout to 10s

    it("should NOT kill process that produces output slowly", async () => {
      vi.useFakeTimers();
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "dev",
        task: "Slow task",
        systemPrompt: "Prompt",
        staleTimeout: 120000, // 2 minutes
      });

      // Initial output
      mockProc.stdout!.emit("data", Buffer.from("Starting...\n"));

      // Advance time and emit output every 60 seconds
      await vi.advanceTimersByTimeAsync(60000);
      mockProc.stdout!.emit("data", Buffer.from("Working...\n"));

      await vi.advanceTimersByTimeAsync(60000);
      mockProc.stdout!.emit("data", Buffer.from("Still working...\n"));

      await vi.advanceTimersByTimeAsync(60000);
      mockProc.stdout!.emit("data", Buffer.from("Almost done...\n"));

      // Process should NOT be killed
      expect(mockProc.kill).not.toHaveBeenCalled();

      // Complete normally
      mockProc.stdout!.emit("data", Buffer.from("Done!"));
      mockProc.emit("close", 0);

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.output).toContain("Done!");
      expect(mockProc.kill).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("staleTimeout defaults to 5 minutes", async () => {
      vi.useFakeTimers();
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "dev",
        task: "Task",
        systemPrompt: "Prompt",
        // No staleTimeout specified
      });

      // Initial output
      mockProc.stdout!.emit("data", Buffer.from("Starting...\n"));

      // Advance time just under 5 minutes with no output
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 30000); // 4.5 minutes
      expect(mockProc.kill).not.toHaveBeenCalled();

      // Advance past 5 minutes
      await vi.advanceTimersByTimeAsync(60000); // Total: 5.5 minutes

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toContain("Process hung");
      expect(result.error).toContain("5분");
      expect(result.exitCode).toBe(-2);
      expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");

      vi.useRealTimers();
    });
  });

  describe("executeLlmTask", () => {
    it("should fall back to Codex when Claude is rate-limited", async () => {
      const claudeProc = createMockProcess();
      const codexProc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(claudeProc).mockReturnValueOnce(codexProc);
      vi.mocked(execFileSync).mockReturnValue(Buffer.from("/usr/local/bin/codex\n"));

      const promise = executeLlmTask({
        agentId: "dev",
        task: "Fallback task",
        systemPrompt: "Prompt",
      });

      claudeProc.stderr!.emit("data", Buffer.from("Rate limit exceeded"));
      claudeProc.emit("close", 1);

      codexProc.stdout!.emit("data", Buffer.from("Codex output"));
      codexProc.emit("close", 0);

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.provider).toBe("codex");
      expect(result.fallbackUsed).toBe(true);
      expect(result.output).toBe("Codex output");
      expect(vi.mocked(spawn).mock.calls[0][0]).toBe("claude");
      expect(vi.mocked(spawn).mock.calls[1][0]).toBe("codex");
    });

    it("should return Claude error when Codex is unavailable", async () => {
      const claudeProc = createMockProcess();
      vi.mocked(spawn).mockReturnValueOnce(claudeProc);
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("not found");
      });

      const promise = executeLlmTask({
        agentId: "dev",
        task: "Fallback task",
        systemPrompt: "Prompt",
      });

      claudeProc.stderr!.emit("data", Buffer.from("Rate limit exceeded"));
      claudeProc.emit("close", 1);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(false);
      expect(result.error).toContain("Codex CLI not available");
    });
  });
});
