// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import AgentPerformance from "@/components/AgentPerformance";

const makeAgentStatsResponse = (overrides = {}) => ({
  success: true,
  agents: [
    {
      id: "qa",
      successRate: 82.5,
      totalTasks: 40,
      failedTasks: 7,
      currentModelTier: "sonnet",
      promotionHistory: [
        {
          from: "haiku",
          to: "sonnet",
          reason: "failure rate exceeded 30%",
          date: "2026-03-01",
        },
      ],
      avgDurationSec: 420,
    },
    {
      id: "dev",
      successRate: 45.0,
      totalTasks: 20,
      failedTasks: 11,
      currentModelTier: "haiku",
      promotionHistory: [],
      avgDurationSec: 180,
    },
    {
      id: "ops",
      successRate: 60.0,
      totalTasks: 30,
      failedTasks: 12,
      currentModelTier: "opus",
      promotionHistory: [],
      avgDurationSec: 600,
    },
  ],
  summary: {
    totalAgents: 11,
    overallSuccessRate: 91.2,
    totalTasksToday: 42,
    totalCostUsd: 0.87,
  },
  ...overrides,
});

function buildFetchMock(opts: {
  ok?: boolean;
  body?: object;
} = {}) {
  const { ok = true, body = makeAgentStatsResponse() } = opts;
  return vi.fn((_url: string | Request | URL) => {
    return Promise.resolve({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    });
  });
}

