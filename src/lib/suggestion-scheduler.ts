/**
 * Suggestion Scheduler
 *
 * Periodic loop that runs suggestion scans, inserts non-duplicate results into
 * agent_suggestions, and broadcasts SSE events. Follows the advisory lock +
 * self-rescheduling setTimeout pattern from orchestrator.ts.
 */

import { query, queryOne, isDbConnectionError, pool } from "@/lib/db";
import { runAllScans, scanOKRProgress, scanProjectStale, scanTaskFailures, scanFeedbackPatterns, scanDeadLetterQueue, scanConversationHealth, scanGatewayHealth, scanTokenUsageSpikes, scanQueueBacklog, scanRelayCommandFailures, scanPermissionBacklog, scanMetricsRegression } from "@/lib/suggestion-scanner";
import type { ScanResult } from "@/lib/suggestion-scanner";
import { broadcastSSE } from "@/lib/sse-broadcaster";
import type { PoolClient } from "pg";

// ─── Constants ────────────────────────────────────────────────────────────────

const SCHEDULER_LOCK_ID = 72696952;
const SCHEDULER_INTERVAL_MS = 60_000; // 1 minute

// Map scan_type strings (stored in DB) to scan functions
const SCAN_FUNCTION_MAP: Record<string, () => Promise<ScanResult[]>> = {
  okr_progress: scanOKRProgress,
  project_stale: scanProjectStale,
  task_failures: scanTaskFailures,
  feedback_patterns: scanFeedbackPatterns,
  dead_letter_queue: scanDeadLetterQueue,
  conversation_health: scanConversationHealth,
  gateway_health: scanGatewayHealth,
  token_usage_spikes: scanTokenUsageSpikes,
  queue_backlog: scanQueueBacklog,
  relay_command_failures: scanRelayCommandFailures,
  permission_backlog: scanPermissionBacklog,
  metrics_regression: scanMetricsRegression,
  all: runAllScans,
};

// Map ScanResult category to agent_suggestions category (DB CHECK constraint)
// DB allows: 'optimization','bug_fix','feature','maintenance','security','performance','data_quality','other'
const CATEGORY_MAP: Record<string, string> = {
  maintenance: "maintenance",
  optimization: "optimization",
  risk: "other",
  opportunity: "feature",
  reporting: "data_quality",
  health: "performance",
  general: "other",
};

// Map ScanResult triggerType to agent_suggestions trigger_type (DB CHECK constraint)
// DB allows: 'scheduled','event_driven','threshold','manual','cascade'
const TRIGGER_TYPE_MAP: Record<string, string> = {
  scheduled: "scheduled",
  event: "event_driven",
  threshold: "threshold",
  pattern: "threshold",
};

// ─── State ────────────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null;
let lockClient: PoolClient | null = null;
let isRunning = false;
let isShuttingDown = false;

// ─── Advisory Lock ────────────────────────────────────────────────────────────

async function acquireAdvisoryLock(): Promise<boolean> {
  try {
    if (lockClient) {
      lockClient.release();
      lockClient = null;
    }

    lockClient = await pool.connect();

    const result = await lockClient.query<{ pg_try_advisory_lock: boolean }>(
      `SELECT pg_try_advisory_lock($1)`,
      [SCHEDULER_LOCK_ID]
    );

    const acquired = result.rows[0]?.pg_try_advisory_lock === true;

    if (!acquired) {
      lockClient.release();
      lockClient = null;
      console.log("[suggestion-scheduler] Advisory lock not acquired (another instance running)");
    } else {
      lockClient.on("error", (err) => {
        console.error("[suggestion-scheduler] Lock connection lost:", err.message);
        lockClient = null;
        stopSuggestionScheduler();
        setTimeout(() => {
          if (!isShuttingDown) {
            console.log("[suggestion-scheduler] Attempting to re-acquire lock...");
            startSuggestionScheduler();
          }
        }, 10_000);
      });
      console.log("[suggestion-scheduler] Advisory lock acquired");
    }

    return acquired;
  } catch (error) {
    console.warn("[suggestion-scheduler] Failed to acquire advisory lock:", error);
    if (lockClient) {
      lockClient.release();
      lockClient = null;
    }
    return false;
  }
}

