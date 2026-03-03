"use client";

import { useState, useEffect, useCallback } from "react";
import { useToastContext } from "@/contexts/ToastContext";
import { useSuggestionSSE } from "@/hooks/useSuggestionSSE";

// ===== Types =====

interface Suggestion {
  id: string;
  title: string;
  description: string;
  rationale?: string;
  category: string;
  urgency: "critical" | "high" | "normal" | "low";
  priority: number; // 0-100
  status: "pending" | "approved" | "rejected" | "completed";
  sourceAgent: string;
  createdAt: string;
}

type StatusFilter = "pending" | "approved" | "completed" | "rejected" | "all";

// ===== Helpers =====

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

// ===== Category Config =====

const CATEGORY_COLORS: Record<string, string> = {
  risk: "bg-red-500/20 text-red-400 border-red-500/30",
  maintenance: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  optimization: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  opportunity: "bg-green-500/20 text-green-400 border-green-500/30",
  health: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  reporting: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  general: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const CATEGORY_LABELS: Record<string, string> = {
  risk: "위험",
  maintenance: "유지보수",
  optimization: "최적화",
  opportunity: "기회",
  health: "건강",
  reporting: "보고",
  general: "일반",
};

// ===== Urgency Config =====

const URGENCY_BADGES: Record<
  string,
  { label: string; className: string }
> = {
  critical: {
    label: "긴급",
    className:
      "bg-red-500/20 text-red-400 border-red-500/30 animate-pulse",
  },
  high: {
    label: "높음",
    className: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  },
  normal: {
    label: "보통",
    className: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  },
  low: {
    label: "낮음",
    className: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  },
};

// ===== Status Tabs =====

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "pending", label: "대기 중" },
  { value: "approved", label: "승인됨" },
  { value: "completed", label: "완료" },
  { value: "rejected", label: "거절" },
];

// ===== Priority Bar =====

function PriorityBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const color =
    pct >= 80
      ? "bg-red-500"
      : pct >= 60
      ? "bg-orange-500"
      : pct >= 40
      ? "bg-yellow-500"
      : "bg-blue-500";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-gray-400 w-6 text-right font-mono">
        {pct}
      </span>
    </div>
  );
}

// ===== Suggestion Card =====

function SuggestionCard({
  suggestion,
  onApprove,
  onReject,
  onExecute,
}: {
  suggestion: Suggestion;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onExecute: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const catColor =
    CATEGORY_COLORS[suggestion.category] ?? CATEGORY_COLORS.general;
  const catLabel =
    CATEGORY_LABELS[suggestion.category] ?? suggestion.category;
  const urgency =
    URGENCY_BADGES[suggestion.urgency] ?? URGENCY_BADGES.normal;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 hover:border-gray-600 transition-colors">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-[10px] px-2 py-0.5 rounded border font-medium ${catColor}`}
          >
            {catLabel}
          </span>
          <span
            className={`text-[10px] px-2 py-0.5 rounded border font-medium ${urgency.className}`}
          >
            {urgency.label}
          </span>
        </div>
        <span className="text-[10px] text-gray-500 flex-shrink-0">
          {relativeTime(suggestion.createdAt)}
        </span>
      </div>

      {/* Source agent */}
      <p className="text-[11px] text-gray-500 mb-1">
        출처: {suggestion.sourceAgent}
      </p>

      {/* Title */}
      <h3 className="text-sm font-semibold text-white mb-1">
        {suggestion.title}
      </h3>

      {/* Description */}
      <p
        className={`text-xs text-gray-400 leading-relaxed ${
          expanded ? "" : "line-clamp-2"
        }`}
      >
        {suggestion.description}
      </p>

      {suggestion.description.length > 80 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[11px] text-blue-400 hover:text-blue-300 mt-0.5 transition-colors"
        >
          {expanded ? "접기 ▲" : "더보기 ▼"}
        </button>
      )}

      {/* Rationale */}
      {suggestion.rationale && expanded && (
        <p className="text-[11px] text-gray-500 italic mt-2 leading-relaxed">
          {suggestion.rationale}
        </p>
      )}

      {/* Priority bar */}
      <div className="mt-3 mb-3">
        <p className="text-[10px] text-gray-500 mb-1">우선순위 점수</p>
        <PriorityBar score={suggestion.priority} />
      </div>

      {/* Action buttons — only for pending */}
      {suggestion.status === "pending" && (
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => onApprove(suggestion.id)}
            className="flex-1 text-xs py-1.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors font-medium"
          >
            승인
          </button>
          <button
            onClick={() => onReject(suggestion.id)}
            className="flex-1 text-xs py-1.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors font-medium"
          >
            거절
          </button>
        </div>
      )}

      {/* Execute button — only for approved */}
      {suggestion.status === "approved" && (
        <div className="mt-1">
          <button
            onClick={() => onExecute(suggestion.id)}
            className="w-full text-xs py-1.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors font-medium"
          >
            실행
          </button>
        </div>
      )}

      {/* Status badge for non-actionable states */}
      {(suggestion.status === "completed" ||
        suggestion.status === "rejected") && (
        <div className="mt-1">
          <span
            className={`text-[10px] px-2 py-0.5 rounded border ${
              suggestion.status === "completed"
                ? "bg-green-500/10 text-green-400 border-green-500/20"
                : "bg-gray-500/10 text-gray-400 border-gray-500/20"
            }`}
          >
            {suggestion.status === "completed" ? "완료됨" : "거절됨"}
          </span>
        </div>
      )}
    </div>
  );
}

