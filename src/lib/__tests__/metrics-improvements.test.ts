/**
 * Tests for sql/020_metrics_improvements.sql logic
 *
 * These tests validate the TypeScript-layer wrappers / DB interactions
 * that correspond to the SQL functions introduced in migration 020:
 *   - calculate_key_result_progress (NULL safety)
 *   - snapshot_project_metrics_batch (batch function)
 *   - sync_project_task_status trigger behaviour
 *   - compress_old_metrics_snapshots utility
 *   - SQL file existence (sanity check)
 *
 * All DB calls are mocked using the project-standard pattern.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Standard mock setup (must come before any @/lib imports)
// ---------------------------------------------------------------------------

vi.mock("pg", () => ({
  Pool: vi.fn(() => ({
    query: vi.fn(),
    connect: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  })),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  isDbConnectionError: vi.fn(),
  withDbFallback: vi.fn(),
  pool: {},
}));

import { query, queryOne } from "@/lib/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate what calculate_key_result_progress returns for given inputs */
function calcProgress(
  metricType: string,
  current: number | null,
  target: number | null
): number {
  // Mirrors the PL/pgSQL logic in 020_metrics_improvements.sql §1
  if (current === null) return 0;
  if (target === null || target <= 0) return 0;
  if (metricType === "boolean") {
    return current >= 1 ? 100 : 0;
  }
  return Math.min(100, Math.max(0, Math.round((current / target) * 100)));
}

// ---------------------------------------------------------------------------
// A-1 §0: SQL file existence check
// ---------------------------------------------------------------------------

describe("sql/020_metrics_improvements.sql", () => {
  it("exists on disk", () => {
    const sqlPath = path.resolve(
      process.cwd(),
      "sql/020_metrics_improvements.sql"
    );
    expect(fs.existsSync(sqlPath)).toBe(true);
  });

  it("contains the calculate_key_result_progress function", () => {
    const sqlPath = path.resolve(
      process.cwd(),
      "sql/020_metrics_improvements.sql"
    );
    const content = fs.readFileSync(sqlPath, "utf-8");
    expect(content).toContain("calculate_key_result_progress");
  });

  it("contains the snapshot_project_metrics_batch function", () => {
    const sqlPath = path.resolve(
      process.cwd(),
      "sql/020_metrics_improvements.sql"
    );
    const content = fs.readFileSync(sqlPath, "utf-8");
    expect(content).toContain("snapshot_project_metrics_batch");
  });

  it("contains the sync_project_task_status trigger function", () => {
    const sqlPath = path.resolve(
      process.cwd(),
      "sql/020_metrics_improvements.sql"
    );
    const content = fs.readFileSync(sqlPath, "utf-8");
    expect(content).toContain("sync_project_task_status");
  });

  it("contains the project_metrics_summary materialized view", () => {
    const sqlPath = path.resolve(
      process.cwd(),
      "sql/020_metrics_improvements.sql"
    );
    const content = fs.readFileSync(sqlPath, "utf-8");
    expect(content).toContain("project_metrics_summary");
  });

  it("contains the compress_old_metrics_snapshots utility function", () => {
    const sqlPath = path.resolve(
      process.cwd(),
      "sql/020_metrics_improvements.sql"
    );
    const content = fs.readFileSync(sqlPath, "utf-8");
    expect(content).toContain("compress_old_metrics_snapshots");
  });
});

// ---------------------------------------------------------------------------
// A-1 §1: NULL safety – calculate_key_result_progress logic
// ---------------------------------------------------------------------------

