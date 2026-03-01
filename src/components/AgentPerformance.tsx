"use client";

import { useState, useEffect } from "react";

interface PromotionEvent {
  from: string;
  to: string;
  reason: string;
  date: string;
}

interface AgentStat {
  id: string;
  successRate: number;
  totalTasks: number;
  failedTasks: number;
  currentModelTier: string;
  promotionHistory: PromotionEvent[];
  avgDurationSec: number;
}

interface AgentStatsSummary {
  totalAgents: number;
  overallSuccessRate: number;
  totalTasksToday: number;
  totalCostUsd: number;
}

interface AgentStatsResponse {
  success: boolean;
  agents: AgentStat[];
  summary: AgentStatsSummary;
}

function rateColor(rate: number): string {
  if (rate >= 80) return "text-green-400";
  if (rate >= 50) return "text-yellow-400";
  return "text-red-400";
}

function rateBarColor(rate: number): string {
  if (rate >= 80) return "bg-green-500";
  if (rate >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

function tierBadgeClass(tier: string): string {
  if (tier === "haiku") return "bg-green-900/40 text-green-400 border border-green-700/40";
  if (tier === "sonnet") return "bg-blue-900/40 text-blue-400 border border-blue-700/40";
  if (tier === "opus") return "bg-purple-900/40 text-purple-400 border border-purple-700/40";
  return "bg-gray-700 text-gray-400";
}

export default function AgentPerformance() {
  const [data, setData] = useState<AgentStatsResponse | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [feedbackScores, setFeedbackScores] = useState<Record<string, number>>({});

  const handleDaysChange = (d: number) => {
    setLoading(true);
    setError(null);
    setDays(d);
  };

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/agent-stats?days=${days}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<AgentStatsResponse>;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "데이터 로드 실패");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [days]);

  // Fetch feedback scores for all agents
  useEffect(() => {
    if (!data?.agents) return;
    let cancelled = false;

    Promise.allSettled(
      data.agents.map((agent) =>
        fetch(`/api/feedback/summary?agentId=${agent.id}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => (d ? { id: agent.id, avg: d.data?.averageRating ?? d.averageRating } : null))
      )
    ).then((results) => {
      if (cancelled) return;
      const scores: Record<string, number> = {};
      for (const r of results) {
        if (r.status === "fulfilled" && r.value && typeof r.value.avg === "number" && r.value.avg > 0) {
          scores[r.value.id] = r.value.avg;
        }
      }
      setFeedbackScores(scores);
    });

    return () => { cancelled = true; };
  }, [data?.agents]);

  const toggleAgent = (id: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-gray-400">
        <div className="w-5 h-5 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
        에이전트 성능 데이터 로딩 중...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-red-400">
        오류: {error}
      </div>
    );
  }

  const summary = data?.summary;
  const agents = data?.agents ?? [];

  return (
    <div className="space-y-6">
      {/* Header + period selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">에이전트 성능</h2>
        <div className="flex gap-1">
          {([7, 14, 30] as const).map((d) => (
            <button
              key={d}
              onClick={() => handleDaysChange(d)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                days === d
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-400 hover:bg-gray-600"
              }`}
            >
              {d}일
            </button>
          ))}
        </div>
      </div>

      {/* Summary KPI cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="전체 에이전트" value={String(summary.totalAgents)} />
          <KpiCard
            label="평균 성공률"
            value={`${summary.overallSuccessRate.toFixed(1)}%`}
          />
          <KpiCard label="오늘 작업 수" value={String(summary.totalTasksToday)} />
          <KpiCard
            label="총 비용"
            value={`$${summary.totalCostUsd.toFixed(4)}`}
            sub="USD"
          />
        </div>
      )}

      {/* Agent list */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300">에이전트별 성능</h3>
        </div>

        {agents.length === 0 ? (
          <p className="px-5 py-6 text-gray-500 text-sm">데이터 없음</p>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {agents.map((agent) => {
              const hasPromotion = agent.promotionHistory.length > 0;
              const isExpanded = expandedAgents.has(agent.id);

              return (
                <div key={agent.id} className="px-5 py-4">
                  {/* Agent row */}
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    {/* Name */}
                    <span className="font-mono text-sm text-gray-200 min-w-[80px]">
                      {agent.id}
                    </span>

                    {/* Model tier badge */}
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-medium ${tierBadgeClass(
                        agent.currentModelTier
                      )}`}
                    >
                      {agent.currentModelTier}
                    </span>

                    {/* Stats */}
                    <div className="flex items-center gap-3 text-xs text-gray-400 ml-auto">
                      <span>{agent.totalTasks}건</span>
                      <span>실패 {agent.failedTasks}</span>
                      <span>{agent.avgDurationSec}초</span>
                      <span className={`font-medium ${rateColor(agent.successRate)}`}>
                        {agent.successRate.toFixed(1)}%
                      </span>
                      <span className="text-amber-400 font-medium">
                        {feedbackScores[agent.id]
                          ? `★ ${feedbackScores[agent.id].toFixed(1)}`
                          : "– –"}
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden mb-2">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-500 ${rateBarColor(
                        agent.successRate
                      )}`}
                      style={{ width: `${agent.successRate}%` }}
                    />
                  </div>

                  {/* Promotion history toggle */}
                  {hasPromotion && (
                    <div className="mt-2">
                      <button
                        onClick={() => toggleAgent(agent.id)}
                        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        승격 이력 {isExpanded ? "▲" : "▼"} ({agent.promotionHistory.length}건)
                      </button>

                      {isExpanded && (
                        <div className="mt-2 space-y-1.5">
                          {agent.promotionHistory.map((p, i) => (
                            <div
                              key={i}
                              className="flex flex-wrap items-center gap-2 text-xs text-gray-400 bg-gray-900/40 rounded px-3 py-1.5"
                            >
                              <span className="text-gray-500">{p.date}</span>
                              <span>
                                <span className="text-green-400">{p.from}</span>
                                {" → "}
                                <span className="text-blue-400">{p.to}</span>
                              </span>
                              <span className="text-gray-500">{p.reason}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 hover:border-gray-600 transition-colors">
      <div className="text-sm text-gray-400 mb-2">{label}</div>
      <div className="text-2xl font-extrabold text-white leading-none">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}