// ===== Main Component =====

export default function SuggestionPanel() {
  const { addToast } = useToastContext();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<string>("all");

  // ===== Fetch =====

  const fetchSuggestions = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/suggestions?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSuggestions(data.suggestions ?? data.data ?? data ?? []);
    } catch (err) {
      console.error("Failed to fetch suggestions:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    setLoading(true);
    fetchSuggestions();
  }, [fetchSuggestions]);

  // ===== SSE =====

  useSuggestionSSE({
    onSuggestionCreated: ({ suggestion }) => {
      setSuggestions((prev) => [suggestion as Suggestion, ...prev]);
    },
    onSuggestionApproved: ({ suggestion }) => {
      setSuggestions((prev) =>
        prev.map((s) =>
          s.id === (suggestion as Suggestion).id
            ? { ...s, status: "approved" }
            : s
        )
      );
    },
    onSuggestionRejected: ({ suggestion }) => {
      setSuggestions((prev) =>
        prev.map((s) =>
          s.id === (suggestion as Suggestion).id
            ? { ...s, status: "rejected" }
            : s
        )
      );
    },
    onSuggestionCompleted: ({ suggestion }) => {
      setSuggestions((prev) =>
        prev.map((s) =>
          s.id === (suggestion as Suggestion).id
            ? { ...s, status: "completed" }
            : s
        )
      );
    },
  });

  // ===== Actions =====

  const handleApprove = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/suggestions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "approved" }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSuggestions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, status: "approved" } : s))
        );
        addToast("제안이 승인되었습니다", "success");
      } catch (err) {
        addToast(
          `승인 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
          "error"
        );
      }
    },
    [addToast]
  );

  const handleReject = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/suggestions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "rejected" }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSuggestions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, status: "rejected" } : s))
        );
        addToast("제안이 거절되었습니다", "success");
      } catch (err) {
        addToast(
          `거절 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
          "error"
        );
      }
    },
    [addToast]
  );

  const handleExecute = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/suggestions/${id}/execute`, {
          method: "POST",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSuggestions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, status: "completed" } : s))
        );
        addToast("제안 실행이 시작되었습니다", "success");
      } catch (err) {
        addToast(
          `실행 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
          "error"
        );
      }
    },
    [addToast]
  );

  // ===== Filtered & Sorted =====

  const filtered = suggestions
    .filter((s) => {
      if (categoryFilter !== "all" && s.category !== categoryFilter)
        return false;
      if (urgencyFilter !== "all" && s.urgency !== urgencyFilter) return false;
      return true;
    })
    .sort((a, b) => {
      // Sort: critical > high > normal > low, then by priority score desc
      const urgencyOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const uA = urgencyOrder[a.urgency] ?? 2;
      const uB = urgencyOrder[b.urgency] ?? 2;
      if (uA !== uB) return uA - uB;
      return b.priority - a.priority;
    });

  // ===== Stats =====

  const pendingCount = suggestions.filter((s) => s.status === "pending").length;
  const approvedCount = suggestions.filter(
    (s) => s.status === "approved"
  ).length;
  const criticalCount = suggestions.filter(
    (s) => s.urgency === "critical" && s.status === "pending"
  ).length;

  // ===== Unique categories present =====

  const presentCategories = Array.from(
    new Set(suggestions.map((s) => s.category))
  );

  return (
    <div className="space-y-5">
      {/* Stats Header */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white">
              제안 인박스
            </h2>
            <p className="text-sm text-gray-400 mt-0.5">
              {pendingCount}개의 제안이 대기 중입니다
              {criticalCount > 0 && (
                <span className="ml-2 text-red-400 font-medium animate-pulse">
                  ({criticalCount}개 긴급)
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-3 text-sm">
            <div className="text-center">
              <div className="text-lg font-bold text-white">{pendingCount}</div>
              <div className="text-[10px] text-gray-500">대기</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-green-400">
                {approvedCount}
              </div>
              <div className="text-[10px] text-gray-500">승인</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-gray-400">
                {suggestions.filter((s) => s.status === "completed").length}
              </div>
              <div className="text-[10px] text-gray-500">완료</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="space-y-3">
        {/* Status Tabs */}
        <div className="flex bg-gray-800 rounded-lg border border-gray-700 p-1 gap-1 overflow-x-auto">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap transition-colors duration-150 ${
                statusFilter === tab.value
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Category & Urgency Dropdowns */}
        <div className="flex gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">전체 카테고리</option>
            {presentCategories.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat] ?? cat}
              </option>
            ))}
          </select>

          <select
            value={urgencyFilter}
            onChange={(e) => setUrgencyFilter(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">전체 긴급도</option>
            <option value="critical">긴급</option>
            <option value="high">높음</option>
            <option value="normal">보통</option>
            <option value="low">낮음</option>
          </select>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16 text-gray-400">
          <div className="w-5 h-5 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm">제안 로딩 중...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 flex items-center justify-center bg-gray-800 rounded-full mb-4 text-2xl">
            💡
          </div>
          <p className="text-sm text-gray-400">
            에이전트가 아직 제안을 생성하지 않았습니다
          </p>
          {(categoryFilter !== "all" || urgencyFilter !== "all") && (
            <button
              onClick={() => {
                setCategoryFilter("all");
                setUrgencyFilter("all");
              }}
              className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              필터 초기화
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((suggestion) => (
            <SuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              onApprove={handleApprove}
              onReject={handleReject}
              onExecute={handleExecute}
            />
          ))}
        </div>
      )}
    </div>
  );
}
