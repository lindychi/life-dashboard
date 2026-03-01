/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * B-1: Agent Stats API Endpoint Tests
 *
 * Tests for GET /api/agent-stats
 *
 * TDD RED phase: tests written before the implementation exists.
 * Run to confirm RED, then implement to see GREEN.
 *
 * Coverage:
 * - GET returns all agents with stats (success rate, model tier, task counts)
 * - GET ?agent_id=xxx returns single agent stats
 * - Returns promotion history for each agent
 * - Returns system summary (total tasks today, overall success rate, total cost)
 * - Requires authentication (returns 401 without auth cookie)
 * - Returns empty array when no agent data exists
 * - avgDurationSec computed from task results
 * - failedTasks count included in per-agent response
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks (must be declared before any @/ imports)
// ---------------------------------------------------------------------------

vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  isDbConnectionError: vi.fn().mockReturnValue(false),
  pool: {},
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
  authenticateRequest: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { query, queryOne } from "@/lib/db";
import { authenticateRequest } from "@/lib/auth";

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockAuthenticateRequest = vi.mocked(authenticateRequest);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGetRequest(searchParams?: Record<string, string>): NextRequest {
  const url = new URL("/api/agent-stats", "http://localhost:3000");
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      url.searchParams.set(k, v);
    }
  }
  return new NextRequest(url, {
    method: "GET",
    headers: { cookie: "auth-token=valid-token" },
  });
}

function makeUnauthenticatedRequest(): NextRequest {
  const url = new URL("/api/agent-stats", "http://localhost:3000");
  return new NextRequest(url, { method: "GET" });
}

// Sample DB rows
const agentResultRows = [
  {
    agent_id: "dev",
    total_tasks: "40",
    failed_tasks: "7",
    avg_duration_sec: "420.5",
    last_model_used: "sonnet",
  },
  {
    agent_id: "qa",
    total_tasks: "20",
    failed_tasks: "2",
    avg_duration_sec: "180.0",
    last_model_used: "haiku",
  },
];

const promotionRows = [
  {
    agent_id: "dev",
    from_model: "haiku",
    to_model: "sonnet",
    reason: "failure_rate_exceeded_30pct",
    promoted_at: "2024-01-15T10:00:00.000Z",
  },
];

