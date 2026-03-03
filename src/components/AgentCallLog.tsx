"use client";

import { useState, useEffect, useCallback } from "react";
import { useToastContext } from "@/contexts/ToastContext";
import { useSuggestionSSE } from "@/hooks/useSuggestionSSE";

// ===== Types =====

interface AgentCall {
  id: string;
  callerId: string;
  calleeId: string;
  purpose: string;
  status: "pending" | "running" | "completed" | "failed" | "denied";
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  callChain?: string[]; // e.g. ["agent-a", "agent-b", "agent-c"]
  depth?: number;
  createdAt: string;
  updatedAt?: string;
}

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

// ===== Status Config =====

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string; spinnerClass?: string }
> = {
  pending: {
    label: "대기 중",
    className:
      "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  },
  running: {
    label: "실행 중",
    className: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    spinnerClass: "animate-spin",
  },
  completed: {
    label: "완료",
    className: "bg-green-500/20 text-green-400 border-green-500/30",
  },
  failed: {
    label: "실패",
    className: "bg-red-500/20 text-red-400 border-red-500/30",
  },
  denied: {
    label: "거부",
    className: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  },
};

// ===== Status Badge =====

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border font-medium ${config.className}`}
    >
      {config.spinnerClass && (
        <span
          className={`w-2 h-2 border border-current border-t-transparent rounded-full ${config.spinnerClass}`}
        />
      )}
      {config.label}
    </span>
  );
}

// ===== Call Chain Visualization =====

function CallChain({ chain, depth }: { chain: string[]; depth?: number }) {
  if (!chain || chain.length === 0) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap text-[10px] text-gray-400 mt-1">
      {depth !== undefined && depth > 0 && (
        <span className="bg-gray-700 text-gray-500 px-1.5 py-0.5 rounded font-mono">
          depth:{depth}
        </span>
      )}
      {chain.map((agent, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-gray-600">→</span>}
          <span className="bg-gray-700/60 px-1.5 py-0.5 rounded text-gray-300 font-mono">
            {agent}
          </span>
        </span>
      ))}
    </div>
  );
}

// ===== Agent Call Card =====

function AgentCallCard({
  call,
  onApprove,
  onDeny,
}: {
  call: AgentCall;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const hasDetails =
    (call.requestPayload && Object.keys(call.requestPayload).length > 0) ||
    (call.responsePayload && Object.keys(call.responsePayload).length > 0);

  return (
    <div className="border border-gray-700 rounded-lg bg-gray-800/50 overflow-hidden">
      {/* Main row */}
      <div className="px-4 py-3">
        {/* Caller → Callee + status */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono font-medium text-gray-300">
                {call.callerId}
              </span>
              <span className="text-gray-500 text-xs">→</span>
              <span className="text-xs font-mono font-medium text-blue-300">
                {call.calleeId}
              </span>
              <StatusBadge status={call.status} />
            </div>
            {/* Purpose */}
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
              {call.purpose}
            </p>
            {/* Call chain */}
            {call.callChain && call.callChain.length > 0 && (
              <CallChain chain={call.callChain} depth={call.depth} />
            )}
          </div>
          <span className="text-[10px] text-gray-500 flex-shrink-0">
            {relativeTime(call.createdAt)}
          </span>
        </div>

        {/* Action buttons */}
        <div className="mt-3 flex items-center gap-2">
          {call.status === "pending" && (
            <>
              <button
                onClick={() => onApprove(call.id)}
                className="text-xs px-3 py-1 rounded bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors font-medium"
              >
                승인
              </button>
              <button
                onClick={() => onDeny(call.id)}
                className="text-xs px-3 py-1 rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors font-medium"
              >
                거부
              </button>
            </>
          )}
          {hasDetails && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors ml-auto"
            >
              {expanded ? "상세 접기 ▲" : "상세 보기 ▼"}
            </button>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && hasDetails && (
        <div className="border-t border-gray-700 px-4 py-3 space-y-3 bg-gray-900/40">
          {call.requestPayload &&
            Object.keys(call.requestPayload).length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1">
                  요청 페이로드
                </p>
                <pre className="text-[11px] text-gray-400 bg-gray-900 rounded px-3 py-2 overflow-x-auto max-h-[160px] overflow-y-auto border border-gray-800 whitespace-pre-wrap break-words">
                  {JSON.stringify(call.requestPayload, null, 2)}
                </pre>
              </div>
            )}
          {call.responsePayload &&
            Object.keys(call.responsePayload).length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1">
                  응답 페이로드
                </p>
                <pre className="text-[11px] text-gray-400 bg-gray-900 rounded px-3 py-2 overflow-x-auto max-h-[160px] overflow-y-auto border border-gray-800 whitespace-pre-wrap break-words">
                  {JSON.stringify(call.responsePayload, null, 2)}
                </pre>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

// ===== Main Component =====

export default function AgentCallLog() {
  const { addToast } = useToastContext();
  const [calls, setCalls] = useState<AgentCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");

  // ===== Fetch =====

  const fetchCalls = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/agent-calls?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCalls(data.calls ?? data.data ?? data ?? []);
    } catch (err) {
      console.error("Failed to fetch agent calls:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    setLoading(true);
    fetchCalls();
  }, [fetchCalls]);

  // ===== SSE — refresh on agent call events =====

  useSuggestionSSE({
    onAgentCallRequested: () => fetchCalls(),
    onAgentCallCompleted: () => fetchCalls(),
  });

  // ===== Actions =====

  const handleApprove = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/agent-calls/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "running" }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setCalls((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: "running" } : c))
        );
        addToast("에이전트 호출이 승인되었습니다", "success");
      } catch (err) {
        addToast(
          `승인 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
          "error"
        );
      }
    },
    [addToast]
  );

  const handleDeny = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/agent-calls/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "denied" }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setCalls((prev) =>
          prev.map((c) => (c.id === id ? { ...c, status: "denied" } : c))
        );
        addToast("에이전트 호출이 거부되었습니다", "success");
      } catch (err) {
        addToast(
          `거부 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
          "error"
        );
      }
    },
    [addToast]
  );

  // ===== Derived data =====

  const allAgents = Array.from(
    new Set(calls.flatMap((c) => [c.callerId, c.calleeId]))
  ).sort();

  const filtered = calls.filter((c) => {
    if (agentFilter !== "all" && c.callerId !== agentFilter && c.calleeId !== agentFilter)
      return false;
    return true;
  });

  const pendingCount = calls.filter((c) => c.status === "pending").length;
  const runningCount = calls.filter((c) => c.status === "running").length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-white">에이전트 호출 로그</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {pendingCount > 0 && (
              <span className="text-yellow-400 font-medium">
                {pendingCount}개 대기 중
              </span>
            )}
            {pendingCount > 0 && runningCount > 0 && (
              <span className="text-gray-600"> · </span>
            )}
            {runningCount > 0 && (
              <span className="text-blue-400 font-medium">
                {runningCount}개 실행 중
              </span>
            )}
            {pendingCount === 0 && runningCount === 0 && (
              <span>총 {calls.length}개의 호출 기록</span>
            )}
          </p>
        </div>

        <button
          onClick={() => {
            setLoading(true);
            fetchCalls();
          }}
          className="self-start sm:self-auto text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors border border-gray-600"
        >
          새로고침
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">전체 상태</option>
          <option value="pending">대기 중</option>
          <option value="running">실행 중</option>
          <option value="completed">완료</option>
          <option value="failed">실패</option>
          <option value="denied">거부</option>
        </select>

        {/* Agent filter */}
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">전체 에이전트</option>
          {allAgents.map((agent) => (
            <option key={agent} value={agent}>
              {agent}
            </option>
          ))}
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16 text-gray-400">
          <div className="w-5 h-5 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm">호출 기록 로딩 중...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 flex items-center justify-center bg-gray-800 rounded-full mb-4 text-2xl">
            🔗
          </div>
          <p className="text-sm text-gray-400">
            {statusFilter !== "all" || agentFilter !== "all"
              ? "필터 조건에 맞는 호출 기록이 없습니다"
              : "에이전트 호출 기록이 없습니다"}
          </p>
          {(statusFilter !== "all" || agentFilter !== "all") && (
            <button
              onClick={() => {
                setStatusFilter("all");
                setAgentFilter("all");
              }}
              className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              필터 초기화
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((call) => (
            <AgentCallCard
              key={call.id}
              call={call}
              onApprove={handleApprove}
              onDeny={handleDeny}
            />
          ))}
        </div>
      )}
    </div>
  );
}