function releaseAdvisoryLock(): void {
  if (lockClient) {
    try {
      lockClient.release();
    } catch {
      // already released
    }
    lockClient = null;
  }
}

// ─── Dedup Check ─────────────────────────────────────────────────────────────

async function isDuplicate(dedupKey: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM agent_suggestions
     WHERE dedup_key = $1
       AND status IN ('pending', 'approved', 'executing')
     LIMIT 1`,
    [dedupKey]
  );
  return row !== null;
}

// ─── Insert Suggestion ────────────────────────────────────────────────────────

async function insertSuggestion(result: ScanResult): Promise<string | null> {
  const dbCategory = CATEGORY_MAP[result.category] ?? "other";
  const dbTriggerType = TRIGGER_TYPE_MAP[result.triggerType] ?? "scheduled";

  // priority_score in DB is REAL (stored as 0.0-1.0 or 0-100; spec says 0-100)
  // The DB column is just REAL with no constraint — store as-is (0-100)
  const row = await queryOne<{ id: string }>(
    `INSERT INTO agent_suggestions (
       source_agent_id,
       category,
       title,
       description,
       rationale,
       execution_plan,
       urgency,
       priority_score,
       trigger_type,
       trigger_context,
       dedup_key,
       expires_at,
       metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      result.sourceAgentId,
      dbCategory,
      result.title,
      result.description,
      result.rationale,
      JSON.stringify({
        commandType: result.executionPlan.commandType,
        task: result.executionPlan.task,
        estimatedDurationMinutes: result.executionPlan.estimatedDurationMinutes,
        requiresAgents: result.executionPlan.requiresAgents,
        targetAgentId: result.targetAgentId,
      }),
      result.urgency,
      result.priorityScore,
      dbTriggerType,
      JSON.stringify(result.triggerData),
      result.dedupKey,
      // Suggestions expire after 7 days
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      JSON.stringify({ targetAgentId: result.targetAgentId }),
    ]
  );

  return row?.id ?? null;
}

// ─── Expire Old Suggestions ───────────────────────────────────────────────────

async function expireOldSuggestions(): Promise<void> {
  try {
    const rows = await query<{ count: string }>(
      `UPDATE agent_suggestions
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'pending'
         AND expires_at IS NOT NULL
         AND expires_at <= NOW()
       RETURNING id`
    );
    if (rows.length > 0) {
      console.log(`[suggestion-scheduler] Expired ${rows.length} old suggestions`);
    }
  } catch (err) {
    console.warn("[suggestion-scheduler] expireOldSuggestions failed:", err);
  }
}

// ─── Run Due Scan Configs ─────────────────────────────────────────────────────

interface ScanConfigRow {
  id: string;
  agent_id: string;
  scan_type: string;
  interval_seconds: number;
  config_params: Record<string, unknown>;
}

