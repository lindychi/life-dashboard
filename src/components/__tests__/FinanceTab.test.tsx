// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import FinanceTab from "@/components/FinanceTab";

const makeSummaryResponse = (overrides = {}) => ({
  success: true,
  period_days: 7,
  overall: {
    total_tasks: "42",
    completed_count: "38",
    failed_count: "4",
    success_rate: "90.5",
    avg_duration_sec: "12.3",
    total_cost_usd: "0.1234",
    total_tool_calls: "200",
  },
  by_agent: [
    {
      agent_id: "agent-alpha",
      total_tasks: "20",
      completed_count: "18",
      success_rate: "90.0",
      avg_duration_sec: "10.0",
      total_cost_usd: "0.0500",
    },
    {
      agent_id: "agent-beta",
      total_tasks: "22",
      completed_count: "20",
      success_rate: "90.9",
      avg_duration_sec: "14.5",
      total_cost_usd: "0.0734",
    },
  ],
  trend: [],
  ...overrides,
});

const makeTokenOverviewResponse = (overrides = {}) => ({
  totalCalls: 150,
  totalCost: 0.1234,
  avgCostPerCall: 0.00082,
  modelDistribution: { haiku: 80, sonnet: 50, opus: 20 },
  successRate: 92,
  avgElapsedMs: 1500,
  ecomodeUsageRate: 30,
  escalationRate: 5,
  ...overrides,
});

const makeDailyResponse = (overrides = {}) => ({
  summary: [
    { day: "2026-02-23", model: "haiku", totalCalls: 10, successfulCalls: 9, totalCost: 0.01 },
    { day: "2026-02-24", model: "sonnet", totalCalls: 8, successfulCalls: 8, totalCost: 0.02 },
  ],
  days: 7,
  ...overrides,
});

