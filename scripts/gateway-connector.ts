#!/usr/bin/env npx ts-node

/**
 * Gateway Connector Script
 *
 * 이 스크립트를 맥북에서 실행하면 LifeDashboard Relay에 연결됩니다.
 * OpenClaw Gateway와 통신하여 Dashboard에서 원격으로 에이전트를 제어할 수 있습니다.
 *
 * 사용법:
 *   npx ts-node scripts/gateway-connector.ts
 *
 * 환경변수:
 *   RELAY_URL: Dashboard relay URL (기본: http://localhost:3000)
 *   RELAY_API_KEY: Relay API 키
 *   GATEWAY_ID: 이 Gateway의 고유 ID (기본: hostname)
 *   POLL_INTERVAL: polling 간격 ms (기본: 3000)
 *   CODEX_BIN: Codex CLI 경로 (기본: codex)
 *   CODEX_MODEL: Codex 모델 (옵션)
 *   CODEX_SANDBOX: Codex sandbox 모드 (기본: workspace-write, disableTools일 때 read-only)
 *   CODEX_APPROVAL: Codex 승인 모드 (기본: never)
 */

import * as os from "os";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env.local") });

import { executeLlmTaskWithRetry, isClaudeAvailable, isCodexAvailable, formatDuration, type ToolCall } from "./claude-executor";
import { TaskStateManager } from "./task-state-manager";

// Config
const RELAY_URL = process.env.RELAY_URL || "http://localhost:3000";
const RELAY_API_KEY = process.env.RELAY_API_KEY || "dev-relay-key";
const GATEWAY_ID = process.env.GATEWAY_ID || os.hostname();
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "3000", 10);
const MCP_CONFIG_PATH = path.resolve(__dirname, "..", ".mcp.json");
const ENABLE_TMUX = process.env.ENABLE_TMUX === "true";

// Task state persistence for recovery after restart
const taskStateManager = new TaskStateManager({
  relayUrl: RELAY_URL,
  relayApiKey: RELAY_API_KEY,
  gatewayId: GATEWAY_ID,
});

interface RelayCommand {
  id: string;
  type: "spawn" | "send" | "status" | "message" | "orchestrate" | "restart";
  payload: Record<string, unknown>;
}

/** Structured progress event for real-time dashboard display */
interface ProgressEventEntry {
  type: "tool_use" | "text" | "health" | "warning" | "stderr";
  timestamp: string;
  tool?: string;
  target?: string;
  content?: string;
}

interface AgentStatus {
  id: string;
  name: string;
  status: "running" | "idle" | "waiting" | "error";
  currentTask?: string;
  sessionKey?: string;
  liveOutput?: {
    lastChunk: string;
    totalChars: number;
    lastActivityAt: string;
    chunksReceived: number;
    /** Recent structured progress events (newest first, max 20) */
    recentEvents?: ProgressEventEntry[];
  };
}

const MAX_RECENT_EVENTS = 50;

/**
 * Parse an onOutput chunk into a structured ProgressEventEntry.
 * Chunks from claude-executor are prefixed with [tool], [text], [stderr], [health], [warning].
 */
function parseOutputChunk(chunk: string): ProgressEventEntry | null {
  const trimmed = chunk.trim();
  if (!trimmed) return null;

  const now = new Date().toISOString();

  // [tool] 📖 Read: lib/auth.ts
  if (trimmed.startsWith("[tool]") || /^[📖✏️🔧🔍📂💻📝🚀🌐🔎🔌]/.test(trimmed)) {
    // Parse formatted tool line: "📖 Read: src/lib/auth.ts" or "[tool] 📖 Read: src/lib/auth.ts"
    const content = trimmed.replace(/^\[tool\]\s*/, "");
    // Extract tool name and target from formatted line: "emoji Label: target"
    const match = content.match(/^.+?\s+(\S+?)(?::\s*(.+))?$/);
    if (match) {
      return { type: "tool_use", timestamp: now, tool: match[1], target: match[2] || undefined };
    }
    return { type: "tool_use", timestamp: now, content: content.slice(0, 200) };
  }

  // [text] Assistant's thinking/response text
  if (trimmed.startsWith("[text] ")) {
    const text = trimmed.slice(7);
    return { type: "text", timestamp: now, content: text.slice(0, 500) };
  }

  // [stderr] ...
  if (trimmed.startsWith("[stderr]")) {
    return { type: "stderr", timestamp: now, content: trimmed.slice(9).trim().slice(0, 200) };
  }

  // [health] ...
  if (trimmed.startsWith("[health]")) {
    return { type: "health", timestamp: now, content: trimmed.slice(9).trim().slice(0, 200) };
  }

  // [warning] ...
  if (trimmed.startsWith("[warning]")) {
    return { type: "warning", timestamp: now, content: trimmed.slice(10).trim().slice(0, 200) };
  }

  // Untagged output (from --print mode)
  return { type: "text", timestamp: now, content: trimmed.slice(0, 500) };
}

/**
 * Summarize tool calls into a compact one-line string.
 * e.g. "🔧 6개 도구 호출: 📖Read ×3, 🔍Grep ×2, ✏️Write ×1"
 */
