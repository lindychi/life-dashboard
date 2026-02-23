/**
 * Claude CLI Executor
 *
 * Claude CLI를 사용하여 에이전트 태스크를 실행하는 모듈.
 * gateway-connector에서 import하여 사용.
 */

import { execFileSync, spawn, type ChildProcess } from "child_process";

export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
  elapsedMs?: number;
  stderrOutput?: string; // Add this for debugging
  provider?: "claude" | "codex";
  rateLimited?: boolean;
  fallbackUsed?: boolean;
  fallbackReason?: "rate_limit";
}

// Safe tools whitelist: file operations + MCP tools, NO Bash execution
const ALLOWED_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "mcp__life-dashboard",
].join(",");

const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /too many requests/i,
  /429/i,
  /quota/i,
  /usage limit/i,
  /limit (reached|exceeded)/i,
  /exceeded.*limit/i,
  /capacity/i,
  /overloaded/i,
  /요청.*많/i,
  /속도 제한/i,
  /요청 한도/i,
  /사용량 제한/i,
  /할당량/i,
];

function isRateLimitError(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(text));
}

function getCodexBin(): string {
  return process.env.CODEX_BIN || "codex";
}

export interface ClaudeExecutorOptions {
  agentId: string;
  task: string;
  systemPrompt: string;
  workDir?: string;
  timeout?: number; // ms, 0 = no timeout (default)
  staleTimeout?: number; // ms, kill if no output for this long (default: 300000 = 5 min, 0 = disabled)
  onOutput?: (chunk: string) => void;
  disableTools?: boolean; // If true, disable all tools to avoid plan mode hanging
  mcpConfig?: string; // Path to MCP config file (optional, defaults to .mcp.json in project root)
  allowBash?: boolean; // If true, include Bash in allowed tools (use with caution)
}

/**
 * Check if Claude CLI is available on PATH
 */
