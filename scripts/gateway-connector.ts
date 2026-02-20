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

import { execSync, spawn } from "child_process";
import * as os from "os";

// Config
const RELAY_URL = process.env.RELAY_URL || "http://localhost:3000";
const RELAY_API_KEY = process.env.RELAY_API_KEY || "life-dashboard-relay-key-2024";
const GATEWAY_ID = process.env.GATEWAY_ID || os.hostname();
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "3000", 10);

interface RelayCommand {
  id: string;
  type: "spawn" | "send" | "status";
  payload: Record<string, unknown>;
}

interface AgentStatus {
  id: string;
  name: string;
  status: "running" | "idle" | "waiting" | "error";
  currentTask?: string;
  sessionKey?: string;
}

// Agent definitions (matching dashboard)
const agents: AgentStatus[] = [
  { id: "coder", name: "Coder", status: "idle" },
  { id: "researcher", name: "Researcher", status: "idle" },
  { id: "designer", name: "Designer", status: "idle" },
  { id: "reviewer", name: "Reviewer", status: "idle" },
  { id: "planner", name: "Planner", status: "idle" },
];

// Helper: API call
async function apiCall(
  endpoint: string,
  method: "GET" | "POST" = "POST",
  body?: unknown
): Promise<unknown> {
  const url = `${RELAY_URL}/api/relay${endpoint}`;
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-relay-key": RELAY_API_KEY,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  return response.json();
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
        const { agentId, task } = command.payload as {
          agentId: string;
          task: string;
        };
        
        // Update agent status
        const agent = agents.find((a) => a.id === agentId);
        if (agent) {
          agent.status = "running";
          agent.currentTask = task;
        }

        // Execute via OpenClaw CLI (simplified - adjust based on actual CLI)
        console.log(`   🚀 Spawning agent: ${agentId}`);
        console.log(`   📋 Task: ${task}`);
        
        // TODO: Actually call OpenClaw sessions_spawn
        // const result = execSync(`openclaw sessions spawn --task "${task}" --label "${agentId}"`, {
        //   encoding: "utf-8",
        // });

        return { success: true, agentId, message: "Task started" };
      }

      case "send": {
        const { sessionKey, message } = command.payload as {
          sessionKey: string;
          message: string;
        };
        console.log(`   📤 Sending to session: ${sessionKey}`);
        console.log(`   💬 Message: ${message}`);
        
        // TODO: Actually call OpenClaw sessions_send
        return { success: true, sessionKey };
      }

      case "status": {
        return { agents };
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
    const result = (await apiCall("/poll", "POST", {
      gatewayId: GATEWAY_ID,
      agents,
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