async function runDueScanConfigs(): Promise<void> {
  let configs: ScanConfigRow[];

  try {
    configs = await query<ScanConfigRow>(`
      SELECT id, agent_id, scan_type, interval_seconds, config_params
      FROM suggestion_scan_configs
      WHERE enabled = TRUE
        AND (next_run_at IS NULL OR next_run_at <= NOW())
      ORDER BY next_run_at ASC NULLS FIRST
    `);
  } catch (err) {
    if (isDbConnectionError(err)) {
      console.warn("[suggestion-scheduler] DB connection error, skipping scan configs");
    } else {
      console.error("[suggestion-scheduler] Failed to query scan configs:", err);
    }
    return;
  }

  if (configs.length === 0) return;

  console.log(`[suggestion-scheduler] Running ${configs.length} due scan config(s)`);

  for (const config of configs) {
    if (isShuttingDown) break;

    const scanFn = SCAN_FUNCTION_MAP[config.scan_type];

    if (!scanFn) {
      console.warn(
        `[suggestion-scheduler] Unknown scan_type "${config.scan_type}" for config ${config.id}`
      );
      // Still update timestamps so we don't retry immediately
      await updateScanConfigTimestamps(config.id, config.interval_seconds, null);
      continue;
    }

    let lastError: string | null = null;

    try {
      const results = await scanFn();
      let insertedCount = 0;

      for (const result of results) {
        try {
          const alreadyExists = await isDuplicate(result.dedupKey);
          if (alreadyExists) continue;

          const newId = await insertSuggestion(result);
          if (newId) {
            insertedCount++;
            broadcastSSE({
              type: "improvement:proposed",
              data: {
                suggestionId: newId,
                title: result.title,
                category: result.category,
                urgency: result.urgency,
                priorityScore: result.priorityScore,
                sourceAgentId: result.sourceAgentId,
                targetAgentId: result.targetAgentId,
                dedupKey: result.dedupKey,
              },
            });
          }
        } catch (insertErr) {
          console.error(
            `[suggestion-scheduler] Failed to insert suggestion "${result.title}":`,
            insertErr
          );
        }
      }

      if (insertedCount > 0 || results.length > 0) {
        console.log(
          `[suggestion-scheduler] scan_type=${config.scan_type}: ${results.length} results, ${insertedCount} inserted`
        );
      }
    } catch (scanErr) {
      lastError = scanErr instanceof Error ? scanErr.message : String(scanErr);
      console.error(
        `[suggestion-scheduler] scan_type=${config.scan_type} failed:`,
        scanErr
      );
    }

    await updateScanConfigTimestamps(config.id, config.interval_seconds, lastError);
  }
}

async function updateScanConfigTimestamps(
  configId: string,
  intervalSeconds: number,
  lastError: string | null
): Promise<void> {
  try {
    if (lastError !== null) {
      await queryOne(
        `UPDATE suggestion_scan_configs
         SET last_run_at = NOW(),
             next_run_at = NOW() + ($1 || ' seconds')::interval,
             failure_count = failure_count + 1,
             last_error = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [intervalSeconds.toString(), lastError, configId]
      );
    } else {
      await queryOne(
        `UPDATE suggestion_scan_configs
         SET last_run_at = NOW(),
             next_run_at = NOW() + ($1 || ' seconds')::interval,
             failure_count = 0,
             last_error = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [intervalSeconds.toString(), configId]
      );
    }
  } catch (err) {
    console.warn(
      `[suggestion-scheduler] Failed to update scan config timestamps for ${configId}:`,
      err
    );
  }
}

// ─── Scheduler Cycle ──────────────────────────────────────────────────────────

async function runSchedulerCycle(): Promise<void> {
  if (isShuttingDown) return;

  try {
    await runDueScanConfigs();
    await expireOldSuggestions();
  } catch (err) {
    if (isDbConnectionError(err)) {
      console.warn("[suggestion-scheduler] DB connection error during cycle");
    } else {
      console.error("[suggestion-scheduler] Cycle error:", err);
    }
  }
}

async function scheduleNextCycle(): Promise<void> {
  if (!isRunning || isShuttingDown) return;

  await runSchedulerCycle();

  if (isRunning && !isShuttingDown) {
    timer = setTimeout(scheduleNextCycle, SCHEDULER_INTERVAL_MS);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the suggestion scheduler.
 * Uses a PostgreSQL advisory lock to ensure only one instance runs at a time.
 */
export async function startSuggestionScheduler(): Promise<void> {
  if (isShuttingDown) return;

  if (timer) {
    console.warn("[suggestion-scheduler] Already running, stopping first");
    stopSuggestionScheduler();
  }

  const lockAcquired = await acquireAdvisoryLock();
  if (!lockAcquired) {
    console.log("[suggestion-scheduler] Will retry lock acquisition in 10s...");
    timer = setTimeout(() => {
      if (!isShuttingDown) {
        startSuggestionScheduler();
      }
    }, 10_000);
    return;
  }

  isRunning = true;
  console.log(
    `[suggestion-scheduler] Starting with interval ${SCHEDULER_INTERVAL_MS}ms`
  );

  scheduleNextCycle();
}

/**
 * Stop the suggestion scheduler and release the advisory lock.
 */
export function stopSuggestionScheduler(): void {
  isShuttingDown = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  isRunning = false;
  releaseAdvisoryLock();
  console.log("[suggestion-scheduler] Stopped");
}