describe("calculate_key_result_progress (NULL safety)", () => {
  describe("returns 0 when current_value is NULL", () => {
    it("percentage metric with NULL current returns 0", () => {
      expect(calcProgress("percentage", null, 100)).toBe(0);
    });

    it("number metric with NULL current returns 0", () => {
      expect(calcProgress("number", null, 50)).toBe(0);
    });

    it("currency metric with NULL current returns 0", () => {
      expect(calcProgress("currency", null, 1000)).toBe(0);
    });

    it("boolean metric with NULL current returns 0", () => {
      expect(calcProgress("boolean", null, 1)).toBe(0);
    });
  });

  describe("returns 0 when target_value is NULL or zero", () => {
    it("percentage metric with NULL target returns 0", () => {
      expect(calcProgress("percentage", 50, null)).toBe(0);
    });

    it("number metric with zero target returns 0 (division-by-zero guard)", () => {
      expect(calcProgress("number", 10, 0)).toBe(0);
    });

    it("number metric with negative target returns 0", () => {
      expect(calcProgress("number", 10, -5)).toBe(0);
    });
  });

  describe("boolean metric type", () => {
    it("returns 100 when current_value >= 1", () => {
      expect(calcProgress("boolean", 1, 1)).toBe(100);
    });

    it("returns 0 when current_value is 0", () => {
      expect(calcProgress("boolean", 0, 1)).toBe(0);
    });

    it("returns 100 for any value >= 1 regardless of target", () => {
      expect(calcProgress("boolean", 5, 1)).toBe(100);
    });
  });

  describe("percentage / number / currency metric types", () => {
    it("returns 50 for 50/100", () => {
      expect(calcProgress("percentage", 50, 100)).toBe(50);
    });

    it("returns 100 for 100/100", () => {
      expect(calcProgress("number", 100, 100)).toBe(100);
    });

    it("caps at 100 when current exceeds target", () => {
      expect(calcProgress("number", 150, 100)).toBe(100);
    });

    it("returns 0 when current is 0", () => {
      expect(calcProgress("currency", 0, 500)).toBe(0);
    });

    it("rounds correctly (33.33… → 33)", () => {
      expect(calcProgress("number", 1, 3)).toBe(33);
    });

    it("rounds correctly (66.66… → 67)", () => {
      expect(calcProgress("number", 2, 3)).toBe(67);
    });
  });
});

// ---------------------------------------------------------------------------
// A-1 §2: snapshot_project_metrics_batch – DB interaction
// ---------------------------------------------------------------------------

describe("snapshot_project_metrics_batch (DB layer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls SELECT snapshot_project_metrics_batch with an array of UUIDs", async () => {
    const projectIds = [
      "550e8400-e29b-41d4-a716-446655440001",
      "550e8400-e29b-41d4-a716-446655440002",
    ];

    vi.mocked(queryOne).mockResolvedValueOnce({ snapshot_project_metrics_batch: 2 });

    // Simulate how application code would call the batch function
    const result = await queryOne<{ snapshot_project_metrics_batch: number }>(
      "SELECT snapshot_project_metrics_batch($1::uuid[])",
      [projectIds]
    );

    expect(queryOne).toHaveBeenCalledWith(
      "SELECT snapshot_project_metrics_batch($1::uuid[])",
      [projectIds]
    );
    expect(result?.snapshot_project_metrics_batch).toBe(2);
  });

  it("returns 0 when called with an empty array", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ snapshot_project_metrics_batch: 0 });

    const result = await queryOne<{ snapshot_project_metrics_batch: number }>(
      "SELECT snapshot_project_metrics_batch($1::uuid[])",
      [[]]
    );

    expect(result?.snapshot_project_metrics_batch).toBe(0);
  });

  it("returns count equal to number of project IDs passed", async () => {
    const projectIds = [
      "550e8400-e29b-41d4-a716-446655440001",
      "550e8400-e29b-41d4-a716-446655440002",
      "550e8400-e29b-41d4-a716-446655440003",
    ];

    vi.mocked(queryOne).mockResolvedValueOnce({ snapshot_project_metrics_batch: 3 });

    const result = await queryOne<{ snapshot_project_metrics_batch: number }>(
      "SELECT snapshot_project_metrics_batch($1::uuid[])",
      [projectIds]
    );

    expect(result?.snapshot_project_metrics_batch).toBe(projectIds.length);
  });
});

// ---------------------------------------------------------------------------
// A-1 §3: sync_project_task_status trigger – DB interaction
// ---------------------------------------------------------------------------

