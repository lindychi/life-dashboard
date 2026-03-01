"use client";

import { useState, useEffect } from "react";

interface DailyTrend {
  date: string;
  total_tasks: string;
  completed_count: string;
  failed_count: string;
}

interface AgentStat {
  agent_id: string;
  total_tasks: string;
  completed_count: string;
  success_rate: string;
  avg_duration_sec: string;
  total_cost_usd: string;
}

interface TopFailure {
  agent_id: string;
  total_tasks: string;
  failure_count: string;
  failure_rate: string;
  failure_types: string[];
}

interface OverallStats {
  total_tasks: string;
  completed_count: string;
  failed_count: string;
  timeout_count: string;
  hung_count: string;
  success_rate: string;
  avg_duration_sec: string;
  median_duration_sec: string;
  p95_duration_sec: string;
  total_cost_usd: string;
  total_tool_calls: string;
}

interface MetricsSummary {
  success: boolean;
  period_days: number;
  overall: OverallStats;
  by_agent: AgentStat[];
  trend: DailyTrend[];
  top_failures: TopFailure[];
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatCost(cost: string | undefined): string {
  const n = parseFloat(cost || "0");
  if (isNaN(n)) return "$0.00";
  return `$${n.toFixed(4)}`;
}

export default function AgentAnalytics() {
  const [data, setData] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  const handleDaysChange = (d: number) => {
    setLoading(true);
    setError(null);
    setDays(d);
  };

  useEffect(() => {
    fetch(`/api/metrics/summary?days=${days}`)
      .then((r) => r.json())
      .then((d: MetricsSummary) => {
        if (!d.success) throw new Error("API 오류");
        setData(d);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <div className="inline-block w-6 h-6 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin mr-3" />
        분석 데이터 로딩 중...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-red-400 mb-2">데이터를 불러올 수 없습니다</p>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  const overall = data.overall;
  const trend = [...data.trend].reverse(); // oldest first for chart
  const maxTasks = Math.max(...trend.map((d) => parseInt(d.total_tasks) || 0), 1);

  return (
    <div className="space-y-6">
      {/* Header + period toggle */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          에이전트 분석
        </h3>
        <div className="flex bg-gray-800 rounded-lg border border-gray-700 p-0.5">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => handleDaysChange(d)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                days === d ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {d}일
            </button>
          ))}
        </div>
      </div>

      {/* Overall stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "전체 태스크", value: overall.total_tasks || "0" },
          { label: "성공률", value: `${parseFloat(overall.success_rate || "0").toFixed(1)}%` },
          { label: "평균 소요시간", value: `${overall.avg_duration_sec || "0"}s` },
          { label: "총 비용", value: formatCost(overall.total_cost_usd) },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 text-center"
          >
            <div className="text-lg font-bold text-white">{value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Daily trend bar chart */}
      <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-4">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
          일별 태스크 추이
        </h4>
        {trend.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">데이터 없음</p>
        ) : (
          <div className="flex items-end gap-1.5 sm:gap-2 h-32">
            {trend.map((day) => {
              const total = parseInt(day.total_tasks) || 0;
              const completed = parseInt(day.completed_count) || 0;
              const failed = parseInt(day.failed_count) || 0;
              const heightPct = total > 0 ? (total / maxTasks) * 100 : 0;
              const successPct = total > 0 ? (completed / total) * 100 : 0;
              const failPct = total > 0 ? (failed / total) * 100 : 0;

              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1 h-full">
                  {/* Bar container */}
                  <div className="flex-1 w-full flex items-end">
                    <div
                      className="w-full rounded-t-sm overflow-hidden"
                      style={{ height: `${heightPct}%`, minHeight: total > 0 ? "4px" : "0" }}
                      title={`${formatDate(day.date)}: 전체 ${total}, 성공 ${completed}, 실패 ${failed}`}
                    >
                      {/* Stack: success (bottom) + failed (top) */}
                      <div className="w-full h-full flex flex-col-reverse">
                        <div
                          className="w-full bg-green-500/70"
                          style={{ height: `${successPct}%` }}
                        />
                        <div
                          className="w-full bg-red-500/60"
                          style={{ height: `${failPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  {/* Date label */}
                  <div className="text-[10px] text-gray-500 whitespace-nowrap">
                    {formatDate(day.date)}
                  </div>
                  {/* Count */}
                  {total > 0 && (
                    <div className="text-[10px] text-gray-400 font-medium">{total}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-4 mt-3">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-green-500/70" />
            <span className="text-xs text-gray-400">성공</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-red-500/60" />
            <span className="text-xs text-gray-400">실패</span>
          </div>
        </div>
      </div>

      {/* Agent success rates */}
      {data.by_agent.length > 0 && (
        <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-4">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            에이전트별 성공률
          </h4>
          <div className="space-y-3">
            {data.by_agent.map((agent) => {
              const rate = parseFloat(agent.success_rate || "0");
              const barColor =
                rate >= 80 ? "bg-green-500" : rate >= 50 ? "bg-yellow-500" : "bg-red-500";
              return (
                <div key={agent.agent_id}>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className="text-sm text-gray-300 truncate max-w-[60%]">
                      {agent.agent_id}
                    </span>
                    <div className="flex items-center gap-2 text-xs text-gray-400 flex-shrink-0">
                      <span>{agent.total_tasks}건</span>
                      <span className="text-white font-medium">{rate.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-500 ${barColor}`}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top failures */}
      {data.top_failures.length > 0 && (
        <div className="bg-gray-800/40 border border-red-900/30 rounded-xl p-4">
          <h4 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-4">
            실패 패턴 (상위 에이전트)
          </h4>
          <div className="space-y-2">
            {data.top_failures.map((f) => (
              <div
                key={f.agent_id}
                className="flex flex-wrap items-center justify-between gap-2 bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2"
              >
                <div>
                  <span className="text-sm text-gray-200">{f.agent_id}</span>
                  {f.failure_types && f.failure_types.length > 0 && (
                    <div className="flex gap-1 mt-0.5 flex-wrap">
                      {f.failure_types.map((t) => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 border border-red-800/30"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-red-400">
                    {parseFloat(f.failure_rate).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500">
                    {f.failure_count}/{f.total_tasks}건
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {data.by_agent.length === 0 && data.top_failures.length === 0 && trend.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-2">📊</p>
          <p className="text-sm">선택한 기간({days}일)에 데이터가 없습니다</p>
        </div>
      )}
    </div>
  );
}