export function isClaudeAvailable(): boolean {
  try {
    execFileSync("which", ["claude"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Codex CLI is available on PATH
 */
export function isCodexAvailable(): boolean {
  try {
    execFileSync("which", [getCodexBin()], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Format milliseconds into human-readable duration
 * e.g. 5000 → "5초", 65000 → "1분 5초", 3600000 → "1시간 0분"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}초`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}분 ${seconds}초` : `${minutes}분`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}시간 ${remainingMinutes}분` : `${hours}시간`;
}

/**
 * Execute a task using Claude CLI
 *
 * Spawns `claude` with --print flag for non-interactive output.
 * Uses --system-prompt to set agent personality.
 */
export function executeClaudeTask(
  options: ClaudeExecutorOptions
): Promise<ExecutionResult> {
  const { task, systemPrompt, workDir, timeout = 0, staleTimeout = 300000, onOutput, disableTools, mcpConfig, allowBash } = options;

  return new Promise((resolve) => {
    const startTime = Date.now();
    let resolved = false;

    const safeResolve = (result: ExecutionResult) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const args = ["--print"];

    // Security: use --allowedTools whitelist instead of --dangerously-skip-permissions
    // This prevents arbitrary Bash execution if the relay server is compromised
    if (disableTools) {
      args.push("--tools", "");
    } else {
      const tools = allowBash ? `${ALLOWED_TOOLS},Bash` : ALLOWED_TOOLS;
      args.push("--allowedTools", tools);

      // Add MCP config if provided
      if (mcpConfig) {
        args.push("--mcp-config", mcpConfig);
      }
    }

    args.push("--no-session-persistence", "--system-prompt", systemPrompt, task);

    const child: ChildProcess = spawn("claude", args, {
      cwd: workDir || process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let lastOutputTime = Date.now();
    let lastStderrTime = Date.now();
    let lastActivityTime = Date.now(); // max(stdout, stderr)

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
      lastOutputTime = Date.now();
      lastActivityTime = Date.now();
      onOutput?.(data.toString());
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
      lastStderrTime = Date.now();
      lastActivityTime = Date.now();
      // Log stderr activity so gateway can see work in progress
      if (onOutput && data.toString().trim()) {
        onOutput(`[stderr] ${data.toString().trim().slice(0, 200)}\n`);
      }
    });

    // Wall-clock timeout
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (timeout > 0) {
      timer = setTimeout(() => {
        if (staleTimer) clearInterval(staleTimer);
        staleTimer = null;
        child.kill("SIGTERM");
        safeResolve({
          success: false,
          error: `Timeout after ${formatDuration(timeout)}`,
          exitCode: -1,
          elapsedMs: Date.now() - startTime,
          provider: "claude",
          rateLimited: false,
        });
      }, timeout);
    }

    // Hung process detection (no output timeout)
    let staleTimer: ReturnType<typeof setInterval> | null = null;
    if (staleTimeout > 0) {
      let warnedStale = false;
      staleTimer = setInterval(() => {
        const now = Date.now();
        const silentMs = now - lastActivityTime;
        const stdoutSilentMs = now - lastOutputTime;

        // Warning: 60% of stale timeout with no activity at all
        if (!warnedStale && silentMs > staleTimeout * 0.6) {
          warnedStale = true;
          const msg = `⚠️ No activity for ${formatDuration(silentMs)} (stale timeout: ${formatDuration(staleTimeout)})`;
          console.warn(msg);
          onOutput?.(`[warning] ${msg}\n`);
        }

        // Kill: no activity (stdout OR stderr) for full stale timeout
        if (silentMs > staleTimeout) {
          if (timer) clearTimeout(timer);
          timer = null;
          if (staleTimer) clearInterval(staleTimer);
          staleTimer = null;

          child.kill("SIGTERM");
          setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              // Process may already be dead
            }
          }, 5000);

          const detail = `stdout silent: ${formatDuration(stdoutSilentMs)}, total silent: ${formatDuration(silentMs)}`;
          safeResolve({
            success: false,
            error: `Process hung (no activity for ${formatDuration(staleTimeout)}). ${detail}`,
            exitCode: -2,
            elapsedMs: now - startTime,
            provider: "claude",
            rateLimited: false,
          });
        } else if (warnedStale && silentMs < staleTimeout * 0.3) {
          // Reset warning if activity resumes
          warnedStale = false;
        }
      }, 15000); // Check every 15 seconds (was 30s, now more responsive)
    }

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      if (staleTimer) clearInterval(staleTimer);
      safeResolve({
        success: false,
        error: err.message,
        exitCode: -1,
        elapsedMs: Date.now() - startTime,
        provider: "claude",
        rateLimited: false,
      });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (staleTimer) clearInterval(staleTimer);
      if (code === 0) {
        safeResolve({
          success: true,
          output: stdout.trim(),
          exitCode: 0,
          elapsedMs: Date.now() - startTime,
          stderrOutput: stderr.trim() || undefined,
          provider: "claude",
          rateLimited: false,
        });
      } else {
        const combinedOutput = `${stderr}\n${stdout}`.trim();
        const rateLimited = isRateLimitError(combinedOutput);
        const baseError = stderr.trim() || `Process exited with code ${code}`;
        const errorMessage = rateLimited ? `Claude rate limit exceeded: ${baseError}` : baseError;

        safeResolve({
          success: false,
          output: stdout.trim(),
          error: errorMessage,
          exitCode: code ?? -1,
          elapsedMs: Date.now() - startTime,
          stderrOutput: stderr.trim() || undefined,
          provider: "claude",
          rateLimited,
        });
      }
    });
  });
}

export async function executeCodexTask(
  options: ClaudeExecutorOptions
): Promise<ExecutionResult> {
  const {
    task,
    systemPrompt,
    workDir,
    timeout = 0,
    staleTimeout = 300000,
    onOutput,
    disableTools,
  } = options;

  return new Promise((resolve) => {
    const startTime = Date.now();
    let resolved = false;

    const safeResolve = (result: ExecutionResult) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const sandboxMode = disableTools
      ? "read-only"
      : process.env.CODEX_SANDBOX || "workspace-write";
    const approvalMode = process.env.CODEX_APPROVAL || "never";
    const model = process.env.CODEX_MODEL;

    const args: string[] = ["--ask-for-approval", approvalMode];

    if (sandboxMode) {
      args.push("--sandbox", sandboxMode);
    }

    args.push("exec", "--ephemeral", "--color", "never");

    if (workDir) {
      args.push("--cd", workDir);
    }

    if (model) {
      args.push("--model", model);
    }

    args.push("-");

    const child: ChildProcess = spawn(getCodexBin(), args, {
      cwd: workDir || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    const prompt = systemPrompt ? `${systemPrompt}\n\n${task}` : task;
    child.stdin?.write(prompt);
    child.stdin?.end();

    let stdout = "";
    let stderr = "";
    let lastOutputTime = Date.now();
    let lastActivityTime = Date.now();

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
      lastOutputTime = Date.now();
      lastActivityTime = Date.now();
      onOutput?.(data.toString());
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
      lastActivityTime = Date.now();
      if (onOutput && data.toString().trim()) {
        onOutput(`[stderr] ${data.toString().trim().slice(0, 200)}\n`);
      }
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (timeout > 0) {
      timer = setTimeout(() => {
        if (staleTimer) clearInterval(staleTimer);
        staleTimer = null;
        child.kill("SIGTERM");
        safeResolve({
          success: false,
          error: `Timeout after ${formatDuration(timeout)}`,
          exitCode: -1,
          elapsedMs: Date.now() - startTime,
          provider: "codex",
          rateLimited: false,
        });
      }, timeout);
    }

    let staleTimer: ReturnType<typeof setInterval> | null = null;
    if (staleTimeout > 0) {
      let warnedStale = false;
      staleTimer = setInterval(() => {
        const now = Date.now();
        const silentMs = now - lastActivityTime;
        const stdoutSilentMs = now - lastOutputTime;

        if (!warnedStale && silentMs > staleTimeout * 0.6) {
          warnedStale = true;
          const msg = `⚠️ No activity for ${formatDuration(silentMs)} (stale timeout: ${formatDuration(staleTimeout)})`;
          console.warn(msg);
          onOutput?.(`[warning] ${msg}\n`);
        }

        if (silentMs > staleTimeout) {
          if (timer) clearTimeout(timer);
          timer = null;
          if (staleTimer) clearInterval(staleTimer);
          staleTimer = null;

          child.kill("SIGTERM");
          setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              // Process may already be dead
            }
          }, 5000);

          const detail = `stdout silent: ${formatDuration(stdoutSilentMs)}, total silent: ${formatDuration(silentMs)}`;
          safeResolve({
            success: false,
            error: `Process hung (no activity for ${formatDuration(staleTimeout)}). ${detail}`,
            exitCode: -2,
            elapsedMs: now - startTime,
            provider: "codex",
            rateLimited: false,
          });
        } else if (warnedStale && silentMs < staleTimeout * 0.3) {
          warnedStale = false;
        }
      }, 15000);
    }

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      if (staleTimer) clearInterval(staleTimer);
      safeResolve({
        success: false,
        error: err.message,
        exitCode: -1,
        elapsedMs: Date.now() - startTime,
        provider: "codex",
        rateLimited: false,
      });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (staleTimer) clearInterval(staleTimer);
      if (code === 0) {
        safeResolve({
          success: true,
          output: stdout.trim(),
          exitCode: 0,
          elapsedMs: Date.now() - startTime,
          stderrOutput: stderr.trim() || undefined,
          provider: "codex",
          rateLimited: false,
        });
      } else {
        const baseError = stderr.trim() || `Process exited with code ${code}`;
        safeResolve({
          success: false,
          output: stdout.trim(),
          error: baseError,
          exitCode: code ?? -1,
          elapsedMs: Date.now() - startTime,
          stderrOutput: stderr.trim() || undefined,
          provider: "codex",
          rateLimited: false,
        });
      }
    });
  });
}

export async function executeLlmTask(
  options: ClaudeExecutorOptions
): Promise<ExecutionResult> {
  const claudeResult = await executeClaudeTask(options);

  if (claudeResult.success || !claudeResult.rateLimited) {
    return claudeResult;
  }

  if (!isCodexAvailable()) {
    return {
      ...claudeResult,
      fallbackUsed: false,
      fallbackReason: "rate_limit",
      error: `${claudeResult.error || "Claude rate limit exceeded"} (Codex CLI not available)`,
    };
  }

  const codexResult = await executeCodexTask(options);

  if (codexResult.success) {
    return {
      ...codexResult,
      fallbackUsed: true,
      fallbackReason: "rate_limit",
      rateLimited: false,
    };
  }

  const combinedError = `Claude rate limit exceeded. Codex fallback failed: ${codexResult.error || "unknown error"}`;

  return {
    ...codexResult,
    success: false,
    error: combinedError,
    fallbackUsed: true,
    fallbackReason: "rate_limit",
    rateLimited: false,
  };
}