function summarizeToolCalls(toolCalls: ToolCall[]): string {
  if (toolCalls.length === 0) return "";
  const TOOL_EMOJIS: Record<string, string> = {
    Read: "📖", Write: "✏️", Edit: "🔧", Grep: "🔍", Glob: "📂",
    Bash: "💻", TodoWrite: "📝", Task: "🚀", WebFetch: "🌐", WebSearch: "🔎",
  };
  const counts = new Map<string, number>();
  for (const tc of toolCalls) {
    counts.set(tc.name, (counts.get(tc.name) || 0) + 1);
  }
  const parts: string[] = [];
  for (const [name, count] of counts) {
    const emoji = name.startsWith("mcp__")
      ? "🔌"
      : (TOOL_EMOJIS[name] || "🔧");
    const shortName = name.startsWith("mcp__")
      ? (name.split("__").pop() || name)
      : name;
    parts.push(`${emoji}${shortName} ×${count}`);
  }
  return `🔧 ${toolCalls.length}개 도구 호출: ${parts.join(", ")}`;
}

// Graceful shutdown: persist task states before exit
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

  try {
    // Flush pending updates and mark active tasks as interrupted
    await taskStateManager.shutdown();
    console.log("✅ Task states persisted successfully");
  } catch (error) {
    console.error("⚠️ Failed to persist task states:", error);
  }

  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Self-restart: process.exit() triggers launchd auto-restart
async function gracefulRestart(reason: string): Promise<void> {
  console.log(`\n🔄 Restarting gateway connector: ${reason}`);
  console.log("   Persisting task states before restart...");
  try {
    await taskStateManager.shutdown();
    console.log("   ✅ Task states persisted");
  } catch (error) {
    console.error("   ⚠️ Failed to persist task states:", error);
  }
  console.log("   launchd will auto-restart in ~5 seconds...");
  process.exit(0);
}

// Dynamic agent status tracking (populated from relay commands)
const agentStatusMap = new Map<string, AgentStatus>();

// Track task start times per agent for execution time metrics
const agentTaskStartTimes = new Map<string, number>();

// Helper to get agents array for polling
function getAgentsList(): AgentStatus[] {
  return Array.from(agentStatusMap.values());
}

// History buffer
const pendingHistoryEntries: Array<{
  agentId: string;
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
  requestGroupId?: string;
  requestTitle?: string;
}> = [];

// Helper: Add history entry
function addHistory(
  agentId: string,
  type: string,
  content: string,
  metadata?: Record<string, unknown>,
  requestGroup?: { requestGroupId?: string; requestTitle?: string }
) {
  pendingHistoryEntries.push({
    agentId,
    type,
    content,
    metadata,
    requestGroupId: requestGroup?.requestGroupId,
    requestTitle: requestGroup?.requestTitle,
  });
}

// Helper: Generic API call (any path under RELAY_URL)
function dashboardApiCall(
  fullPath: string,
  method: "GET" | "POST" | "PATCH" = "POST",
  body?: unknown
): Promise<unknown> {
  const url = `${RELAY_URL}${fullPath}`;
  const urlObj = new URL(url);
  const transport = urlObj.protocol === "https:" ? https : http;
  const bodyStr = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method,
        headers: {
          "Content-Type": "application/json",
          "x-relay-key": RELAY_API_KEY,
          ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr).toString() } : {}),
        },
        timeout: 10000, // 10s — request group updates are secondary
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ error: "Invalid JSON", raw: data }); }
        });
      }
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Helper: Update request group agent status via API (best-effort)
async function updateRequestGroupAgent(
  requestGroupId: string,
  agentId: string,
  action: "add_agent" | "update_agent",
  agentStatus: string,
  taskSummary?: string
): Promise<void> {
  try {
    await dashboardApiCall(`/api/request-groups/${requestGroupId}`, "PATCH", {
      action,
      agentId,
      agentStatus,
      taskSummary,
    });
  } catch (error) {
    console.error(`   ⚠️ Failed to update request group agent: ${error}`);
  }
}

// Helper: Re-queue failed task for one more attempt
async function requeueFailedTask(
  agentId: string,
  task: string,
  originalCommandId: string,
  attempt: number
): Promise<void> {
  if (attempt >= 2) {
    console.log(`   ⛔ Max requeue attempts reached for ${agentId}, task permanently failed`);
    return;
  }

  try {
    console.log(`   🔄 Re-queuing failed task for ${agentId} (attempt ${attempt + 1})`);
    await apiCall("/command", "POST", {
      gatewayId: GATEWAY_ID,
      type: "spawn",
      payload: {
        agentId,
        task: `[재시도 ${attempt + 1}회] 이전 시도가 실패했습니다. 핵심만 간결하게 처리해주세요.\n\n${task}`,
        _requeueAttempt: attempt + 1,
        _originalCommandId: originalCommandId,
      },
    });
    addHistory(agentId, "output", `🔄 작업 실패로 재큐잉됨 (시도 ${attempt + 1})`);
  } catch (error) {
    console.error(`   ❌ Failed to requeue task for ${agentId}:`, error);
  }
}

// Helper: API call using http/https directly (avoids Node.js undici's 300s default timeout)
function apiCall(
  endpoint: string,
  method: "GET" | "POST" = "POST",
  body?: unknown
): Promise<unknown> {
  const url = `${RELAY_URL}/api/relay${endpoint}`;
  const urlObj = new URL(url);
  const transport = urlObj.protocol === "https:" ? https : http;
  const bodyStr = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method,
        headers: {
          "Content-Type": "application/json",
          "x-relay-key": RELAY_API_KEY,
          ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr).toString() } : {}),
        },
        timeout: 30000, // 30s timeout — poll interval is 3s so this gives ample margin
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ error: "Invalid JSON", raw: data });
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out (30s)"));
    });

    req.on("error", reject);

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// Temp directory for downloaded attachments
const ATTACHMENTS_TMP_DIR = path.join(os.tmpdir(), "ld-attachments");

