"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import HistoryEntryCard from "@/components/HistoryEntryCard";
import { copyToClipboard } from "@/lib/clipboard";
import { HISTORY_TYPE_LABELS } from "@/lib/ui-constants";
import type {
  AgentRuntime,
  HistoryEntry,
  TimelineResponse,
} from "@/lib/frontend-types";
import type { GroupedHistoryEntry } from "@/lib/history";

// ===== Types =====

interface HistoryPanelProps {
  historyData: Record<string, HistoryEntry[]>;
  agents: AgentRuntime[];
  agentMap: Record<string, { emoji: string; name: string }>;
}

interface SwimlaneColumn {
  id: string;          // agentId, type name, or date bucket
  label: string;       // Display label
  emoji?: string;      // Optional emoji for the header
  entries: HistoryEntry[];
  lastActivity: number;
}

// ===== Skeleton Loader =====

function TimelineSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="border border-gray-700/50 rounded-lg p-3 bg-gray-800/30"
        >
          <div className="flex items-start gap-2">
            <div className="w-8 h-8 rounded-full bg-gray-700/50" />
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-4 w-20 bg-gray-700/50 rounded" />
                <div className="h-4 w-12 bg-gray-700/50 rounded" />
                <div className="h-3 w-16 bg-gray-700/30 rounded" />
              </div>
              <div className="space-y-1.5">
                <div className="h-3 w-full bg-gray-700/30 rounded" />
                <div className="h-3 w-3/4 bg-gray-700/30 rounded" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== Empty State =====

function EmptyState() {
  return (
    <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 text-center">
      <p className="text-gray-500">아직 기록이 없습니다</p>
      <p className="text-gray-600 text-sm mt-1">
        에이전트 활동이 발생하면 여기에 표시됩니다
      </p>
    </div>
  );
}

// ===== Error State =====

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-gray-800 rounded-xl p-8 border border-red-700/50 text-center">
      <p className="text-red-400">타임라인을 불러오지 못했습니다</p>
      <button
        onClick={onRetry}
        className="mt-3 px-4 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none"
      >
        다시 시도
      </button>
    </div>
  );
}

// ===== Main Component =====

