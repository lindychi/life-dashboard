"use client";

import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { relativeTime } from "@/lib/format-utils";

// ===== Types =====
interface CronJob {
  id: string;
  name: string;
  description: string | null;
  schedule: string;
  handlerType: string;
  handlerConfig: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CronJobRun {
  id: string;
  cronJobId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "failed";
  result: Record<string, unknown> | null;
  error: string | null;
}

// ===== Helpers =====
function cronToHuman(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const dayNames: Record<string, string> = {
    "0": "일요일",
    "1": "월요일",
    "2": "화요일",
    "3": "수요일",
    "4": "목요일",
    "5": "금요일",
    "6": "토요일",
    "7": "일요일",
  };

  const monthNames: Record<string, string> = {
    "1": "1월",
    "2": "2월",
    "3": "3월",
    "4": "4월",
    "5": "5월",
    "6": "6월",
    "7": "7월",
    "8": "8월",
    "9": "9월",
    "10": "10월",
    "11": "11월",
    "12": "12월",
  };

  function formatTime(h: string, m: string): string {
    const hourNum = parseInt(h, 10);
    const minNum = parseInt(m, 10);
    const period = hourNum < 12 ? "오전" : "오후";
    const displayHour = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum;
    if (minNum === 0) return `${period} ${displayHour}시`;
    return `${period} ${displayHour}시 ${minNum}분`;
  }

  // Every N minutes: */N * * * *
  const everyMinMatch = minute.match(/^\*\/(\d+)$/);
  if (everyMinMatch && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const n = parseInt(everyMinMatch[1], 10);
    return `매 ${n}분마다`;
  }

  // Every N hours: 0 */N * * *
  const everyHourMatch = hour.match(/^\*\/(\d+)$/);
  if (everyHourMatch && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const n = parseInt(everyHourMatch[1], 10);
    return `매 ${n}시간마다`;
  }

  // Every minute: * * * * *
  if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return "매분";
  }

  // Every hour at specific minute: M * * * *
  if (/^\d+$/.test(minute) && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const m = parseInt(minute, 10);
    return m === 0 ? "매시 정각" : `매시 ${m}분`;
  }

  // Specific time patterns
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    const timeStr = formatTime(hour, minute);

    // Daily: M H * * *
    if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      return `매일 ${timeStr}`;
    }

    // Specific day of week: M H * * D
    if (dayOfMonth === "*" && month === "*" && /^\d$/.test(dayOfWeek)) {
      const dayName = dayNames[dayOfWeek] || dayOfWeek;
      return `매주 ${dayName} ${timeStr}`;
    }

    // Multiple days of week: M H * * D,D,...
    if (dayOfMonth === "*" && month === "*" && /^[\d,]+$/.test(dayOfWeek)) {
      const days = dayOfWeek.split(",").map((d) => dayNames[d] || d).join(", ");
      return `매주 ${days} ${timeStr}`;
    }

    // Weekdays: M H * * 1-5
    if (dayOfMonth === "*" && month === "*" && dayOfWeek === "1-5") {
      return `평일 ${timeStr}`;
    }

    // Specific day of month: M H D * *
    if (/^\d+$/.test(dayOfMonth) && month === "*" && dayOfWeek === "*") {
      return `매월 ${dayOfMonth}일 ${timeStr}`;
    }

    // Specific month and day: M H D M *
    if (/^\d+$/.test(dayOfMonth) && /^\d+$/.test(month) && dayOfWeek === "*") {
      const monthName = monthNames[month] || `${month}월`;
      return `매년 ${monthName} ${dayOfMonth}일 ${timeStr}`;
    }
  }

  return expression;
}

// ===== Sub-components =====

function StatusBadge({ job, runs }: { job: CronJob; runs: CronJobRun[] }) {
  const hasRunning = runs.some((r) => r.status === "running");

  if (hasRunning) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
        실행중
      </span>
    );
  }

  if (job.enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
        활성
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-gray-500/20 text-gray-400 border border-gray-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
      일시정지
    </span>
  );
}

