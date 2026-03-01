// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CronJobsPanel from "@/components/CronJobsPanel";

// Mock react-markdown and remark-gfm to avoid ESM issues in jsdom
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <span>{children}</span>,
}));
vi.mock("remark-gfm", () => ({ default: vi.fn() }));

// Mock format-utils relativeTime
vi.mock("@/lib/format-utils", () => ({
  relativeTime: vi.fn(() => "just now"),
}));

// Mock ToastContext so components don't need ToastProvider in tests
vi.mock("@/contexts/ToastContext", () => ({
  useToastContext: () => ({ addToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const makeCronJob = (overrides = {}) => ({
  id: "job-1",
  name: "Daily Report",
  description: "Generate daily report",
  schedule: "0 9 * * *",
  handlerType: "daily-assistant",
  handlerConfig: {},
  enabled: true,
  lastRunAt: "2026-02-28T09:00:00Z",
  nextRunAt: "2026-03-01T09:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-02-28T09:00:00Z",
  ...overrides,
});

function buildFetchMock(jobs = [makeCronJob()]) {
  return vi.fn((url: string | Request | URL, opts?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    const method = opts?.method ?? "GET";

    if (urlStr === "/api/cron/jobs" && method === "GET") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ jobs }),
      });
    }
    if (urlStr.includes("/runs") && method === "GET") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ runs: [] }),
      });
    }
    if (urlStr === "/api/cron/jobs" && method === "POST") {
      const body = JSON.parse(opts?.body as string);
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () => ({ job: { id: "new-job", ...body } }),
      });
    }
    if (urlStr.match(/\/api\/cron\/jobs\/[^/]+$/) && method === "PATCH") {
      const body = JSON.parse(opts?.body as string);
      const jobId = urlStr.split("/").pop()!;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ job: { ...makeCronJob({ id: jobId }), ...body } }),
      });
    }
    if (urlStr.includes("/run") && method === "POST") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
}

// Helper: wait for jobs to load (both desktop+mobile render "Daily Report" twice)
async function waitForJobsLoaded() {
  await waitFor(() => {
    expect(screen.getAllByText("Daily Report").length).toBeGreaterThanOrEqual(1);
  });
}

