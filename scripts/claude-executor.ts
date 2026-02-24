/**
 * Claude CLI Executor
 *
 * Claude CLI를 사용하여 에이전트 태스크를 실행하는 모듈.
 * gateway-connector에서 import하여 사용.
 */

import { execFileSync, spawn, type ChildProcess } from "child_process";
import { isTmuxAvailable, spawnInTmux, getProcessState } from "./tmux-manager";

export interface ToolCall {
  name: string;
  input?: Record<string, unknown>;
  result?: string;
  timestamp: string;
}

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
  retriesUsed?: number;
  toolCalls?: ToolCall[];
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
  onToolCall?: (toolCall: ToolCall) => void; // Called for each tool_use with input/result details
  disableTools?: boolean; // If true, disable all tools to avoid plan mode hanging
  mcpConfig?: string; // Path to MCP config file (optional, defaults to .mcp.json in project root)
  allowBash?: boolean; // If true, include Bash in allowed tools (use with caution)
  maxRetries?: number; // Max retry attempts for hung/rate-limited failures (default 2)
  retryDelayMs?: number; // Delay between retries in ms (default 3000)
  enableTmux?: boolean; // Run Claude inside tmux for live terminal monitoring (default: false)
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

interface StreamEvent {
  type: "system" | "assistant" | "user" | "result";
  subtype?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: string | Array<{ type: string; text?: string }>;
    }>;
  };
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
}

interface ParsedStreamResult {
  events: StreamEvent[];
  textChunks: string[];
  toolCalls: ToolCall[];
}

function parseStreamEvents(
  rawChunk: string,
  buffer: { partial: string },
  toolCallTracker: Map<string, ToolCall>,
): ParsedStreamResult {
  const combined = buffer.partial + rawChunk;
  const lines = combined.split("\n");

  // Last line might be incomplete — save it
  buffer.partial = lines.pop() || "";

  const events: StreamEvent[] = [];
  const textChunks: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed) as StreamEvent;
      events.push(event);

      // Extract text from assistant messages
      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) {
            textChunks.push(block.text);
          }
          // Capture tool_use with input details
          if (block.type === "tool_use" && block.name) {
            const tc: ToolCall = {
              name: block.name,
              input: block.input,
              timestamp: new Date().toISOString(),
            };
            if (block.tool_use_id) {
              toolCallTracker.set(block.tool_use_id, tc);
            }
            toolCalls.push(tc);
          }
          // Capture tool_result and correlate with previous tool_use
          if (block.type === "tool_result" && block.tool_use_id) {
            const pending = toolCallTracker.get(block.tool_use_id);
            const resultText = typeof block.content === "string"
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map(c => c.text || "").join("")
                : "";
            if (pending) {
              // Truncate very long results to 2000 chars for storage
              pending.result = resultText.length > 2000
                ? resultText.slice(0, 2000) + "... (truncated)"
                : resultText;
            }
          }
        }
      }

      // Extract final result text
      if (event.type === "result" && event.result) {
        textChunks.push(event.result);
      }
    } catch {
      // Not valid JSON — could be a partial line or non-JSON output
    }
  }

  return { events, textChunks, toolCalls };
}

/**
 * Check if a process has active network connections (ESTABLISHED TCP sockets).
 * Used to determine if Claude CLI is still waiting for API response vs truly hung.
 * Returns true if the process has at least one ESTABLISHED connection.
 */
