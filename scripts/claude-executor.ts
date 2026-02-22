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
}

export interface ClaudeExecutorOptions {
  agentId: string;
  task: string;
  systemPrompt: string;
  workDir?: string;
  timeout?: number; // ms, 0 = no timeout (default)
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
  const { task, systemPrompt, workDir, timeout = 0 } = options;

  return new Promise((resolve) => {
    const startTime = Date.now();

    const args = [
      "--print",
      "--permission-mode",
      "plan",
      "--no-session-persistence",
      "--system-prompt",
      systemPrompt,
      task,
    ];

    const child: ChildProcess = spawn("claude", args, {
      cwd: workDir || process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (timeout > 0) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({
          success: false,
          error: `Timeout after ${formatDuration(timeout)}`,
          exitCode: -1,
          elapsedMs: Date.now() - startTime,
        });
      }, timeout);
    }

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        success: false,
        error: err.message,
        exitCode: -1,
        elapsedMs: Date.now() - startTime,
      });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({
          success: true,
          output: stdout.trim(),
          exitCode: 0,
          elapsedMs: Date.now() - startTime,
        });
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          error: stderr.trim() || `Process exited with code ${code}`,
          exitCode: code ?? -1,
          elapsedMs: Date.now() - startTime,
        });
      }
    });
  });
}
