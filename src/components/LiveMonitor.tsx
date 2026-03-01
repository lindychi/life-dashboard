"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { relativeTime } from "@/lib/format-utils";
import { STATUS_STYLES } from "@/lib/ui-constants";
import LiveOutputRenderer from "@/components/LiveOutputRenderer";
import type { HistoryEntry } from "@/lib/frontend-types";

/**
 * Live agent status entry as received from the relay status API.
 * Re-exported here for use in AgentDashboard props.
 */
export interface AgentStatusEntry {
  id: string;
  name: string;
  status: "running" | "idle" | "waiting" | "error" | "stale";
  currentTask?: string;
  updatedAt: string;
  liveOutput?: {
    lastChunk: string;
    totalChars: number;
    lastActivityAt: string;
    chunksReceived: number;
    recentEvents?: Array<{
      type: "tool_use" | "text" | "health" | "warning" | "stderr";
      timestamp: string;
      tool?: string;
      target?: string;
      content?: string;
    }>;
  };
}

interface LiveMonitorProps {
  agentStatuses: AgentStatusEntry[];
  historyData: Record<string, HistoryEntry[]>;
  agentMap: Record<string, { emoji: string; name: string }>;
}

// STATUS_STYLES imported from @/lib/ui-constants


export default function LiveMonitor({ agentStatuses, historyData, agentMap }: LiveMonitorProps) {
  const activeAgents = agentStatuses.filter((a) => a.status === "running");
  const staleAgents = agentStatuses.filter((a) => a.status === "stale");
  const otherAgents = agentStatuses.filter((a) => a.status !== "running" && a.status !== "stale");

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
    <div className="bg-gray-800/50 rounded-xl border border-gray-700 p-3 sm:p-4 lg:p-3 mb-4 sm:mb-6 lg:mb-3">
      <div className="flex items-center justify-between mb-3 sm:mb-4 lg:mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <h3 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
            실시간 모니터
          </h3>
          <span className="text-[10px] sm:text-xs text-gray-500">
            {activeAgents.length} 활성 / {agentStatuses.length} 전체
          </span>
        </div>
      </div>

      {/* Active agents - expanded cards */}
      {activeAgents.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3 lg:gap-2 mb-3 lg:mb-2">
          {activeAgents.map((agent) => {
            const display = getDisplay(agent.id);
            const logs = getRecentLogs(agent.id);
            const style = STATUS_STYLES[agent.status];

            return (
              <div
                key={agent.id}
                className="bg-gray-900 rounded-lg border border-green-500/30 p-2.5 sm:p-3 lg:p-2"
              >
                {/* Header */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg sm:text-xl">{display.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <span className="text-xs sm:text-sm font-bold text-white truncate">
                        {display.name}
                      </span>
                      <span className="flex items-center gap-1 flex-shrink-0">
                        <span
                          className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${style.bg} ${
                            style.pulse ? "animate-pulse" : ""
                          }`}
                        />
                        <span className="text-[10px] text-green-400 hidden sm:inline">{style.label}</span>
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-600 flex-shrink-0">
                    {relativeTime(agent.updatedAt)}
                  </span>
                </div>

                {/* Current task */}
                {agent.currentTask && (
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded px-2 py-1.5 mb-2">
                    <p className="text-[11px] sm:text-xs text-blue-300 line-clamp-2 break-words">{agent.currentTask}</p>
                  </div>
                )}

                {/* Live output (real-time) — takes priority over history logs */}
                {agent.liveOutput && (agent.liveOutput.recentEvents?.length || agent.liveOutput.lastChunk) ? (
                  <div className="bg-gray-800/80 rounded px-2 py-1.5 font-mono text-[10px] sm:text-[11px] overflow-hidden">
                    <div className="max-h-24 sm:max-h-28 overflow-y-auto overflow-x-hidden space-y-0.5">
                      <LiveOutputRenderer
                        recentEvents={agent.liveOutput.recentEvents}
                        lastChunk={agent.liveOutput.lastChunk}
                        maxItems={8}
                        maxTextChars={120}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[10px] text-gray-600">
                      <span>{agent.liveOutput.chunksReceived} chunks</span>
                      <span>{relativeTime(agent.liveOutput.lastActivityAt)}</span>
                    </div>
                  </div>
                ) : logs.length > 0 ? (
                  /* Fallback to recent history logs */
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
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Stale agents - previously running but gateway disconnected */}
      {staleAgents.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] text-amber-500 uppercase tracking-wider font-medium">
              연결 끊김 ({staleAgents.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {staleAgents.map((agent) => {
              const display = getDisplay(agent.id);
              return (
                <div
                  key={agent.id}
                  className="flex items-center gap-1.5 bg-amber-900/20 rounded-lg px-2.5 py-1.5 border border-amber-700/30"
                >
                  <span className="text-sm opacity-60">{display.emoji}</span>
                  <span className="text-xs text-amber-400/70">{display.name}</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-600" title="비활성" />
                  <span className="text-[10px] text-gray-600">{relativeTime(agent.updatedAt)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Other agents - compact row */}
      {otherAgents.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {otherAgents.map((agent) => {
            const display = getDisplay(agent.id);
            const style = STATUS_STYLES[agent.status] ?? STATUS_STYLES.idle;

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