export function checkNetworkHealth(pid: number): boolean {
  try {
    const output = execFileSync("lsof", ["-i", "-a", "-p", String(pid), "-n", "-P"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Look for ESTABLISHED connections (process is waiting for API response)
    return output.includes("ESTABLISHED");
  } catch {
    // lsof may fail if process already exited or permission denied
    return false;
  }
}

/** Tool display info: emoji + short label */
const TOOL_DISPLAY: Record<string, { emoji: string; label: string }> = {
  Read: { emoji: "📖", label: "Read" },
  Write: { emoji: "✏️", label: "Write" },
  Edit: { emoji: "🔧", label: "Edit" },
  Grep: { emoji: "🔍", label: "Grep" },
  Glob: { emoji: "📂", label: "Glob" },
  Bash: { emoji: "💻", label: "Bash" },
  TodoWrite: { emoji: "📝", label: "TodoWrite" },
  Task: { emoji: "🚀", label: "Task" },
  WebFetch: { emoji: "🌐", label: "WebFetch" },
  WebSearch: { emoji: "🔎", label: "WebSearch" },
};

/**
 * Get display info for a tool (emoji + short name).
 */
function getToolDisplay(toolName: string): { emoji: string; label: string } {
  if (TOOL_DISPLAY[toolName]) return TOOL_DISPLAY[toolName];
  // MCP tools: extract the last segment
  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    const shortName = parts[parts.length - 1] || toolName;
    return { emoji: "🔌", label: shortName };
  }
  return { emoji: "🔧", label: toolName };
}

/**
 * Summarize tool input into a concise one-line string for display in progress logs.
 * Shows the most relevant parameter for each tool type.
 */
function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  try {
    switch (toolName) {
      case "Read":
        return input.file_path ? String(input.file_path).split("/").slice(-2).join("/") : "";
      case "Write":
        return input.file_path ? String(input.file_path).split("/").slice(-2).join("/") : "";
      case "Edit":
        return input.file_path ? String(input.file_path).split("/").slice(-2).join("/") : "";
      case "Grep":
        return input.pattern ? `"${String(input.pattern).slice(0, 50)}"` : "";
      case "Glob":
        return input.pattern ? `"${String(input.pattern).slice(0, 50)}"` : "";
      case "Bash":
        return input.command ? String(input.command).slice(0, 60) : "";
      case "TodoWrite":
        if (Array.isArray(input.todos)) {
          const inProgress = (input.todos as Array<{ status?: string; content?: string }>).find(t => t.status === "in_progress");
          return inProgress?.content ? String(inProgress.content).slice(0, 50) : `${input.todos.length}개 항목`;
        }
        return "";
      case "WebFetch":
        return input.url ? String(input.url).slice(0, 60) : "";
      case "WebSearch":
        return input.query ? `"${String(input.query).slice(0, 50)}"` : "";
      case "Task":
        return input.description ? String(input.description).slice(0, 50) : "";
      default:
        // For MCP tools, show the first string parameter value
        if (toolName.startsWith("mcp__")) {
          const firstVal = Object.values(input).find(v => typeof v === "string");
          return firstVal ? String(firstVal).slice(0, 50) : "";
        }
        return "";
    }
  } catch {
    return "";
  }
}

/**
 * Format a tool call into a rich display line with emoji and details.
 */
function formatToolCallLine(toolName: string, input?: Record<string, unknown>): string {
  const display = getToolDisplay(toolName);
  const summary = input ? summarizeToolInput(toolName, input) : "";
  if (summary) {
    return `${display.emoji} ${display.label}: ${summary}`;
  }
  return `${display.emoji} ${display.label}`;
}

/**
 * Execute a task using Claude CLI
 *
 * Spawns `claude` with --print flag (no-tool tasks) or --output-format stream-json (tool tasks).
 * Uses --system-prompt to set agent personality.
 */