export default function HistoryPanel({
  historyData,
  agents,
  agentMap,
}: HistoryPanelProps) {
  // ----- Filter state -----
  const [filterAgent, setFilterAgent] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [hideOutput, setHideOutput] = useState(true);
  const [viewMode, setViewMode] = useState<"unified" | "split" | "grouped">("unified");
  const [splitAxis, setSplitAxis] = useState<"agent" | "type" | "date">("agent");
  const [filterRequestGroupId, setFilterRequestGroupId] = useState<string | null>(null);
  const [filterRequestGroupTitle, setFilterRequestGroupTitle] = useState<string | null>(null);

  // ----- Timeline data state -----
  const [timelineEntries, setTimelineEntries] = useState<HistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState(false);

  // ----- Grouped data state -----
  const [groupedData, setGroupedData] = useState<GroupedHistoryEntry[]>([]);
  const [groupedLoading, setGroupedLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [ungroupedEntries, setUngroupedEntries] = useState<HistoryEntry[]>([]);
  const [groupStatusFilter, setGroupStatusFilter] = useState<"all" | "in_progress" | "completed" | "failed">("all");
  const [groupSearchText, setGroupSearchText] = useState("");

  // ----- UI state -----
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(
    new Set()
  );

  // ----- Refs -----
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ----- Helpers -----
  const getDisplay = (agentId: string) =>
    agentMap[agentId] || { emoji: "\u{1F916}", name: agentId };

  const toggleExpand = useCallback((id: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCopy = useCallback(async (entryId: string, content: string) => {
    const success = await copyToClipboard(content);
    if (success) {
      setCopiedId(entryId);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }, []);

  const handleReply = useCallback(
    async (
      entry: {
        id: string;
        agentId: string;
        type: string;
        content: string;
        timestamp: string;
        metadata?: Record<string, unknown>;
      },
      replyText: string
    ) => {
      try {
        await fetch("/api/relay/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "spawn",
            payload: {
              agentId: entry.agentId,
              task: `사용자 피드백에 대해 응답하세요.\n\n이전 당신의 메시지:\n${entry.content.slice(0, 500)}\n\n사용자 답신:\n${replyText}`,
            },
          }),
        });
        await fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: entry.agentId,
            type: "message_sent",
            content: `\u{1F4AC} 사용자 \u2192 ${agentMap[entry.agentId]?.name || entry.agentId}: ${replyText}`,
          }),
        });
        setReplyingTo(null);
      } catch (err) {
        console.error("Reply failed:", err);
      }
    },
    [agentMap]
  );

  // ----- Handler for filtering by request group from entry card -----
  const handleFilterByGroup = useCallback((requestGroupId: string, requestTitle: string) => {
    setFilterRequestGroupId(requestGroupId);
    setFilterRequestGroupTitle(requestTitle);
    setViewMode("unified");
  }, []);

  // ----- Toggle expand/collapse for grouped view -----
  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // ----- All available types (from prop data for dropdown) -----
  const allTypes = useMemo(() => {
    const types = new Set<string>();
    Object.values(historyData)
      .flat()
      .forEach((e) => types.add(e.type));
    // Also include types from fetched timeline entries
    timelineEntries.forEach((e) => types.add(e.type));
    return Array.from(types);
  }, [historyData, timelineEntries]);

  // ----- Fetch timeline data from API -----
  const fetchTimeline = useCallback(
    async (cursor?: string) => {
      // Cancel any in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      if (cursor) {
        setLoading(true);
      }

      try {
        const params = new URLSearchParams();

        if (filterAgent !== "all") {
          params.set("agentId", filterAgent);
        }
        if (filterType !== "all") {
          params.set("types", filterType);
        }
        if (debouncedSearch) {
          params.set("search", debouncedSearch);
        }
        if (dateFrom) {
          params.set("dateFrom", new Date(dateFrom).toISOString());
        }
        if (dateTo) {
          // Set dateTo to end of day
          const endOfDay = new Date(dateTo);
          endOfDay.setHours(23, 59, 59, 999);
          params.set("dateTo", endOfDay.toISOString());
        }
        if (hideOutput && !filterRequestGroupId) {
          // requestGroupId 필터 시에는 output도 표시 (전체 맥락 보기 위해)
          params.set("excludeTypes", "output");
        }
        if (filterRequestGroupId) {
          params.set("requestGroupId", filterRequestGroupId);
        }
        if (cursor) {
          params.set("cursor", cursor);
        }
        params.set("limit", "50");

        const res = await fetch(
          `/api/history/timeline?${params.toString()}`,
          { signal: controller.signal }
        );

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data: TimelineResponse = await res.json();

        if (cursor) {
          // Append to existing entries
          setTimelineEntries((prev) => [...prev, ...data.entries]);
        } else {
          // Replace entries (fresh fetch)
          setTimelineEntries(data.entries);
        }

        setNextCursor(data.nextCursor);
        setTotalCount(data.totalCount);
        setHasMore(data.hasMore);
        setError(false);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return; // Ignore aborted requests
        }
        console.error("Timeline fetch error:", err);
        if (!cursor) {
          // Only show error state on initial load failures
          setTimelineEntries([]);
        }
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [filterAgent, filterType, debouncedSearch, dateFrom, dateTo, hideOutput, filterRequestGroupId]
  );

  // ----- Initial load and filter change handling -----
  useEffect(() => {
    setInitialLoading(true);
    setTimelineEntries([]);
    setNextCursor(null);
    setError(false);
    fetchTimeline().finally(() => setInitialLoading(false));
  }, [fetchTimeline]);

  // ----- Fetch grouped data when in grouped view mode -----
  useEffect(() => {
    if (viewMode !== "grouped") return;

    setGroupedLoading(true);

    Promise.all([
      fetch("/api/history/grouped").then((res) => res.json()),
      fetch("/api/history/timeline?limit=30&excludeTypes=output").then((res) => res.json()),
    ])
      .then(([groupedResult, timelineResult]) => {
        const groups: GroupedHistoryEntry[] = groupedResult.groups || [];
        setGroupedData(groups);

        // Auto-expand the most recent group (only on first load when nothing is expanded)
        if (groups.length > 0) {
          setExpandedGroups((prev) => {
            if (prev.size === 0) {
              return new Set([groups[0].requestGroupId]);
            }
            return prev;
          });
        }

        // Find ungrouped entries (those without requestGroupId)
        const groupedIds = new Set(
          groups.flatMap((g) => g.entries.map((e) => e.id))
        );
        const ungrouped = ((timelineResult.entries || []) as HistoryEntry[]).filter(
          (e) => !e.requestGroupId && !groupedIds.has(e.id)
        );
        setUngroupedEntries(ungrouped);
      })
      .catch((err) => console.error("Grouped fetch error:", err))
      .finally(() => setGroupedLoading(false));
  }, [viewMode]);

  // ----- Debounced search -----
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(searchText);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchText]);

  // ----- IntersectionObserver for infinite scroll -----
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && nextCursor) {
          fetchTimeline(nextCursor);
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, nextCursor, fetchTimeline]);

  // ----- Load more handler (fallback button) -----
  const handleLoadMore = useCallback(() => {
    if (nextCursor && !loading) {
      fetchTimeline(nextCursor);
    }
  }, [nextCursor, loading, fetchTimeline]);

  // ----- Retry handler -----
  const handleRetry = useCallback(() => {
    setInitialLoading(true);
    setError(false);
    setTimelineEntries([]);
    setNextCursor(null);
    fetchTimeline().finally(() => setInitialLoading(false));
  }, [fetchTimeline]);

  // ----- Split view: group entries by agent -----
  const splitByAgent = useMemo((): SwimlaneColumn[] => {
    const groupMap = new Map<string, HistoryEntry[]>();

    for (const entry of timelineEntries) {
      if (!groupMap.has(entry.agentId)) {
        groupMap.set(entry.agentId, []);
      }
      groupMap.get(entry.agentId)!.push(entry);
    }

    const columns: SwimlaneColumn[] = [];
    for (const [agentId, entries] of groupMap) {
      const lastActivity = Math.max(
        ...entries.map((e) => new Date(e.timestamp).getTime())
      );
      const display = getDisplay(agentId);
      columns.push({
        id: agentId,
        label: display.name,
        emoji: display.emoji,
        entries,
        lastActivity
      });
    }

    // Sort by most recent activity (descending)
    columns.sort((a, b) => b.lastActivity - a.lastActivity);
    return columns;
  }, [timelineEntries]);

  // ----- Split view: group entries by type -----
  const splitByType = useMemo((): SwimlaneColumn[] => {
    const typeEmojis: Record<string, string> = {
      task_started: "🚀",
      task_completed: "✅",
      task_failed: "❌",
      output: "📄",
      status_change: "🔄",
      message_sent: "💬",
      message_received: "📥",
      command_received: "📡",
    };

    const groupMap = new Map<string, HistoryEntry[]>();

    for (const entry of timelineEntries) {
      if (!groupMap.has(entry.type)) {
        groupMap.set(entry.type, []);
      }
      groupMap.get(entry.type)!.push(entry);
    }

    const columns: SwimlaneColumn[] = [];
    for (const [type, entries] of groupMap) {
      const lastActivity = Math.max(
        ...entries.map((e) => new Date(e.timestamp).getTime())
      );
      const typeLabel = HISTORY_TYPE_LABELS[type as keyof typeof HISTORY_TYPE_LABELS]?.label || type;
      columns.push({
        id: type,
        label: typeLabel,
        emoji: typeEmojis[type],
        entries,
        lastActivity
      });
    }

    // Sort by most recent activity (descending)
    columns.sort((a, b) => b.lastActivity - a.lastActivity);
    return columns;
  }, [timelineEntries]);

  // ----- Split view: group entries by date -----
  const splitByDate = useMemo((): SwimlaneColumn[] => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const thisWeek = new Date(today);
    thisWeek.setDate(thisWeek.getDate() - 7);
    const thisMonth = new Date(today);
    thisMonth.setDate(thisMonth.getDate() - 30);

    const buckets = {
      today: [] as HistoryEntry[],
      yesterday: [] as HistoryEntry[],
      thisWeek: [] as HistoryEntry[],
      thisMonth: [] as HistoryEntry[],
      older: [] as HistoryEntry[],
    };

    for (const entry of timelineEntries) {
      const entryDate = new Date(entry.timestamp);
      if (entryDate >= today) {
        buckets.today.push(entry);
      } else if (entryDate >= yesterday) {
        buckets.yesterday.push(entry);
      } else if (entryDate >= thisWeek) {
        buckets.thisWeek.push(entry);
      } else if (entryDate >= thisMonth) {
        buckets.thisMonth.push(entry);
      } else {
        buckets.older.push(entry);
      }
    }

    const columns: SwimlaneColumn[] = [];
    const bucketMeta = [
      { key: "today", label: "오늘", emoji: "📅" },
      { key: "yesterday", label: "어제", emoji: "📆" },
      { key: "thisWeek", label: "이번 주", emoji: "📊" },
      { key: "thisMonth", label: "이번 달", emoji: "🗓️" },
      { key: "older", label: "그 이전", emoji: "📜" },
    ];

    for (const { key, label, emoji } of bucketMeta) {
      const entries = buckets[key as keyof typeof buckets];
      if (entries.length > 0) {
        const lastActivity = Math.max(
          ...entries.map((e) => new Date(e.timestamp).getTime())
        );
        columns.push({ id: key, label, emoji, entries, lastActivity });
      }
    }

    // Date buckets are already in chronological order (most recent first)
    return columns;
  }, [timelineEntries]);

  // ----- Active split columns based on splitAxis -----
  const activeSplitColumns = useMemo(() => {
    switch (splitAxis) {
      case "agent": return splitByAgent;
      case "type": return splitByType;
      case "date": return splitByDate;
      default: return splitByAgent;
    }
  }, [splitAxis, splitByAgent, splitByType, splitByDate]);

  // ----- Filtered grouped data (for grouped view filters) -----
  const filteredGroupedData = useMemo(() => {
    let filtered = groupedData;

    // Filter by status
    if (groupStatusFilter === "completed") {
      filtered = filtered.filter((g) => g.completedCount > 0 && g.inProgressCount === 0 && g.failedCount === 0);
    } else if (groupStatusFilter === "in_progress") {
      filtered = filtered.filter((g) => g.inProgressCount > 0);
    } else if (groupStatusFilter === "failed") {
      filtered = filtered.filter((g) => g.failedCount > 0);
    }

    // Filter by agent
    if (filterAgent !== "all") {
      filtered = filtered.filter((g) =>
        g.entries.some((e) => e.agentId === filterAgent)
      );
    }

    // Filter by group search text
    if (groupSearchText.trim()) {
      const lower = groupSearchText.toLowerCase();
      filtered = filtered.filter(
        (g) =>
          g.requestTitle?.toLowerCase().includes(lower) ||
          g.entries.some((e) => e.content.toLowerCase().includes(lower))
      );
    }

    return filtered;
  }, [groupedData, groupStatusFilter, filterAgent, groupSearchText]);

  // ----- Unique agents in grouped data (for group header avatars) -----
  const getGroupAgents = useCallback(
    (entries: HistoryEntry[]): Array<{ id: string; emoji: string; name: string }> => {
      const seen = new Set<string>();
      const result: Array<{ id: string; emoji: string; name: string }> = [];
      for (const entry of entries) {
        if (!seen.has(entry.agentId)) {
          seen.add(entry.agentId);
          const display = agentMap[entry.agentId] || { emoji: "\u{1F916}", name: entry.agentId };
          result.push({ id: entry.agentId, ...display });
        }
      }
      return result;
    },
    [agentMap]
  );

  // ----- Group status derivation -----
  const getGroupStatus = useCallback(
    (group: GroupedHistoryEntry): "completed" | "in_progress" | "failed" | "mixed" => {
      if (group.failedCount > 0 && group.inProgressCount === 0) return "failed";
      if (group.inProgressCount > 0) return "in_progress";
      if (group.completedCount > 0 && group.failedCount === 0 && group.inProgressCount === 0) return "completed";
      return "mixed";
    },
    []
  );

  // ----- Detect consecutive same-agent runs for connector lines -----
  const shouldShowConnector = useCallback(
    (index: number): boolean => {
      if (index === 0) return false;
      return (
        timelineEntries[index].agentId ===
        timelineEntries[index - 1].agentId
      );
    },
    [timelineEntries]
  );

  return (
    <div className="space-y-4">
      {/* ===== Enhanced Filter Bar ===== */}
      <div className="bg-gray-800/50 rounded-xl p-2.5 sm:p-4 border border-gray-700/50 space-y-2 sm:space-y-3">
        {/* Row 1: Agent, Type, Search */}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          {/* Filters row */}
          <div className="flex gap-1.5 sm:gap-2">
            {/* Agent filter */}
            <select
              value={filterAgent}
              onChange={(e) => setFilterAgent(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-[11px] sm:text-sm text-white focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500 min-h-[38px] sm:min-h-0 flex-1 sm:flex-none max-w-[45%] sm:max-w-none"
            >
              <option value="all">전체 에이전트</option>
              {agents.map((a) => (
                <option key={a.config.id} value={a.config.id}>
                  {a.config.emoji} {a.config.name}
                </option>
              ))}
            </select>

            {/* Type filter */}
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-[11px] sm:text-sm text-white focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500 min-h-[38px] sm:min-h-0 flex-1 sm:flex-none max-w-[45%] sm:max-w-none"
            >
              <option value="all">전체 타입</option>
              {allTypes.map((t) => (
                <option key={t} value={t}>
                  {HISTORY_TYPE_LABELS[t as keyof typeof HISTORY_TYPE_LABELS]
                    ?.label || t}
                </option>
              ))}
            </select>
          </div>

          {/* Search input */}
          <div className="relative flex-1 min-w-0 sm:min-w-[180px]">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="검색..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 pl-8 text-xs sm:text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500 min-h-[38px] sm:min-h-0"
            />
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            {searchText && (
              <button
                onClick={() => setSearchText("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Date range, output toggle, view mode, count */}
        <div className="space-y-2 sm:space-y-0">
          {/* Date range */}
          <div className="flex flex-wrap gap-1.5 sm:gap-2 items-center">
            {/* Date from */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] sm:text-xs text-gray-500">시작</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-1.5 sm:px-2 py-1.5 text-[11px] sm:text-xs text-white focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500 [color-scheme:dark] min-h-[34px] sm:min-h-0"
              />
            </div>

            {/* Date to */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] sm:text-xs text-gray-500">종료</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-1.5 sm:px-2 py-1.5 text-[11px] sm:text-xs text-white focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500 [color-scheme:dark] min-h-[34px] sm:min-h-0"
              />
            </div>

            {dateFrom || dateTo ? (
              <button
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                }}
                className="text-[10px] sm:text-xs text-gray-500 hover:text-gray-300 px-1.5 py-1.5 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none min-h-[34px] sm:min-h-0"
                title="날짜 필터 초기화"
              >
                초기화
              </button>
            ) : null}

            {/* Spacer - hidden on mobile */}
            <div className="hidden sm:block flex-1" />

            {/* Count display */}
            <span className="text-[10px] sm:text-xs text-gray-500 ml-auto sm:ml-0">
              {timelineEntries.length}
              {totalCount > 0 && ` / ${totalCount}`}건
            </span>
          </div>

          {/* Controls row - output toggle + view mode */}
          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1 -mb-1">
            {/* Output toggle pill */}
            <button
              onClick={() => setHideOutput((prev) => !prev)}
              className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-full text-[10px] sm:text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none whitespace-nowrap min-h-[32px] sm:min-h-0 ${
                hideOutput
                  ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                  : "bg-gray-700/50 text-gray-400 border border-gray-600/50"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full transition-colors ${
                  hideOutput ? "bg-purple-400" : "bg-gray-500"
                }`}
              />
              output 숨기기
            </button>

            <div className="flex-1" />

            {/* View mode toggle pills */}
            <div className="inline-flex rounded-lg bg-gray-900/50 p-0.5 border border-gray-700/50 shrink-0">
              <button
                onClick={() => setViewMode("unified")}
                className={`px-2 sm:px-3 py-1.5 rounded-md text-[10px] sm:text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none min-h-[32px] sm:min-h-0 ${
                  viewMode === "unified"
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                통합
              </button>
              <button
                onClick={() => setViewMode("split")}
                className={`px-2 sm:px-3 py-1.5 rounded-md text-[10px] sm:text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none min-h-[32px] sm:min-h-0 ${
                  viewMode === "split"
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                분할
              </button>
              <button
                onClick={() => {
                  setViewMode("grouped");
                  // 요청별 뷰로 전환 시 그룹 필터 해제
                  setFilterRequestGroupId(null);
                  setFilterRequestGroupTitle(null);
                }}
                className={`px-2 sm:px-3 py-1.5 rounded-md text-[10px] sm:text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none min-h-[32px] sm:min-h-0 ${
                  viewMode === "grouped"
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                요청별
              </button>
            </div>
          </div>
        </div>

        {/* Active requestGroupId filter banner */}
        {filterRequestGroupId && (
          <div className="flex items-center gap-2 px-1">
            <span className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30 max-w-full">
              <span>📋</span>
              <span className="truncate max-w-[200px] sm:max-w-[300px]">
                {filterRequestGroupTitle || filterRequestGroupId.slice(0, 8)}
              </span>
              <button
                onClick={() => {
                  setFilterRequestGroupId(null);
                  setFilterRequestGroupTitle(null);
                }}
                className="ml-1 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                title="요청 그룹 필터 해제"
              >
                ✕
              </button>
            </span>
          </div>
        )}
      </div>

      {/* ===== Split Axis Selector (for split view mode only) ===== */}
      {viewMode === "split" && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs text-gray-500">분할 기준:</span>
          <div className="inline-flex rounded-lg bg-gray-900/50 p-0.5 border border-gray-700/50">
            <button
              onClick={() => setSplitAxis("agent")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                splitAxis === "agent"
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              에이전트
            </button>
            <button
              onClick={() => setSplitAxis("type")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                splitAxis === "type"
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              타입
            </button>
            <button
              onClick={() => setSplitAxis("date")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                splitAxis === "date"
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              날짜
            </button>
          </div>
        </div>
      )}

      {/* ===== Content Area ===== */}
      {initialLoading ? (
        <TimelineSkeleton />
      ) : error && timelineEntries.length === 0 ? (
        <ErrorState onRetry={handleRetry} />
      ) : timelineEntries.length === 0 && viewMode !== "grouped" ? (
        <EmptyState />
      ) : viewMode === "unified" ? (
        /* ----- Unified Timeline ----- */
        <div className="max-h-[700px] overflow-y-auto space-y-0">
          {timelineEntries.map((entry, index) => (
            <div key={entry.id}>
              {/* Connector line for consecutive same-agent entries */}
              {shouldShowConnector(index) && (
                <div className="flex items-center pl-[18px] py-0">
                  <div className="w-0.5 h-3 bg-gray-700/60 rounded-full" />
                </div>
              )}
              <div className={index > 0 && !shouldShowConnector(index) ? "mt-2" : ""}>
                <HistoryEntryCard
                  entry={entry}
                  agentDisplay={getDisplay(entry.agentId)}
                  isExpanded={expandedEntries.has(entry.id)}
                  isReplying={replyingTo === entry.id}
                  isCopied={copiedId === entry.id}
                  onToggleExpand={toggleExpand}
                  onToggleReply={(id) =>
                    setReplyingTo(replyingTo === id ? null : id)
                  }
                  onCopy={handleCopy}
                  onReply={handleReply}
                  onFilterByGroup={handleFilterByGroup}
                />
              </div>
            </div>
          ))}

          {/* Infinite scroll sentinel */}
          <div ref={loadMoreRef} className="h-1" />

          {/* Loading indicator */}
          {loading && (
            <div className="flex justify-center py-4">
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <svg
                  className="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                불러오는 중...
              </div>
            </div>
          )}

          {/* Load more fallback button */}
          {hasMore && !loading && (
            <div className="flex justify-center py-3">
              <button
                onClick={handleLoadMore}
                className="px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
              >
                더 불러오기
              </button>
            </div>
          )}
        </div>
      ) : viewMode === "grouped" ? (
        /* ----- Request Group Timeline (Enhanced Accordion) ----- */
        <div className="space-y-3">
          {/* Grouped view filter bar */}
          <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
            {/* Status filter pills */}
            <div className="inline-flex rounded-lg bg-gray-900/50 p-0.5 border border-gray-700/50">
              {([
                { key: "all" as const, label: "전체", emoji: "" },
                { key: "in_progress" as const, label: "진행중", emoji: "🔄" },
                { key: "completed" as const, label: "완료", emoji: "✅" },
                { key: "failed" as const, label: "실패", emoji: "❌" },
              ] as const).map(({ key, label, emoji }) => (
                <button
                  key={key}
                  onClick={() => setGroupStatusFilter(key)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none whitespace-nowrap ${
                    groupStatusFilter === key
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {emoji && <span className="mr-1">{emoji}</span>}{label}
                </button>
              ))}
            </div>

            {/* Group search */}
            <div className="relative flex-1 min-w-0 sm:min-w-[180px]">
              <input
                type="text"
                value={groupSearchText}
                onChange={(e) => setGroupSearchText(e.target.value)}
                placeholder="요청 그룹 검색..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 pl-8 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500"
              />
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {groupSearchText && (
                <button
                  onClick={() => setGroupSearchText("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Group count */}
            <span className="text-xs text-gray-500 ml-auto shrink-0">
              {filteredGroupedData.length}개 그룹
              {ungroupedEntries.length > 0 && ` + ${ungroupedEntries.length}건 개별`}
            </span>

            {/* Expand/Collapse all */}
            <div className="flex gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setExpandedGroups(new Set(filteredGroupedData.map((g) => g.requestGroupId)))}
                className="px-2 py-1 rounded text-[10px] text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                title="모두 펼치기"
              >
                모두 펼치기
              </button>
              <button
                type="button"
                onClick={() => setExpandedGroups(new Set())}
                className="px-2 py-1 rounded text-[10px] text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                title="모두 접기"
              >
                모두 접기
              </button>
            </div>
          </div>

          {/* Grouped content */}
          <div className="max-h-[700px] overflow-y-auto space-y-2">
            {groupedLoading ? (
              <TimelineSkeleton />
            ) : filteredGroupedData.length === 0 && ungroupedEntries.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-gray-600 text-3xl mb-3">📋</div>
                <p className="text-gray-500 text-sm">
                  {groupStatusFilter !== "all" || groupSearchText
                    ? "필터 조건에 맞는 요청 그룹이 없습니다"
                    : "요청 그룹이 없습니다"}
                </p>
                {(groupStatusFilter !== "all" || groupSearchText) && (
                  <button
                    onClick={() => {
                      setGroupStatusFilter("all");
                      setGroupSearchText("");
                    }}
                    className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    필터 초기화
                  </button>
                )}
              </div>
            ) : (
              <>
                {filteredGroupedData.map((group) => {
                  const isGroupExpanded = expandedGroups.has(group.requestGroupId);
                  const status = getGroupStatus(group);
                  const groupAgents = getGroupAgents(group.entries);
                  const total = group.completedCount + group.failedCount + group.inProgressCount;
                  const completedPct = total > 0 ? (group.completedCount / total) * 100 : 0;
                  const failedPct = total > 0 ? (group.failedCount / total) * 100 : 0;
                  const inProgressPct = total > 0 ? (group.inProgressCount / total) * 100 : 0;

                  // Status badge config
                  const statusConfig = {
                    completed: { label: "완료", bg: "bg-green-500/15", text: "text-green-400", border: "border-green-500/30", dot: "bg-green-400" },
                    in_progress: { label: "진행중", bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30", dot: "bg-blue-400 animate-pulse" },
                    failed: { label: "실패", bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/30", dot: "bg-red-400" },
                    mixed: { label: "혼합", bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/30", dot: "bg-amber-400" },
                  }[status];

                  // Border accent by status
                  const borderAccent = {
                    completed: "border-l-green-500/40",
                    in_progress: "border-l-blue-500/40",
                    failed: "border-l-red-500/40",
                    mixed: "border-l-amber-500/40",
                  }[status];

                  return (
                    <div
                      key={group.requestGroupId}
                      className={`rounded-xl border border-gray-700/40 overflow-hidden transition-all duration-200 border-l-[3px] ${borderAccent} ${
                        isGroupExpanded ? "bg-gray-800/40" : "bg-gray-800/20 hover:bg-gray-800/30"
                      }`}
                    >
                      {/* ===== Enhanced Group Header Card ===== */}
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.requestGroupId)}
                        className="w-full text-left px-4 py-3.5 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none group"
                      >
                        <div className="flex items-start gap-3">
                          {/* Chevron */}
                          <div className="pt-0.5 shrink-0">
                            <svg
                              className={`w-4 h-4 text-gray-500 group-hover:text-gray-300 transition-all duration-200 ${isGroupExpanded ? "rotate-90" : ""}`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </div>

                          {/* Main content */}
                          <div className="flex-1 min-w-0">
                            {/* Title row */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-sm font-semibold text-gray-100 truncate max-w-[70%]">
                                {group.requestTitle || "제목 없음"}
                              </h3>

                              {/* Status badge */}
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />
                                {statusConfig.label}
                              </span>
                            </div>

                            {/* Meta row: agents + time + counts */}
                            <div className="flex items-center gap-3 mt-2 flex-wrap">
                              {/* Agent avatars */}
                              <div className="flex items-center">
                                <div className="flex -space-x-1">
                                  {groupAgents.slice(0, 4).map((agent) => (
                                    <span
                                      key={agent.id}
                                      className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-700/80 border-2 border-gray-800/80 text-xs"
                                      title={agent.name}
                                    >
                                      {agent.emoji}
                                    </span>
                                  ))}
                                  {groupAgents.length > 4 && (
                                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-600/80 border-2 border-gray-800/80 text-[10px] text-gray-300 font-medium">
                                      +{groupAgents.length - 4}
                                    </span>
                                  )}
                                </div>
                                {groupAgents.length <= 2 && (
                                  <span className="ml-1.5 text-[11px] text-gray-500">
                                    {groupAgents.map((a) => a.name).join(", ")}
                                  </span>
                                )}
                              </div>

                              {/* Separator */}
                              <span className="text-gray-700">·</span>

                              {/* Time */}
                              <span className="text-[11px] text-gray-500 shrink-0">
                                {new Date(group.startedAt).toLocaleString("ko-KR", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>

                              {/* Separator */}
                              <span className="text-gray-700">·</span>

                              {/* Stat counters */}
                              <div className="flex items-center gap-1.5 text-[11px]">
                                {group.completedCount > 0 && (
                                  <span className="inline-flex items-center gap-0.5 text-green-400/80">
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-400/60" />
                                    {group.completedCount}
                                  </span>
                                )}
                                {group.inProgressCount > 0 && (
                                  <span className="inline-flex items-center gap-0.5 text-blue-400/80">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400/60 animate-pulse" />
                                    {group.inProgressCount}
                                  </span>
                                )}
                                {group.failedCount > 0 && (
                                  <span className="inline-flex items-center gap-0.5 text-red-400/80">
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-400/60" />
                                    {group.failedCount}
                                  </span>
                                )}
                                <span className="text-gray-600">{group.totalCount}건</span>
                              </div>
                            </div>

                            {/* Progress bar */}
                            {total > 0 && (
                              <div className="mt-2.5 w-full bg-gray-700/30 rounded-full h-1 overflow-hidden">
                                <div className="h-full flex">
                                  {completedPct > 0 && (
                                    <div
                                      className="bg-green-500/70 h-full transition-all duration-500 ease-out"
                                      style={{ width: `${completedPct}%` }}
                                    />
                                  )}
                                  {inProgressPct > 0 && (
                                    <div
                                      className="bg-blue-500/70 h-full transition-all duration-500 ease-out"
                                      style={{ width: `${inProgressPct}%` }}
                                    />
                                  )}
                                  {failedPct > 0 && (
                                    <div
                                      className="bg-red-500/70 h-full transition-all duration-500 ease-out"
                                      style={{ width: `${failedPct}%` }}
                                    />
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Detail link */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFilterRequestGroupId(group.requestGroupId);
                              setFilterRequestGroupTitle(group.requestTitle || "제목 없음");
                              setViewMode("unified");
                            }}
                            className="shrink-0 px-2.5 py-1.5 text-[11px] text-blue-400/70 hover:text-blue-300 hover:bg-blue-500/10 rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none opacity-0 group-hover:opacity-100"
                            title="통합 뷰에서 이 그룹만 보기"
                          >
                            상세 &rarr;
                          </button>
                        </div>
                      </button>

                      {/* ===== Expanded Group Entries with Timeline Connector ===== */}
                      {isGroupExpanded && (
                        <div className="border-t border-gray-700/30">
                          {/* Entries with visual timeline */}
                          <div className="relative pl-6 pr-3 py-2">
                            {/* Vertical timeline line */}
                            <div
                              className="absolute left-[27px] top-2 bottom-2 w-px bg-gradient-to-b from-gray-600/40 via-gray-600/20 to-transparent"
                              aria-hidden="true"
                            />

                            <div className="space-y-0">
                              {group.entries.map((entry, entryIndex) => {
                                const isLast = entryIndex === group.entries.length - 1;
                                const entryTypeConfig: Record<string, { dot: string; ring: string }> = {
                                  task_started: { dot: "bg-blue-400", ring: "ring-blue-400/20" },
                                  task_completed: { dot: "bg-green-400", ring: "ring-green-400/20" },
                                  task_failed: { dot: "bg-red-400", ring: "ring-red-400/20" },
                                  output: { dot: "bg-purple-400/60", ring: "ring-purple-400/10" },
                                  status_change: { dot: "bg-yellow-400/60", ring: "ring-yellow-400/10" },
                                  message_sent: { dot: "bg-indigo-400/60", ring: "ring-indigo-400/10" },
                                  command_received: { dot: "bg-orange-400/60", ring: "ring-orange-400/10" },
                                };
                                const dotConfig = entryTypeConfig[entry.type] || { dot: "bg-gray-500", ring: "ring-gray-500/10" };

                                return (
                                  <div key={entry.id} className="relative">
                                    {/* Timeline dot */}
                                    <div
                                      className={`absolute -left-[13px] top-[18px] w-2.5 h-2.5 rounded-full ${dotConfig.dot} ring-[3px] ${dotConfig.ring} z-10`}
                                      aria-hidden="true"
                                    />

                                    {/* Entry card with left margin for timeline */}
                                    <div className={`ml-3 ${!isLast ? "pb-1" : ""}`}>
                                      <HistoryEntryCard
                                        entry={entry}
                                        agentDisplay={getDisplay(entry.agentId)}
                                        isExpanded={expandedEntries.has(entry.id)}
                                        isReplying={replyingTo === entry.id}
                                        isCopied={copiedId === entry.id}
                                        onToggleExpand={toggleExpand}
                                        onToggleReply={(id) => setReplyingTo(replyingTo === id ? null : id)}
                                        onCopy={handleCopy}
                                        onReply={handleReply}
                                        onFilterByGroup={handleFilterByGroup}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* ===== Ungrouped Entries Section ===== */}
                {ungroupedEntries.length > 0 && (
                  <div className={`rounded-xl border border-gray-700/30 overflow-hidden border-l-[3px] border-l-gray-600/30 ${
                    expandedGroups.has("__ungrouped__") ? "bg-gray-800/30" : "bg-gray-800/15 hover:bg-gray-800/25"
                  } transition-all duration-200`}>
                    <button
                      type="button"
                      onClick={() => toggleGroup("__ungrouped__")}
                      className="w-full text-left px-4 py-3 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none group"
                    >
                      <div className="flex items-center gap-3">
                        {/* Chevron */}
                        <svg
                          className={`w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-all duration-200 shrink-0 ${expandedGroups.has("__ungrouped__") ? "rotate-90" : ""}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>

                        {/* Icon */}
                        <div className="w-7 h-7 rounded-lg bg-gray-700/40 flex items-center justify-center shrink-0">
                          <svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                          </svg>
                        </div>

                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-gray-400">개별 작업</h3>
                          <p className="text-[11px] text-gray-600 mt-0.5">요청 그룹에 속하지 않은 항목</p>
                        </div>

                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-700/40 text-gray-500 border border-gray-600/30">
                          {ungroupedEntries.length}건
                        </span>
                      </div>
                    </button>

                    {expandedGroups.has("__ungrouped__") && (
                      <div className="border-t border-gray-700/20 p-2 space-y-1">
                        {ungroupedEntries.map((entry) => (
                          <HistoryEntryCard
                            key={entry.id}
                            entry={entry}
                            agentDisplay={getDisplay(entry.agentId)}
                            isExpanded={expandedEntries.has(entry.id)}
                            isReplying={replyingTo === entry.id}
                            isCopied={copiedId === entry.id}
                            onToggleExpand={toggleExpand}
                            onToggleReply={(id) => setReplyingTo(replyingTo === id ? null : id)}
                            onCopy={handleCopy}
                            onReply={handleReply}
                            onFilterByGroup={handleFilterByGroup}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        /* ----- Split/Swimlane Timeline ----- */
        <div className="overflow-x-auto pb-2">
          <div
            className="flex gap-4"
            style={{ minWidth: `${Math.max(activeSplitColumns.length * 320, 320)}px` }}
          >
            {activeSplitColumns.map((column) => {
              return (
                <div
                  key={column.id}
                  className="flex-shrink-0 w-[300px] bg-gray-800/30 rounded-xl border border-gray-700/50 overflow-hidden"
                >
                  {/* Column header */}
                  <div className="sticky top-0 z-10 bg-gray-800/80 backdrop-blur-sm px-3 py-2.5 border-b border-gray-700/50 flex items-center gap-2">
                    {column.emoji && <span className="text-lg">{column.emoji}</span>}
                    <span className="text-sm font-medium text-gray-200 truncate">
                      {column.label}
                    </span>
                    <span className="ml-auto text-xs text-gray-500">
                      {column.entries.length}건
                    </span>
                  </div>

                  {/* Column entries */}
                  <div className="max-h-[600px] overflow-y-auto p-2 space-y-2">
                    {column.entries.map((entry) => (
                      <HistoryEntryCard
                        key={entry.id}
                        entry={entry}
                        agentDisplay={getDisplay(entry.agentId)}
                        isExpanded={expandedEntries.has(entry.id)}
                        isReplying={replyingTo === entry.id}
                        isCopied={copiedId === entry.id}
                        onToggleExpand={toggleExpand}
                        onToggleReply={(id) =>
                          setReplyingTo(replyingTo === id ? null : id)
                        }
                        onCopy={handleCopy}
                        onReply={handleReply}
                        onFilterByGroup={handleFilterByGroup}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {activeSplitColumns.length === 0 && (
              <div className="w-full text-center py-8 text-gray-500 text-sm">
                표시할 데이터가 없습니다
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
