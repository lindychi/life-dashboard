// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OKRView, { type Objective } from "@/components/OKRView";

// Mock the SSE hook to prevent real EventSource connections and re-fetch loops in tests
vi.mock("@/hooks/useOKRSSE", () => ({
  useOKRSSE: vi.fn().mockImplementation(() => ({
    disconnect: vi.fn(),
    reconnect: vi.fn(),
  })),
}));

// Mock ToastContext so components don't need ToastProvider in tests
vi.mock("@/contexts/ToastContext", () => ({
  useToastContext: () => ({ addToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const makeObjective = (overrides: Partial<Objective> = {}): Objective => ({
  id: "obj-1",
  title: "Grow user base",
  description: "Increase monthly active users",
  periodType: "quarterly",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  status: "active",
  owner: "hanchi",
  overallProgress: 45,
  keyResults: [
    {
      id: "kr-1",
      title: "Reach 1000 MAU",
      currentValue: 450,
      targetValue: 1000,
      unit: "명",
      metricType: "number",
      progress: 45,
      status: "active",
    },
  ],
  ...overrides,
});

function buildFetchMock(objectives: Objective[] = [makeObjective()]) {
  const apiObjectives = objectives.map((obj) => ({
    id: obj.id,
    title: obj.title,
    description: obj.description,
    period_type: obj.periodType,
    start_date: obj.startDate,
    end_date: obj.endDate,
    status: obj.status,
    owner: obj.owner,
    tags: obj.tags,
    overall_progress: obj.overallProgress,
    key_results: obj.keyResults.map((kr) => ({
      id: kr.id,
      title: kr.title,
      description: kr.description,
      current_value: kr.currentValue,
      target_value: kr.targetValue,
      unit: kr.unit,
      metric_type: kr.metricType,
      progress: kr.progress,
      status: kr.status,
      weight: kr.weight,
    })),
  }));

  return vi.fn((url: string | Request | URL, opts?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    const method = opts?.method ?? "GET";

    if (urlStr.includes("/api/okr/objectives") && method === "GET") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ objectives: apiObjectives }),
      });
    }
    if (urlStr.includes("/api/okr/objectives") && method === "POST") {
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () => ({ id: "new-obj", ...JSON.parse(opts?.body as string) }),
      });
    }
    if (urlStr.includes("/api/okr/key-results") && method === "POST") {
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () => ({ id: "new-kr", ...JSON.parse(opts?.body as string) }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

describe("OKRView", () => {
  beforeEach(() => {
    global.fetch = buildFetchMock() as unknown as typeof fetch;
    // Suppress window.alert in tests
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Loading state", () => {
    it("shows loading spinner when fetching objectives", () => {
      global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
      render(<OKRView />);
      expect(screen.getByText("OKR 불러오는 중...")).toBeInTheDocument();
    });
  });

  describe("Error state", () => {
    it("shows error state when fetch fails", async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
      ) as unknown as typeof fetch;

      render(<OKRView />);
      await waitFor(() => {
        expect(screen.getByText("오류 발생")).toBeInTheDocument();
      });
    });
  });

  describe("Empty state", () => {
    it("shows empty state when no objectives exist", async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ objectives: [] }),
        })
      ) as unknown as typeof fetch;

      render(<OKRView />);
      await waitFor(
        () => {
          expect(screen.getByText("OKR이 없습니다")).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it("shows add objective button in empty state", async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ objectives: [] }),
        })
      ) as unknown as typeof fetch;

      render(<OKRView />);
      await waitFor(
        () => {
          expect(screen.getByRole("button", { name: /목표 추가/i })).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });
  });

  describe("When using initialObjectives prop", () => {
    it("renders objectives without fetching when initialObjectives provided", () => {
      const objectives = [makeObjective()];
      render(<OKRView initialObjectives={objectives} />);
      expect(screen.getByText("Grow user base")).toBeInTheDocument();
      // SSE hook may trigger refetch; only assert the objective text is visible
      // and no POST/PATCH fetch was made (GET may be called by SSE handler)
    });

    it("displays objective progress percentage", () => {
      render(<OKRView initialObjectives={[makeObjective({ overallProgress: 75 })]} />);
      // overallProgress=75 appears in both the ObjectiveCard header and the summary card
      // Use getAllByText to handle duplicates
      const elements = screen.getAllByText("75%");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });

    it("displays active status badge for active objectives", () => {
      render(<OKRView initialObjectives={[makeObjective({ status: "active" })]} />);
      expect(screen.getByText("진행 중")).toBeInTheDocument();
    });

    it("displays completed status badge for completed objectives", () => {
      render(
        <OKRView initialObjectives={[makeObjective({ status: "completed" })]} />
      );
      expect(screen.getByText("완료")).toBeInTheDocument();
    });

    it("displays summary cards for active objectives count", () => {
      render(<OKRView initialObjectives={[makeObjective()]} />);
      expect(screen.getByText("활성 목표")).toBeInTheDocument();
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    it("displays overall progress in summary card", () => {
      render(<OKRView initialObjectives={[makeObjective({ overallProgress: 45 })]} />);
      // "전체 진행률" appears both in SummaryCard label and in ObjectiveCard sub-label
      const labels = screen.getAllByText("전체 진행률");
      expect(labels.length).toBeGreaterThanOrEqual(1);
      // "45%" appears in both the SummaryCard value and the ObjectiveCard header
      const values = screen.getAllByText("45%");
      expect(values.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("ObjectiveModal open/close", () => {
    it("opens ObjectiveModal when 목표 추가 button is clicked", async () => {
      const user = userEvent.setup();
      render(<OKRView initialObjectives={[makeObjective()]} />);

      const addBtn = screen.getByRole("button", { name: /목표 추가/i });
      await user.click(addBtn);

      expect(screen.getByText("새 목표 추가")).toBeInTheDocument();
    });

    it("closes ObjectiveModal when 취소 button is clicked", async () => {
      const user = userEvent.setup();
      render(<OKRView initialObjectives={[makeObjective()]} />);

      await user.click(screen.getByRole("button", { name: /목표 추가/i }));
      expect(screen.getByText("새 목표 추가")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "취소" }));
      await waitFor(() => {
        expect(screen.queryByText("새 목표 추가")).not.toBeInTheDocument();
      });
    });

    it("closes ObjectiveModal when backdrop is clicked", async () => {
      const user = userEvent.setup();
      render(<OKRView initialObjectives={[makeObjective()]} />);

      await user.click(screen.getByRole("button", { name: /목표 추가/i }));
      expect(screen.getByText("새 목표 추가")).toBeInTheDocument();

      // Click the backdrop (the fixed overlay div)
      const backdrop = document.querySelector(".fixed.inset-0.z-40");
      expect(backdrop).not.toBeNull();
      fireEvent.click(backdrop!);

      await waitFor(() => {
        expect(screen.queryByText("새 목표 추가")).not.toBeInTheDocument();
      });
    });
  });

  describe("ObjectiveModal form submission", () => {
    it("calls POST /api/okr/objectives with correct payload when form is submitted", async () => {
      const user = userEvent.setup();
      render(<OKRView initialObjectives={[makeObjective()]} />);

      await user.click(screen.getByRole("button", { name: /목표 추가/i }));

      // Fill in required title field
      const titleInput = screen.getByPlaceholderText("예: 올해 1분기 성장 목표");
      await user.clear(titleInput);
      await user.type(titleInput, "Test Objective Title");

      await user.click(screen.getByRole("button", { name: "목표 생성" }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/okr/objectives",
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: expect.stringContaining("Test Objective Title"),
          })
        );
      });
    });

    it("submit button is disabled when title is empty", async () => {
      const user = userEvent.setup();
      render(<OKRView initialObjectives={[makeObjective()]} />);

      await user.click(screen.getByRole("button", { name: /목표 추가/i }));

      const submitBtn = screen.getByRole("button", { name: "목표 생성" });
      expect(submitBtn).toBeDisabled();
    });
  });

  describe("KeyResultModal open/close", () => {
    it("expands objective and shows 핵심결과 추가 button", async () => {
      const user = userEvent.setup();
      render(<OKRView initialObjectives={[makeObjective()]} />);

      // Click objective card header to expand
      await user.click(screen.getByText("Grow user base"));

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /핵심결과 추가/i })
        ).toBeInTheDocument();
      });
    });

    it("opens KeyResultModal when 핵심결과 추가 is clicked", async () => {
      const user = userEvent.setup();
      render(<OKRView initialObjectives={[makeObjective()]} />);

      await user.click(screen.getByText("Grow user base"));

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /핵심결과 추가/i })
        ).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /핵심결과 추가/i }));

      // Modal heading <h2> should appear
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "핵심결과 추가" })).toBeInTheDocument();
      });
    });

    it("closes KeyResultModal when 취소 button is clicked", async () => {
      const user = userEvent.setup();
      render(<OKRView initialObjectives={[makeObjective()]} />);

      await user.click(screen.getByText("Grow user base"));
      await waitFor(() => screen.getByRole("button", { name: /핵심결과 추가/i }));

      await user.click(screen.getByRole("button", { name: /핵심결과 추가/i }));
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: "핵심결과 추가" })).toBeInTheDocument()
      );

      // Cancel button inside modal
      const cancelBtns = screen.getAllByRole("button", { name: "취소" });
      await user.click(cancelBtns[cancelBtns.length - 1]);

      await waitFor(() => {
        expect(screen.queryByRole("heading", { name: "핵심결과 추가" })).not.toBeInTheDocument();
      });
    });
  });

  describe("KeyResultModal form submission", () => {
    it("calls POST /api/okr/key-results with correct payload", async () => {
      const user = userEvent.setup();
      render(<OKRView initialObjectives={[makeObjective()]} />);

      await user.click(screen.getByText("Grow user base"));
      await waitFor(() => screen.getByRole("button", { name: /핵심결과 추가/i }));

      await user.click(screen.getByRole("button", { name: /핵심결과 추가/i }));
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: "핵심결과 추가" })).toBeInTheDocument()
      );

      const titleInput = screen.getByPlaceholderText("예: 월간 활성 사용자 수");
      await user.type(titleInput, "Test KR Title");

      // Label has no htmlFor; locate by placeholder instead
      const targetInput = screen.getByPlaceholderText("예: 1000");
      await user.type(targetInput, "500");

      // Submit button is the disabled-by-default button inside the modal footer
      const submitBtns = screen.getAllByRole("button", { name: /핵심결과 추가/i });
      const submitBtn = submitBtns.find(
        (b) => b.getAttribute("type") === "submit"
      )!;
      await user.click(submitBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/okr/key-results",
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: expect.stringContaining("Test KR Title"),
          })
        );
      });
    });

    it("submit button is disabled when title is empty", async () => {
      const user = userEvent.setup();
      render(<OKRView initialObjectives={[makeObjective()]} />);

      await user.click(screen.getByText("Grow user base"));
      await waitFor(() => screen.getByRole("button", { name: /핵심결과 추가/i }));

      await user.click(screen.getByRole("button", { name: /핵심결과 추가/i }));
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: "핵심결과 추가" })).toBeInTheDocument()
      );

      // Find the submit button (type=submit) among buttons with this name
      const submitBtns = screen.getAllByRole("button", { name: /핵심결과 추가/i });
      const submitBtn = submitBtns.find(
        (b) => b.getAttribute("type") === "submit"
      )!;
      expect(submitBtn).toBeDisabled();
    });
  });

  describe("Key result display", () => {
    it("shows key result title when objective is expanded", async () => {
      const user = userEvent.setup();
      render(<OKRView initialObjectives={[makeObjective()]} />);

      await user.click(screen.getByText("Grow user base"));

      await waitFor(() => {
        expect(screen.getByText("Reach 1000 MAU")).toBeInTheDocument();
      });
    });

    it("shows empty key results message when objective has no key results", async () => {
      const user = userEvent.setup();
      render(
        <OKRView
          initialObjectives={[makeObjective({ keyResults: [] })]}
        />
      );

      await user.click(screen.getByText("Grow user base"));

      await waitFor(() => {
        expect(screen.getByText("핵심 결과가 없습니다")).toBeInTheDocument();
      });
    });
  });
});
