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
 */

import * as os from "os";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env.local") });

import { executeClaudeTask, isClaudeAvailable, formatDuration } from "./claude-executor";

// Config
const RELAY_URL = process.env.RELAY_URL || "http://localhost:3000";
const RELAY_API_KEY = process.env.RELAY_API_KEY || "dev-relay-key";
const GATEWAY_ID = process.env.GATEWAY_ID || os.hostname();
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "3000", 10);
const MCP_CONFIG_PATH = path.resolve(__dirname, "..", ".mcp.json");

interface RelayCommand {
  id: string;
  type: "spawn" | "send" | "status" | "message" | "orchestrate";
  payload: Record<string, unknown>;
}

interface AgentStatus {
  id: string;
  name: string;
  status: "running" | "idle" | "waiting" | "error";
  currentTask?: string;
  sessionKey?: string;
}

// Dynamic agent status tracking (populated from relay commands)
const agentStatusMap = new Map<string, AgentStatus>();

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
}> = [];

// Helper: Add history entry
function addHistory(agentId: string, type: string, content: string, metadata?: Record<string, unknown>) {
  pendingHistoryEntries.push({ agentId, type, content, metadata });
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
        timeout: 0, // No timeout
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

    req.on("error", reject);

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
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
        const { agentId, task, systemPrompt } = command.payload as {
          agentId: string;
          task: string;
          systemPrompt?: string;
        };

        // Update agent status to running
        agentStatusMap.set(agentId, {
          id: agentId,
          name: agentId,
          status: "running",
          currentTask: task,
        });

        addHistory(agentId, "task_started", `Task started: ${task}`);

        // Check Claude CLI availability
        if (!isClaudeAvailable()) {
          console.log(`   ⚠️ Claude CLI not found. Simulating task.`);
          agentStatusMap.set(agentId, {
            id: agentId,
            name: agentId,
            status: "idle",
          });
          addHistory(agentId, "task_failed", "Claude CLI not available");
          return { success: false, error: "Claude CLI not available" };
        }

        // Execute asynchronously (don't block the poll loop)
        console.log(`   🚀 Spawning Claude for agent: ${agentId}`);
        console.log(`   📋 Task: ${task}`);

        executeClaudeTask({
          agentId,
          task,
          systemPrompt: systemPrompt || `You are the ${agentId} agent.`,
          mcpConfig: MCP_CONFIG_PATH,
        }).then((result) => {
          if (result.success) {
            console.log(`   ✅ Task completed for ${agentId}`);
            addHistory(agentId, "task_completed", result.output || "Task completed");
            agentStatusMap.set(agentId, {
              id: agentId,
              name: agentId,
              status: "idle",
            });
          } else {
            console.log(`   ❌ Task failed for ${agentId}: ${result.error}`);
            addHistory(agentId, "task_failed", result.error || "Task failed");
            agentStatusMap.set(agentId, {
              id: agentId,
              name: agentId,
              status: "error",
            });
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
        const { from, to, content, type: msgType } = command.payload as {
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

      case "orchestrate": {
        const { task } = command.payload as { task: string };

        // Import orchestrate function and ProgressEvent type
        const { orchestrate } = await import("./orchestrator");
        type ProgressEvent = import("./orchestrator").ProgressEvent;

        // Read agents directly from agents.json (avoids auth requirement of API)
        const fs = await import("fs");
        const path = await import("path");
        const agentsJsonPath = path.join(__dirname, "..", "agents.json");
        const agentsData = JSON.parse(fs.readFileSync(agentsJsonPath, "utf-8"));
        const agents = agentsData
          .filter((a: any) => a.enabled)
          .map((a: any) => ({
            id: a.id,
            name: a.name,
            role: a.role,
            systemPrompt: a.systemPrompt,
          }));

        // Build an agent name map
        const agentNameMap: Record<string, string> = {};
        agents.forEach((a: any) => { agentNameMap[a.id] = a.name; });
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
              addHistory(event.agentId || "unknown", "task_completed", `✅ ${agentName} → Orchestrator: 완료`);
              break;
            }
            case "subtask_failed": {
              const agentName = getAgentName(event.agentId || "unknown");
              addHistory(event.agentId || "unknown", "task_failed", `❌ ${agentName} → Orchestrator: 실패 — ${event.detail || "알 수 없는 오류"}`);
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

        // Create an executor function that uses executeClaudeTask
        const executor = async (agentId: string, taskStr: string, systemPrompt?: string) => {
          const agentName = getAgentName(agentId);
          agentStatusMap.set(agentId, {
            id: agentId,
            name: agentName,
            status: "running",
            currentTask: taskStr,
          });

          let lastStreamUpdate = 0;
          const STREAM_INTERVAL = 3000; // Send streaming updates every 3 seconds
          let streamBuffer = "";

          const result = await executeClaudeTask({
            agentId,
            task: taskStr,
            systemPrompt: systemPrompt || `You are the ${agentId} agent.`,
            mcpConfig: MCP_CONFIG_PATH,
            onOutput: (chunk: string) => {
              streamBuffer += chunk;
              const now = Date.now();
              if (now - lastStreamUpdate >= STREAM_INTERVAL) {
                lastStreamUpdate = now;
                // Show last 200 chars of accumulated output as progress
                const preview = streamBuffer.length > 200
                  ? "..." + streamBuffer.slice(-200)
                  : streamBuffer;
                addHistory(agentId, "output", `⏳ ${agentName} 진행 중...\n${preview}`);
              }
            },
          });

          const elapsed = result.elapsedMs ? ` (${formatDuration(result.elapsedMs)})` : "";

          if (result.success) {
            addHistory(agentId, "output", `📋 ${agentName}의 응답${elapsed}:\n${result.output || "완료"}`);
            agentStatusMap.set(agentId, { id: agentId, name: agentName, status: "idle" });
          } else {
            addHistory(agentId, "output", `⚠️ ${agentName} 오류${elapsed}:\n${result.error || "실패"}`);
            agentStatusMap.set(agentId, { id: agentId, name: agentName, status: "error" });
          }

          return result;
        };

        // Execute orchestration (don't block poll loop)
        orchestrate(task, agents, executor, onProgress).then((result) => {
          const elapsed = formatDuration(result.totalTime);
          console.log(`   ✅ Orchestration completed: ${result.results.length} subtasks (${elapsed})`);
          addHistory("orchestrator", "task_completed", `🏁 오케스트레이션 완료 — ⏱️ 총 ${elapsed} 소요\n\n${result.summary}`);
        }).catch((error) => {
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

// Main polling loop
async function pollLoop(): Promise<void> {
  try {
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
  console.log("║     🔌 Gateway Connector v1.0          ║");
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

  // Register
  const registered = await register();
  if (!registered) {
    console.error("\n❌ Failed to register. Exiting.");
    process.exit(1);
  }

  console.log("\n🔄 Starting poll loop... (Ctrl+C to stop)\n");

  // Poll loop
  setInterval(pollLoop, POLL_INTERVAL);
  
  // Initial poll
  await pollLoop();
}

main().catch(console.error);
