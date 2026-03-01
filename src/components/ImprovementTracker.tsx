"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useToastContext } from "@/contexts/ToastContext";
import StarRating from "@/components/StarRating";

// ===== Types =====

interface FeedbackSummary {
  averageRating: number;
  totalFeedback: number;
  activeImprovements: number;
  learnedPreferences: number;
  categoryAverages: Record<string, number>;
}

interface TrendPoint {
  week: string;
  avgRating: number;
}

interface Preference {
  id: string;
  key: string;
  value: string;
}

interface Improvement {
  id: string;
  title: string;
  description: string;
  status: "proposed" | "applied" | "rejected";
  beforeValue?: string;
  afterValue?: string;
  createdAt: string;
}

interface FeedbackEntry {
  id: string;
  agentId: string;
  rating: number;
  comment?: string;
  createdAt: string;
}

// ===== KPI Card =====

function KpiCard({
  label,
  value,
  icon,
  iconColor,
}: {
  label: string;
  value: string;
  icon: string;
  iconColor?: string;
}) {
  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 hover:border-gray-600 transition-colors">
      <div className="flex justify-between items-start mb-2">
        <div className="text-sm text-gray-400">{label}</div>
        <span className={`text-xl ${iconColor || ""}`}>{icon}</span>
      </div>
      <div className="text-2xl font-extrabold text-white leading-none">{value}</div>
    </div>
  );
}

// ===== SVG Sparkline =====

function SparklineChart({ data }: { data: TrendPoint[] }) {
  const width = 600;
  const height = 120;
  const padding = { top: 10, right: 10, bottom: 24, left: 30 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = useMemo(() => {
    if (data.length === 0) return [];
    const minY = 0;
    const maxY = 5;
    return data.map((d, i) => ({
      x: padding.left + (data.length === 1 ? chartWidth / 2 : (i / (data.length - 1)) * chartWidth),
      y: padding.top + chartHeight - ((d.avgRating - minY) / (maxY - minY)) * chartHeight,
      label: d.week,
      value: d.avgRating,
    }));
  }, [data, chartWidth, chartHeight, padding.left, padding.top]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[120px] text-gray-500 text-sm">
        데이터 없음
      </div>
    );
  }

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {[1, 2, 3, 4, 5].map((v) => {
        const y = padding.top + chartHeight - ((v / 5) * chartHeight);
        return (
          <g key={v}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="rgb(55, 65, 81)" strokeWidth={0.5} strokeDasharray="4 4" />
            <text x={padding.left - 6} y={y + 3} textAnchor="end" className="fill-gray-500" fontSize="9">{v}</text>
          </g>
        );
      })}

      {/* Area fill */}
      <path d={areaPath} fill="rgb(245, 158, 11)" fillOpacity="0.15" />

      {/* Line */}
      <path d={linePath} fill="none" stroke="rgb(251, 191, 36)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

      {/* Dots */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="rgb(251, 191, 36)" stroke="rgb(31, 41, 55)" strokeWidth={1.5} />
      ))}

      {/* X-axis labels */}
      {points.map((p, i) => (
        <text key={`label-${i}`} x={p.x} y={height - 4} textAnchor="middle" className="fill-gray-500" fontSize="9">
          {p.label}
        </text>
      ))}
    </svg>
  );
}

// ===== Category Bars =====