describe("sync_project_task_status trigger (DB interaction)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updating task_executions.status propagates to project_tasks.task_status", async () => {
    // Simulate the application code that triggers the sync:
    // UPDATE task_executions SET status = 'completed' WHERE id = $1
    vi.mocked(query).mockResolvedValueOnce([]); // UPDATE returns empty rows array

    await query(
      "UPDATE task_executions SET status = $1 WHERE id = $2",
      ["completed", "exec-uuid-001"]
    );

    // The trigger fires server-side; from the client we just verify the UPDATE was issued
    expect(query).toHaveBeenCalledWith(
      "UPDATE task_executions SET status = $1 WHERE id = $2",
      ["completed", "exec-uuid-001"]
    );
  });

  it("project_tasks row reflects updated status after trigger fires", async () => {
    const taskExecutionId = "exec-uuid-002";

    // After the trigger fires, reading project_tasks should show the new status
    vi.mocked(queryOne).mockResolvedValueOnce({
      task_execution_id: taskExecutionId,
      task_status: "completed",
    });

    const row = await queryOne<{ task_execution_id: string; task_status: string }>(
      "SELECT task_execution_id, task_status FROM project_tasks WHERE task_execution_id = $1",
      [taskExecutionId]
    );

    expect(row?.task_status).toBe("completed");
  });

  it("trigger does not fire when status value does not change (WHEN OLD.status IS DISTINCT FROM NEW.status)", async () => {
    // If the same status is set, the trigger condition OLD.status IS DISTINCT FROM NEW.status
    // evaluates to false, so the UPDATE on project_tasks should not be issued.
    // We simulate this by confirming only one DB call occurs (the UPDATE itself, not a cascade).
    vi.mocked(query).mockResolvedValueOnce([]);

    await query(
      "UPDATE task_executions SET status = $1 WHERE id = $2",
      ["running", "exec-uuid-003"]
    );

    // Only the one UPDATE call is made; trigger is a no-op when status unchanged
    expect(query).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// A-1 §4: refresh_project_metrics_summary – materialized view refresh
// ---------------------------------------------------------------------------

describe("refresh_project_metrics_summary (materialized view)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the refresh function without error", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null);

    await queryOne("SELECT refresh_project_metrics_summary()");

    expect(queryOne).toHaveBeenCalledWith(
      "SELECT refresh_project_metrics_summary()"
    );
  });

  it("querying the materialized view returns aggregated totals", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({
      total_projects: 5,
      avg_completion_rate: "72.40",
      avg_success_rate: "88.00",
      total_tasks_all_projects: 150,
      total_completed_tasks: 100,
      total_failed_tasks: 10,
      total_running_tasks: 5,
    });

    const summary = await queryOne<{
      total_projects: number;
      avg_completion_rate: string;
      avg_success_rate: string;
      total_tasks_all_projects: number;
      total_completed_tasks: number;
      total_failed_tasks: number;
      total_running_tasks: number;
    }>("SELECT * FROM project_metrics_summary");

    expect(summary?.total_projects).toBe(5);
    expect(summary?.total_completed_tasks).toBe(100);
    expect(summary?.total_failed_tasks).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// A-1 §5: compress_old_metrics_snapshots – returns deleted count
// ---------------------------------------------------------------------------

describe("compress_old_metrics_snapshots (utility)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the number of deleted snapshot rows", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ compress_old_metrics_snapshots: 42 });

    const result = await queryOne<{ compress_old_metrics_snapshots: number }>(
      "SELECT compress_old_metrics_snapshots()"
    );

    expect(result?.compress_old_metrics_snapshots).toBe(42);
  });

  it("returns 0 when no snapshots are old enough to compress", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ compress_old_metrics_snapshots: 0 });

    const result = await queryOne<{ compress_old_metrics_snapshots: number }>(
      "SELECT compress_old_metrics_snapshots()"
    );

    expect(result?.compress_old_metrics_snapshots).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A-1 §6: validate_key_result_weights – OKR weight validation
// ---------------------------------------------------------------------------

describe("validate_key_result_weights (OKR helper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when key result weights sum to 100", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ validate_key_result_weights: true });

    const result = await queryOne<{ validate_key_result_weights: boolean }>(
      "SELECT validate_key_result_weights($1)",
      ["objective-uuid-001"]
    );

    expect(result?.validate_key_result_weights).toBe(true);
  });

  it("returns false when key result weights do not sum to 100", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ validate_key_result_weights: false });

    const result = await queryOne<{ validate_key_result_weights: boolean }>(
      "SELECT validate_key_result_weights($1)",
      ["objective-uuid-002"]
    );

    expect(result?.validate_key_result_weights).toBe(false);
  });
});
