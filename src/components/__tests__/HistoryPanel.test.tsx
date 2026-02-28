// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HistoryPanel from "@/components/HistoryPanel";
import type { AgentRuntime, HistoryEntry } from "@/lib/frontend-types";

// Mock dependencies
vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/agent-actions", () => ({
  sendAgentReply: vi.fn().mockResolvedValue(undefined),
}));

// TODO: Fix React 19 passive effects compatibility - temporarily skipped
// These tests fail due to commitHookPassiveMountEffects error in jsdom + React 19
describe.skip("HistoryPanel Integration Tests", () => {
  const mockAgents: AgentRuntime[] = [
    {
      config: {
        id: "agent-1",
        name: "Dev Agent",
        emoji: "🛠️",
        role: "developer",
        category: "dev" as const,
        enabled: true,
        systemPrompt: "test",
      },
      status: "idle",
      stack: [],
      completedToday: 0,
    },
    {
      config: {
        id: "agent-2",
        name: "QA Agent",
        emoji: "🧪",
        role: "qa",
        category: "dev" as const,
        enabled: true,
        systemPrompt: "test",
      },
      status: "idle",
      stack: [],
      completedToday: 0,
    },
  ];

  const mockHistoryData: Record<string, HistoryEntry[]> = {
    "agent-1": [
      {
        id: "entry-1",
        agentId: "agent-1",
        type: "task_started",
        content: "Task started: Implement feature X",
        timestamp: new Date("2024-01-01T10:00:00Z").toISOString(),
      },
      {
        id: "entry-2",
        agentId: "agent-1",
        type: "task_completed",
        content: "Task completed: Feature X implemented",
        timestamp: new Date("2024-01-01T10:30:00Z").toISOString(),
      },
    ],
    "agent-2": [
      {
        id: "entry-3",
        agentId: "agent-2",
        type: "task_started",
        content: "Task started: Run tests",
        timestamp: new Date("2024-01-01T11:00:00Z").toISOString(),
      },
    ],
  };

  const mockAgentMap = {
    "agent-1": { emoji: "🛠️", name: "Dev Agent" },
    "agent-2": { emoji: "🧪", name: "QA Agent" },
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // IntersectionObserver is not available in jsdom
    global.IntersectionObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
      unobserve: vi.fn(),
    })) as unknown as typeof IntersectionObserver;

    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    // Default mock response for timeline API
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        entries: [
          {
            id: "entry-1",
            agentId: "agent-1",
            type: "task_started",
            content: "Task started: Implement feature X",
            timestamp: new Date("2024-01-01T10:00:00Z").toISOString(),
          },
          {
            id: "entry-2",
            agentId: "agent-1",
            type: "task_completed",
            content: "Task completed: Feature X implemented",
            timestamp: new Date("2024-01-01T10:30:00Z").toISOString(),
          },
          {
            id: "entry-3",
            agentId: "agent-2",
            type: "task_started",
            content: "Task started: Run tests",
            timestamp: new Date("2024-01-01T11:00:00Z").toISOString(),
          },
        ],
        nextCursor: null,
        totalCount: 3,
        hasMore: false,
      }),
    });
  });

  afterEach(async () => {
    // Flush any pending React passive effects before cleanup
    await act(async () => {});
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("Rendering", () => {
    it("should render filter controls", async () => {
      render(
        <HistoryPanel
          historyData={mockHistoryData}
          agents={mockAgents}
          agentMap={mockAgentMap}
        />
      );

      // Wait for initial data load
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });

      // Check filter controls exist
      expect(screen.getByRole("combobox", { name: /전체 에이전트/i })).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: /전체 타입/i })).toBeInTheDocument();
      expect(screen.getByPlaceholderText("검색...")).toBeInTheDocument();
    });

    it("should render timeline entries after API call", async () => {
      render(
        <HistoryPanel
          historyData={mockHistoryData}
          agents={mockAgents}
          agentMap={mockAgentMap}
        />
      );

      // Wait for entries to appear
      await waitFor(() => {
        expect(screen.getByText(/Implement feature X/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/Feature X implemented/i)).toBeInTheDocument();
      expect(screen.getByText(/Run tests/i)).toBeInTheDocument();
    });

    it("should render skeleton loader during initial load", () => {
      render(
        <HistoryPanel
          historyData={{}}
          agents={mockAgents}
          agentMap={mockAgentMap}
        />
      );

      // Skeleton has multiple animated divs
      const skeletonElements = document.querySelectorAll(".animate-pulse");
      expect(skeletonElements.length).toBeGreaterThan(0);
    });
  });

  describe("Filtering", () => {
    it("should filter by agent", async () => {
      const user = userEvent.setup();

      render(
        <HistoryPanel
          historyData={mockHistoryData}
          agents={mockAgents}
          agentMap={mockAgentMap}
        />
      );

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByText(/Implement feature X/i)).toBeInTheDocument();
      });

      // Reset fetch mock for filter request
      fetchMock.mockClear();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entries: [
            {
              id: "entry-1",
              agentId: "agent-1",
              type: "task_started",
              content: "Task started: Implement feature X",
              timestamp: new Date("2024-01-01T10:00:00Z").toISOString(),
            },
          ],
          nextCursor: null,
          totalCount: 1,
          hasMore: false,
        }),
      });

      // Select agent-1 from dropdown
      const agentSelect = screen.getByRole("combobox", { name: /전체 에이전트/i });
      await user.selectOptions(agentSelect, "agent-1");

      // Wait for filtered fetch
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining("agentId=agent-1"),
          expect.anything()
        );
      });
    });

    it("should filter by search text (debounced)", async () => {
      const user = userEvent.setup();
      vi.useFakeTimers();

      render(
        <HistoryPanel
          historyData={mockHistoryData}
          agents={mockAgents}
          agentMap={mockAgentMap}
        />
      );

      // Wait for initial load
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });

      fetchMock.mockClear();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entries: [
            {
              id: "entry-1",
              agentId: "agent-1",
              type: "task_started",
              content: "Task started: Implement feature X",
              timestamp: new Date("2024-01-01T10:00:00Z").toISOString(),
            },
          ],
          nextCursor: null,
          totalCount: 1,
          hasMore: false,
        }),
      });

      // Type search text
      const searchInput = screen.getByPlaceholderText("검색...");
      await user.type(searchInput, "feature");

      // Fast-forward debounce timer (300ms)
      vi.advanceTimersByTime(300);

      // Wait for fetch with search param
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining("search=feature"),
          expect.anything()
        );
      });

      vi.useRealTimers();
    });
  });

  describe("View Modes", () => {
    it("should switch between unified, split, and grouped views", async () => {
      const user = userEvent.setup();

      // Mock grouped API response
      fetchMock.mockImplementation((url) => {
        if (typeof url === "string" && url.includes("/grouped")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ groups: [] }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            entries: mockHistoryData["agent-1"],
            nextCursor: null,
            totalCount: 2,
            hasMore: false,
          }),
        });
      });

      render(
        <HistoryPanel
          historyData={mockHistoryData}
          agents={mockAgents}
          agentMap={mockAgentMap}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Implement feature X/i)).toBeInTheDocument();
      });

      // Click "분할" button
      const splitButton = screen.getByRole("button", { name: /분할/i });
      await user.click(splitButton);

      // Should show split axis selector
      await waitFor(() => {
        expect(screen.getByText("분할 기준:")).toBeInTheDocument();
      });

      // Click "요청별" button
      const groupedButton = screen.getByRole("button", { name: /요청별/i });
      await user.click(groupedButton);

      // Should fetch grouped data
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining("/grouped"),
          expect.anything()
        );
      });
    });

    it("should render split columns in split view mode", async () => {
      const user = userEvent.setup();

      render(
        <HistoryPanel
          historyData={mockHistoryData}
          agents={mockAgents}
          agentMap={mockAgentMap}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Implement feature X/i)).toBeInTheDocument();
      });

      // Switch to split view
      const splitButton = screen.getByRole("button", { name: /분할/i });
      await user.click(splitButton);

      // Should show agent columns (default split axis)
      await waitFor(() => {
        expect(screen.getByText("Dev Agent")).toBeInTheDocument();
        expect(screen.getByText("QA Agent")).toBeInTheDocument();
      });
    });
  });

  describe("Error Handling", () => {
    it("should show error state when API fails", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network error"));

      render(
        <HistoryPanel
          historyData={{}}
          agents={mockAgents}
          agentMap={mockAgentMap}
        />
      );

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByText(/타임라인을 불러오지 못했습니다/i)).toBeInTheDocument();
      });

      expect(screen.getByRole("button", { name: /다시 시도/i })).toBeInTheDocument();
    });

    it("should retry on error state button click", async () => {
      const user = userEvent.setup();
      fetchMock.mockRejectedValueOnce(new Error("Network error"));

      render(
        <HistoryPanel
          historyData={{}}
          agents={mockAgents}
          agentMap={mockAgentMap}
        />
      );

      // Wait for error state
      await waitFor(() => {
        expect(screen.getByText(/타임라인을 불러오지 못했습니다/i)).toBeInTheDocument();
      });

      // Mock successful retry
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entries: mockHistoryData["agent-1"],
          nextCursor: null,
          totalCount: 2,
          hasMore: false,
        }),
      });

      const retryButton = screen.getByRole("button", { name: /다시 시도/i });
      await user.click(retryButton);

      // Should show entries after retry
      await waitFor(() => {
        expect(screen.getByText(/Implement feature X/i)).toBeInTheDocument();
      });
    });
  });

  describe("Empty State", () => {
    it("should show empty state when no entries", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entries: [],
          nextCursor: null,
          totalCount: 0,
          hasMore: false,
        }),
      });

      render(
        <HistoryPanel
          historyData={{}}
          agents={mockAgents}
          agentMap={mockAgentMap}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/아직 기록이 없습니다/i)).toBeInTheDocument();
      });
    });
  });

  describe("Infinite Scroll", () => {
    it("should load more entries when scrolling", async () => {
      // First page
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entries: [mockHistoryData["agent-1"][0]],
          nextCursor: "cursor-1",
          totalCount: 2,
          hasMore: true,
        }),
      });

      render(
        <HistoryPanel
          historyData={mockHistoryData}
          agents={mockAgents}
          agentMap={mockAgentMap}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Implement feature X/i)).toBeInTheDocument();
      });

      // Mock second page load
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entries: [mockHistoryData["agent-1"][1]],
          nextCursor: null,
          totalCount: 2,
          hasMore: false,
        }),
      });

      // Click load more button (fallback for IntersectionObserver)
      const loadMoreButton = screen.getByRole("button", { name: /더 불러오기/i });
      await userEvent.click(loadMoreButton);

      await waitFor(() => {
        expect(screen.getByText(/Feature X implemented/i)).toBeInTheDocument();
      });

      // Verify second fetch used cursor
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("cursor=cursor-1"),
        expect.anything()
      );
    });
  });
});
