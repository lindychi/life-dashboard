/**
 * Browser Session Manager
 *
 * Manages headless Chrome/Chromium instances for agent browser access.
 * Each session gets its own Chrome process with a unique CDP endpoint.
 *
 * Features:
 * - Singleton manager with in-memory session tracking
 * - Auto-assigns debug port via --remote-debugging-port=0
 * - Discovers actual port from Chrome's stderr output
 * - Stale session cleanup (default 10-minute max age)
 * - SIGTERM + SIGKILL fallback for graceful process cleanup
 * - Cross-platform Chrome/Chromium discovery
 */

import { spawn, execFileSync, ChildProcess } from "child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserSession {
  sessionId: string;    // Unique session key (e.g. agentId-commandId)
  cdpEndpoint: string;  // WebSocket URL for Chrome DevTools Protocol
  pid: number;          // Chrome process PID
  port: number;         // Actual debug port Chrome bound to
  createdAt: Date;
  lastActivity: Date;
}

// Internal record that also holds the ChildProcess handle
interface SessionRecord extends BrowserSession {
  process: ChildProcess;
}

// ---------------------------------------------------------------------------
// Chrome launch arguments
// ---------------------------------------------------------------------------

const CHROME_ARGS = [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-sync",
  "--no-first-run",
  "--remote-debugging-port=0", // Auto-assign port
];

// Timeout (ms) to wait for Chrome to print the CDP endpoint on stderr
const CHROME_START_TIMEOUT_MS = 5000;

// Default max session age for stale cleanup
const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

// Grace period before escalating SIGTERM → SIGKILL
const SIGKILL_GRACE_MS = 3000;

// ---------------------------------------------------------------------------
// Chrome binary discovery
// ---------------------------------------------------------------------------

const MACOS_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

const LINUX_BINS = ["google-chrome", "chromium-browser", "chromium"];

/**
 * Finds the Chrome/Chromium binary.
 * Resolution order: CHROME_BIN env var → known macOS paths → PATH lookup.
 * Throws if no binary is found.
 */
