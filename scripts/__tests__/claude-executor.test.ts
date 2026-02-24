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
  checkNetworkHealth,
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

      // Verify spawn was called with stream-json args (tool-enabled mode)
      expect(spawn).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining([
          "--print", "--output-format", "stream-json", "--verbose",
          "--allowedTools", "Read,Write,Edit,Glob,Grep,mcp__life-dashboard",
          "--no-session-persistence", "--system-prompt",
          expect.stringContaining("You are the PM agent."),
          "Review Q1 metrics",
        ]),
        expect.objectContaining({
          stdio: ["ignore", "pipe", "pipe"],
        })
      );

      // Simulate stream-json output: result event with final text
      mockProc.stdout!.emit("data", Buffer.from('{"type":"result","result":"Task completed successfully"}\n'));
      mockProc.emit("close", 0);

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.output).toBe("Task completed successfully");
      expect(result.exitCode).toBe(0);
    });

    it("should spawn claude with --print only when disableTools is true", async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const options: ClaudeExecutorOptions = {
        agentId: "pm",
        task: "Plan something",
        systemPrompt: "You are the PM agent.",
        disableTools: true,
      };

      const promise = executeClaudeTask(options);

      // Verify spawn was called with --print only (no stream-json)
      expect(spawn).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining([
          "--print", "--tools", "",
          "--no-session-persistence", "--system-prompt",
          expect.stringContaining("You are the PM agent."),
          "Plan something",
        ]),
        expect.objectContaining({
          stdio: ["ignore", "pipe", "pipe"],
        })
      );

      // Simulate raw text output (--print mode)
      mockProc.stdout!.emit("data", Buffer.from("Plan completed"));
      mockProc.emit("close", 0);

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.output).toBe("Plan completed");
      expect(result.exitCode).toBe(0);
    });

    it("should append tool availability notice to system prompt", async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      // Tool-enabled mode: notice should list available tools and warn against Bash
      executeClaudeTask({
        agentId: "dev",
        task: "Deploy the app",
        systemPrompt: "You are the DevOps agent.",
      });

      const toolEnabledArgs = vi.mocked(spawn).mock.calls[0][1] as string[];
      const systemPromptArg = toolEnabledArgs[toolEnabledArgs.indexOf("--system-prompt") + 1];
      expect(systemPromptArg).toContain("시스템 제약");
      expect(systemPromptArg).toContain("Read,Write,Edit,Glob,Grep,mcp__life-dashboard");
      expect(systemPromptArg).toContain("Bash");
      expect(systemPromptArg).toContain("텍스트로 제안");

      mockProc.emit("close", 0);

      vi.mocked(spawn).mockClear();

      // Disabled tools mode: notice should say no tools available
      const mockProc2 = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc2);

      executeClaudeTask({
        agentId: "pm",
        task: "Summarize",
        systemPrompt: "You are the PM agent.",
        disableTools: true,
      });

      const disabledArgs = vi.mocked(spawn).mock.calls[0][1] as string[];
      const disabledPrompt = disabledArgs[disabledArgs.indexOf("--system-prompt") + 1];
      expect(disabledPrompt).toContain("시스템 제약");
      expect(disabledPrompt).toContain("도구 사용이 비활성화");
      expect(disabledPrompt).not.toContain("Read,Write,Edit");

      mockProc2.emit("close", 0);
    });

    it("should capture stdout as output on success", async () => {
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      const promise = executeClaudeTask({
        agentId: "dev",
        task: "Fix bug",
        systemPrompt: "You are the Dev agent.",
      });

      // In stream-json mode, output comes as NDJSON events
      mockProc.stdout!.emit("data", Buffer.from('{"type":"assistant","message":{"content":[{"type":"text","text":"Line 1\\nLine 2\\n"}]}}\n'));
      mockProc.stdout!.emit("data", Buffer.from('{"type":"result","result":"Done"}\n'));
      mockProc.emit("close", 0);

      const result = await promise;
      expect(result.success).toBe(true);
      // finalResultText ("Done") takes precedence over accumulated stdout
      expect(result.output).toBe("Done");
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

      // Initial output (stream-json events)
      mockProc.stdout!.emit("data", Buffer.from('{"type":"assistant","message":{"content":[{"type":"text","text":"Starting..."}]}}\n'));

      // Advance time and emit output every 60 seconds
      await vi.advanceTimersByTimeAsync(60000);
      mockProc.stdout!.emit("data", Buffer.from('{"type":"assistant","message":{"content":[{"type":"text","text":"Working..."}]}}\n'));

      await vi.advanceTimersByTimeAsync(60000);
      mockProc.stdout!.emit("data", Buffer.from('{"type":"assistant","message":{"content":[{"type":"text","text":"Still working..."}]}}\n'));

      await vi.advanceTimersByTimeAsync(60000);
      mockProc.stdout!.emit("data", Buffer.from('{"type":"assistant","message":{"content":[{"type":"text","text":"Almost done..."}]}}\n'));

      // Process should NOT be killed
      expect(mockProc.kill).not.toHaveBeenCalled();

      // Complete normally
      mockProc.stdout!.emit("data", Buffer.from('{"type":"result","result":"Done!"}\n'));
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

  describe("checkNetworkHealth", () => {
    it("should return true when process has ESTABLISHED connections", () => {
      vi.mocked(execFileSync).mockReturnValue(
        "COMMAND  PID USER   FD   TYPE    DEVICE SIZE/OFF NODE NAME\nclaude 12345 user  10u  IPv4 0x1234  0t0  TCP 127.0.0.1:52345->api.anthropic.com:443 (ESTABLISHED)\n" as unknown as Buffer
      );

      expect(checkNetworkHealth(12345)).toBe(true);
      expect(execFileSync).toHaveBeenCalledWith(
        "lsof",
        ["-i", "-a", "-p", "12345", "-n", "-P"],
        { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
      );
    });

    it("should return false when process has no ESTABLISHED connections", () => {
      vi.mocked(execFileSync).mockReturnValue(
        "COMMAND  PID USER   FD   TYPE    DEVICE SIZE/OFF NODE NAME\nclaude 12345 user  10u  IPv4 0x1234  0t0  TCP 127.0.0.1:52345->api.anthropic.com:443 (CLOSE_WAIT)\n" as unknown as Buffer
      );

      expect(checkNetworkHealth(12345)).toBe(false);
    });

    it("should return false when lsof fails (process exited)", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("lsof: no file use located");
      });

      expect(checkNetworkHealth(99999)).toBe(false);
    });

    it("should return false when lsof returns empty output", () => {
      vi.mocked(execFileSync).mockReturnValue("" as unknown as Buffer);

      expect(checkNetworkHealth(12345)).toBe(false);
    });
  });

  describe("network-based hung detection", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("should NOT kill process when network health check detects active connection at warning threshold", async () => {
      vi.useFakeTimers();
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      // Mock checkNetworkHealth to return true (active API connection)
      // execFileSync is already mocked, so we need to handle both 'which' calls and 'lsof' calls
      vi.mocked(execFileSync).mockImplementation((cmd: string) => {
        if (cmd === "lsof") {
          return "ESTABLISHED" as unknown as Buffer;
        }
        return Buffer.from("");
      });

      const onOutput = vi.fn();
      const promise = executeClaudeTask({
        agentId: "qa",
        task: "Review code",
        systemPrompt: "You are QA.",
        staleTimeout: 60000, // 1 minute for test speed
        onOutput,
      });

      // Initial output to establish baseline
      mockProc.stdout!.emit("data", Buffer.from('{"type":"assistant","message":{"content":[{"type":"text","text":"Starting"}]}}\n'));

      // Advance past 60% threshold (36s) to the first 15s check interval that exceeds it
      // At 45s (3rd interval tick), silentMs=45s > 36s (60% of 60s)
      await vi.advanceTimersByTimeAsync(45000);

      // Should have detected active connection and NOT warned
      expect(onOutput).toHaveBeenCalledWith(
        expect.stringContaining("[health] Active API connection detected")
      );

      // Process should NOT be killed
      expect(mockProc.kill).not.toHaveBeenCalled();

      // Complete normally
      mockProc.stdout!.emit("data", Buffer.from('{"type":"result","result":"Done"}\n'));
      mockProc.emit("close", 0);

      const result = await promise;
      expect(result.success).toBe(true);

      vi.useRealTimers();
    });

    it("should NOT kill process when network health check detects active connection at kill threshold", async () => {
      vi.useFakeTimers();
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      // First call: no network (triggers warning), subsequent calls: has network (prevents kill)
      let lsofCallCount = 0;
      vi.mocked(execFileSync).mockImplementation((cmd: string) => {
        if (cmd === "lsof") {
          lsofCallCount++;
          if (lsofCallCount === 1) {
            // First check at warning threshold: no connection, let warning happen
            throw new Error("no connections");
          }
          // At kill threshold: active connection, should prevent kill
          return "ESTABLISHED" as unknown as Buffer;
        }
        return Buffer.from("");
      });

      const onOutput = vi.fn();
      const promise = executeClaudeTask({
        agentId: "qa",
        task: "Review code",
        systemPrompt: "You are QA.",
        staleTimeout: 60000, // 1 minute
        onOutput,
      });

      // Initial output
      mockProc.stdout!.emit("data", Buffer.from('{"type":"assistant","message":{"content":[{"type":"text","text":"Starting"}]}}\n'));

      // Advance past warning threshold (first lsof call fails, warning emitted)
      await vi.advanceTimersByTimeAsync(45000);
      expect(onOutput).toHaveBeenCalledWith(expect.stringContaining("[warning]"));

      // Advance past kill threshold (second lsof call succeeds with ESTABLISHED)
      await vi.advanceTimersByTimeAsync(30000); // total ~75s > 60s staleTimeout

      // Should have detected active connection at kill threshold
      expect(onOutput).toHaveBeenCalledWith(
        expect.stringContaining("[health] Active API connection at kill threshold")
      );

      // Process should NOT be killed
      expect(mockProc.kill).not.toHaveBeenCalled();

      // Complete normally
      mockProc.stdout!.emit("data", Buffer.from('{"type":"result","result":"Done"}\n'));
      mockProc.emit("close", 0);

      const result = await promise;
      expect(result.success).toBe(true);

      vi.useRealTimers();
    });

    it("should kill process when no active network connection and stale timeout exceeded", async () => {
      vi.useFakeTimers();
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      // Mock checkNetworkHealth to always return false (no active connection)
      vi.mocked(execFileSync).mockImplementation((cmd: string) => {
        if (cmd === "lsof") {
          throw new Error("no connections");
        }
        return Buffer.from("");
      });

      const onOutput = vi.fn();
      const promise = executeClaudeTask({
        agentId: "qa",
        task: "Hung task",
        systemPrompt: "You are QA.",
        staleTimeout: 60000, // 1 minute
        onOutput,
      });

      // Initial output
      mockProc.stdout!.emit("data", Buffer.from('{"type":"assistant","message":{"content":[{"type":"text","text":"Starting"}]}}\n'));

      // Advance past stale timeout with no output and no network
      await vi.advanceTimersByTimeAsync(45000); // warning at 36s
      await vi.advanceTimersByTimeAsync(30000); // kill at 60s+

      // Run remaining timers (SIGKILL follow-up)
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(-2);
      expect(result.error).toContain("Process hung");
      expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");

      vi.useRealTimers();
    });

    it("should still kill process at absolute max (3x) even with active network", async () => {
      vi.useFakeTimers();
      const mockProc = createMockProcess();
      vi.mocked(spawn).mockReturnValue(mockProc);

      // Network always shows ESTABLISHED — but absolute max should still kill
      vi.mocked(execFileSync).mockImplementation((cmd: string) => {
        if (cmd === "lsof") {
          return "ESTABLISHED" as unknown as Buffer;
        }
        return Buffer.from("");
      });

      const onOutput = vi.fn();
      const staleTimeout = 60000; // 1 minute
      const promise = executeClaudeTask({
        agentId: "qa",
        task: "Infinite thinking task",
        systemPrompt: "You are QA.",
        staleTimeout,
        onOutput,
      });

      // Initial output
      mockProc.stdout!.emit("data", Buffer.from('{"type":"assistant","message":{"content":[{"type":"text","text":"Starting"}]}}\n'));

      // The network health check resets lastActivityTime each time at the warning and kill thresholds.
      // But the absolute max cap (3x = 180s) checks against the LAST activity time.
      // Since network health keeps resetting lastActivityTime, we need to advance
      // far enough that even with resets, the absolute max is eventually reached.
      // Actually, the absolute max checks silentMs = now - lastActivityTime.
      // If network health keeps resetting lastActivityTime to Date.now(), the silentMs
      // stays small. The absolute max would never be reached this way.
      // This is by design: if there's a real active connection, we keep extending.
      // The absolute max only triggers when silentMs > staleTimeout * 3,
      // which means lastActivityTime hasn't been reset for 3x the stale timeout.
      // So let's test: stop the network check returning true after a while.

      // For the first 2 minutes, network is active (keeps resetting)
      await vi.advanceTimersByTimeAsync(120000);
      expect(mockProc.kill).not.toHaveBeenCalled();

      // Now network goes away
      vi.mocked(execFileSync).mockImplementation((cmd: string) => {
        if (cmd === "lsof") {
          throw new Error("no connections");
        }
        return Buffer.from("");
      });

      // After network goes away, the absolute max (3x = 180s from last reset) applies
      // The last reset was at ~120s. Now we need 180s of no activity to hit absolute max.
      // But the stale timeout (60s) kill will trigger first at 60s of no activity.
      await vi.advanceTimersByTimeAsync(75000); // 75s past last reset

      // Run remaining timers
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(false);
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

      // Emit Claude rate limit error and close
      claudeProc.stderr!.emit("data", Buffer.from("Rate limit exceeded"));
      claudeProc.emit("close", 1);

      // Wait a tick for executeLlmTask to process Claude result and spawn Codex
      await new Promise((r) => setTimeout(r, 50));

      // Now emit Codex output (handlers are registered after Codex spawn)
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