export function executeClaudeTask(
  options: ClaudeExecutorOptions
): Promise<ExecutionResult> {
  const { agentId, task, systemPrompt, workDir, timeout = 0, staleTimeout = 300000, onOutput, onToolCall, disableTools, mcpConfig, allowBash, enableTmux = false } = options;

  return new Promise((resolve) => {
    const startTime = Date.now();
    let resolved = false;
    let tmuxCleanup: (() => void) | null = null;

    const safeResolve = (result: ExecutionResult) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const args: string[] = [];

    // Security: use --allowedTools whitelist instead of --dangerously-skip-permissions
    // This prevents arbitrary Bash execution if the relay server is compromised
    if (disableTools) {
      // No-tool tasks (planner, summarizer): single API call, use --print for simplicity
      args.push("--print");
      args.push("--tools", "");
    } else {
      // Tool-using tasks: use stream-json for structured event output
      // Note: stream-json only emits events on actual output (tool calls, text), NOT during thinking/inference
      args.push("--print", "--output-format", "stream-json", "--verbose");
      const tools = allowBash ? `${ALLOWED_TOOLS},Bash` : ALLOWED_TOOLS;
      args.push("--allowedTools", tools);

      // Add MCP config if provided
      if (mcpConfig) {
        args.push("--mcp-config", mcpConfig);
      }
    }

    // Append tool availability notice to prevent agents from attempting unavailable tools
    const toolNotice = disableTools
      ? "\n\n## 시스템 제약 (필수 준수)\n당신은 도구 사용이 비활성화되어 있습니다. 분석과 텍스트 응답만 가능합니다. 코드 실행, 파일 수정, 쉘 명령 실행은 절대 시도하지 마세요."
      : `\n\n## 시스템 제약 (필수 준수)\n사용 가능한 도구: ${allowBash ? `${ALLOWED_TOOLS},Bash` : ALLOWED_TOOLS}\n위 목록에 없는 도구(특히 Bash/터미널/쉘 명령)는 절대 사용하지 마세요. 승인 프롬프트가 표시되면 프로세스가 중단됩니다.\n실행이 필요한 작업(git, 배포, npm 등)은 직접 실행하지 말고, 필요한 명령어를 텍스트로 제안만 해주세요.`;

    args.push("--no-session-persistence", "--system-prompt", systemPrompt + toolNotice, task);

    const useStreamJson = !disableTools;
    const streamBuffer = { partial: "" };
    const toolCallTracker = new Map<string, ToolCall>();
    const allToolCalls: ToolCall[] = [];
    let finalResultText = "";

    let stdout = "";
    let stderr = "";
    let lastOutputTime = Date.now();
    let lastStderrTime = Date.now();
    let lastActivityTime = Date.now(); // max(stdout, stderr)

    const useTmux = enableTmux && isTmuxAvailable();
    let child: ChildProcess;

    if (useTmux) {
      // Tmux mode: run Claude inside a tmux session for live monitoring
      const tmuxResult = spawnInTmux("claude", args, {
        cwd: workDir || process.cwd(),
        agentId,
        onStdout: (chunk: string) => {
          lastOutputTime = Date.now();
          lastActivityTime = Date.now();

          if (useStreamJson) {
            const { events, textChunks, toolCalls } = parseStreamEvents(chunk, streamBuffer, toolCallTracker);

            // Track and emit tool calls
            for (const tc of toolCalls) {
              allToolCalls.push(tc);
              onToolCall?.(tc);
              onOutput?.(`${formatToolCallLine(tc.name, tc.input)}\n`);
            }

            for (const event of events) {
              if (event.type === "result" && event.result) {
                finalResultText = event.result;
              }
            }

            // Accumulate and stream text output to onOutput
            if (textChunks.length > 0) {
              const joined = textChunks.join("");
              stdout += joined;
              // Stream text chunks so dashboard can show thinking/response progress
              onOutput?.(`[text] ${joined}`);
            }
          } else {
            stdout += chunk;
            onOutput?.(chunk);
          }
        },
        onExit: (code: number | null) => {
          if (timer) clearTimeout(timer);
          if (staleTimer) clearInterval(staleTimer);
          if (code === 0) {
            const outputText = finalResultText || stdout.trim();
            safeResolve({
              success: true,
              output: outputText,
              exitCode: 0,
              elapsedMs: Date.now() - startTime,
              provider: "claude",
              rateLimited: false,
              toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
            });
          } else {
            const rateLimited = isRateLimitError(stdout);
            safeResolve({
              success: false,
              output: stdout.trim(),
              error: `Process exited with code ${code}`,
              exitCode: code ?? -1,
              elapsedMs: Date.now() - startTime,
              provider: "claude",
              rateLimited,
              toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
            });
          }
        },
      });
      tmuxCleanup = tmuxResult.cleanup;
      console.log(`   📺 Tmux session: ${tmuxResult.sessionName} (attach with: tmux attach -t ${tmuxResult.sessionName})`);

      // Create a dummy child process for the timeout/stale logic
      // The actual process lifecycle is managed by tmux
      child = spawn("sleep", ["infinity"], { stdio: "ignore" });
    } else {
      // Standard mode: direct spawn with pipe capture
      child = spawn("claude", args, {
        cwd: workDir || process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.on("data", (data: Buffer) => {
        const raw = data.toString();
        lastOutputTime = Date.now();
        lastActivityTime = Date.now();

        if (useStreamJson) {
          const { events, textChunks, toolCalls } = parseStreamEvents(raw, streamBuffer, toolCallTracker);

          // Track and emit tool calls
          for (const tc of toolCalls) {
            allToolCalls.push(tc);
            onToolCall?.(tc);
            onOutput?.(`${formatToolCallLine(tc.name, tc.input)}\n`);
          }

          for (const event of events) {
            // Capture final result
            if (event.type === "result" && event.result) {
              finalResultText = event.result;
            }
          }

          // Accumulate and stream text output to onOutput
          if (textChunks.length > 0) {
            const joined = textChunks.join("");
            stdout += joined;
            // Stream text chunks so dashboard can show thinking/response progress
            onOutput?.(`[text] ${joined}`);
          }
        } else {
          // --print mode (no-tool tasks): raw text accumulation
          stdout += raw;
          onOutput?.(raw);
        }
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
    }

    const killProcess = () => {
      if (tmuxCleanup) {
        tmuxCleanup();
      }
      try { child.kill("SIGTERM"); } catch { /* already dead */ }
    };

    // Wall-clock timeout
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (timeout > 0) {
      timer = setTimeout(() => {
        if (staleTimer) clearInterval(staleTimer);
        staleTimer = null;
        killProcess();
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

        // Warning threshold: 60% of stale timeout with no activity at all
        if (!warnedStale && silentMs > staleTimeout * 0.6) {
          // In tmux mode, check process health before warning/killing
          if (useTmux) {
            const state = getProcessState(agentId);

            // If process is alive and actively working (CPU or child processes), it's legitimate
            if (state.alive && (state.cpuActive || state.childProcessCount > 0)) {
              // Reset the lastActivityTime to give it more time
              lastActivityTime = Date.now();
              warnedStale = false;
              const detail = `CPU: ${state.cpuActive ? 'active' : 'idle'}, children: ${state.childProcessCount}`;
              onOutput?.(`[health] Process alive and working (${detail}), resetting stale timer\n`);
              return; // Skip the kill/warn logic
            }
          }

          // Non-tmux: check network health via lsof
          const pid = child.pid;
          if (!useTmux && pid && checkNetworkHealth(pid)) {
            lastActivityTime = Date.now();
            warnedStale = false;
            onOutput?.(`[health] Active API connection detected, resetting stale timer\n`);
            return;
          }

          warnedStale = true;
          const msg = `⚠️ No activity for ${formatDuration(silentMs)} (stale timeout: ${formatDuration(staleTimeout)})`;
          console.warn(msg);
          onOutput?.(`[warning] ${msg}\n`);
        }

        // Absolute maximum cap: 3x stale timeout regardless of network/CPU state
        const absoluteMaxMs = staleTimeout * 3;
        if (silentMs > absoluteMaxMs) {
          if (timer) clearTimeout(timer);
          timer = null;
          if (staleTimer) clearInterval(staleTimer);
          staleTimer = null;

          killProcess();
          setTimeout(() => {
            try { child.kill("SIGKILL"); } catch { /* already dead */ }
          }, 5000);

          const detail = `stdout silent: ${formatDuration(stdoutSilentMs)}, total silent: ${formatDuration(silentMs)}`;
          safeResolve({
            success: false,
            error: `Process exceeded absolute timeout (${formatDuration(absoluteMaxMs)}) with no output. ${detail}`,
            exitCode: -2,
            elapsedMs: now - startTime,
            provider: "claude",
            rateLimited: false,
          });
          return;
        }

        // Kill: no activity (stdout OR stderr) for full stale timeout
        if (silentMs > staleTimeout) {
          // In tmux mode, do one final health check before killing
          if (useTmux) {
            const state = getProcessState(agentId);

            // Still working? Give it more time
            if (state.alive && (state.cpuActive || state.childProcessCount > 0)) {
              lastActivityTime = Date.now();
              warnedStale = false;
              const detail = `CPU: ${state.cpuActive ? 'active' : 'idle'}, children: ${state.childProcessCount}`;
              onOutput?.(`[health] Process still working at kill threshold (${detail}), extending timeout\n`);
              return;
            }
          }

          // Non-tmux: final network health check before killing
          const killPid = child.pid;
          if (!useTmux && killPid && checkNetworkHealth(killPid)) {
            lastActivityTime = Date.now();
            warnedStale = false;
            onOutput?.(`[health] Active API connection at kill threshold, extending timeout\n`);
            return;
          }

          if (timer) clearTimeout(timer);
          timer = null;
          if (staleTimer) clearInterval(staleTimer);
          staleTimer = null;

          killProcess();
          setTimeout(() => {
            try { child.kill("SIGKILL"); } catch { /* already dead */ }
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

    // In tmux mode, exit is handled by the onExit callback above
    if (!useTmux) {
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
          const outputText = finalResultText || stdout.trim();
          safeResolve({
            success: true,
            output: outputText,
            exitCode: 0,
            elapsedMs: Date.now() - startTime,
            stderrOutput: stderr.trim() || undefined,
            provider: "claude",
            rateLimited: false,
            toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
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
            toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
          });
        }
      });
    }
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

        // Absolute maximum cap: 3x stale timeout regardless of CPU state
        const absoluteMaxMs = staleTimeout * 3;
        if (silentMs > absoluteMaxMs) {
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
            error: `Process exceeded absolute timeout (${formatDuration(absoluteMaxMs)}) with no output. ${detail}`,
            exitCode: -2,
            elapsedMs: now - startTime,
            provider: "codex",
            rateLimited: false,
          });
          return;
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

/**
 * Execute a task with automatic retry for hung/rate-limited failures
 *
 * Wraps executeLlmTask with retry logic:
 * - Retries only for hung (exitCode -2) or rate-limited failures
 * - Increases staleTimeout by 50% on each retry for hung processes
 * - Logs retry attempts and notifies via onOutput callback
 */
export async function executeLlmTaskWithRetry(
  options: ClaudeExecutorOptions
): Promise<ExecutionResult> {
  const maxRetries = options.maxRetries ?? 2;
  const retryDelay = options.retryDelayMs ?? 3000;
  let currentStaleTimeout = options.staleTimeout;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await executeLlmTask({
      ...options,
      staleTimeout: currentStaleTimeout,
    });

    // Success or non-retryable failure → return immediately
    const isRetryable = result.exitCode === -2 || result.rateLimited;
    if (result.success || !isRetryable || attempt === maxRetries) {
      if (attempt > 0 && result.success) {
        console.log(`✅ Retry succeeded on attempt ${attempt + 1} for ${options.agentId}`);
      }
      return {
        ...result,
        // Track retry info
        ...(attempt > 0 ? { retriesUsed: attempt } : {}),
      };
    }

    // Retryable failure
    const reason = result.exitCode === -2 ? "hung" : "rate_limited";
    console.log(`🔄 Retry ${attempt + 1}/${maxRetries} for ${options.agentId}: ${reason}`);
    options.onOutput?.(`[retry] Attempt ${attempt + 2} starting after ${reason}...\n`);

    // Increase stale timeout by 100% for hung retries (5min→10min matches complex task level)
    if (result.exitCode === -2 && currentStaleTimeout) {
      currentStaleTimeout = Math.round(currentStaleTimeout * 2.0);
    }

    // Wait before retry
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }

  // Should not reach here, but TypeScript safety
  return executeLlmTask(options);
}