function ToggleSwitch({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
        enabled ? "bg-blue-600" : "bg-gray-600"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          enabled ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function RunStatusBadge({ status }: { status: CronJobRun["status"] }) {
  if (status === "success") {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
        성공
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
        실패
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
      실행중
    </span>
  );
}

function RunResultDetail({
  run,
  handlerType,
}: {
  run: CronJobRun;
  handlerType: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (run.error) {
    return (
      <div className="mt-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
        <p className="text-xs text-red-400 font-medium mb-1">오류</p>
        <p className="text-sm text-red-300 break-words">{run.error}</p>
      </div>
    );
  }

  if (!run.result) return null;

  const result = run.result;

  // If result has a message, show it as summary
  const message = typeof result.message === "string" ? result.message : null;

  // Check if there's structured data to render
  const data = result.data as Record<string, unknown> | undefined;
  const hasDetailData = data && typeof data === "object";

  // Check for markdown content in data
  const markdownContent = hasDetailData
    ? typeof data.briefing === "string"
      ? data.briefing
      : typeof data.report === "string"
        ? data.report
        : typeof data.content === "string"
          ? data.content
          : typeof data.markdown === "string"
            ? data.markdown
            : null
    : null;

  const isDailyAssistant = handlerType === "daily-assistant";
  const isAgentImprovement = handlerType === "agent-improvement";

  return (
    <div className="mt-2 space-y-2">
      {message && (
        <p className="text-sm text-gray-300">{message}</p>
      )}

      {hasDetailData && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            {expanded ? "결과 접기 ▲" : "결과 상세보기 ▼"}
          </button>

          {expanded && (
            <div className="mt-2 p-4 rounded-lg bg-gray-900/80 border border-gray-700">
              {markdownContent ? (
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {markdownContent}
                  </ReactMarkdown>
                </div>
              ) : isDailyAssistant && data ? (
                <DailyAssistantResult data={data} />
              ) : isAgentImprovement && data ? (
                <AgentImprovementResult data={data} />
              ) : (
                <JsonTreeView data={data} />
              )}
            </div>
          )}
        </div>
      )}

      {!hasDetailData && !message && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            {expanded ? "JSON 접기 ▲" : "JSON 보기 ▼"}
          </button>
          {expanded && (
            <div className="mt-2 p-3 rounded-lg bg-gray-900/80 border border-gray-700">
              <JsonTreeView data={result} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DailyAssistantResult({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-3">
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
            {key}
          </h4>
          {typeof value === "string" ? (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {value}
              </ReactMarkdown>
            </div>
          ) : (
            <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(value, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function AgentImprovementResult({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-3">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="border-b border-gray-700/50 pb-3 last:border-0 last:pb-0">
          <h4 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">
            {key.replace(/_/g, " ")}
          </h4>
          {typeof value === "string" ? (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {value}
              </ReactMarkdown>
            </div>
          ) : Array.isArray(value) ? (
            <ul className="list-disc list-inside space-y-1">
              {value.map((item, i) => (
                <li key={i} className="text-sm text-gray-300">
                  {typeof item === "string" ? item : JSON.stringify(item)}
                </li>
              ))}
            </ul>
          ) : (
            <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(value, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function JsonTreeView({ data }: { data: Record<string, unknown> }) {
  return (
    <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
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
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

// ===== Main Component =====
export default function CronJobsPanel() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [jobRuns, setJobRuns] = useState<Record<string, CronJobRun[]>>({});
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());
  const [togglingJobs, setTogglingJobs] = useState<Set<string>>(new Set());

  // Fetch all jobs
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/cron/jobs");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.jobs) {
        setJobs(data.jobs);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to fetch cron jobs:", err);
      setError(err instanceof Error ? err.message : "크론 작업 목록을 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch runs for a specific job
  const fetchRuns = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/cron/jobs/${jobId}/runs?limit=20`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.runs) {
        setJobRuns((prev) => ({ ...prev, [jobId]: data.runs }));
      }
    } catch (err) {
      console.error(`Failed to fetch runs for job ${jobId}:`, err);
    }
  }, []);

  // Poll jobs every 10 seconds
  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 10_000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  // Poll runs for expanded job every 5 seconds
  useEffect(() => {
    if (!expandedJobId) return;
    fetchRuns(expandedJobId);
    const interval = setInterval(() => fetchRuns(expandedJobId), 5_000);
    return () => clearInterval(interval);
  }, [expandedJobId, fetchRuns]);

  // Toggle job enabled/disabled (optimistic update)
  const handleToggle = useCallback(
    async (job: CronJob) => {
      const newEnabled = !job.enabled;

      // Optimistic update
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, enabled: newEnabled } : j))
      );
      setTogglingJobs((prev) => new Set(prev).add(job.id));

      try {
        const res = await fetch(`/api/cron/jobs/${job.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: newEnabled }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.job) {
          setJobs((prev) =>
            prev.map((j) => (j.id === job.id ? data.job : j))
          );
        }
      } catch (err) {
        console.error("Failed to toggle job:", err);
        // Revert on error
        setJobs((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, enabled: !newEnabled } : j))
        );
      } finally {
        setTogglingJobs((prev) => {
          const next = new Set(prev);
          next.delete(job.id);
          return next;
        });
      }
    },
    []
  );

  // Run job now
  const handleRunNow = useCallback(
    async (jobId: string) => {
      setRunningJobs((prev) => new Set(prev).add(jobId));

      try {
        const res = await fetch(`/api/cron/jobs/${jobId}/run`, {
          method: "POST",
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        // Refresh jobs and runs after execution
        await Promise.all([fetchJobs(), fetchRuns(jobId)]);
      } catch (err) {
        console.error("Failed to run job:", err);
        alert(
          `작업 실행 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`
        );
      } finally {
        setRunningJobs((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
      }
    },
    [fetchJobs, fetchRuns]
  );

  // Toggle expanded job row
  const handleRowClick = useCallback(
    (jobId: string) => {
      setExpandedJobId((prev) => (prev === jobId ? null : jobId));
    },
    []
  );

  // Loading state
  if (loading) {
    return (
      <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 text-center">
        <div className="flex items-center justify-center gap-3">
          <LoadingSpinner />
          <span className="text-gray-400">크론 작업을 불러오는 중...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error && jobs.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl p-8 border border-red-500/30 text-center">
        <p className="text-red-400 mb-2">크론 작업을 불러오지 못했습니다</p>
        <p className="text-gray-500 text-sm">{error}</p>
        <button
          onClick={() => {
            setLoading(true);
            fetchJobs();
          }}
          className="mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          다시 시도
        </button>
      </div>
    );
  }

  // Empty state
  if (jobs.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 text-center">
        <p className="text-gray-500 text-lg">등록된 크론 작업이 없습니다</p>
        <p className="text-gray-600 text-sm mt-1">
          크론 작업이 등록되면 여기에 표시됩니다
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">
          예약 작업
        </h2>
        <span className="text-xs text-gray-500">
          {jobs.filter((j) => j.enabled).length}/{jobs.length} 활성
        </span>
      </div>

      {/* Job Table */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        {/* Table Header - hidden on mobile */}
        <div className="hidden lg:grid lg:grid-cols-[1fr_180px_100px_120px_120px_140px] gap-4 px-4 py-3 border-b border-gray-700 text-xs text-gray-500 font-medium uppercase tracking-wider">
          <div>이름</div>
          <div>스케줄</div>
          <div>상태</div>
          <div>마지막 실행</div>
          <div>다음 실행</div>
          <div className="text-right">액션</div>
        </div>

        {/* Job Rows */}
        <div className="divide-y divide-gray-700/50">
          {jobs.map((job) => {
            const isExpanded = expandedJobId === job.id;
            const runs = jobRuns[job.id] || [];
            const isRunning = runningJobs.has(job.id);
            const isToggling = togglingJobs.has(job.id);

            return (
              <div key={job.id}>
                {/* Job Row */}
                <div
                  role="button"
                  tabIndex={0}
                  className={`px-4 py-3 transition-colors cursor-pointer hover:bg-gray-700/30 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none focus-visible:ring-inset ${
                    isExpanded ? "bg-gray-700/20" : ""
                  }`}
                  onClick={() => handleRowClick(job.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleRowClick(job.id);
                    }
                  }}
                >
                  {/* Desktop layout */}
                  <div className="hidden lg:grid lg:grid-cols-[1fr_180px_100px_120px_120px_140px] gap-4 items-center">
                    {/* Name */}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {job.name}
                      </p>
                      {job.description && (
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          {job.description}
                        </p>
                      )}
                    </div>

                    {/* Schedule */}
                    <div className="min-w-0">
                      <p className="text-sm text-gray-300 truncate">
                        {cronToHuman(job.schedule)}
                      </p>
                      <p className="text-xs text-gray-600 font-mono mt-0.5">
                        {job.schedule}
                      </p>
                    </div>

                    {/* Status */}
                    <div>
                      <StatusBadge job={job} runs={runs} />
                    </div>

                    {/* Last Run */}
                    <div>
                      <p className="text-xs text-gray-400">
                        {job.lastRunAt ? relativeTime(job.lastRunAt) : "-"}
                      </p>
                    </div>

                    {/* Next Run */}
                    <div>
                      <p className="text-xs text-gray-400">
                        {job.nextRunAt && job.enabled
                          ? relativeTime(job.nextRunAt)
                          : "-"}
                      </p>
                    </div>

                    {/* Actions */}
                    <div
                      className="flex items-center justify-end gap-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ToggleSwitch
                        enabled={job.enabled}
                        onChange={() => handleToggle(job)}
                        disabled={isToggling}
                      />
                      <button
                        onClick={() => handleRunNow(job.id)}
                        disabled={isRunning}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                      >
                        {isRunning ? (
                          <>
                            <LoadingSpinner />
                            <span>실행중...</span>
                          </>
                        ) : (
                          <span>지금 실행</span>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Mobile layout */}
                  <div className="lg:hidden space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-white truncate">
                          {job.name}
                        </p>
                        {job.description && (
                          <p className="text-xs text-gray-500 truncate mt-0.5">
                            {job.description}
                          </p>
                        )}
                      </div>
                      <StatusBadge job={job} runs={runs} />
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-gray-300">
                          {cronToHuman(job.schedule)}
                        </p>
                        <p className="text-[10px] text-gray-600 font-mono">
                          {job.schedule}
                        </p>
                      </div>
                      <div className="text-right text-xs text-gray-500">
                        {job.lastRunAt && (
                          <p>마지막: {relativeTime(job.lastRunAt)}</p>
                        )}
                        {job.nextRunAt && job.enabled && (
                          <p>다음: {relativeTime(job.nextRunAt)}</p>
                        )}
                      </div>
                    </div>

                    <div
                      className="flex items-center gap-3 pt-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ToggleSwitch
                        enabled={job.enabled}
                        onChange={() => handleToggle(job)}
                        disabled={isToggling}
                      />
                      <button
                        onClick={() => handleRunNow(job.id)}
                        disabled={isRunning}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                      >
                        {isRunning ? (
                          <>
                            <LoadingSpinner />
                            <span>실행중...</span>
                          </>
                        ) : (
                          <span>지금 실행</span>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded Run History */}
                {isExpanded && (
                  <div className="px-4 pb-4 bg-gray-900/50">
                    <div className="border-t border-gray-700/50 pt-3">
                      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                        실행 기록
                      </h3>

                      {runs.length === 0 ? (
                        <p className="text-sm text-gray-600 py-3">
                          아직 실행 기록이 없습니다
                        </p>
                      ) : (
                        <div className="space-y-2 max-h-[500px] overflow-y-auto">
                          {runs.map((run) => (
                            <div
                              key={run.id}
                              className="bg-gray-800/80 rounded-lg p-3 border border-gray-700/50"
                            >
                              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                                <RunStatusBadge status={run.status} />
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
                                    <span>
                                      시작: {relativeTime(run.startedAt)}
                                    </span>
                                    {run.finishedAt && (
                                      <span>
                                        종료: {relativeTime(run.finishedAt)}
                                      </span>
                                    )}
                                    {run.finishedAt && (
                                      <span className="text-gray-600">
                                        (
                                        {Math.round(
                                          (new Date(run.finishedAt).getTime() -
                                            new Date(run.startedAt).getTime()) /
                                            1000
                                        )}
                                        초)
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <RunResultDetail
                                run={run}
                                handlerType={job.handlerType}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