export function findChromeBin(): string {
  // 1. Explicit override
  const envBin = process.env.CHROME_BIN;
  if (envBin) {
    return envBin;
  }

  // 2. macOS fixed paths
  if (process.platform === "darwin") {
    for (const p of MACOS_PATHS) {
      try {
        execFileSync("test", ["-x", p], { stdio: "ignore" });
        return p;
      } catch {
        // Not found at this path
      }
    }
  }

  // 3. Linux / PATH lookup
  const candidates =
    process.platform === "linux" ? LINUX_BINS : [...LINUX_BINS];

  for (const bin of candidates) {
    try {
      const result = execFileSync("which", [bin], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      if (result) return result;
    } catch {
      // Not on PATH
    }
  }

  throw new Error(
    "Chrome/Chromium not found. Install Google Chrome or set CHROME_BIN env var."
  );
}

// ---------------------------------------------------------------------------
// BrowserSessionManager (singleton)
// ---------------------------------------------------------------------------

class BrowserSessionManager {
  private static instance: BrowserSessionManager;
  private sessions: Map<string, SessionRecord> = new Map();

  private constructor() {}

  static getInstance(): BrowserSessionManager {
    if (!BrowserSessionManager.instance) {
      BrowserSessionManager.instance = new BrowserSessionManager();
    }
    return BrowserSessionManager.instance;
  }

  /**
   * Launches a headless Chrome instance for the given sessionId.
   * If a session with that ID already exists, it is returned as-is.
   */
  async launchBrowser(sessionId: string): Promise<BrowserSession> {
    // Return existing session if already active
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastActivity = new Date();
      return this.toPublic(existing);
    }

    // Cleanup stale sessions before spawning a new one
    await this.cleanupStaleSessions();

    const chromeBin = findChromeBin();

    return new Promise<BrowserSession>((resolve, reject) => {
      const proc = spawn(chromeBin, CHROME_ARGS, {
        stdio: ["ignore", "ignore", "pipe"],
        detached: false,
      });

      let settled = false;
      let stderrBuf = "";

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          proc.kill("SIGKILL");
        } catch {
          // Already dead
        }
        reject(
          new Error(
            `Chrome did not print CDP endpoint within ${CHROME_START_TIMEOUT_MS}ms`
          )
        );
      }, CHROME_START_TIMEOUT_MS);

      proc.stderr!.setEncoding("utf-8");
      proc.stderr!.on("data", (chunk: string) => {
        stderrBuf += chunk;

        // Chrome prints: "DevTools listening on ws://127.0.0.1:PORT/..."
        const match = stderrBuf.match(
          /DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/[^\s]*)/
        );
        if (!match || settled) return;

        settled = true;
        clearTimeout(timeout);

        const cdpEndpoint = match[1];
        const port = parseInt(match[2], 10);
        const pid = proc.pid!;
        const now = new Date();

        const record: SessionRecord = {
          sessionId,
          cdpEndpoint,
          pid,
          port,
          createdAt: now,
          lastActivity: now,
          process: proc,
        };

        this.sessions.set(sessionId, record);
        resolve(this.toPublic(record));
      });

      proc.on("error", (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn Chrome: ${err.message}`));
      });

      proc.on("exit", (code: number | null, signal: string | null) => {
        // Remove from map if the process dies unexpectedly
        this.sessions.delete(sessionId);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(
            new Error(
              `Chrome exited prematurely (code=${code}, signal=${signal}). ` +
                `stderr: ${stderrBuf.slice(-500)}`
            )
          );
        }
      });
    });
  }

  /**
   * Terminates the Chrome process for the given sessionId and removes it
   * from the session map. SIGTERM first, SIGKILL after 3 seconds.
   */
  async closeBrowser(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record) return;

    this.sessions.delete(sessionId);
    await killProcess(record.pid, record.process);
  }

  /**
   * Returns the active session for sessionId, or null if not found.
   */
  getBrowser(sessionId: string): BrowserSession | null {
    const record = this.sessions.get(sessionId);
    if (!record) return null;
    record.lastActivity = new Date();
    return this.toPublic(record);
  }

  /**
   * Returns all currently active sessions.
   */
  listActiveSessions(): BrowserSession[] {
    return Array.from(this.sessions.values()).map((r) => this.toPublic(r));
  }

  /**
   * Closes sessions that have been inactive longer than maxAgeMs.
   * Defaults to 10 minutes.
   */
  async cleanupStaleSessions(maxAgeMs: number = DEFAULT_MAX_AGE_MS): Promise<void> {
    const cutoff = Date.now() - maxAgeMs;
    const stale = Array.from(this.sessions.values()).filter(
      (r) => r.lastActivity.getTime() < cutoff
    );

    await Promise.all(stale.map((r) => this.closeBrowser(r.sessionId)));
  }

  /**
   * Closes all active sessions. Call on process exit for graceful shutdown.
   */
  async closeAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((id) => this.closeBrowser(id)));
  }

  // Strip the internal ChildProcess handle before returning to callers
  private toPublic(record: SessionRecord): BrowserSession {
    return {
      sessionId: record.sessionId,
      cdpEndpoint: record.cdpEndpoint,
      pid: record.pid,
      port: record.port,
      createdAt: record.createdAt,
      lastActivity: record.lastActivity,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Sends SIGTERM to the process; escalates to SIGKILL after SIGKILL_GRACE_MS
 * if the process hasn't exited.
 */
function killProcess(pid: number, proc: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    proc.once("exit", finish);

    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may already be dead
      finish();
      return;
    }

    const killTimer = setTimeout(() => {
      if (done) return;
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone
      }
      finish();
    }, SIGKILL_GRACE_MS);

    // Ensure the timer doesn't prevent Node from exiting
    if (killTimer.unref) killTimer.unref();
  });
}

// ---------------------------------------------------------------------------
// Convenience exports (follow agent-intelligence.ts pattern)
// ---------------------------------------------------------------------------

const manager = BrowserSessionManager.getInstance();

export const launchBrowser = (sessionId: string): Promise<BrowserSession> =>
  manager.launchBrowser(sessionId);

export const closeBrowser = (sessionId: string): Promise<void> =>
  manager.closeBrowser(sessionId);

export const getBrowser = (sessionId: string): BrowserSession | null =>
  manager.getBrowser(sessionId);

export const listBrowserSessions = (): BrowserSession[] =>
  manager.listActiveSessions();

export const cleanupStaleBrowserSessions = (maxAgeMs?: number): Promise<void> =>
  manager.cleanupStaleSessions(maxAgeMs);

export const closeAllBrowsers = (): Promise<void> => manager.closeAll();

export const isChromiumAvailable = (): boolean => {
  try {
    findChromeBin();
    return true;
  } catch {
    return false;
  }
};

export { BrowserSessionManager };