function buildFetchMock(opts: {
  summaryOk?: boolean;
  overviewOk?: boolean;
  dailyOk?: boolean;
  summaryBody?: object;
  overviewBody?: object;
  dailyBody?: object;
} = {}) {
  const {
    summaryOk = true,
    overviewOk = true,
    dailyOk = true,
    summaryBody = makeSummaryResponse(),
    overviewBody = makeTokenOverviewResponse(),
    dailyBody = makeDailyResponse(),
  } = opts;

  return vi.fn((url: string | Request | URL) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    if (urlStr.includes("/api/metrics/summary")) {
      return Promise.resolve({
        ok: summaryOk,
        status: summaryOk ? 200 : 500,
        json: async () => summaryBody,
      });
    }
    if (urlStr.includes("view=overview")) {
      return Promise.resolve({
        ok: overviewOk,
        status: overviewOk ? 200 : 500,
        json: async () => overviewBody,
      });
    }
    if (urlStr.includes("view=daily")) {
      return Promise.resolve({
        ok: dailyOk,
        status: dailyOk ? 200 : 500,
        json: async () => dailyBody,
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

describe("FinanceTab", () => {
  beforeEach(() => {
    global.fetch = buildFetchMock() as unknown as typeof fetch;
  });

  afterEach(async () => {
    await act(async () => {});
    vi.clearAllMocks();
  });

  describe("Loading state", () => {
    it("shows loading message while fetching data", () => {
      // Hang the fetch so loading persists
      global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
      render(<FinanceTab />);
      expect(screen.getByText("재정 데이터 로딩 중...")).toBeInTheDocument();
    });
  });

  describe("Error state", () => {
    it("shows error message when metrics/summary fetch fails", async () => {
      global.fetch = buildFetchMock({ summaryOk: false }) as unknown as typeof fetch;
      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByText(/오류:/i)).toBeInTheDocument();
      });
      expect(screen.getByText(/metrics\/summary: HTTP 500/i)).toBeInTheDocument();
    });

    it("shows error message when token-usage overview fetch fails", async () => {
      global.fetch = buildFetchMock({ overviewOk: false }) as unknown as typeof fetch;
      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByText(/오류:/i)).toBeInTheDocument();
      });
      expect(screen.getByText(/token-usage overview: HTTP 500/i)).toBeInTheDocument();
    });
  });

  describe("KPI cards", () => {
    it("displays total cost from metrics summary", async () => {
      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByText("$0.1234")).toBeInTheDocument();
      });
    });

    it("displays total tasks count", async () => {
      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByText("42")).toBeInTheDocument();
      });
    });

    it("displays success rate", async () => {
      render(<FinanceTab />);
      await waitFor(() => {
        // success_rate: "90.5" -> "90.5%"
        expect(screen.getByText("90.5%")).toBeInTheDocument();
      });
    });

    it("displays average duration", async () => {
      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByText("12.3초")).toBeInTheDocument();
      });
    });

    it("displays completed count in KPI sub-label", async () => {
      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByText("완료: 38")).toBeInTheDocument();
      });
    });

    it("displays failed count in KPI sub-label", async () => {
      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByText("실패: 4건")).toBeInTheDocument();
      });
    });
  });

  describe("Token overview section", () => {
    it("displays total API calls from token overview", async () => {
      render(<FinanceTab />);
      await waitFor(() => {
        // totalCalls: 150
        expect(screen.getByText("150")).toBeInTheDocument();
      });
    });

    it("displays model distribution bar chart with haiku/sonnet/opus labels", async () => {
      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByText("haiku")).toBeInTheDocument();
        expect(screen.getByText("sonnet")).toBeInTheDocument();
        expect(screen.getByText("opus")).toBeInTheDocument();
      });
    });

    it("shows 데이터 없음 when all model distribution counts are zero", async () => {
      global.fetch = buildFetchMock({
        overviewBody: makeTokenOverviewResponse({
          modelDistribution: { haiku: 0, sonnet: 0, opus: 0 },
        }),
      }) as unknown as typeof fetch;
      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByText("데이터 없음")).toBeInTheDocument();
      });
    });
  });

  describe("Daily cost bar chart", () => {
    it("renders bar chart dates from daily summary", async () => {
      render(<FinanceTab />);
      await waitFor(() => {
        // dateLabel is MM-DD slice (slice(5)) of "2026-02-23" -> "02-23"
        expect(screen.getByText("02-23")).toBeInTheDocument();
        expect(screen.getByText("02-24")).toBeInTheDocument();
      });
    });

    it("shows 데이터 없음 when daily summary is empty", async () => {
      global.fetch = buildFetchMock({
        dailyBody: { summary: [], days: 7 },
      }) as unknown as typeof fetch;
      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByText("데이터 없음")).toBeInTheDocument();
      });
    });
  });

  describe("Per-agent cost table", () => {
    it("renders agent IDs in cost table", async () => {
      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByText("agent-alpha")).toBeInTheDocument();
        expect(screen.getByText("agent-beta")).toBeInTheDocument();
      });
    });

    it("sorts agents by cost descending (highest cost first)", async () => {
      render(<FinanceTab />);
      await waitFor(() => {
        const cells = screen.getAllByText(/agent-(alpha|beta)/);
        // agent-beta has higher cost (0.0734) so it should appear first
        expect(cells[0]).toHaveTextContent("agent-beta");
        expect(cells[1]).toHaveTextContent("agent-alpha");
      });
    });

    it("shows 데이터 없음 when by_agent is empty", async () => {
      global.fetch = buildFetchMock({
        summaryBody: makeSummaryResponse({ by_agent: [] }),
      }) as unknown as typeof fetch;
      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByText("데이터 없음")).toBeInTheDocument();
      });
    });
  });

  describe("Period selector", () => {
    it("shows period buttons for 7, 14, and 30 days", async () => {
      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "7일" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "14일" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "30일" })).toBeInTheDocument();
      });
    });

    it("re-fetches with new days param when 14일 button is clicked", async () => {
      const fetchMock = buildFetchMock();
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByText("$0.1234")).toBeInTheDocument();
      });

      const initialCallCount = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.length;

      fireEvent.click(screen.getByRole("button", { name: "14일" }));

      await waitFor(() => {
        const calls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls.length).toBeGreaterThan(initialCallCount);
        const newUrls = calls.slice(initialCallCount).map((c) => c[0] as string);
        expect(newUrls.some((u) => u.includes("days=14"))).toBe(true);
      });
    });

    it("re-fetches with days=30 when 30일 button is clicked", async () => {
      const fetchMock = buildFetchMock();
      global.fetch = fetchMock as unknown as typeof fetch;

      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByText("$0.1234")).toBeInTheDocument();
      });

      const initialCallCount = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "30일" }));

      await waitFor(() => {
        const calls = (fetchMock as ReturnType<typeof vi.fn>).mock.calls;
        const newUrls = calls.slice(initialCallCount).map((c) => c[0] as string);
        expect(newUrls.some((u) => u.includes("days=30"))).toBe(true);
      });
    });

    it("highlights active period button", async () => {
      render(<FinanceTab />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "7일" })).toBeInTheDocument();
      });
      // 7일 is active by default
      const btn7 = screen.getByRole("button", { name: "7일" });
      expect(btn7.className).toContain("bg-blue-600");

      fireEvent.click(screen.getByRole("button", { name: "14일" }));
      await waitFor(() => {
        const btn14 = screen.getByRole("button", { name: "14일" });
        expect(btn14.className).toContain("bg-blue-600");
      });
    });
  });
});
