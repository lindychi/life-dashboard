"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { relativeTime } from "@/lib/format-utils";

interface AgentStatusEntry {
  id: string;
  name: string;
  status: "running" | "idle" | "waiting" | "error";
  currentTask?: string;
  updatedAt: string;
}

interface HistoryEntry {
  id: string;
  agentId: string;
  type: string;
  content: string;
  timestamp: string;
}

interface LiveMonitorProps {
  agentStatuses: AgentStatusEntry[];
  historyData: Record<string, HistoryEntry[]>;
  agentMap: Record<string, { emoji: string; name: string }>;
}

const STATUS_STYLES: Record<string, { bg: string; pulse: boolean; label: string }> = {
  running: { bg: "bg-green-500", pulse: true, label: "실행 중" },
  idle: { bg: "bg-gray-500", pulse: false, label: "대기" },
  waiting: { bg: "bg-yellow-500", pulse: true, label: "대기 중" },
  error: { bg: "bg-red-500", pulse: false, label: "에러" },
};

export default function LiveMonitor({ agentStatuses, historyData, agentMap }: LiveMonitorProps) {
  const activeAgents = agentStatuses.filter((a) => a.status === "running");
  const otherAgents = agentStatuses.filter((a) => a.status !== "running");

  // Get recent log entries for a specific agent (newest first, max 3)
  const getRecentLogs = useMemo(() => {
    return (agentId: string): HistoryEntry[] => {
      const allEntries = Object.values(historyData).flat();
      return allEntries
        .filter((e) => e.agentId === agentId)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 3);
    };
  }, [historyData]);

  const getDisplay = (agentId: string) =>
    agentMap[agentId] || { emoji: "\u{1F916}", name: agentId };

  if (agentStatuses.length === 0) {
    return null;
  }

  return (
    <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            실시간 모니터
          </h3>
          <span className="text-xs text-gray-500">
            {activeAgents.length} 활성 / {agentStatuses.length} 전체
          </span>
        </div>
      </div>

      {/* Active agents - expanded cards */}
      {activeAgents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-3">
          {activeAgents.map((agent) => {
            const display = getDisplay(agent.id);
            const logs = getRecentLogs(agent.id);
            const style = STATUS_STYLES[agent.status];

            return (
              <div
                key={agent.id}
                className="bg-gray-900 rounded-lg border border-green-500/30 p-3"
              >
                {/* Header */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{display.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white truncate">
                        {display.name}
                      </span>
                      <span className="flex items-center gap-1">
                        <span
                          className={`w-2 h-2 rounded-full ${style.bg} ${
                            style.pulse ? "animate-pulse" : ""
                          }`}
                        />
                        <span className="text-[10px] text-green-400">{style.label}</span>
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-600">
                    {relativeTime(agent.updatedAt)}
                  </span>
                </div>

                {/* Current task */}
                {agent.currentTask && (
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded px-2 py-1.5 mb-2">
                    <p className="text-xs text-blue-300 truncate">{agent.currentTask}</p>
                  </div>
                )}

                {/* Recent logs */}
                {logs.length > 0 && (
                  <div className="space-y-1">
                    {logs.map((log) => (
                      <div
                        key={log.id}
                        className="text-xs text-gray-400 bg-gray-800/80 rounded px-2 py-1"
                      >
                        <div className="prose prose-xs prose-invert max-w-none line-clamp-2 break-words [&>*]:m-0 [&>*]:text-xs">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {log.content.length > 150
                              ? log.content.slice(0, 150) + "..."
                              : log.content}
                          </ReactMarkdown>
                        </div>
                        <span className="text-[10px] text-gray-600 mt-0.5 block">
                          {relativeTime(log.timestamp)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Other agents - compact row */}
      {otherAgents.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {otherAgents.map((agent) => {
            const display = getDisplay(agent.id);
            const style = STATUS_STYLES[agent.status] || STATUS_STYLES.idle;

            return (
              <div
                key={agent.id}
                className="flex items-center gap-1.5 bg-gray-900/50 rounded-lg px-2.5 py-1.5 border border-gray-700/50"
              >
                <span className="text-sm">{display.emoji}</span>
                <span className="text-xs text-gray-400">{display.name}</span>
                <span
                  className={`w-1.5 h-1.5 rounded-full ${style.bg} ${
                    style.pulse ? "animate-pulse" : ""
                  }`}
                  title={style.label}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
