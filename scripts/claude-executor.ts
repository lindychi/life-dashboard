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
}

export interface ClaudeExecutorOptions {
  agentId: string;
  task: string;
  systemPrompt: string;
  workDir?: string;
  timeout?: number; // ms, default 300000 (5 min)
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
 * Execute a task using Claude CLI
 *
 * Spawns `claude` with --print flag for non-interactive output.
 * Uses --system-prompt to set agent personality.
 */
export function executeClaudeTask(
  options: ClaudeExecutorOptions
): Promise<ExecutionResult> {
  const { task, systemPrompt, workDir, timeout = 300_000 } = options;

  return new Promise((resolve) => {
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

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        success: false,
        error: `Timeout after ${timeout}ms`,
        exitCode: -1,
      });
    }, timeout);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        error: err.message,
        exitCode: -1,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({
          success: true,
          output: stdout.trim(),
          exitCode: 0,
        });
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          error: stderr.trim() || `Process exited with code ${code}`,
          exitCode: code ?? -1,
        });
      }
    });
  });
}