// Download attachment by ref_key from dashboard and save to temp file
async function downloadAttachment(refKey: string): Promise<{ filePath: string; filename: string } | null> {
  try {
    // First, lookup attachment metadata by ref_key
    const metaResult = await apiCall(`/attachments/by-ref/${refKey}`, "GET") as {
      attachment?: { id: string; originalFilename: string; storageKey: string };
    };

    if (!metaResult?.attachment) {
      console.log(`   ⚠️ Attachment not found for ref_key: ${refKey}`);
      return null;
    }

    const { id, originalFilename } = metaResult.attachment;

    // Download the file content
    const url = `${RELAY_URL}/api/attachments/${id}`;
    const urlObj = new URL(url);
    const transport = urlObj.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
      const req = transport.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
          path: urlObj.pathname,
          method: "GET",
          headers: {
            "x-relay-key": RELAY_API_KEY,
          },
          timeout: 30000,
        },
        (res) => {
          if (res.statusCode !== 200) {
            console.log(`   ⚠️ Failed to download attachment ${refKey}: HTTP ${res.statusCode}`);
            res.resume();
            resolve(null);
            return;
          }

          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            try {
              const buffer = Buffer.concat(chunks);

              // Ensure temp dir exists
              const tmpDir = path.join(ATTACHMENTS_TMP_DIR, refKey);
              fs.mkdirSync(tmpDir, { recursive: true });

              const filePath = path.join(tmpDir, originalFilename);
              fs.writeFileSync(filePath, buffer);

              console.log(`   📎 Downloaded attachment: ${originalFilename} → ${filePath}`);
              resolve({ filePath, filename: originalFilename });
            } catch (err) {
              console.error(`   ❌ Failed to save attachment ${refKey}:`, err);
              resolve(null);
            }
          });
        }
      );

      req.on("error", (err) => {
        console.error(`   ❌ Download error for attachment ${refKey}:`, err);
        resolve(null);
      });

      req.end();
    });
  } catch (error) {
    console.error(`   ❌ Failed to download attachment ${refKey}:`, error);
    return null;
  }
}

// Download all attachments referenced in a command payload, return file paths
async function resolveCommandAttachments(
  refKeys: string[]
): Promise<Array<{ refKey: string; filePath: string; filename: string }>> {
  const results: Array<{ refKey: string; filePath: string; filename: string }> = [];

  for (const refKey of refKeys) {
    const downloaded = await downloadAttachment(refKey);
    if (downloaded) {
      results.push({ refKey, ...downloaded });
    }
  }

  return results;
}