function CategoryBars({ averages }: { averages: Record<string, number> }) {
  const entries = Object.entries(averages).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return <div className="text-gray-500 text-sm py-4">카테고리 데이터 없음</div>;
  }

  return (
    <div className="space-y-3">
      {entries.map(([cat, avg]) => (
        <div key={cat}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-300">{cat}</span>
            <span className="text-amber-400 font-medium">{avg.toFixed(1)}</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full bg-amber-500 transition-all duration-500"
              style={{ width: `${(avg / 5) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== Main Component =====

export default function ImprovementTracker() {
  const { addToast } = useToastContext();
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [improvements, setImprovements] = useState<Improvement[]>([]);
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      try {
        const [summaryRes, trendsRes, prefsRes, improvRes, feedbackRes] = await Promise.allSettled([
          fetch("/api/feedback/summary"),
          fetch("/api/feedback/trends?weeks=8"),
          fetch("/api/preferences"),
          fetch("/api/improvements"),
          fetch("/api/feedback?limit=20"),
        ]);

        if (cancelled) return;

        if (summaryRes.status === "fulfilled" && summaryRes.value.ok) {
          const data = await summaryRes.value.json();
          setSummary(data.data ?? data);
        }
        if (trendsRes.status === "fulfilled" && trendsRes.value.ok) {
          const data = await trendsRes.value.json();
          setTrends(data.data ?? data.trends ?? []);
        }
        if (prefsRes.status === "fulfilled" && prefsRes.value.ok) {
          const data = await prefsRes.value.json();
          setPreferences(data.data ?? data.preferences ?? []);
        }
        if (improvRes.status === "fulfilled" && improvRes.value.ok) {
          const data = await improvRes.value.json();
          setImprovements(data.data ?? data.improvements ?? []);
        }
        if (feedbackRes.status === "fulfilled" && feedbackRes.value.ok) {
          const data = await feedbackRes.value.json();
          setFeedbackEntries(data.data ?? data.entries ?? []);
        }
      } catch {
        // Individual fetches are handled by allSettled
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAll();
    return () => { cancelled = true; };
  }, []);

  const handleImprovementAction = useCallback(
    async (id: string, action: "approve" | "reject") => {
      try {
        const res = await fetch(`/api/improvements/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: action === "approve" ? "applied" : "rejected" }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        setImprovements((prev) =>
          prev.map((imp) =>
            imp.id === id
              ? { ...imp, status: action === "approve" ? "applied" : "rejected" }
              : imp
          )
        );
        addToast(action === "approve" ? "개선 사항이 적용되었습니다" : "개선 사항이 거절되었습니다", "success");
      } catch (err) {
        addToast(
          `작업 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
          "error"
        );
      }
    },
    [addToast]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-gray-400">
        <div className="w-5 h-5 border-2 border-gray-700 border-t-amber-500 rounded-full animate-spin" />
        개선 데이터 로딩 중...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* A) KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="kpi-cards">
        <KpiCard
          label="평균 별점"
          value={summary ? `${summary.averageRating.toFixed(1)}` : "–"}
          icon="★"
          iconColor="text-amber-400"
        />
        <KpiCard
          label="총 피드백 수"
          value={summary ? String(summary.totalFeedback) : "0"}
          icon="📊"
        />
        <KpiCard
          label="활성 개선 수"
          value={summary ? String(summary.activeImprovements) : "0"}
          icon="🔧"
        />
        <KpiCard
          label="학습된 선호 수"
          value={summary ? String(summary.learnedPreferences) : "0"}
          icon="🧠"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* B) Feedback Trend Chart */}
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">피드백 트렌드</h3>
          <SparklineChart data={trends} />
        </div>

        {/* C) Top Improvement Areas */}
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">카테고리별 평균</h3>
          <CategoryBars averages={summary?.categoryAverages ?? {}} />
        </div>
      </div>

      {/* D) Learned Preferences */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">학습된 선호</h3>
        {preferences.length === 0 ? (
          <p className="text-gray-500 text-sm">학습된 선호가 없습니다</p>
        ) : (
          <div className="flex flex-wrap gap-2 max-h-[200px] overflow-y-auto">
            {preferences.map((pref) => (
              <span
                key={pref.id}
                className="text-xs px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300"
              >
                {pref.key}: {pref.value}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* E) Improvement Actions */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">개선 작업</h3>
        {improvements.length === 0 ? (
          <p className="text-gray-500 text-sm">개선 작업이 없습니다</p>
        ) : (
          <div className="space-y-3">
            {improvements.map((imp) => (
              <div
                key={imp.id}
                className="border border-gray-700 rounded-lg p-4 bg-gray-800/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-200">{imp.title}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          imp.status === "proposed"
                            ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                            : imp.status === "applied"
                            ? "bg-green-500/20 text-green-400 border-green-500/30"
                            : "bg-red-500/20 text-red-400 border-red-500/30"
                        }`}
                      >
                        {imp.status === "proposed" ? "제안됨" : imp.status === "applied" ? "적용됨" : "거절됨"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">{imp.description}</p>
                    {imp.status === "applied" && (imp.beforeValue || imp.afterValue) && (
                      <div className="flex items-center gap-2 mt-2 text-xs">
                        {imp.beforeValue && (
                          <span className="text-red-400 line-through">{imp.beforeValue}</span>
                        )}
                        {imp.beforeValue && imp.afterValue && (
                          <span className="text-gray-600">→</span>
                        )}
                        {imp.afterValue && (
                          <span className="text-green-400">{imp.afterValue}</span>
                        )}
                      </div>
                    )}
                  </div>
                  {imp.status === "proposed" && (
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => handleImprovementAction(imp.id, "approve")}
                        className="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
                      >
                        승인
                      </button>
                      <button
                        onClick={() => handleImprovementAction(imp.id, "reject")}
                        className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                      >
                        거절
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* F) Feedback Timeline */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">피드백 타임라인</h3>
        {feedbackEntries.length === 0 ? (
          <p className="text-gray-500 text-sm">피드백이 없습니다</p>
        ) : (
          <div className="relative">
            {/* Timeline connector line */}
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-700" />

            <div className="space-y-4">
              {feedbackEntries.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 relative">
                  {/* Timeline dot */}
                  <div className="w-[15px] h-[15px] rounded-full bg-amber-500/30 border-2 border-amber-500/60 flex-shrink-0 mt-0.5 z-10" />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StarRating rating={entry.rating} readonly size="sm" />
                      <span className="text-xs font-mono text-gray-400">{entry.agentId}</span>
                      <span className="text-[10px] text-gray-500">
                        {new Date(entry.createdAt).toLocaleString("ko-KR")}
                      </span>
                    </div>
                    {entry.comment && (
                      <p className="text-xs text-gray-400 mt-1">{entry.comment}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
