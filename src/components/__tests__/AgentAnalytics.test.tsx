// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import AgentAnalytics from "@/components/AgentAnalytics";

const makeMetricsSummary = (overrides = {}) => ({
  success: true,
  period_days: 7,
  overall: {
    total_tasks: "100",
    completed_count: "85",
    failed_count: "10",
    timeout_count: "3",
    hung_count: "2",
    success_rate: "85.0",
    avg_duration_sec: "8.5",
    median_duration_sec: "7.0",
    p95_duration_sec: "20.0",
    total_cost_usd: "0.0500",
    total_tool_calls: "300",
  },
  by_agent: [
    {
      agent_id: "dev-agent",
      total_tasks: "60",
      completed_count: "54",
      success_rate: "90.0",
      avg_duration_sec: "7.0",
      total_cost_usd: "0.0300",
    },
    {
      agent_id: "qa-agent",
      total_tasks: "40",
      completed_count: "31",
      success_rate: "77.5",
      avg_duration_sec: "11.0",
      total_cost_usd: "0.0200",
    },
  ],
  trend: [
    { date: "2026-02-27", total_tasks: "15", completed_count: "13", failed_count: "2" },
    { date: "2026-02-26", total_tasks: "20", completed_count: "17", failed_count: "3" },
  ],
  top_failures: [],
  ...overrides,
});

function buildFetchMock(responseBody = makeMetricsSummary(), ok = true) {
  return vi.fn(() =>
    Promise.resolve({
      ok,
      status: ok ? 200 : 500,
      json: async () => responseBody,
    })
  );
}

describe("AgentAnalytics", () => {
  beforeEach(() => {
    global.fetch = buildFetchMock() as unknown as typeof fetch;
  });

  afterEach(async () => {
    await act(async () => {});
    vi.clearAllMocks();
  });

  describe("Loading state", () => {
    it("shows loading spinner while fetching data", () => {
      global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
      render(<AgentAnalytics />);
      expect(screen.getByText("분석 데이터 로딩 중...")).toBeInTheDocument();
    });
  });

  describe("Error state", () => {
    it("shows error message when fetch fails with non-ok response", async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ success: false }),
        })
      ) as unknown as typeof fetch;

      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.getByText("데이터를 불러올 수 없습니다")).toBeInTheDocument();
      });
    });

    it("shows error message when fetch throws a network error", async () => {
      global.fetch = vi.fn(() =>
        Promise.reject(new Error("Network error"))
      ) as unknown as typeof fetch;

      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.getByText("데이터를 불러올 수 없습니다")).toBeInTheDocument();
      });
    });
  });

  describe("Overall stats cards", () => {
    it("displays total task count", async () => {
      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.getByText("100")).toBeInTheDocument();
      });
    });

    it("displays success rate with one decimal", async () => {
      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.getByText("85.0%")).toBeInTheDocument();
      });
    });

    it("displays average duration with s suffix", async () => {
      render(<AgentAnalytics />);
      await waitFor(() => {
        // avg_duration_sec: "8.5" → "8.5s"
        expect(screen.getByText("8.5s")).toBeInTheDocument();
      });
    });

    it("displays total cost formatted as dollars", async () => {
      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.getByText("$0.0500")).toBeInTheDocument();
      });
    });
  });

  describe("Daily trend bar chart", () => {
    it("renders chart heading", async () => {
      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.getByText("일별 태스크 추이")).toBeInTheDocument();
      });
    });

    it("renders formatted date labels for each trend entry", async () => {
      render(<AgentAnalytics />);
      await waitFor(() => {
        // trend dates are reversed (oldest first): 2026-02-26, 2026-02-27
        // formatDate: month/day -> "2/26", "2/27"
        expect(screen.getByText("2/26")).toBeInTheDocument();
        expect(screen.getByText("2/27")).toBeInTheDocument();
      });
    });

    it("shows 데이터 없음 when trend array is empty", async () => {
      global.fetch = buildFetchMock(
        makeMetricsSummary({ trend: [] })
      ) as unknown as typeof fetch;
      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.getByText("데이터 없음")).toBeInTheDocument();
      });
    });

    it("renders legend entries for success and failure", async () => {
      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.getByText("성공")).toBeInTheDocument();
        expect(screen.getByText("실패")).toBeInTheDocument();
      });
    });
  });

  describe("Agent success rates section", () => {
    it("renders agent success rates heading", async () => {
      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.getByText("에이전트별 성공률")).toBeInTheDocument();
      });
    });

    it("displays agent IDs in the success rates list", async () => {
      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.getByText("dev-agent")).toBeInTheDocument();
        expect(screen.getByText("qa-agent")).toBeInTheDocument();
      });
    });

    it("displays success rate percentage for each agent", async () => {
      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.getByText("90.0%")).toBeInTheDocument();
        expect(screen.getByText("77.5%")).toBeInTheDocument();
      });
    });

    it("displays task count for each agent", async () => {
      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.getByText("60건")).toBeInTheDocument();
        expect(screen.getByText("40건")).toBeInTheDocument();
      });
    });

    it("does not render agent section when by_agent is empty", async () => {
      global.fetch = buildFetchMock(
        makeMetricsSummary({ by_agent: [] })
      ) as unknown as typeof fetch;
      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.queryByText("에이전트별 성공률")).not.toBeInTheDocument();
      });
    });
  });

  describe("Empty state", () => {
    it("shows empty state message when no data is available", async () => {
      global.fetch = buildFetchMock(
        makeMetricsSummary({ by_agent: [], top_failures: [], trend: [] })
      ) as unknown as typeof fetch;
      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.getByText(/데이터가 없습니다/i)).toBeInTheDocument();
      });
    });
  });

  describe("Top failures section", () => {
    it("renders top failures when present", async () => {
      global.fetch = buildFetchMock(
        makeMetricsSummary({
          top_failures: [
            {
              agent_id: "flaky-agent",
              total_tasks: "10",
              failure_count: "7",
              failure_rate: "70.0",
              failure_types: ["timeout", "hung"],
            },
          ],
        })
      ) as unknown as typeof fetch;
      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.getByText("실패 패턴 (상위 에이전트)")).toBeInTheDocument();
        expect(screen.getByText("flaky-agent")).toBeInTheDocument();
        expect(screen.getByText("70.0%")).toBeInTheDocument();
      });
    });
  });

  describe("Period selector", () => {
    it("renders 7/14/30일 period buttons", async () => {
      render(<AgentAnalytics />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "7일" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "14일" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "30일" })).toBeInTheDocument();
      });
    });

    it("re-fetches with days=14 when 14일 is clicked", async () => {
      const fetchMock = buildFetchMock();
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<AgentAnalytics />);
      await waitFor(() => expect(screen.getByText("100")).toBeInTheDocument());

      const beforeCount = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "14일" }));

      await waitFor(() => {
        const calls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls;
        const newUrls = calls.slice(beforeCount).map((c) => c[0] as string);
        expect(newUrls.some((u) => u.includes("days=14"))).toBe(true);
      });
    });

    it("highlights active period button with bg-blue-600 class", async () => {
      render(<AgentAnalytics />);
      await waitFor(() => {
        const btn7 = screen.getByRole("button", { name: "7일" });
        expect(btn7.className).toContain("bg-blue-600");
      });
    });
  });
});