const summaryRow = {
  total_agents: "2",
  overall_success_rate: "91.25",
  tasks_today: "42",
  total_cost_usd: "0.87",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/agent-stats (B-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated
    mockAuthenticateRequest.mockResolvedValue(true);
  });

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  describe("authentication", () => {
    it("returns 401 when request is not authenticated", async () => {
      mockAuthenticateRequest.mockResolvedValue(false);

      const { GET } = await import("../agent-stats/route");
      const request = makeUnauthenticatedRequest();
      const response = await GET(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it("proceeds when request is authenticated via session cookie", async () => {
      mockAuthenticateRequest.mockResolvedValue(true);
      mockQuery
        .mockResolvedValueOnce([]) // agent stats query
        .mockResolvedValueOnce([]); // promotions query
      mockQueryOne.mockResolvedValueOnce(null); // summary query

      const { GET } = await import("../agent-stats/route");
      const request = makeGetRequest();
      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    it("proceeds when request has relay key header", async () => {
      mockAuthenticateRequest.mockResolvedValue(true);
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockQueryOne.mockResolvedValueOnce(null);

      const { GET } = await import("../agent-stats/route");
      const url = new URL("/api/agent-stats", "http://localhost:3000");
      const request = new NextRequest(url, {
        method: "GET",
        headers: { "x-relay-key": "dev-relay-key" },
      });
      const response = await GET(request);

      expect(response.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // GET all agents
  // -------------------------------------------------------------------------

  describe("GET all agents: returns full agent list with stats", () => {
    it("returns success:true with agents array", async () => {
      mockQuery
        .mockResolvedValueOnce(agentResultRows)
        .mockResolvedValueOnce(promotionRows);
      mockQueryOne.mockResolvedValueOnce(summaryRow);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.agents)).toBe(true);
    });

    it("returns per-agent id, successRate, totalTasks, failedTasks", async () => {
      mockQuery
        .mockResolvedValueOnce(agentResultRows)
        .mockResolvedValueOnce(promotionRows);
      mockQueryOne.mockResolvedValueOnce(summaryRow);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      const devAgent = data.agents.find((a: any) => a.id === "dev");
      expect(devAgent).toBeDefined();
      expect(devAgent.id).toBe("dev");
      expect(devAgent.totalTasks).toBe(40);
      expect(devAgent.failedTasks).toBe(7);
      // successRate = (40 - 7) / 40 * 100 = 82.5
      expect(devAgent.successRate).toBeCloseTo(82.5, 1);
    });

    it("returns currentModelTier derived from last_model_used", async () => {
      mockQuery
        .mockResolvedValueOnce(agentResultRows)
        .mockResolvedValueOnce(promotionRows);
      mockQueryOne.mockResolvedValueOnce(summaryRow);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      const devAgent = data.agents.find((a: any) => a.id === "dev");
      expect(devAgent.currentModelTier).toBe("sonnet");

      const qaAgent = data.agents.find((a: any) => a.id === "qa");
      expect(qaAgent.currentModelTier).toBe("haiku");
    });

    it("returns avgDurationSec as a number", async () => {
      mockQuery
        .mockResolvedValueOnce(agentResultRows)
        .mockResolvedValueOnce(promotionRows);
      mockQueryOne.mockResolvedValueOnce(summaryRow);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      const devAgent = data.agents.find((a: any) => a.id === "dev");
      expect(typeof devAgent.avgDurationSec).toBe("number");
      expect(devAgent.avgDurationSec).toBeCloseTo(420.5, 1);
    });

    it("returns empty agents array when no agent data exists in DB", async () => {
      mockQuery
        .mockResolvedValueOnce([]) // no agent stats
        .mockResolvedValueOnce([]); // no promotions
      mockQueryOne.mockResolvedValueOnce(null); // no summary

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.agents).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Promotion history
  // -------------------------------------------------------------------------

  describe("promotion history: included per agent", () => {
    it("returns promotionHistory array for agents that have been promoted", async () => {
      mockQuery
        .mockResolvedValueOnce(agentResultRows)
        .mockResolvedValueOnce(promotionRows);
      mockQueryOne.mockResolvedValueOnce(summaryRow);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      const devAgent = data.agents.find((a: any) => a.id === "dev");
      expect(Array.isArray(devAgent.promotionHistory)).toBe(true);
      expect(devAgent.promotionHistory).toHaveLength(1);
    });

    it("includes from, to, reason, and date in each promotion history entry", async () => {
      mockQuery
        .mockResolvedValueOnce(agentResultRows)
        .mockResolvedValueOnce(promotionRows);
      mockQueryOne.mockResolvedValueOnce(summaryRow);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      const devAgent = data.agents.find((a: any) => a.id === "dev");
      const promo = devAgent.promotionHistory[0];
      expect(promo.from).toBe("haiku");
      expect(promo.to).toBe("sonnet");
      expect(promo.reason).toBe("failure_rate_exceeded_30pct");
      expect(promo.date).toBeDefined();
    });

    it("returns empty promotionHistory for agents with no promotions", async () => {
      mockQuery
        .mockResolvedValueOnce(agentResultRows)
        .mockResolvedValueOnce(promotionRows); // only dev has promotions
      mockQueryOne.mockResolvedValueOnce(summaryRow);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      const qaAgent = data.agents.find((a: any) => a.id === "qa");
      expect(Array.isArray(qaAgent.promotionHistory)).toBe(true);
      expect(qaAgent.promotionHistory).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // GET single agent via ?agent_id=xxx
  // -------------------------------------------------------------------------

  describe("GET ?agent_id=xxx: returns single agent stats", () => {
    it("returns only the requested agent when agent_id param is provided", async () => {
      const singleAgentRow = [agentResultRows[0]]; // dev only
      const devPromos = [promotionRows[0]];

      mockQuery
        .mockResolvedValueOnce(singleAgentRow)
        .mockResolvedValueOnce(devPromos);
      mockQueryOne.mockResolvedValueOnce(summaryRow);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest({ agent_id: "dev" }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Single agent still returned in agents array (or as agent field)
      const agents = Array.isArray(data.agents) ? data.agents : [data.agent];
      expect(agents.some((a: any) => a.id === "dev")).toBe(true);
    });

    it("returns empty agents array when agent_id has no data", async () => {
      mockQuery
        .mockResolvedValueOnce([]) // no results for that agent
        .mockResolvedValueOnce([]);
      mockQueryOne.mockResolvedValueOnce(null);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest({ agent_id: "nonexistent" }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.agents).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // System summary
  // -------------------------------------------------------------------------

  describe("system summary: aggregated metrics across all agents", () => {
    it("returns summary object with totalAgents", async () => {
      mockQuery
        .mockResolvedValueOnce(agentResultRows)
        .mockResolvedValueOnce(promotionRows);
      mockQueryOne.mockResolvedValueOnce(summaryRow);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      expect(data.summary).toBeDefined();
      expect(typeof data.summary.totalAgents).toBe("number");
      expect(data.summary.totalAgents).toBe(2);
    });

    it("returns summary.overallSuccessRate as a number", async () => {
      mockQuery
        .mockResolvedValueOnce(agentResultRows)
        .mockResolvedValueOnce(promotionRows);
      mockQueryOne.mockResolvedValueOnce(summaryRow);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      expect(typeof data.summary.overallSuccessRate).toBe("number");
      expect(data.summary.overallSuccessRate).toBeGreaterThanOrEqual(0);
      expect(data.summary.overallSuccessRate).toBeLessThanOrEqual(100);
    });

    it("returns summary.totalTasksToday as a number", async () => {
      mockQuery
        .mockResolvedValueOnce(agentResultRows)
        .mockResolvedValueOnce(promotionRows);
      mockQueryOne.mockResolvedValueOnce(summaryRow);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      expect(typeof data.summary.totalTasksToday).toBe("number");
      expect(data.summary.totalTasksToday).toBe(42);
    });

    it("returns summary.totalCostUsd as a number", async () => {
      mockQuery
        .mockResolvedValueOnce(agentResultRows)
        .mockResolvedValueOnce(promotionRows);
      mockQueryOne.mockResolvedValueOnce(summaryRow);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      expect(typeof data.summary.totalCostUsd).toBe("number");
      expect(data.summary.totalCostUsd).toBeCloseTo(0.87, 2);
    });

    it("returns zero summary values when no agent data exists", async () => {
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockQueryOne.mockResolvedValueOnce(null);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      expect(data.summary.totalAgents).toBe(0);
      expect(data.summary.overallSuccessRate).toBe(0);
      expect(data.summary.totalTasksToday).toBe(0);
      expect(data.summary.totalCostUsd).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Response shape validation
  // -------------------------------------------------------------------------

  describe("response shape", () => {
    it("response includes success, agents, and summary at top level", async () => {
      mockQuery
        .mockResolvedValueOnce(agentResultRows)
        .mockResolvedValueOnce(promotionRows);
      mockQueryOne.mockResolvedValueOnce(summaryRow);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("agents");
      expect(data).toHaveProperty("summary");
    });

    it("each agent entry has all required fields", async () => {
      mockQuery
        .mockResolvedValueOnce(agentResultRows)
        .mockResolvedValueOnce(promotionRows);
      mockQueryOne.mockResolvedValueOnce(summaryRow);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      for (const agent of data.agents) {
        expect(agent).toHaveProperty("id");
        expect(agent).toHaveProperty("successRate");
        expect(agent).toHaveProperty("totalTasks");
        expect(agent).toHaveProperty("failedTasks");
        expect(agent).toHaveProperty("currentModelTier");
        expect(agent).toHaveProperty("promotionHistory");
        expect(agent).toHaveProperty("avgDurationSec");
      }
    });

    it("summary has all required fields", async () => {
      mockQuery
        .mockResolvedValueOnce(agentResultRows)
        .mockResolvedValueOnce(promotionRows);
      mockQueryOne.mockResolvedValueOnce(summaryRow);

      const { GET } = await import("../agent-stats/route");
      const response = await GET(makeGetRequest());
      const data = await response.json();

      expect(data.summary).toHaveProperty("totalAgents");
      expect(data.summary).toHaveProperty("overallSuccessRate");
      expect(data.summary).toHaveProperty("totalTasksToday");
      expect(data.summary).toHaveProperty("totalCostUsd");
    });
  });
});
