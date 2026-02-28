"use client";

import { useMemo } from "react";

export interface KPIMetric {
  id: string;
  label: string;
  value: string | number;
  change?: number; // Percentage change from previous period
  trend?: "up" | "down" | "neutral";
  icon?: string; // Emoji
  format?: "number" | "percentage" | "currency" | "text";
  target?: number; // Optional target value
}

interface KPIDashboardProps {
  metrics: KPIMetric[];
  layout?: "grid" | "compact";
  columns?: 2 | 3 | 4;
}

export default function KPIDashboard({
  metrics,
  layout = "grid",
  columns = 3,
}: KPIDashboardProps) {
  const gridCols = useMemo(() => {
    if (columns === 2) return "grid-cols-1 sm:grid-cols-2";
    if (columns === 4) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
    return "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"; // default: 3
  }, [columns]);

  if (layout === "compact") {
    return (
      <div className="space-y-2">
        {metrics.map((metric) => (
          <CompactKPICard key={metric.id} metric={metric} />
        ))}
      </div>
    );
  }

  return (
    <div className={`grid ${gridCols} gap-4 lg:gap-5`}>
      {metrics.map((metric) => (
        <KPICard key={metric.id} metric={metric} />
      ))}
    </div>
  );
}

function KPICard({ metric }: { metric: KPIMetric }) {
  const formattedValue = useMemo(() => {
    if (metric.format === "percentage" && typeof metric.value === "number") {
      return `${metric.value}%`;
    }
    if (metric.format === "currency" && typeof metric.value === "number") {
      return new Intl.NumberFormat("ko-KR", {
        style: "currency",
        currency: "KRW",
      }).format(metric.value);
    }
    if (metric.format === "number" && typeof metric.value === "number") {
      return new Intl.NumberFormat("ko-KR").format(metric.value);
    }
    return metric.value;
  }, [metric.value, metric.format]);

  const changeColor = useMemo(() => {
    if (!metric.change) return "text-gray-400";
    if (metric.trend === "up" && metric.change > 0) return "text-green-500";
    if (metric.trend === "down" && metric.change < 0) return "text-red-500";
    if (metric.trend === "neutral") return "text-gray-400";
    return metric.change > 0 ? "text-green-500" : "text-red-500";
  }, [metric.change, metric.trend]);

  const progressPercentage = useMemo(() => {
    if (!metric.target || typeof metric.value !== "number") return null;
    return Math.min(100, (metric.value / metric.target) * 100);
  }, [metric.value, metric.target]);

  return (
    <div className="bg-gray-800 rounded-xl p-5 lg:p-4 border border-gray-700 hover:border-gray-600 transition-colors duration-150">
      {/* Header */}
      <div className="flex justify-between items-start mb-3 lg:mb-2">
        <div className="flex-1">
          <div className="text-sm text-gray-400 mb-1">{metric.label}</div>
          <div className="text-3xl lg:text-2xl font-extrabold text-white leading-none">
            {formattedValue}
          </div>
        </div>
        {metric.icon && <span className="text-2xl lg:text-xl">{metric.icon}</span>}
      </div>

      {/* Change Indicator */}
      {metric.change !== undefined && (
        <div className={`flex items-center gap-1 text-xs ${changeColor}`}>
          {metric.change > 0 ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
          ) : metric.change < 0 ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                clipRule="evenodd"
              />
            </svg>
          )}
          <span className="font-medium">
            {Math.abs(metric.change)}%{" "}
            <span className="font-normal text-gray-500">vs 지난주</span>
          </span>
        </div>
      )}

      {/* Progress Bar (if target exists) */}
      {progressPercentage !== null && (
        <div className="mt-3 lg:mt-2">
          <div className="flex justify-between text-xs text-gray-400 mb-1.5">
            <span>목표 대비</span>
            <span className="font-medium text-white">
              {progressPercentage.toFixed(0)}%
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className={`
                h-2 rounded-full transition-all duration-500 ease-out
                ${progressPercentage >= 100 ? "bg-green-500" : progressPercentage >= 75 ? "bg-blue-600" : progressPercentage >= 50 ? "bg-yellow-500" : "bg-red-500"}
              `}
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CompactKPICard({ metric }: { metric: KPIMetric }) {
  const formattedValue = useMemo(() => {
    if (metric.format === "percentage" && typeof metric.value === "number") {
      return `${metric.value}%`;
    }
    if (metric.format === "currency" && typeof metric.value === "number") {
      return new Intl.NumberFormat("ko-KR", {
        style: "currency",
        currency: "KRW",
        notation: "compact",
      }).format(metric.value);
    }
    if (metric.format === "number" && typeof metric.value === "number") {
      return new Intl.NumberFormat("ko-KR", { notation: "compact" }).format(
        metric.value
      );
    }
    return metric.value;
  }, [metric.value, metric.format]);

  const changeColor = useMemo(() => {
    if (!metric.change) return "text-gray-400";
    if (metric.trend === "up" && metric.change > 0) return "text-green-500";
    if (metric.trend === "down" && metric.change < 0) return "text-red-500";
    if (metric.trend === "neutral") return "text-gray-400";
    return metric.change > 0 ? "text-green-500" : "text-red-500";
  }, [metric.change, metric.trend]);

  return (
    <div className="flex items-center justify-between px-4 py-3 lg:px-3 lg:py-2 bg-gray-800 rounded-lg border border-gray-700">
      <div className="flex items-center gap-3">
        {metric.icon && <span className="text-xl">{metric.icon}</span>}
        <div>
          <div className="text-xs text-gray-400">{metric.label}</div>
          <div className="text-lg lg:text-base font-bold text-white">
            {formattedValue}
          </div>
        </div>
      </div>
      {metric.change !== undefined && (
        <div className={`flex items-center gap-1 text-xs ${changeColor}`}>
          {metric.change > 0 ? "↑" : metric.change < 0 ? "↓" : "→"}
          <span className="font-medium">{Math.abs(metric.change)}%</span>
        </div>
      )}
    </div>
  );
}

// Utility: Generate sample KPI data for testing
export function generateSampleKPIs(): KPIMetric[] {
  return [
    {
      id: "completion-rate",
      label: "완료율",
      value: 87,
      change: 5,
      trend: "up",
      icon: "📊",
      format: "percentage",
      target: 90,
    },
    {
      id: "active-tasks",
      label: "활성 작업",
      value: 12,
      change: -2,
      trend: "down",
      icon: "📝",
      format: "number",
    },
    {
      id: "total-hours",
      label: "총 작업 시간",
      value: 145,
      change: 8,
      trend: "up",
      icon: "⏱️",
      format: "number",
    },
    {
      id: "revenue",
      label: "월 수익",
      value: 3200000,
      change: 15,
      trend: "up",
      icon: "💰",
      format: "currency",
      target: 5000000,
    },
    {
      id: "success-rate",
      label: "성공률",
      value: 92,
      change: 0,
      trend: "neutral",
      icon: "✅",
      format: "percentage",
    },
    {
      id: "users",
      label: "활성 사용자",
      value: 1234,
      change: 23,
      trend: "up",
      icon: "👥",
      format: "number",
      target: 2000,
    },
  ];
}
