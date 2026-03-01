/**
 * Tests for src/lib/agent-intelligence.ts  (A-2: Agent Auto-Promotion)
 *
 * TDD RED → GREEN cycle:
 *   1. These tests are written BEFORE the implementation exists.
 *   2. They drive the exact shape of the public API.
 *   3. Run them first to see RED, then implement to see GREEN.
 *
 * Coverage:
 *   - recordTaskResult: inserts success/failure rows
 *   - getAgentStats: returns {total, failures, successRate} for a window
 *   - shouldPromoteModel: true when failure rate > 30% in last 20 tasks
 *   - getRecommendedModel: haiku→sonnet→opus promotion chain
 *   - Promotion cooldown: no re-promotion within 1 hour
 *   - recordPromotion: inserts promotion audit row
 *   - Window scoping: stats limited to most recent N tasks
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
import {
  recordTaskResult,
  getAgentStats,
  shouldPromoteModel,
  getRecommendedModel,
  recordPromotion,
} from "../agent-intelligence";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENT_ID = "agent-001";
const DEFAULT_WINDOW = 20;

// ---------------------------------------------------------------------------
// recordTaskResult
// ---------------------------------------------------------------------------

describe("recordTaskResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a success row for the given agent", async () => {
    vi.mocked(query).mockResolvedValueOnce([]);

    await recordTaskResult(AGENT_ID, "success");

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_task_results"),
      expect.arrayContaining([AGENT_ID, "success"])
    );
  });

  it("inserts a failure row for the given agent", async () => {
    vi.mocked(query).mockResolvedValueOnce([]);

    await recordTaskResult(AGENT_ID, "failure");

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_task_results"),
      expect.arrayContaining([AGENT_ID, "failure"])
    );
  });

  it("includes model_used when provided", async () => {
    vi.mocked(query).mockResolvedValueOnce([]);

    await recordTaskResult(AGENT_ID, "success", "claude-sonnet-4-5");

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_task_results"),
      expect.arrayContaining([AGENT_ID, "success", "claude-sonnet-4-5"])
    );
  });

  it("omits model_used parameter when not provided", async () => {
    vi.mocked(query).mockResolvedValueOnce([]);

    await recordTaskResult(AGENT_ID, "failure");

    // model_used should default to null in the DB; the call params array should not
    // contain a non-null model string (it can contain null explicitly).
    const call = vi.mocked(query).mock.calls[0];
    const params = call[1] as unknown[];
    expect(params).not.toContain("claude-sonnet-4-5");
  });
});

// ---------------------------------------------------------------------------
// getAgentStats
// ---------------------------------------------------------------------------

describe("getAgentStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns total, failures, and successRate for last 20 tasks by default", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({
      total: "20",
      failures: "4",
    });

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.total).toBe(20);
    expect(stats.failures).toBe(4);
    expect(stats.successRate).toBeCloseTo(0.8);
  });

  it("queries with the default window size of 20", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "5", failures: "1" });

    await getAgentStats(AGENT_ID);

    expect(queryOne).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([AGENT_ID, DEFAULT_WINDOW])
    );
  });

  it("queries with a custom window size when provided", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "10", failures: "2" });

    await getAgentStats(AGENT_ID, 10);

    expect(queryOne).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([AGENT_ID, 10])
    );
  });

  it("returns successRate of 1.0 when there are no failures", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "10", failures: "0" });

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.successRate).toBe(1.0);
    expect(stats.failures).toBe(0);
  });

  it("returns successRate of 0 when all tasks failed", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "5", failures: "5" });

    const stats = await getAgentStats(AGENT_ID);

    expect(stats.successRate).toBe(0);
  });

  it("returns zeros when agent has no task history", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null);

    const stats = await getAgentStats("brand-new-agent");

    expect(stats.total).toBe(0);
    expect(stats.failures).toBe(0);
    expect(stats.successRate).toBe(1.0); // no failures → 100% success by default
  });

  it("stats are scoped to the agent_id (not global)", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "3", failures: "1" });

    await getAgentStats("specific-agent-xyz");

    expect(queryOne).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["specific-agent-xyz"])
    );
  });
});

// ---------------------------------------------------------------------------
// shouldPromoteModel
// ---------------------------------------------------------------------------

describe("shouldPromoteModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when failure rate exceeds 30% in last 20 tasks", async () => {
    // 7/20 = 35% failure rate → should promote
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "20", failures: "7" });

    const result = await shouldPromoteModel(AGENT_ID);

    expect(result).toBe(true);
  });

  it("returns false when failure rate is exactly 30%", async () => {
    // 6/20 = 30% — boundary: not strictly greater than 30%
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "20", failures: "6" });

    const result = await shouldPromoteModel(AGENT_ID);

    expect(result).toBe(false);
  });

  it("returns false when failure rate is below 30%", async () => {
    // 4/20 = 20% failure rate
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "20", failures: "4" });

    const result = await shouldPromoteModel(AGENT_ID);

    expect(result).toBe(false);
  });

  it("returns false when agent has no history (new agent)", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null);

    const result = await shouldPromoteModel("new-agent");

    expect(result).toBe(false);
  });

  it("returns false when total tasks < 5 (insufficient data)", async () => {
    // Only 2 tasks, both failed — but sample too small to promote
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "2", failures: "2" });

    const result = await shouldPromoteModel(AGENT_ID);

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getRecommendedModel (promotion chain: haiku → sonnet → opus)
// ---------------------------------------------------------------------------

describe("getRecommendedModel", () => {
  beforeEach(() => {
    // resetAllMocks drains mockResolvedValueOnce queues in addition to
    // clearing call counts — prevents stale mock bleed-over between tests.
    vi.resetAllMocks();
  });

  it("promotes haiku to sonnet when failure rate > 30%", async () => {
    // shouldPromoteModel returns true (7/20 failures)
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "20", failures: "7" });
    // No recent promotion (cooldown check returns null)
    vi.mocked(queryOne).mockResolvedValueOnce(null);

    const model = await getRecommendedModel(AGENT_ID, "haiku");

    expect(model).toBe("sonnet");
  });

  it("promotes sonnet to opus when failure rate > 30%", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "20", failures: "7" });
    vi.mocked(queryOne).mockResolvedValueOnce(null); // no cooldown

    const model = await getRecommendedModel(AGENT_ID, "sonnet");

    expect(model).toBe("opus");
  });

  it("returns opus unchanged when already at max model tier", async () => {
    // Even with high failure rate, opus cannot be promoted further
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "20", failures: "7" });

    const model = await getRecommendedModel(AGENT_ID, "opus");

    expect(model).toBe("opus");
  });

  it("returns default model when failure rate <= 30%", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "20", failures: "4" });

    const model = await getRecommendedModel(AGENT_ID, "haiku");

    expect(model).toBe("haiku");
  });

  it("returns default model for brand-new agent with no history", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null);

    const model = await getRecommendedModel("new-agent", "haiku");

    expect(model).toBe("haiku");
  });

  it("respects 1-hour promotion cooldown: returns current model if promoted recently", async () => {
    // shouldPromoteModel would return true...
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "20", failures: "7" });
    // ...but there was a recent promotion within the last hour
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: "promo-001",
      agent_id: AGENT_ID,
      from_model: "haiku",
      to_model: "sonnet",
      promoted_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago
    });

    const model = await getRecommendedModel(AGENT_ID, "haiku");

    // Should NOT promote again within 1 hour
    expect(model).toBe("haiku");
  });

  it("allows re-promotion after cooldown period has elapsed", async () => {
    // shouldPromoteModel returns true
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "20", failures: "7" });
    // Last promotion was 2 hours ago — cooldown expired
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: "promo-001",
      agent_id: AGENT_ID,
      from_model: "haiku",
      to_model: "sonnet",
      promoted_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hrs ago
    });

    const model = await getRecommendedModel(AGENT_ID, "haiku");

    expect(model).toBe("sonnet");
  });

  it("handles unknown model tiers by returning the default unchanged", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "20", failures: "7" });

    const model = await getRecommendedModel(AGENT_ID, "claude-custom-tier");

    expect(model).toBe("claude-custom-tier");
  });
});

// ---------------------------------------------------------------------------
// recordPromotion
// ---------------------------------------------------------------------------

describe("recordPromotion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a promotion audit row with all required fields", async () => {
    vi.mocked(query).mockResolvedValueOnce([]);

    await recordPromotion(AGENT_ID, "haiku", "sonnet", "failure_rate_exceeded_30pct");

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_model_promotions"),
      expect.arrayContaining([AGENT_ID, "haiku", "sonnet", "failure_rate_exceeded_30pct"])
    );
  });

  it("records correct from_model and to_model for sonnet→opus promotion", async () => {
    vi.mocked(query).mockResolvedValueOnce([]);

    await recordPromotion(AGENT_ID, "sonnet", "opus", "persistent_high_failure_rate");

    const call = vi.mocked(query).mock.calls[0];
    const params = call[1] as unknown[];
    expect(params).toContain("sonnet");
    expect(params).toContain("opus");
  });

  it("does not throw when DB insert succeeds", async () => {
    vi.mocked(query).mockResolvedValueOnce([]);

    await expect(
      recordPromotion(AGENT_ID, "haiku", "sonnet", "test")
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Window scoping: stats limited to most recent N tasks
// ---------------------------------------------------------------------------

describe("window scoping (last N tasks)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getAgentStats query uses ORDER BY created_at DESC LIMIT to scope the window", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "10", failures: "3" });

    await getAgentStats(AGENT_ID, 10);

    const callSql = vi.mocked(queryOne).mock.calls[0][0] as string;
    // The query must reference the window limit (passed as parameter or inline)
    expect(callSql.toLowerCase()).toMatch(/limit|window|row_number|rank/);
  });

  it("shouldPromoteModel uses the default window of 20 tasks", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ total: "20", failures: "7" });

    await shouldPromoteModel(AGENT_ID);

    expect(queryOne).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([AGENT_ID, 20])
    );
  });
});
