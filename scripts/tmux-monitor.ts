#!/usr/bin/env npx tsx

/**
 * Agent Session Monitor
 *
 * Interactive CLI to view and attach to agent tmux sessions.
 *
 * Usage:
 *   npx tsx scripts/tmux-monitor.ts          # Interactive menu
 *   npx tsx scripts/tmux-monitor.ts list      # List sessions
 *   npx tsx scripts/tmux-monitor.ts attach pm # Attach to pm agent
 *   npx tsx scripts/tmux-monitor.ts peek pm   # Preview pm output
 *   npx tsx scripts/tmux-monitor.ts kill pm   # Kill pm session
 *   npx tsx scripts/tmux-monitor.ts kill-all  # Kill all sessions
 */

import {
  isTmuxAvailable,
  listAgentSessions,
  capturePane,
  killAgentSession,
  killAllAgentSessions,
  getSessionName,
} from "./tmux-manager";
import { execFileSync } from "child_process";
import * as readline from "readline";

function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

function printSessions(
  sessions: ReturnType<typeof listAgentSessions>
): void {
  if (sessions.length === 0) {
    console.log("  (no active sessions)");
    return;
  }

  for (const [i, s] of sessions.entries()) {
    const status = s.attached ? "📺 attached" : "💤 detached";
    console.log(
      `  ${i + 1}. ${s.agentId.padEnd(12)} ${status}  (${formatAge(s.created)} ago)  [${s.sessionName}]`
    );
  }
}

async function interactiveMenu(): Promise<void> {
  const sessions = listAgentSessions();

  console.log("\n╔════════════════════════════════════════╗");
  console.log("║       🔍 Agent Session Monitor         ║");
  console.log("╚════════════════════════════════════════╝\n");

  printSessions(sessions);

  if (sessions.length === 0) {
    console.log("\n  Start agents via the gateway connector to see sessions here.");
    console.log("  Set ENABLE_TMUX=true in .env.local to enable tmux tracking.\n");
    return;
  }

  console.log("\nCommands:");
  console.log("  [N]        Attach to session (Ctrl+B D to detach)");
  console.log("  p[N]       Peek at output (last 30 lines)");
  console.log("  k[N]       Kill session");
  console.log("  ka         Kill all sessions");
  console.log("  q          Quit\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question("Choice: ", resolve);
  });
  rl.close();

  if (answer === "q" || answer === "") return;

  if (answer === "ka") {
    const count = killAllAgentSessions();
    console.log(`✅ Killed ${count} session(s)`);
    return;
  }

  // Peek
  const peekMatch = answer.match(/^p(\d+)$/);
  if (peekMatch) {
    const idx = parseInt(peekMatch[1], 10) - 1;
    if (idx >= 0 && idx < sessions.length) {
      const output = capturePane(sessions[idx].sessionName, 30);
      console.log(`\n--- ${sessions[idx].agentId} output ---`);
      console.log(output || "(empty)");
      console.log("--- end ---");
    } else {
      console.error("Invalid session number");
    }
    return;
  }

  // Kill
  const killMatch = answer.match(/^k(\d+)$/);
  if (killMatch) {
    const idx = parseInt(killMatch[1], 10) - 1;
    if (idx >= 0 && idx < sessions.length) {
      killAgentSession(sessions[idx].agentId);
      console.log(`✅ Killed session: ${sessions[idx].agentId}`);
    } else {
      console.error("Invalid session number");
    }
    return;
  }

  // Attach
  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < sessions.length) {
    console.log(`Attaching to: ${sessions[idx].agentId}`);
    console.log("(Press Ctrl+B then D to detach)\n");
    execFileSync("tmux", ["attach-session", "-t", sessions[idx].sessionName], {
      stdio: "inherit",
    });
  } else {
    console.error("Invalid choice");
  }
}

async function main(): Promise<void> {
  if (!isTmuxAvailable()) {
    console.error("❌ tmux is not installed");
    console.log("\nInstall: brew install tmux");
    process.exit(1);
  }

  const [, , command, arg] = process.argv;

  switch (command) {
    case "list":
    case "ls": {
      const sessions = listAgentSessions();
      printSessions(sessions);
      break;
    }

    case "attach": {
      if (!arg) {
        console.error("Usage: tmux-monitor.ts attach <agentId>");
        process.exit(1);
      }
      const sessionName = getSessionName(arg);
      console.log(`Attaching to ${sessionName}... (Ctrl+B D to detach)`);
      execFileSync("tmux", ["attach-session", "-t", sessionName], {
        stdio: "inherit",
      });
      break;
    }

    case "peek": {
      if (!arg) {
        console.error("Usage: tmux-monitor.ts peek <agentId>");
        process.exit(1);
      }
      const output = capturePane(getSessionName(arg), 50);
      console.log(output || "(no output or session not found)");
      break;
    }

    case "kill": {
      if (!arg) {
        console.error("Usage: tmux-monitor.ts kill <agentId>");
        process.exit(1);
      }
      const killed = killAgentSession(arg);
      console.log(killed ? `✅ Killed ${arg}` : `❌ Session not found: ${arg}`);
      break;
    }

    case "kill-all": {
      const count = killAllAgentSessions();
      console.log(`✅ Killed ${count} session(s)`);
      break;
    }

    default:
      await interactiveMenu();
  }
}

main().catch(console.error);