// Clean up temp attachment files after task completion
function cleanupAttachmentFiles(refKeys: string[]): void {
  for (const refKey of refKeys) {
    const tmpDir = path.join(ATTACHMENTS_TMP_DIR, refKey);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Register with relay
async function register(): Promise<boolean> {
  try {
    const result = (await apiCall("/register", "POST", {
      gatewayId: GATEWAY_ID,
    })) as { success?: boolean };

    if (result.success) {
      console.log(`✅ Registered as: ${GATEWAY_ID}`);
      return true;
    }
    console.error("❌ Registration failed:", result);
    return false;
  } catch (error) {
    console.error("❌ Connection failed:", error);
    return false;
  }
}

// Execute OpenClaw command
async function executeCommand(command: RelayCommand): Promise<unknown> {
  console.log(`\n📥 Received command: ${command.type}`);
  console.log(`   Payload:`, JSON.stringify(command.payload, null, 2));

  try {
    switch (command.type) {
      case "spawn": {
        const { agentId, task, systemPrompt, _attachmentRefKeys, requestGroupId, requestTitle } = command.payload as {
          agentId: string;
          task: string;
          systemPrompt?: string;
          _attachmentRefKeys?: string[];
          requestGroupId?: string;
          requestTitle?: string;
        };

        // Request group context for history entries
        const reqGroup = requestGroupId ? { requestGroupId, requestTitle } : undefined;

        // Update agent status to running
        agentStatusMap.set(agentId, {
          id: agentId,
          name: agentId,
          status: "running",
          currentTask: task,
        });

        agentTaskStartTimes.set(agentId, Date.now());
        addHistory(agentId, "task_started", `Task started: ${task}`, undefined, reqGroup);

        // Register agent in request group (best-effort, non-blocking)
        if (requestGroupId) {
          const taskPreview = task.length > 100 ? task.substring(0, 100) + "..." : task;
          updateRequestGroupAgent(requestGroupId, agentId, "add_agent", "running", taskPreview);
        }

        // Check Claude CLI availability
        if (!isClaudeAvailable()) {
          console.log(`   ⚠️ Claude CLI not found. Simulating task.`);
          agentStatusMap.set(agentId, {
            id: agentId,
            name: agentId,
            status: "idle",
          });
          addHistory(agentId, "task_failed", "Claude CLI not available", undefined, reqGroup);
          if (requestGroupId) {
            updateRequestGroupAgent(requestGroupId, agentId, "update_agent", "failed");
          }
          return { success: false, error: "Claude CLI not available" };
        }

        // Download attachments if present
        let attachmentFiles: Array<{ refKey: string; filePath: string; filename: string }> = [];
        if (_attachmentRefKeys && _attachmentRefKeys.length > 0) {
          console.log(`   📎 Downloading ${_attachmentRefKeys.length} attachment(s)...`);
          attachmentFiles = await resolveCommandAttachments(_attachmentRefKeys);
          if (attachmentFiles.length > 0) {
            addHistory(agentId, "output", `📎 ${attachmentFiles.length}개 첨부파일 다운로드 완료: ${attachmentFiles.map(f => f.filename).join(", ")}`, undefined, reqGroup);
          }
        }

        // Build final task with attachment file paths injected
        let finalTask = task;
        if (attachmentFiles.length > 0) {
          const fileList = attachmentFiles
            .map((f) => `- ${f.filename}: ${f.filePath}`)
            .join("\n");
          // Replace @file:refKey references with actual local paths
          for (const f of attachmentFiles) {
            finalTask = finalTask.replace(
              new RegExp(`@file:${f.refKey}`, "g"),
              f.filePath
            );
          }
          // Also append file path summary if not already in the text
          if (!finalTask.includes(attachmentFiles[0].filePath)) {
            finalTask += `\n\n첨부파일 로컬 경로:\n${fileList}`;
          }
        }

        // Track task in persistent state for recovery
        const executionId = await taskStateManager.startTask({
          agentId,
          commandId: command.id,
          commandType: "spawn",
          task: finalTask,
          systemPrompt: systemPrompt || `You are the ${agentId} agent.`,
          requestGroupId,
          requestTitle,
          attachmentRefKeys: _attachmentRefKeys,
          attemptNumber: (command.payload as { _requeueAttempt?: number })?._requeueAttempt || 1,
          maxAttempts: 3,
        });

        // Execute asynchronously (don't block the poll loop)
        console.log(`   🚀 Spawning Claude for agent: ${agentId}`);
        console.log(`   📋 Task: ${finalTask}`);

        const isComplexTask = /분석|analyze|refactor|리팩토링|검토|review|보안|security|아키텍처|architect|debug|디버그|plan|계획|test|QA|테스트|PM|product|orchestrat|전체|comprehensive|deep|tdd|migration|마이그레이션/i.test(task);
        // Agent-specific staleTimeout overrides (agents that inherently need more time)
        const AGENT_STALE_OVERRIDES: Record<string, number> = {
          qa: 600000,         // 10min — test execution + analysis
          pm: 600000,         // 10min — analytical tasks
          orchestrator: 900000, // 15min — multi-step orchestration
          analyst: 600000,    // 10min — code analysis
          learner: 600000,    // 10min — knowledge extraction
        };
        const staleTimeout = AGENT_STALE_OVERRIDES[agentId] || (isComplexTask ? 600000 : 300000); // agent override > complex 10min > simple 5min

        let totalChars = 0;
        let chunksReceived = 0;
        let outputBuffer = "";
        let lastHistoryUpdate = 0;
        const taskToolCalls: ToolCall[] = [];
        const recentEvents: ProgressEventEntry[] = [];
        const HISTORY_INTERVAL = 10000; // Send history entries every 10s

        executeLlmTaskWithRetry({
          agentId,
          task: finalTask,
          systemPrompt: systemPrompt || `You are the ${agentId} agent.`,
          mcpConfig: MCP_CONFIG_PATH,
          staleTimeout,
          enableTmux: ENABLE_TMUX,
          onToolCall: (tc: ToolCall) => {
            taskToolCalls.push(tc);
          },
          onOutput: (chunk: string) => {
            // Parse chunk into structured event
            const event = parseOutputChunk(chunk);

            // Log stderr/warning for visibility but don't skip — they become events too
            if (chunk.startsWith("[stderr]") || chunk.startsWith("[warning]")) {
              console.log(`   📡 ${agentId}: ${chunk.trim()}`);
            }

            totalChars += chunk.length;
            chunksReceived++;

            // Keep last 500 chars as text preview (include all types for context)
            outputBuffer += chunk;
            if (outputBuffer.length > 500) {
              outputBuffer = outputBuffer.slice(-500);
            }

            // Append structured event to recent events ring buffer
            if (event) {
              recentEvents.unshift(event); // newest first
              if (recentEvents.length > MAX_RECENT_EVENTS) {
                recentEvents.length = MAX_RECENT_EVENTS;
              }
            }

            // Update task execution state (batched)
            if (executionId) {
              taskStateManager.updateProgress(executionId, {
                lastOutput: outputBuffer,
                toolCallsCount: taskToolCalls.length,
                totalOutputChars: totalChars,
              });
            }

            // Update agent status with live output + structured events
            const current = agentStatusMap.get(agentId);
            if (current) {
              agentStatusMap.set(agentId, {
                ...current,
                liveOutput: {
                  lastChunk: outputBuffer,
                  totalChars,
                  lastActivityAt: new Date().toISOString(),
                  chunksReceived,
                  recentEvents: [...recentEvents],
                },
              });
            }

            // Send periodic history entries (less frequently now)
            const now = Date.now();
            if (now - lastHistoryUpdate >= HISTORY_INTERVAL) {
              lastHistoryUpdate = now;
              // Build tool call summary
              const toolSummary = summarizeToolCalls(taskToolCalls);
              const preview = outputBuffer.length > 200 ? "..." + outputBuffer.slice(-200) : outputBuffer;
              addHistory(agentId, "output", `⏳ ${agentId} 진행 중...${toolSummary ? `\n${toolSummary}` : ""}\n${preview}`, undefined, reqGroup);
            }
          },
        }).then((result) => {
          // Clean up downloaded attachment temp files
          if (_attachmentRefKeys && _attachmentRefKeys.length > 0) {
            cleanupAttachmentFiles(_attachmentRefKeys);
          }

          if (result.fallbackUsed && result.provider === "codex") {
            console.log(`   🔁 Claude limit reached — Codex fallback used for ${agentId}`);
          }

          // Merge tool calls from result and from onToolCall tracking
          const finalToolCalls = result.toolCalls || taskToolCalls;

          // Calculate execution time metrics
          const taskStartTime = agentTaskStartTimes.get(agentId);
          const taskElapsedMs = taskStartTime ? Date.now() - taskStartTime : result.elapsedMs;
          agentTaskStartTimes.delete(agentId);

          if (result.success) {
            console.log(`   ✅ Task completed for ${agentId}`);
            const prefix = result.fallbackUsed ? "🔁 Codex fallback\n" : "";
            const fullOutput = result.output || "Task completed";
            const truncatedOutput = fullOutput.length > 5000
              ? fullOutput.slice(0, 5000) + "\n...(truncated)"
              : fullOutput;
            addHistory(agentId, "task_completed", `${prefix}${truncatedOutput}`, {
              ...(finalToolCalls.length > 0 ? { toolCalls: finalToolCalls } : {}),
              elapsedMs: taskElapsedMs,
              isComplex: isComplexTask,
              retryCount: (result as { retriesUsed?: number }).retriesUsed || 0,
              provider: result.provider,
              ...(fullOutput.length > 5000 ? { fullResponseLength: fullOutput.length } : {}),
            }, reqGroup);

            // Mark task execution as completed
            if (executionId) {
              taskStateManager.completeTask(executionId, result.output?.slice(-2000));
            }

            agentStatusMap.set(agentId, {
              id: agentId,
              name: agentId,
              status: "idle",
            });

            // Update request group agent status to completed
            if (requestGroupId) {
              updateRequestGroupAgent(requestGroupId, agentId, "update_agent", "completed");
            }
          } else {
            const isHung = result.exitCode === -2;
            const errorMsg = isHung
              ? `⏰ 프로세스 응답 없음으로 자동 종료됨: ${result.error}`
              : result.error || "Task failed";

            console.log(`   ❌ Task ${isHung ? 'hung' : 'failed'} for ${agentId}: ${errorMsg}`);
            addHistory(agentId, "task_failed", errorMsg, {
              ...(finalToolCalls.length > 0 ? { toolCalls: finalToolCalls } : {}),
              elapsedMs: taskElapsedMs,
              isComplex: isComplexTask,
              retryCount: (result as { retriesUsed?: number }).retriesUsed || 0,
              exitCode: result.exitCode,
              isHung,
            }, reqGroup);

            // Mark task execution as failed
            if (executionId) {
              taskStateManager.failTask(executionId, errorMsg);
            }

            // Update request group agent status to failed
            if (requestGroupId) {
              updateRequestGroupAgent(requestGroupId, agentId, "update_agent", "failed");
            }
            agentStatusMap.set(agentId, {
              id: agentId,
              name: agentId,
              status: isHung ? "idle" : "error",
            });

            // Re-queue hung tasks for another attempt
            if (isHung) {
              const currentAttempt = (command.payload as { _requeueAttempt?: number })?._requeueAttempt || 0;
              requeueFailedTask(agentId, task, command.id, currentAttempt);
            }
          }
        });

        return { success: true, agentId, message: "Task started" };
      }

      case "send": {
        const { sessionKey, message } = command.payload as {
          sessionKey: string;
          message: string;
        };
        console.log(`   📤 Sending to session: ${sessionKey}`);
        console.log(`   💬 Message: ${message}`);

        // Add history entry
        const agent = Array.from(agentStatusMap.values()).find((a) => a.sessionKey === sessionKey);
        if (agent) {
          addHistory(agent.id, "message_sent", `Message sent: ${message}`);
        }

        // TODO: Actually call OpenClaw sessions_send
        return { success: true, sessionKey };
      }

      case "status": {
        // Add history entry for status check
        addHistory("system", "status_change", "Gateway status checked");
        return { agents: getAgentsList() };
      }

      case "message": {
        const { from, to, content } = command.payload as {
          from: string;
          to: string;
          content: string;
          type: string;
        };
        console.log(`   💬 Message from ${from} to ${to}: ${content}`);

        // Add to history
        addHistory(to, "message_received", `[${from}] ${content}`);

        return { success: true, delivered: true };
      }

      case "restart": {
        const { reason } = command.payload as { reason?: string };
        console.log(`   🔄 Restart requested: ${reason || "manual"}`);
        // Delay slightly so the poll response can be sent
        setTimeout(() => gracefulRestart(reason || "remote request"), 1000);
        return { success: true, message: "Restarting..." };
      }

      case "orchestrate": {
        const { task, _attachmentRefKeys: orchAttRefKeys } = command.payload as {
          task: string;
          _attachmentRefKeys?: string[];
        };

        // Download attachments for orchestrate command
        let orchAttachmentFiles: Array<{ refKey: string; filePath: string; filename: string }> = [];
        if (orchAttRefKeys && orchAttRefKeys.length > 0) {
          console.log(`   📎 Downloading ${orchAttRefKeys.length} attachment(s) for orchestration...`);
          orchAttachmentFiles = await resolveCommandAttachments(orchAttRefKeys);
        }

        // Build final task with attachment paths
        let orchFinalTask = task;
        if (orchAttachmentFiles.length > 0) {
          const fileList = orchAttachmentFiles.map((f) => `- ${f.filename}: ${f.filePath}`).join("\n");
          for (const f of orchAttachmentFiles) {
            orchFinalTask = orchFinalTask.replace(new RegExp(`@file:${f.refKey}`, "g"), f.filePath);
          }
          if (!orchFinalTask.includes(orchAttachmentFiles[0].filePath)) {
            orchFinalTask += `\n\n첨부파일 로컬 경로:\n${fileList}`;
          }
        }

        // Import orchestrate function and ProgressEvent type
        const { orchestrate } = await import("./orchestrator");
        type ProgressEvent = import("./orchestrator").ProgressEvent;

        // Read agents directly from agents.json (avoids auth requirement of API)
        const fs = await import("fs");
        const path = await import("path");
        const agentsJsonPath = path.join(__dirname, "..", "agents.json");
        const agentsData = JSON.parse(fs.readFileSync(agentsJsonPath, "utf-8")) as Array<{
          id: string;
          name: string;
          role: string;
          systemPrompt: string;
          enabled: boolean;
        }>;
        const agents = agentsData
          .filter((a) => a.enabled)
          .map((a) => ({
            id: a.id,
            name: a.name,
            role: a.role,
            systemPrompt: a.systemPrompt,
          }));

        // Build an agent name map
        const agentNameMap: Record<string, string> = {};
        agents.forEach((a) => { agentNameMap[a.id] = a.name; });
        const getAgentName = (id: string) => agentNameMap[id] || id;

        // Progress callback for real-time visibility
        const onProgress = (event: ProgressEvent) => {
          switch (event.phase) {
            case "plan_creating":
              addHistory("orchestrator", "task_started", `🧠 작업 분석 중: ${task}`);
              break;
            case "plan_created":
              addHistory("orchestrator", "output", `📋 계획 수립 완료: ${event.totalSubtasks}개 서브태스크 생성\n${event.detail || ""}`);
              break;
            case "subtask_starting": {
              const agentName = getAgentName(event.agentId || "unknown");
              addHistory("orchestrator", "output", `📨 Orchestrator → ${agentName}: "${event.task}"`);
              addHistory(event.agentId || "unknown", "task_started", `🔄 [${(event.subtaskIndex || 0) + 1}/${event.totalSubtasks}] 작업 수신`);
              break;
            }
            case "subtask_completed": {
              const agentName = getAgentName(event.agentId || "unknown");
              // Include actual agent response in task_completed history (truncated to 10000 chars, full length in metadata)
              const completedDetail = event.detail || "";
              const truncatedDetail = completedDetail.length > 10000
                ? completedDetail.slice(0, 10000) + "\n...(truncated)"
                : completedDetail;
              const completedContent = truncatedDetail
                ? `✅ ${agentName} → Orchestrator 보고:\n${truncatedDetail}`
                : `✅ ${agentName} → Orchestrator: 완료`;
              addHistory(event.agentId || "unknown", "task_completed", completedContent,
                completedDetail.length > 10000 ? { fullResponseLength: completedDetail.length } : undefined);
              break;
            }
            case "subtask_failed": {
              const agentName = getAgentName(event.agentId || "unknown");
              addHistory(event.agentId || "unknown", "task_failed", `❌ ${agentName} → Orchestrator: 실패 — ${event.detail || "알 수 없는 오류"}`);
              break;
            }
            case "subtask_retrying": {
              const agentName = getAgentName(event.agentId || "unknown");
              addHistory(event.agentId || "unknown", "output", `🔄 ${agentName} 재시도 중: ${event.detail || ""}`);
              break;
            }
            case "summarizing":
              addHistory("orchestrator", "output", "📊 결과 종합 중...");
              break;
            case "completed":
              // Final summary logged in .then() handler below
              break;
          }
        };

        // Create an executor function that uses executeLlmTask (Claude → Codex fallback)
        const executor = async (agentId: string, taskStr: string, systemPrompt?: string) => {
          const agentName = getAgentName(agentId);
          agentStatusMap.set(agentId, {
            id: agentId,
            name: agentName,
            status: "running",
            currentTask: taskStr,
          });

          let lastStreamUpdate = 0;
          const STREAM_INTERVAL = 10000; // Send streaming updates every 10 seconds
          let streamBuffer = "";
          let totalChars = 0;
          let chunksReceived = 0;
          const orchToolCalls: ToolCall[] = [];
          const orchRecentEvents: ProgressEventEntry[] = [];

          const isComplexTask = /분석|analyze|refactor|리팩토링|검토|review|보안|security|아키텍처|architect|debug|디버그|plan|계획|test|QA|테스트|PM|product|orchestrat|전체|comprehensive|deep|tdd|migration|마이그레이션/i.test(taskStr);
          // Agent-specific staleTimeout overrides
          const ORCH_AGENT_STALE_OVERRIDES: Record<string, number> = {
            qa: 600000, pm: 600000, orchestrator: 900000, analyst: 600000, learner: 600000,
          };
          const taskStaleTimeout = ORCH_AGENT_STALE_OVERRIDES[agentId] || (isComplexTask ? 600000 : 300000); // agent override > complex 10min > simple 5min

          const result = await executeLlmTaskWithRetry({
            agentId,
            task: taskStr,
            systemPrompt: systemPrompt || `You are the ${agentId} agent.`,
            mcpConfig: MCP_CONFIG_PATH,
            staleTimeout: taskStaleTimeout,
            enableTmux: ENABLE_TMUX,
            onToolCall: (tc: ToolCall) => {
              orchToolCalls.push(tc);
            },
            onOutput: (chunk: string) => {
              // Parse into structured event
              const event = parseOutputChunk(chunk);

              // Log stderr and warnings for visibility
              if (chunk.startsWith("[stderr]") || chunk.startsWith("[warning]")) {
                console.log(`   📡 ${agentName}: ${chunk.trim()}`);
              }

              totalChars += chunk.length;
              chunksReceived++;

              // Keep last 500 chars as preview
              streamBuffer += chunk;
              if (streamBuffer.length > 500) {
                streamBuffer = streamBuffer.slice(-500);
              }

              // Append structured event
              if (event) {
                orchRecentEvents.unshift(event);
                if (orchRecentEvents.length > MAX_RECENT_EVENTS) {
                  orchRecentEvents.length = MAX_RECENT_EVENTS;
                }
              }

              // Update agent status with live output + structured events
              const current = agentStatusMap.get(agentId);
              if (current) {
                agentStatusMap.set(agentId, {
                  ...current,
                  liveOutput: {
                    lastChunk: streamBuffer,
                    totalChars,
                    lastActivityAt: new Date().toISOString(),
                    chunksReceived,
                    recentEvents: [...orchRecentEvents],
                  },
                });
              }

              // Send periodic history entries (less frequently now)
              const now = Date.now();
              if (now - lastStreamUpdate >= STREAM_INTERVAL) {
                lastStreamUpdate = now;
                // Show last 200 chars of accumulated output as progress
                const toolSummary = summarizeToolCalls(orchToolCalls);
                const preview = streamBuffer.length > 200
                  ? "..." + streamBuffer.slice(-200)
                  : streamBuffer;
                addHistory(agentId, "output", `⏳ ${agentName} 진행 중...${toolSummary ? `\n${toolSummary}` : ""}\n${preview}`);
              }
            },
          });

          const elapsed = result.elapsedMs ? ` (${formatDuration(result.elapsedMs)})` : "";
          const finalOrchToolCalls = result.toolCalls || orchToolCalls;

          if (result.success) {
            const prefix = result.fallbackUsed ? "🔁 Codex fallback\n" : "";
            addHistory(agentId, "output", `📋 ${agentName}의 응답${elapsed}:\n${prefix}${result.output || "완료"}`,
              finalOrchToolCalls.length > 0 ? { toolCalls: finalOrchToolCalls } : undefined);
            agentStatusMap.set(agentId, { id: agentId, name: agentName, status: "idle" });
          } else {
            const isHung = result.exitCode === -2;
            const label = isHung ? "⏰ 응답 없음 자동 종료" : "⚠️ 오류";
            addHistory(agentId, "output", `${label}${elapsed}:\n${result.error || "실패"}`,
              finalOrchToolCalls.length > 0 ? { toolCalls: finalOrchToolCalls } : undefined);
            agentStatusMap.set(agentId, {
              id: agentId,
              name: agentName,
              status: isHung ? "idle" : "error",
            });

            // Add retry info if retries were used
            if (result.exitCode === -2 && "retriesUsed" in result) {
              addHistory(agentId, "output", `🔄 ${agentName}: ${(result as { retriesUsed: number }).retriesUsed}회 재시도 후에도 실패`);
            }
          }

          return result;
        };

        // Execute orchestration (don't block poll loop)
        orchestrate(orchFinalTask, agents, executor, onProgress).then((result) => {
          // Clean up downloaded attachment temp files
          if (orchAttRefKeys && orchAttRefKeys.length > 0) {
            cleanupAttachmentFiles(orchAttRefKeys);
          }

          const elapsed = formatDuration(result.totalTime);
          console.log(`   ✅ Orchestration completed: ${result.results.length} subtasks (${elapsed})`);
          addHistory("orchestrator", "task_completed", `🏁 오케스트레이션 완료 — ⏱️ 총 ${elapsed} 소요\n\n${result.summary}`);
        }).catch((error) => {
          // Clean up on failure too
          if (orchAttRefKeys && orchAttRefKeys.length > 0) {
            cleanupAttachmentFiles(orchAttRefKeys);
          }

          console.log(`   ❌ Orchestration failed: ${error.message}`);
          addHistory("orchestrator", "task_failed", error.message);
        });

        return { success: true, message: "Orchestration started" };
      }

      default:
        return { error: `Unknown command type: ${command.type}` };
    }
  } catch (error) {
    console.error(`   ❌ Command failed:`, error);
    return { error: String(error) };
  }
}

// Track when agents entered error state for auto-recovery
const agentErrorTimestamps = new Map<string, number>();
const AUTO_RECOVERY_MS = 300000; // 5 minutes in error state → auto-recover to idle

// Auto-recover stuck agents (error state > 5 minutes → idle)
function recoverStuckAgents(): void {
  const now = Date.now();
  for (const [agentId, agent] of agentStatusMap.entries()) {
    if (agent.status === "error") {
      if (!agentErrorTimestamps.has(agentId)) {
        agentErrorTimestamps.set(agentId, now);
      }
      const errorDuration = now - (agentErrorTimestamps.get(agentId) || now);
      if (errorDuration > AUTO_RECOVERY_MS) {
        console.log(`   🔄 Auto-recovering stuck agent: ${agentId} (error for ${Math.round(errorDuration / 60000)}min)`);
        agentStatusMap.set(agentId, {
          id: agent.id,
          name: agent.name,
          status: "idle",
        });
        agentErrorTimestamps.delete(agentId);
        addHistory(agentId, "status_change", `🔄 자동 복구: error 상태 ${Math.round(errorDuration / 60000)}분 경과로 idle 리셋`);
      }
    } else {
      // Agent is no longer in error, clear the timestamp
      agentErrorTimestamps.delete(agentId);
    }
  }
}

// Main polling loop
async function pollLoop(): Promise<void> {
  try {
    // Auto-recover stuck agents before polling
    recoverStuckAgents();

    // Snapshot entries to send (new entries may be added during command execution)
    const entriesToSend = [...pendingHistoryEntries];
    pendingHistoryEntries.length = 0;

    const result = (await apiCall("/poll", "POST", {
      gatewayId: GATEWAY_ID,
      agents: getAgentsList(),
      historyEntries: entriesToSend,
    })) as { commands?: RelayCommand[] };

    if (result.commands && result.commands.length > 0) {
      for (const command of result.commands) {
        await executeCommand(command);
      }
    }
  } catch (error) {
    console.error("⚠️ Poll error:", error);
  }
}

// Main
async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════╗");
  console.log("║     🔌 Gateway Connector v1.1          ║");
  console.log("╚════════════════════════════════════════╝");
  console.log(`\n📡 Relay URL: ${RELAY_URL}`);
  console.log(`🔑 Gateway ID: ${GATEWAY_ID}`);
  console.log(`⏱️  Poll interval: ${POLL_INTERVAL}ms\n`);

  // Check Claude CLI
  if (isClaudeAvailable()) {
    console.log("✅ Claude CLI found");
  } else {
    console.log("⚠️  Claude CLI not found - tasks will fail");
  }

  // Check Codex CLI (fallback)
  if (isCodexAvailable()) {
    console.log("✅ Codex CLI found (fallback enabled)");
  } else {
    console.log("⚠️  Codex CLI not found - fallback disabled");
  }

  // Register
  const registered = await register();
  if (!registered) {
    console.error("\n❌ Failed to register. Exiting.");
    process.exit(1);
  }

  console.log("\n🔄 Starting poll loop... (Ctrl+C to stop)\n");

  // Task recovery: mark any previously-running tasks as interrupted & attempt recovery
  const interruptedCount = await taskStateManager.markAllRunningAsInterrupted("gateway_restart");
  if (interruptedCount > 0) {
    console.log(`🔄 ${interruptedCount} interrupted task(s) found from previous run`);
    addHistory("system", "status_change", `🔄 게이트웨이 재시작: ${interruptedCount}개 중단된 태스크 발견`);

    // Fetch interrupted tasks for potential recovery
    const interrupted = await taskStateManager.getInterruptedTasks();
    for (const task of interrupted) {
      // Only recover tasks under max attempts
      if (task.attemptNumber < task.maxAttempts) {
        console.log(`   🔄 Recovering task for ${task.agentId}: ${task.task.slice(0, 80)}...`);
        addHistory(task.agentId, "output", `🔄 중단된 태스크 복구 시도 (시도 ${task.attemptNumber + 1}/${task.maxAttempts})`);

        // Re-queue via relay command
        try {
          await apiCall("/command", "POST", {
            gatewayId: GATEWAY_ID,
            type: task.commandType,
            payload: {
              agentId: task.agentId,
              task: `[복구 시도 ${task.attemptNumber + 1}/${task.maxAttempts}] 이전 작업이 게이트웨이 재시작으로 중단되었습니다. 이전 진행 상태를 참고하여 작업을 이어서 완료해주세요.\n\n이전 출력 (마지막 부분):\n${task.lastOutput || "(없음)"}\n\n원래 작업:\n${task.task}`,
              systemPrompt: task.systemPrompt,
              _attachmentRefKeys: task.attachmentRefKeys,
              requestGroupId: task.requestGroupId,
              requestTitle: task.requestTitle,
              _requeueAttempt: task.attemptNumber,
            },
          });
        } catch (err) {
          console.error(`   ❌ Failed to recover task for ${task.agentId}:`, err);
        }
      } else {
        console.log(`   ⛔ Task for ${task.agentId} exceeded max attempts (${task.maxAttempts}), marking as failed`);
        addHistory(task.agentId, "task_failed", `⛔ 최대 재시도 횟수 초과 (${task.maxAttempts}회), 복구 포기: ${task.task.slice(0, 100)}`);
      }
    }
  }

  // Poll loop
  setInterval(pollLoop, POLL_INTERVAL);
  
  // Initial poll
  await pollLoop();
}

main().catch(console.error);
