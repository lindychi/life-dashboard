// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePendingReplies } from "@/hooks/useDashboardData";
import type { HistoryEntry } from "@/lib/frontend-types";

// Helper to create a history entry
function makeEntry(
  overrides: Partial<HistoryEntry> & { agentId: string }
): HistoryEntry {
  const { agentId, type, content, timestamp, ...rest } = overrides;
  return {
    id: Math.random().toString(36).slice(2),
    agentId,
    type: type ?? "output",
    content: content ?? "default content",
    timestamp: timestamp ?? new Date().toISOString(),
    ...rest,
  };
}

// A content string that looksLikeQuestion returns true for
const QUESTION_CONTENT =
  "Could you please review this implementation and let me know if it looks correct?";

// A content string that looksLikeQuestion returns false for (completion pattern)
const COMPLETION_CONTENT = "Task completed successfully without any issues.";

const AGENT_MAP = {
  "agent-1": { emoji: "🛠️", name: "Dev Agent" },
  "agent-2": { emoji: "🧪", name: "QA Agent" },
};

describe("usePendingReplies", () => {
  describe("basic filtering", () => {
    it("returns empty array when historyData is empty", () => {
      const { result } = renderHook(() => usePendingReplies({}, AGENT_MAP));
      expect(result.current).toEqual([]);
    });

    it("returns empty array when no entries look like questions", () => {
      const historyData: Record<string, HistoryEntry[]> = {
        "agent-1": [
          makeEntry({
            agentId: "agent-1",
            type: "output",
            content: COMPLETION_CONTENT,
          }),
        ],
      };
      const { result } = renderHook(() =>
        usePendingReplies(historyData, AGENT_MAP)
      );
      expect(result.current).toEqual([]);
    });

    it("returns pending entry when agent asked a question with no reply", () => {
      const entry = makeEntry({
        agentId: "agent-1",
        type: "output",
        content: QUESTION_CONTENT,
      });
      const historyData: Record<string, HistoryEntry[]> = {
        "agent-1": [entry],
      };
      const { result } = renderHook(() =>
        usePendingReplies(historyData, AGENT_MAP)
      );
      expect(result.current).toHaveLength(1);
      expect(result.current[0]).toEqual(entry);
    });

    it("excludes entry when agent already received a reply (message_sent)", () => {
      const t1 = new Date("2024-01-01T10:00:00Z").toISOString();
      const t2 = new Date("2024-01-01T10:05:00Z").toISOString();
      const historyData: Record<string, HistoryEntry[]> = {
        "agent-1": [
          makeEntry({
            agentId: "agent-1",
            type: "output",
            content: QUESTION_CONTENT,
            timestamp: t1,
          }),
          makeEntry({
            agentId: "agent-1",
            type: "message_sent",
            content: "Reply sent",
            timestamp: t2,
          }),
        ],
      };
      const { result } = renderHook(() =>
        usePendingReplies(historyData, AGENT_MAP)
      );
      expect(result.current).toHaveLength(0);
    });
  });

  describe("agentMap filtering", () => {
    it("excludes entries from agents not in agentMap", () => {
      const historyData: Record<string, HistoryEntry[]> = {
        "unknown-agent": [
          makeEntry({
            agentId: "unknown-agent",
            type: "output",
            content: QUESTION_CONTENT,
          }),
        ],
      };
      const { result } = renderHook(() =>
        usePendingReplies(historyData, AGENT_MAP)
      );
      expect(result.current).toHaveLength(0);
    });

    it("includes entries from known agents when agentMap is provided", () => {
      const historyData: Record<string, HistoryEntry[]> = {
        "agent-1": [
          makeEntry({
            agentId: "agent-1",
            type: "output",
            content: QUESTION_CONTENT,
          }),
        ],
      };
      const { result } = renderHook(() =>
        usePendingReplies(historyData, AGENT_MAP)
      );
      expect(result.current).toHaveLength(1);
    });

    it("includes all agents when agentMap is not provided", () => {
      const historyData: Record<string, HistoryEntry[]> = {
        "unknown-agent": [
          makeEntry({
            agentId: "unknown-agent",
            type: "output",
            content: QUESTION_CONTENT,
          }),
        ],
      };
      const { result } = renderHook(() => usePendingReplies(historyData));
      expect(result.current).toHaveLength(1);
    });
  });

  describe("agentId validation", () => {
    it("skips entries without agentId", () => {
      const historyData: Record<string, HistoryEntry[]> = {
        "agent-1": [
          makeEntry({
            agentId: "" as string,
            type: "output",
            content: QUESTION_CONTENT,
          }),
        ],
      };
      const { result } = renderHook(() =>
        usePendingReplies(historyData, AGENT_MAP)
      );
      expect(result.current).toHaveLength(0);
    });
  });

  describe("multi-agent scenarios", () => {
    it("tracks pending replies independently per agent", () => {
      const t1 = new Date("2024-01-01T10:00:00Z").toISOString();
      const t2 = new Date("2024-01-01T10:01:00Z").toISOString();
      const t3 = new Date("2024-01-01T10:02:00Z").toISOString();

      const entry1 = makeEntry({
        agentId: "agent-1",
        type: "output",
        content: QUESTION_CONTENT,
        timestamp: t1,
      });
      const entry2 = makeEntry({
        agentId: "agent-2",
        type: "output",
        content: QUESTION_CONTENT,
        timestamp: t2,
      });
      const reply1 = makeEntry({
        agentId: "agent-1",
        type: "message_sent",
        content: "Reply to agent-1",
        timestamp: t3,
      });

      const historyData: Record<string, HistoryEntry[]> = {
        "agent-1": [entry1, reply1],
        "agent-2": [entry2],
      };

      const { result } = renderHook(() =>
        usePendingReplies(historyData, AGENT_MAP)
      );

      // Only agent-2 is still pending
      expect(result.current).toHaveLength(1);
      expect(result.current[0].agentId).toBe("agent-2");
    });

    it("returns latest question entry when agent asked multiple questions", () => {
      const t1 = new Date("2024-01-01T10:00:00Z").toISOString();
      const t2 = new Date("2024-01-01T10:05:00Z").toISOString();

      const firstQuestion = makeEntry({
        agentId: "agent-1",
        type: "output",
        content: QUESTION_CONTENT,
        timestamp: t1,
      });
      const secondQuestion = makeEntry({
        agentId: "agent-1",
        type: "output",
        content: "Could you please confirm and let me know when it is done?",
        timestamp: t2,
      });

      const historyData: Record<string, HistoryEntry[]> = {
        "agent-1": [firstQuestion, secondQuestion],
      };

      const { result } = renderHook(() =>
        usePendingReplies(historyData, AGENT_MAP)
      );

      expect(result.current).toHaveLength(1);
      // Should be the latest (second) question
      expect(result.current[0].id).toBe(secondQuestion.id);
    });
  });

  describe("task_completed type support", () => {
    it("detects questions from task_completed entries", () => {
      const entry = makeEntry({
        agentId: "agent-1",
        type: "task_completed",
        content: QUESTION_CONTENT,
      });
      const historyData: Record<string, HistoryEntry[]> = {
        "agent-1": [entry],
      };
      const { result } = renderHook(() =>
        usePendingReplies(historyData, AGENT_MAP)
      );
      expect(result.current).toHaveLength(1);
    });
  });
});
