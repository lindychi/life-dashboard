"use client";

import { useState, useEffect } from "react";

interface MetricsSummary {
  success: boolean;
  period_days: number;
  overall: {
    total_tasks: string;
    completed_count: string;
    failed_count: string;
    success_rate: string;
    avg_duration_sec: string;
    total_cost_usd: string;
    total_tool_calls: string;
  };
  by_agent: Array<{
    agent_id: string;
    total_tasks: string;
    completed_count: string;
    success_rate: string;
    avg_duration_sec: string;
    total_cost_usd: string;
  }>;
  trend: Array<{
    date: string;
    total_tasks: string;
    completed_count: string;
    failed_count: string;
  }>;
}

interface TokenOverview {
  totalCalls: number;
  totalCost: number;
  avgCostPerCall: number;
  modelDistribution: {
    haiku: number;
    sonnet: number;
    opus: number;
  };
  successRate: number;
  avgElapsedMs: number;
  ecomodeUsageRate: number;
  escalationRate: number;
}

interface DailySummary {
  day: string;
  model: string;
  totalCalls: number;
  successfulCalls: number;
  totalCost: number;
}

function fmt(value: string | number | null | undefined, decimals = 4): string {
  const n = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (isNaN(n)) return "$0.0000";
  return `$${n.toFixed(decimals)}`;
}

function fmtPct(value: string | number | null | undefined): string {
  const n = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  if (isNaN(n)) return "0%";
  return `${n.toFixed(1)}%`;
}

