/**
 * Tmux Manager for Agent Process Tracking
 *
 * Provides tmux session management for real-time agent output monitoring.
 * Users can attach to tmux sessions to see agent work live, and scroll
 * through output history.
 *
 * Fallback: Works without tmux — falls back to normal child_process.spawn.
 *
 * Note: tmux commands require shell execution since they use shell features
 * (redirection, pipes). All inputs are sanitized via allowlist validation.
 */

import { execSync, execFileSync } from "child_process";

const SESSION_PREFIX = "ld-agent";

/** Validate agentId to prevent injection (alphanumeric + hyphens only) */
function sanitizeId(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (clean !== id) {
    throw new Error(`Invalid agent ID: ${id}`);
  }
  return clean;
}

/**
 * Check if tmux is available on PATH
 */
export function isTmuxAvailable(): boolean {
  try {
    execFileSync("which", ["tmux"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate tmux session name: ld-agent-{agentId}
 * One session per agent (reuse if exists)
 */
export function getSessionName(agentId: string): string {
  return `${SESSION_PREFIX}-${sanitizeId(agentId)}`;
}

/**
 * Check if a tmux session exists
 */
export function sessionExists(sessionName: string): boolean {
  try {
    execFileSync("tmux", ["has-session", "-t", sessionName], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn a command inside a tmux session.
 *
 * Creates a detached tmux session with the agent name, runs the command inside it,
 * and captures output via pipe-pane + log file tailing.
 */
export function spawnInTmux(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    agentId: string;
    onStdout?: (chunk: string) => void;
    onExit?: (code: number | null) => void;
  }
): { cleanup: () => void; sessionName: string } {
  const agentId = sanitizeId(options.agentId);
  const sessionName = getSessionName(agentId);
  const workDir = options.cwd || process.cwd();
  const logFile = `/tmp/${sessionName}.log`;

  // Kill existing session for this agent (if any)
  if (sessionExists(sessionName)) {
    execFileSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
  }

  // Build shell command string with proper quoting
  const cmdStr = buildShellCommand(command, args);

  // The full command to run inside tmux: cd to workDir, run, then mark exit code
  const tmuxCmd = `cd '${workDir.replace(/'/g, "'\\''")}' && ${cmdStr}; echo "___EXIT_CODE_$?___"; sleep 2`;

  // Create detached tmux session
  execFileSync("tmux", [
    "new-session", "-d", "-s", sessionName,
    "-x", "200", "-y", "50",
    tmuxCmd,
  ], { stdio: "pipe" });

  // Truncate log file and pipe tmux output to it
  execFileSync("bash", ["-c", `> '${logFile}'`], { stdio: "pipe" });
  execFileSync("tmux", [
    "pipe-pane", "-t", sessionName, "-o",
    `cat >> '${logFile}'`,
  ], { stdio: "pipe" });

  // Monitor the log file for new output
  let lastSize = 0;
  let exited = false;

  const captureInterval = setInterval(() => {
    if (exited) return;

    try {
      // Check if session still exists
      if (!sessionExists(sessionName)) {
        exited = true;
        clearInterval(captureInterval);
        options.onExit?.(0);
        return;
      }

      // Read new content from log
      const content = readNewContent(logFile, lastSize);
      if (content.data.length > 0) {
        lastSize = content.newOffset;

        // Check for exit marker
        const exitMatch = content.data.match(/___EXIT_CODE_(\d+)___/);
        if (exitMatch) {
          const cleanData = content.data.replace(/___EXIT_CODE_\d+___\n?/, "");
          if (cleanData) {
            options.onStdout?.(cleanData);
          }
          exited = true;
          clearInterval(captureInterval);
          options.onExit?.(parseInt(exitMatch[1], 10));
          return;
        }

        options.onStdout?.(content.data);
      }
    } catch {
      // Log file may not exist yet or session dead
    }
  }, 1000);

  const cleanup = () => {
    exited = true;
    clearInterval(captureInterval);
    try {
      if (sessionExists(sessionName)) {
        execFileSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
      }
    } catch {
      // Already dead
    }
    try {
      execFileSync("rm", ["-f", logFile], { stdio: "ignore" });
    } catch {
      // Fine
    }
  };

  return { cleanup, sessionName };
}

function buildShellCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((arg) => {
      // Quote args that contain special characters
      if (/[\ \t\n"'`$\\;|&<>(){}[\]!#~*?]/.test(arg)) {
        return `'${arg.replace(/'/g, "'\\''")}'`;
      }
      return arg;
    })
    .join(" ");
}

function readNewContent(
  filePath: string,
  fromOffset: number
): { data: string; newOffset: number } {
  try {
    const stats = execFileSync("wc", ["-c", filePath], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    const fileSize = parseInt(stats.split(/\s+/)[0], 10);

    if (fileSize <= fromOffset || isNaN(fileSize)) {
      return { data: "", newOffset: fromOffset };
    }

    const data = execFileSync("tail", ["-c", `+${fromOffset + 1}`, filePath], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
      maxBuffer: 1024 * 1024,
    });

    return { data, newOffset: fileSize };
  } catch {
    return { data: "", newOffset: fromOffset };
  }
}

/**
 * List all active agent tmux sessions
 */
export function listAgentSessions(): Array<{
  sessionName: string;
  agentId: string;
  created: string;
  attached: boolean;
}> {
  if (!isTmuxAvailable()) return [];

  try {
    const output = execFileSync("tmux", [
      "list-sessions", "-F",
      "#{session_name}|#{session_created}|#{session_attached}",
    ], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();

    if (!output) return [];

    return output
      .split("\n")
      .filter((line) => line.startsWith(SESSION_PREFIX))
      .map((line) => {
        const [sessionName, created, attached] = line.split("|");
        const agentId = sessionName.replace(`${SESSION_PREFIX}-`, "");
        return {
          sessionName,
          agentId,
          created: new Date(parseInt(created, 10) * 1000).toISOString(),
          attached: attached === "1",
        };
      });
  } catch {
    return [];
  }
}

/**
 * Capture current pane content from a session
 */
export function capturePane(sessionName: string, lines: number = 100): string {
  if (!isTmuxAvailable()) return "";

  try {
    return execFileSync("tmux", [
      "capture-pane", "-t", sessionName, "-p", "-S", `-${lines}`,
    ], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

/**
 * Kill a specific agent session
 */
export function killAgentSession(agentId: string): boolean {
  const sessionName = getSessionName(agentId);
  if (!sessionExists(sessionName)) return false;

  try {
    execFileSync("tmux", ["kill-session", "-t", sessionName], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill all agent sessions
 */
export function killAllAgentSessions(): number {
  const sessions = listAgentSessions();
  let killed = 0;
  for (const session of sessions) {
    try {
      execFileSync("tmux", ["kill-session", "-t", session.sessionName], { stdio: "ignore" });
      killed++;
    } catch {
      // Fine
    }
  }
  return killed;
}

/**
 * Get process health metrics for an agent session
 *
 * Checks whether the tmux session's primary process is actually working:
 * - alive: Is the tmux session still running
 * - cpuActive: Is the process using CPU (> 0.5%)
 * - childProcessCount: How many child processes it has spawned
 * - lastPaneActivity: Epoch timestamp of last pane content change
 *
 * Returns defaults (all false/0) if session not found or errors occur.
 */
export interface ProcessHealthState {
  alive: boolean;
  cpuActive: boolean;
  childProcessCount: number;
  lastPaneActivity: string;
}

export function getProcessState(agentId: string): ProcessHealthState {
  const defaults: ProcessHealthState = {
    alive: false,
    cpuActive: false,
    childProcessCount: 0,
    lastPaneActivity: "0",
  };

  const sessionName = getSessionName(agentId);

  // Check if session exists
  if (!sessionExists(sessionName)) {
    return defaults;
  }

  try {
    // Get the PID of the process running in the tmux pane
    const pidStr = execFileSync("tmux", [
      "display-message", "-t", sessionName, "-p", "#{pane_pid}",
    ], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();

    const pid = parseInt(pidStr, 10);
    if (isNaN(pid)) {
      return { ...defaults, alive: true };
    }

    // Check CPU usage
    let cpuActive = false;
    try {
      const cpuOutput = execFileSync("ps", ["-o", "%cpu", "-p", pidStr], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();

      // Output format: "%CPU\n 1.2" — parse second line
      const lines = cpuOutput.split("\n");
      if (lines.length > 1) {
        const cpuPercent = parseFloat(lines[1].trim());
        cpuActive = !isNaN(cpuPercent) && cpuPercent > 0.5;
      }
    } catch {
      // ps command failed, process may be dead
    }

    // Count child processes
    let childProcessCount = 0;
    try {
      const childOutput = execFileSync("pgrep", ["-c", "-P", pidStr], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      childProcessCount = parseInt(childOutput, 10) || 0;
    } catch {
      // pgrep returns non-zero when no children found
      childProcessCount = 0;
    }

    // Get last pane activity timestamp
    let lastPaneActivity = "0";
    try {
      lastPaneActivity = execFileSync("tmux", [
        "display-message", "-t", sessionName, "-p", "#{pane_last_activity}",
      ], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
    } catch {
      // Failed to get activity timestamp
    }

    return {
      alive: true,
      cpuActive,
      childProcessCount,
      lastPaneActivity,
    };
  } catch {
    // Any error → return safe defaults with alive=true (session exists but can't probe)
    return { ...defaults, alive: true };
  }
}