describe("AgentPerformance", () => {
  beforeEach(() => {
    global.fetch = buildFetchMock() as unknown as typeof fetch;
  });

  afterEach(async () => {
    await act(async () => {});
    vi.clearAllMocks();
  });

  describe("Loading state", () => {
    it("shows loading message while fetching data", () => {
      global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
      render(<AgentPerformance />);
      expect(screen.getByText("에이전트 성능 데이터 로딩 중...")).toBeInTheDocument();
    });
  });

  describe("Error state", () => {
    it("shows error message when fetch fails", async () => {
      global.fetch = buildFetchMock({ ok: false }) as unknown as typeof fetch;
      render(<AgentPerformance />);
      await waitFor(() => {
        expect(screen.getByText(/오류:/i)).toBeInTheDocument();
      });
    });
  });

  describe("Summary KPI cards", () => {
    it("renders total agents KPI card", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        expect(screen.getByText("전체 에이전트")).toBeInTheDocument();
        expect(screen.getByText("11")).toBeInTheDocument();
      });
    });

    it("renders overall success rate KPI card", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        expect(screen.getByText("평균 성공률")).toBeInTheDocument();
        expect(screen.getByText("91.2%")).toBeInTheDocument();
      });
    });

    it("renders tasks today KPI card", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        expect(screen.getByText("오늘 작업 수")).toBeInTheDocument();
        expect(screen.getByText("42")).toBeInTheDocument();
      });
    });

    it("renders total cost KPI card", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        expect(screen.getByText("총 비용")).toBeInTheDocument();
        expect(screen.getByText("$0.8700")).toBeInTheDocument();
      });
    });
  });

  describe("Agent list", () => {
    it("renders agent IDs in font-mono", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        expect(screen.getByText("qa")).toBeInTheDocument();
        expect(screen.getByText("dev")).toBeInTheDocument();
        expect(screen.getByText("ops")).toBeInTheDocument();
      });
    });

    it("renders success rates as percentages", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        expect(screen.getByText("82.5%")).toBeInTheDocument();
        expect(screen.getByText("45.0%")).toBeInTheDocument();
        expect(screen.getByText("60.0%")).toBeInTheDocument();
      });
    });

    it("renders task counts and failed counts", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        // qa: 40 tasks, 7 failed
        expect(screen.getByText("40건")).toBeInTheDocument();
        expect(screen.getByText("실패 7")).toBeInTheDocument();
      });
    });

    it("renders average duration in seconds", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        expect(screen.getByText("420초")).toBeInTheDocument();
      });
    });
  });

  describe("Success rate color-coding", () => {
    it("applies green color class for success rate >= 80%", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        // qa has 82.5% success rate -> green
        const rateEl = screen.getByText("82.5%");
        expect(rateEl.className).toContain("text-green-");
      });
    });

    it("applies yellow color class for success rate between 50% and 79%", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        // ops has 60.0% success rate -> yellow
        const rateEl = screen.getByText("60.0%");
        expect(rateEl.className).toContain("text-yellow-");
      });
    });

    it("applies red color class for success rate < 50%", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        // dev has 45.0% success rate -> red
        const rateEl = screen.getByText("45.0%");
        expect(rateEl.className).toContain("text-red-");
      });
    });
  });

  describe("Model tier badges", () => {
    it("shows haiku badge with green color", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        // dev agent has haiku tier
        const badges = screen.getAllByText("haiku");
        expect(badges.length).toBeGreaterThan(0);
        expect(badges[0].className).toContain("green");
      });
    });

    it("shows sonnet badge with blue color", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        // qa agent has sonnet tier
        const badges = screen.getAllByText("sonnet");
        // Filter to the badge (not the promotion history text which might say "to: sonnet")
        expect(badges.length).toBeGreaterThan(0);
        // Find the badge element specifically
        const badge = badges.find((el) => el.className.includes("blue"));
        expect(badge).toBeTruthy();
      });
    });

    it("shows opus badge with purple color", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        // ops agent has opus tier
        const badges = screen.getAllByText("opus");
        expect(badges.length).toBeGreaterThan(0);
        expect(badges[0].className).toContain("purple");
      });
    });
  });

  describe("Promotion history", () => {
    it("shows promotion history when available", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        // qa agent has promotion from haiku to sonnet
        expect(screen.getByText(/승격 이력/i)).toBeInTheDocument();
      });
    });

    it("shows promotion from/to details after expanding", async () => {
      render(<AgentPerformance />);
      // Wait for data to load, then expand the promotion history toggle
      await waitFor(() => {
        expect(screen.getByText(/승격 이력/i)).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText(/승격 이력/i));
      await waitFor(() => {
        // After expanding, promotion reason text should be visible
        expect(screen.getByText("failure rate exceeded 30%")).toBeInTheDocument();
      });
    });
  });

  describe("Empty state", () => {
    it("renders 데이터 없음 when no agents exist", async () => {
      global.fetch = buildFetchMock({
        body: makeAgentStatsResponse({ agents: [] }),
      }) as unknown as typeof fetch;
      render(<AgentPerformance />);
      await waitFor(() => {
        expect(screen.getByText("데이터 없음")).toBeInTheDocument();
      });
    });
  });

  describe("Period selector", () => {
    it("shows period buttons for 7, 14, and 30 days", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "7일" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "14일" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "30일" })).toBeInTheDocument();
      });
    });

    it("highlights active period button (7일 by default)", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "7일" })).toBeInTheDocument();
      });
      const btn7 = screen.getByRole("button", { name: "7일" });
      expect(btn7.className).toContain("bg-blue-600");
    });

    it("re-fetches with new days param when 14일 button is clicked", async () => {
      const fetchMock = buildFetchMock();
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<AgentPerformance />);
      await waitFor(() => {
        expect(screen.getByText("91.2%")).toBeInTheDocument();
      });

      const initialCallCount = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "14일" }));

      await waitFor(() => {
        const calls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls.length).toBeGreaterThan(initialCallCount);
        const newUrls = calls.slice(initialCallCount).map((c) => c[0] as string);
        expect(newUrls.some((u: string) => u.includes("days=14"))).toBe(true);
      });
    });

    it("re-fetches with days=30 when 30일 button is clicked", async () => {
      const fetchMock = buildFetchMock();
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<AgentPerformance />);
      await waitFor(() => {
        expect(screen.getByText("91.2%")).toBeInTheDocument();
      });

      const initialCallCount = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "30일" }));

      await waitFor(() => {
        const calls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls;
        const newUrls = calls.slice(initialCallCount).map((c) => c[0] as string);
        expect(newUrls.some((u: string) => u.includes("days=30"))).toBe(true);
      });
    });

    it("highlights clicked period button", async () => {
      render(<AgentPerformance />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "14일" })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole("button", { name: "14일" }));
      await waitFor(() => {
        const btn14 = screen.getByRole("button", { name: "14일" });
        expect(btn14.className).toContain("bg-blue-600");
      });
    });
  });
});