export default function FinanceTab() {
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [tokenOverview, setTokenOverview] = useState<TokenOverview | null>(null);
  const [dailySummary, setDailySummary] = useState<DailySummary[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleDaysChange = (d: number) => {
    setLoading(true);
    setError(null);
    setDays(d);
  };

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch(`/api/metrics/summary?days=${days}`).then((r) => {
        if (!r.ok) throw new Error(`metrics/summary: HTTP ${r.status}`);
        return r.json() as Promise<MetricsSummary>;
      }),
      fetch(`/api/token-usage?view=overview&days=${days}`).then((r) => {
        if (!r.ok) throw new Error(`token-usage overview: HTTP ${r.status}`);
        return r.json() as Promise<TokenOverview>;
      }),
      fetch(`/api/token-usage?view=daily&days=${days}`).then((r) => {
        if (!r.ok) throw new Error(`token-usage daily: HTTP ${r.status}`);
        return r.json() as Promise<{ summary: DailySummary[]; days: number }>;
      }),
    ])
      .then(([s, t, d]) => {
        if (!cancelled) {
          setSummary(s);
          setTokenOverview(t);
          // Aggregate by day across models
          const byDay: Record<string, number> = {};
          for (const row of d.summary) {
            byDay[row.day] = (byDay[row.day] ?? 0) + row.totalCost;
          }
          const aggregated: DailySummary[] = Object.entries(byDay)
            .map(([day, totalCost]) => {
              const rows = d.summary.filter((r) => r.day === day);
              return {
                day,
                model: "all",
                totalCalls: rows.reduce((a, r) => a + r.totalCalls, 0),
                successfulCalls: rows.reduce((a, r) => a + r.successfulCalls, 0),
                totalCost,
              };
            })
            .sort((a, b) => a.day.localeCompare(b.day));
          setDailySummary(aggregated);
        }
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        재정 데이터 로딩 중...
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

  const overall = summary?.overall;
  const totalCostUsd = parseFloat(overall?.total_cost_usd ?? "0") || 0;
  const totalTasks = parseInt(overall?.total_tasks ?? "0", 10) || 0;
  const successRate = parseFloat(overall?.success_rate ?? "0") || 0;
  const avgDuration = parseFloat(overall?.avg_duration_sec ?? "0") || 0;

  // Bar chart: max cost for scaling
  const maxDailyCost = Math.max(...dailySummary.map((d) => d.totalCost), 0.0001);

  const modelDist = tokenOverview?.modelDistribution;
  const totalModelCalls =
    (modelDist?.haiku ?? 0) + (modelDist?.sonnet ?? 0) + (modelDist?.opus ?? 0);

  return (
    <div className="space-y-6">
      {/* Header + period selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">AI 비용 현황</h2>
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="총 비용"
          value={`$${totalCostUsd.toFixed(4)}`}
          sub="USD"
          icon="💰"
        />
        <KpiCard
          label="총 작업"
          value={totalTasks.toLocaleString()}
          sub={`완료: ${overall?.completed_count ?? 0}`}
          icon="📋"
        />
        <KpiCard
          label="성공률"
          value={fmtPct(successRate)}
          sub={`실패: ${overall?.failed_count ?? 0}건`}
          icon="✅"
        />
        <KpiCard
          label="평균 소요시간"
          value={`${avgDuration.toFixed(1)}초`}
          sub="작업당 평균"
          icon="⏱️"
        />
      </div>

      {/* Token Overview + Model Distribution */}
      {tokenOverview && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Token cost breakdown */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">
              토큰 사용량 요약
            </h3>
            <div className="space-y-3">
              <Row label="총 API 호출" value={tokenOverview.totalCalls.toLocaleString()} />
              <Row label="평균 비용/호출" value={`$${tokenOverview.avgCostPerCall.toFixed(5)}`} />
              <Row label="평균 응답시간" value={`${(tokenOverview.avgElapsedMs / 1000).toFixed(1)}초`} />
              <Row label="성공률" value={`${tokenOverview.successRate}%`} />
              <Row label="에코모드 비율" value={`${tokenOverview.ecomodeUsageRate}%`} />
              <Row label="에스컬레이션 비율" value={`${tokenOverview.escalationRate}%`} />
            </div>
          </div>

          {/* Model distribution */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">
              모델별 사용 분포
            </h3>
            {totalModelCalls === 0 ? (
              <p className="text-gray-500 text-sm">데이터 없음</p>
            ) : (
              <div className="space-y-3">
                {(["haiku", "sonnet", "opus"] as const).map((model) => {
                  const count = modelDist?.[model] ?? 0;
                  const pct = totalModelCalls > 0 ? (count / totalModelCalls) * 100 : 0;
                  const color =
                    model === "haiku"
                      ? "bg-green-500"
                      : model === "sonnet"
                      ? "bg-blue-500"
                      : "bg-purple-500";
                  return (
                    <div key={model}>
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span className="capitalize">{model}</span>
                        <span>
                          {count.toLocaleString()}회 ({pct.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full ${color} transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Daily cost bar chart */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">일별 비용 추이</h3>
        {dailySummary.length === 0 ? (
          <p className="text-gray-500 text-sm">데이터 없음</p>
        ) : (
          <div className="flex items-end gap-2 h-32">
            {dailySummary.map((d) => {
              const heightPct = (d.totalCost / maxDailyCost) * 100;
              const dateLabel = d.day.slice(5); // MM-DD
              return (
                <div
                  key={d.day}
                  className="flex flex-col items-center flex-1 gap-1 group"
                >
                  <div className="relative w-full flex items-end justify-center h-24">
                    <div
                      className="w-full bg-blue-600 rounded-t hover:bg-blue-500 transition-colors cursor-default"
                      style={{ height: `${Math.max(heightPct, 2)}%` }}
                      title={`${d.day}: $${d.totalCost.toFixed(4)} (${d.totalCalls}회)`}
                    />
                    {/* Tooltip on hover */}
                    <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 pointer-events-none">
                      <div className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white whitespace-nowrap">
                        {d.day}
                        <br />${d.totalCost.toFixed(4)} · {d.totalCalls}회
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500">{dateLabel}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Per-agent cost table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300">에이전트별 비용</h3>
        </div>
        {!summary?.by_agent || summary.by_agent.length === 0 ? (
          <p className="px-5 py-6 text-gray-500 text-sm">데이터 없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-700">
                  <th className="px-5 py-3 text-left font-medium">에이전트</th>
                  <th className="px-4 py-3 text-right font-medium">비용 (USD)</th>
                  <th className="px-4 py-3 text-right font-medium">작업 수</th>
                  <th className="px-4 py-3 text-right font-medium">성공률</th>
                  <th className="px-4 py-3 text-right font-medium">평균 소요시간</th>
                </tr>
              </thead>
              <tbody>
                {summary.by_agent
                  .slice()
                  .sort(
                    (a, b) =>
                      parseFloat(b.total_cost_usd) - parseFloat(a.total_cost_usd)
                  )
                  .map((agent, i) => (
                    <tr
                      key={agent.agent_id}
                      className={`border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors ${
                        i % 2 === 0 ? "" : "bg-gray-800/50"
                      }`}
                    >
                      <td className="px-5 py-3 text-gray-200 font-mono text-xs truncate max-w-[180px]">
                        {agent.agent_id}
                      </td>
                      <td className="px-4 py-3 text-right text-yellow-400 font-medium">
                        {fmt(agent.total_cost_usd)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">
                        {parseInt(agent.total_tasks, 10).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={
                            parseFloat(agent.success_rate) >= 80
                              ? "text-green-400"
                              : parseFloat(agent.success_rate) >= 50
                              ? "text-yellow-400"
                              : "text-red-400"
                          }
                        >
                          {fmtPct(agent.success_rate)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-300">
                        {parseFloat(agent.avg_duration_sec).toFixed(1)}초
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
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
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: string;
}) {
  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 hover:border-gray-600 transition-colors">
      <div className="flex justify-between items-start mb-2">
        <div className="text-sm text-gray-400">{label}</div>
        {icon && <span className="text-xl">{icon}</span>}
      </div>
      <div className="text-2xl font-extrabold text-white leading-none">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-400">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  );
}
