"use client";

import { useState, useEffect } from "react";

interface MetricsSummary {
  period_days: number;
  overall: {
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
  };
  by_agent: Array<{
    agent_id: string;
    total_tasks: string;
    completed_count: string;
    success_rate: string;
    avg_duration_sec: string;
    total_cost_usd: string;
  }>;
  by_model: Array<{
    model_tier: string;
    total_tasks: string;
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
  top_failures: Array<{
    agent_id: string;
    total_tasks: string;
    failure_count: string;
    failure_rate: string;
    failure_types: string[];
  }>;
}

export default function MetricsPanel() {
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    async function fetchSummary() {
      try {
        setLoading(true);
        const response = await fetch(`/api/metrics/summary?days=${days}`);
        if (!response.ok) throw new Error("Failed to fetch metrics");
        const data = await response.json();
        setSummary(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    fetchSummary();
  }, [days]);

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 text-center">
        <p className="text-gray-400">Loading metrics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 border border-red-700 text-center">
        <p className="text-red-400">Error: {error}</p>
        <p className="text-gray-500 text-sm mt-2">
          메트릭 시스템을 설치하려면: <code className="bg-gray-900 px-2 py-1 rounded">psql life_dashboard &lt; sql/005_task_metrics.sql</code>
        </p>
      </div>
    );
  }

  if (!summary) return null;

  const overall = summary.overall;
  const successRate = parseFloat(overall.success_rate || "0");
  const totalCost = parseFloat(overall.total_cost_usd || "0");

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-white">📊 Agent Metrics</h2>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          className="bg-gray-700 text-white px-3 py-1.5 rounded-lg border border-gray-600 text-sm"
        >
          <option value="1">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </select>
      </div>

      {/* Overall metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Tasks"
          value={overall.total_tasks || "0"}
          icon="📋"
        />
        <MetricCard
          label="Success Rate"
          value={`${successRate.toFixed(1)}%`}
          icon="✅"
          color={successRate >= 90 ? "green" : successRate >= 70 ? "yellow" : "red"}
        />
        <MetricCard
          label="Avg Duration"
          value={`${overall.avg_duration_sec || "0"}s`}
          icon="⏱️"
        />
        <MetricCard
          label="Total Cost"
          value={`$${totalCost.toFixed(2)}`}
          icon="💰"
        />
      </div>

      {/* Agent performance */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h3 className="text-lg font-bold mb-4 text-white">🤖 Agent Performance</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-700">
                <th className="pb-2">Agent</th>
                <th className="pb-2 text-right">Tasks</th>
                <th className="pb-2 text-right">Success Rate</th>
                <th className="pb-2 text-right">Avg Duration</th>
                <th className="pb-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="text-white">
              {summary.by_agent.map((agent) => {
                const rate = parseFloat(agent.success_rate || "0");
                return (
                  <tr key={agent.agent_id} className="border-b border-gray-700/50">
                    <td className="py-2">{agent.agent_id}</td>
                    <td className="py-2 text-right">{agent.total_tasks}</td>
                    <td className={`py-2 text-right ${rate >= 90 ? "text-green-400" : rate >= 70 ? "text-yellow-400" : "text-red-400"}`}>
                      {rate.toFixed(1)}%
                    </td>
                    <td className="py-2 text-right">{agent.avg_duration_sec}s</td>
                    <td className="py-2 text-right">${parseFloat(agent.total_cost_usd || "0").toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Model tier effectiveness */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h3 className="text-lg font-bold mb-4 text-white">🧠 Model Tier Effectiveness</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {summary.by_model.map((model) => {
            const rate = parseFloat(model.success_rate || "0");
            const tierColor = model.model_tier === "opus" ? "text-purple-400" :
                             model.model_tier === "sonnet" ? "text-blue-400" : "text-green-400";
            return (
              <div key={model.model_tier} className="bg-gray-900 rounded-lg p-4">
                <div className={`text-lg font-bold ${tierColor} mb-2`}>
                  {model.model_tier.toUpperCase()}
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Tasks:</span>
                    <span className="text-white">{model.total_tasks}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Success:</span>
                    <span className={rate >= 90 ? "text-green-400" : rate >= 70 ? "text-yellow-400" : "text-red-400"}>
                      {rate.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Avg time:</span>
                    <span className="text-white">{model.avg_duration_sec}s</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Cost:</span>
                    <span className="text-white">${parseFloat(model.total_cost_usd || "0").toFixed(2)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily trend */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h3 className="text-lg font-bold mb-4 text-white">📈 Daily Trend</h3>
        <div className="space-y-2">
          {summary.trend.map((day) => {
            const total = parseInt(day.total_tasks || "0", 10);
            const completed = parseInt(day.completed_count || "0", 10);
            const failed = parseInt(day.failed_count || "0", 10);
            const successPct = total > 0 ? (completed / total) * 100 : 0;
            const failurePct = total > 0 ? (failed / total) * 100 : 0;
            return (
              <div key={day.date} className="flex items-center gap-3">
                <div className="w-24 text-sm text-gray-400">{day.date}</div>
                <div className="flex-1 flex h-6 bg-gray-900 rounded overflow-hidden">
                  {completed > 0 && (
                    <div
                      className="bg-green-500/80 flex items-center justify-center text-xs text-white"
                      style={{ width: `${successPct}%` }}
                      title={`${completed} completed`}
                    >
                      {completed > 5 ? completed : ""}
                    </div>
                  )}
                  {failed > 0 && (
                    <div
                      className="bg-red-500/80 flex items-center justify-center text-xs text-white"
                      style={{ width: `${failurePct}%` }}
                      title={`${failed} failed`}
                    >
                      {failed > 3 ? failed : ""}
                    </div>
                  )}
                </div>
                <div className="w-12 text-sm text-gray-400 text-right">{total}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top failures */}
      {summary.top_failures.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h3 className="text-lg font-bold mb-4 text-white">⚠️ Top Failures</h3>
          <div className="space-y-2">
            {summary.top_failures.map((item) => {
              const failureRate = parseFloat(item.failure_rate || "0");
              return (
                <div key={item.agent_id} className="flex items-center justify-between bg-gray-900 rounded p-3">
                  <div>
                    <div className="font-medium text-white">{item.agent_id}</div>
                    <div className="text-sm text-gray-400">
                      {item.failure_count} failures out of {item.total_tasks} tasks
                      {item.failure_types && ` (${item.failure_types.join(", ")})`}
                    </div>
                  </div>
                  <div className="text-red-400 font-bold text-lg">
                    {failureRate.toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  color = "gray",
}: {
  label: string;
  value: string;
  icon: string;
  color?: "gray" | "green" | "yellow" | "red";
}) {
  const colorClasses = {
    gray: "text-gray-400",
    green: "text-green-400",
    yellow: "text-yellow-400",
    red: "text-red-400",
  };

  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
      <div className="text-2xl mb-2">{icon}</div>
      <div className="text-sm text-gray-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${colorClasses[color]}`}>
        {value}
      </div>
    </div>
  );
}
