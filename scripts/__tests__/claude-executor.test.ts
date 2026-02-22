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
  type ClaudeExecutorOptions,
} from "../claude-executor";

function createMockProcess(): ChildProcess & EventEmitter {
  const proc = new EventEmitter() as ChildProcess & EventEmitter;
  proc.stdout = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
  proc.stderr = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
  proc.kill = vi.fn().mockReturnValue(true);
  proc.pid = 12345;
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
        ["--print", "--permission-mode", "plan", "--no-session-persistence", "--system-prompt", "You are the PM agent.", "Review Q1 metrics"],
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

    it("should use default timeout of 300000ms", async () => {
      vi.useFakeTimers();
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "dev",
        task: "Task",
        systemPrompt: "Prompt",
      });

      // Should not timeout at 299s
      vi.advanceTimersByTime(299_000);
      // Process hasn't resolved yet

      // Timeout at 300s
      vi.advanceTimersByTime(1_001);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toContain("Timeout after 300000ms");

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
  });
});