describe("CronJobsPanel", () => {
  beforeEach(() => {
    global.fetch = buildFetchMock() as unknown as typeof fetch;
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Loading state", () => {
    it("shows loading message while jobs are being fetched", () => {
      global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
      render(<CronJobsPanel />);
      expect(screen.getByText("크론 작업을 불러오는 중...")).toBeInTheDocument();
    });
  });

  describe("Error state", () => {
    it("shows error message and retry button when fetch fails", async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
      ) as unknown as typeof fetch;

      render(<CronJobsPanel />);
      await waitFor(() => {
        expect(screen.getByText("크론 작업을 불러오지 못했습니다")).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    });
  });

  describe("Empty state", () => {
    it("shows empty state message when no jobs exist", async () => {
      global.fetch = buildFetchMock([]) as unknown as typeof fetch;
      render(<CronJobsPanel />);
      await waitFor(() => {
        expect(screen.getByText("등록된 크론 작업이 없습니다")).toBeInTheDocument();
      });
    });

    it("shows 새 작업 추가 button in empty state", async () => {
      global.fetch = buildFetchMock([]) as unknown as typeof fetch;
      render(<CronJobsPanel />);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /새 작업 추가/i })).toBeInTheDocument();
      });
    });
  });

  describe("Job list rendering", () => {
    it("displays job name in job list", async () => {
      render(<CronJobsPanel />);
      // Desktop + mobile both render the job name — use getAllByText
      await waitFor(() => {
        expect(screen.getAllByText("Daily Report").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("displays human-readable schedule label", async () => {
      render(<CronJobsPanel />);
      await waitForJobsLoaded();
      // cronToHuman("0 9 * * *") => "매일 오전 9시"
      expect(screen.getAllByText("매일 오전 9시").length).toBeGreaterThanOrEqual(1);
    });

    it("displays raw cron expression in monospace", async () => {
      render(<CronJobsPanel />);
      await waitForJobsLoaded();
      expect(screen.getAllByText("0 9 * * *").length).toBeGreaterThanOrEqual(1);
    });

    it("displays active status badge for enabled job", async () => {
      render(<CronJobsPanel />);
      await waitForJobsLoaded();
      // Both desktop and mobile render StatusBadge — use getAllByText
      expect(screen.getAllByText("활성").length).toBeGreaterThanOrEqual(1);
    });

    it("displays 일시정지 badge for disabled job", async () => {
      global.fetch = buildFetchMock([makeCronJob({ enabled: false })]) as unknown as typeof fetch;
      render(<CronJobsPanel />);
      await waitFor(() => {
        expect(screen.getAllByText("일시정지").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("shows active count in header", async () => {
      render(<CronJobsPanel />);
      await waitFor(() => {
        expect(screen.getByText("1/1 활성")).toBeInTheDocument();
      });
    });
  });

  describe("CreateJobModal open/close", () => {
    it("opens CreateJobModal when 새 작업 button is clicked", async () => {
      const user = userEvent.setup();
      render(<CronJobsPanel />);
      await waitForJobsLoaded();

      await user.click(screen.getByRole("button", { name: "새 작업" }));
      expect(screen.getByText("새 크론 작업 추가")).toBeInTheDocument();
    });

    it("closes CreateJobModal when 취소 button is clicked", async () => {
      const user = userEvent.setup();
      render(<CronJobsPanel />);
      await waitForJobsLoaded();

      await user.click(screen.getByRole("button", { name: "새 작업" }));
      expect(screen.getByText("새 크론 작업 추가")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "취소" }));
      await waitFor(() => {
        expect(screen.queryByText("새 크론 작업 추가")).not.toBeInTheDocument();
      });
    });

    it("closes CreateJobModal when backdrop overlay is clicked", async () => {
      const user = userEvent.setup();
      render(<CronJobsPanel />);
      await waitForJobsLoaded();

      await user.click(screen.getByRole("button", { name: "새 작업" }));
      expect(screen.getByText("새 크론 작업 추가")).toBeInTheDocument();

      const backdrop = document.querySelector(".fixed.inset-0.z-40");
      expect(backdrop).not.toBeNull();
      fireEvent.click(backdrop!);

      await waitFor(() => {
        expect(screen.queryByText("새 크론 작업 추가")).not.toBeInTheDocument();
      });
    });
  });

  describe("CreateJobModal cron presets", () => {
    async function openModal() {
      const user = userEvent.setup();
      render(<CronJobsPanel />);
      await waitForJobsLoaded();
      await user.click(screen.getByRole("button", { name: "새 작업" }));
      await waitFor(() => screen.getByText("새 크론 작업 추가"));
      return user;
    }

    it("clicking 매시 정각 preset sets schedule to 0 * * * *", async () => {
      const user = await openModal();
      await user.click(screen.getByRole("button", { name: "매시 정각" }));
      const scheduleInput = screen.getByPlaceholderText("분 시 일 월 요일");
      expect((scheduleInput as HTMLInputElement).value).toBe("0 * * * *");
    });

    it("clicking 매주 월요일 9시 preset sets schedule to 0 9 * * 1", async () => {
      const user = await openModal();
      await user.click(screen.getByRole("button", { name: "매주 월요일 9시" }));
      const scheduleInput = screen.getByPlaceholderText("분 시 일 월 요일");
      expect((scheduleInput as HTMLInputElement).value).toBe("0 9 * * 1");
    });

    it("clicking 매 30분 preset sets schedule to */30 * * * *", async () => {
      const user = await openModal();
      await user.click(screen.getByRole("button", { name: "매 30분" }));
      const scheduleInput = screen.getByPlaceholderText("분 시 일 월 요일");
      expect((scheduleInput as HTMLInputElement).value).toBe("*/30 * * * *");
    });

    it("clicking 매월 1일 9시 preset sets schedule to 0 9 1 * *", async () => {
      const user = await openModal();
      await user.click(screen.getByRole("button", { name: "매월 1일 9시" }));
      const scheduleInput = screen.getByPlaceholderText("분 시 일 월 요일");
      expect((scheduleInput as HTMLInputElement).value).toBe("0 9 1 * *");
    });

    it("clicking 평일 오전 9시 preset sets schedule to 0 9 * * 1-5", async () => {
      const user = await openModal();
      await user.click(screen.getByRole("button", { name: "평일 오전 9시" }));
      const scheduleInput = screen.getByPlaceholderText("분 시 일 월 요일");
      expect((scheduleInput as HTMLInputElement).value).toBe("0 9 * * 1-5");
    });

    it("shows Korean preview when valid preset is selected", async () => {
      const user = await openModal();
      // Clear default schedule and set to "매시 정각"
      await user.click(screen.getByRole("button", { name: "매시 정각" }));
      // The preview element contains the Korean text
      await waitFor(() => {
        expect(screen.getAllByText("매시 정각").length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe("CreateJobModal form submission", () => {
    it("calls POST /api/cron/jobs with correct payload", async () => {
      const user = userEvent.setup();
      render(<CronJobsPanel />);
      await waitForJobsLoaded();

      await user.click(screen.getByRole("button", { name: "새 작업" }));
      await waitFor(() => screen.getByText("새 크론 작업 추가"));

      await user.type(screen.getByPlaceholderText("예: 일일 보고서 생성"), "My New Job");
      await user.type(screen.getByPlaceholderText("예: daily-assistant, log, noop"), "log");

      await user.click(screen.getByRole("button", { name: "작업 생성" }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/cron/jobs",
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: expect.stringContaining("My New Job"),
          })
        );
      });
    });

    it("submit button is disabled when name is empty", async () => {
      const user = userEvent.setup();
      render(<CronJobsPanel />);
      await waitForJobsLoaded();

      await user.click(screen.getByRole("button", { name: "새 작업" }));
      await waitFor(() => screen.getByText("새 크론 작업 추가"));

      expect(screen.getByRole("button", { name: "작업 생성" })).toBeDisabled();
    });

    it("shows JSON validation error when config JSON is invalid", async () => {
      const user = userEvent.setup();
      render(<CronJobsPanel />);
      await waitForJobsLoaded();

      await user.click(screen.getByRole("button", { name: "새 작업" }));
      await waitFor(() => screen.getByText("새 크론 작업 추가"));

      const configTextarea = screen.getByDisplayValue("{}");
      // Use fireEvent.change to avoid userEvent's special-character parsing of "{"
      fireEvent.change(configTextarea, { target: { value: "{ invalid json" } });

      await waitFor(() => {
        expect(screen.getByText("올바른 JSON 형식이 아닙니다")).toBeInTheDocument();
      });
    });

    it("enabled toggle defaults to on (active)", async () => {
      const user = userEvent.setup();
      render(<CronJobsPanel />);
      await waitForJobsLoaded();

      await user.click(screen.getByRole("button", { name: "새 작업" }));
      await waitFor(() => screen.getByText("새 크론 작업 추가"));

      // Modal switch: the switch inside the modal (last switch in DOM when modal is open)
      const switches = screen.getAllByRole("switch");
      const modalSwitch = switches[switches.length - 1];
      expect(modalSwitch).toHaveAttribute("aria-checked", "true");
    });

    it("toggling enabled switch changes aria-checked value", async () => {
      const user = userEvent.setup();
      render(<CronJobsPanel />);
      await waitForJobsLoaded();

      await user.click(screen.getByRole("button", { name: "새 작업" }));
      await waitFor(() => screen.getByText("새 크론 작업 추가"));

      const switches = screen.getAllByRole("switch");
      const modalSwitch = switches[switches.length - 1];
      await user.click(modalSwitch);
      expect(modalSwitch).toHaveAttribute("aria-checked", "false");
    });
  });

  describe("Row expand to see run history", () => {
    it("expands job row to show run history when clicked", async () => {
      const user = userEvent.setup();
      render(<CronJobsPanel />);
      await waitForJobsLoaded();

      // Job row is a div with role="button"
      const rowDiv = document.querySelector("div[role='button']");
      expect(rowDiv).not.toBeNull();
      await user.click(rowDiv!);

      await waitFor(() => {
        expect(screen.getByText("실행 기록")).toBeInTheDocument();
        expect(screen.getByText("아직 실행 기록이 없습니다")).toBeInTheDocument();
      });
    });
  });
});
