// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ImprovementTracker from "@/components/ImprovementTracker";
import { ToastProvider } from "@/contexts/ToastContext";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function renderWithProviders() {
  return render(
    <ToastProvider>
      <ImprovementTracker />
    </ToastProvider>
  );
}

function mockAllApis(overrides: Partial<Record<string, unknown>> = {}) {
  const defaults: Record<string, unknown> = {
    "/api/feedback/summary": {
      data: {
        averageRating: 4.2,
        totalFeedback: 15,
        activeImprovements: 3,
        learnedPreferences: 7,
        categoryAverages: { "정확도": 4.5, "속도": 3.8, "완성도": 4.0 },
      },
    },
    "/api/feedback/trends?weeks=8": {
      data: [
        { week: "W1", avgRating: 3.5 },
        { week: "W2", avgRating: 4.0 },
        { week: "W3", avgRating: 4.2 },
        { week: "W4", avgRating: 4.5 },
      ],
    },
    "/api/preferences": {
      data: [
        { id: "1", key: "코드 스타일", value: "함수형" },
        { id: "2", key: "언어", value: "한국어" },
      ],
    },
    "/api/improvements": {
      data: [
        {
          id: "imp-1",
          title: "에러 핸들링 개선",
          description: "더 상세한 에러 메시지 제공",
          status: "proposed",
          createdAt: "2025-01-01T00:00:00Z",
        },
        {
          id: "imp-2",
          title: "응답 속도 향상",
          description: "캐싱 도입으로 응답 시간 단축",
          status: "applied",
          beforeValue: "3초",
          afterValue: "0.5초",
          createdAt: "2025-01-02T00:00:00Z",
        },
      ],
    },
    "/api/feedback?limit=20": {
      data: [
        {
          id: "fb-1",
          agentId: "dev-agent",
          rating: 5,
          comment: "매우 정확한 구현",
          createdAt: "2025-01-03T00:00:00Z",
        },
        {
          id: "fb-2",
          agentId: "ops-agent",
          rating: 3,
          createdAt: "2025-01-02T00:00:00Z",
        },
      ],
    },
    ...overrides,
  };

  mockFetch.mockImplementation((url: string) => {
    const urlStr = typeof url === "string" ? url : String(url);
    for (const [key, value] of Object.entries(defaults)) {
      if (urlStr.includes(key) || urlStr.endsWith(key)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(value),
        });
      }
    }
    return Promise.resolve({ ok: false, status: 404 });
  });
}

describe("ImprovementTracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    renderWithProviders();
    expect(screen.getByText(/로딩 중/)).toBeInTheDocument();
  });

  it("renders KPI cards after loading", async () => {
    mockAllApis();
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText("평균 별점")).toBeInTheDocument();
    });

    // KPI values inside their card containers
    const kpiCards = screen.getByTestId("kpi-cards");
    expect(kpiCards).toBeInTheDocument();
    expect(screen.getByText("총 피드백 수")).toBeInTheDocument();
    expect(screen.getByText("활성 개선 수")).toBeInTheDocument();
    expect(screen.getByText("학습된 선호 수")).toBeInTheDocument();
  });

  it("renders section headings", async () => {
    mockAllApis();
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText("피드백 트렌드")).toBeInTheDocument();
    });

    expect(screen.getByText("카테고리별 평균")).toBeInTheDocument();
    expect(screen.getByText("학습된 선호")).toBeInTheDocument();
    expect(screen.getByText("개선 작업")).toBeInTheDocument();
    expect(screen.getByText("피드백 타임라인")).toBeInTheDocument();
  });

  it("renders learned preferences as pills", async () => {
    mockAllApis();
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText(/코드 스타일: 함수형/)).toBeInTheDocument();
    });
    expect(screen.getByText(/언어: 한국어/)).toBeInTheDocument();
  });

  it("renders improvement actions with correct status badges", async () => {
    mockAllApis();
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText("에러 핸들링 개선")).toBeInTheDocument();
    });

    expect(screen.getByText("제안됨")).toBeInTheDocument();
    expect(screen.getByText("적용됨")).toBeInTheDocument();
    // Applied improvement shows before/after values
    expect(screen.getByText("3초")).toBeInTheDocument();
    expect(screen.getByText("0.5초")).toBeInTheDocument();
  });

  it("renders proposed improvements with approve/reject buttons", async () => {
    mockAllApis();
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText("에러 핸들링 개선")).toBeInTheDocument();
    });

    expect(screen.getByText("승인")).toBeInTheDocument();
    expect(screen.getByText("거절")).toBeInTheDocument();
  });

  it("renders feedback timeline entries", async () => {
    mockAllApis();
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText("dev-agent")).toBeInTheDocument();
    });

    expect(screen.getByText("ops-agent")).toBeInTheDocument();
    expect(screen.getByText("매우 정확한 구현")).toBeInTheDocument();
  });

  it("renders category bars", async () => {
    mockAllApis();
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText("정확도")).toBeInTheDocument();
    });

    expect(screen.getByText("4.5")).toBeInTheDocument();
    expect(screen.getByText("속도")).toBeInTheDocument();
    expect(screen.getByText("3.8")).toBeInTheDocument();
  });

  it("renders empty state messages when APIs return empty data", async () => {
    mockAllApis({
      "/api/preferences": { data: [] },
      "/api/improvements": { data: [] },
      "/api/feedback?limit=20": { data: [] },
    });
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText("학습된 선호가 없습니다")).toBeInTheDocument();
    });

    expect(screen.getByText("개선 작업이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("피드백이 없습니다")).toBeInTheDocument();
  });
});
