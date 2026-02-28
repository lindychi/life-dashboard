"use client";

import React, { useMemo, useState } from "react";
import AgentSection from "@/components/AgentSection";
import HistoryPanel from "@/components/HistoryPanel";
import LiveMonitor from "@/components/LiveMonitor";
import PendingRepliesBanner from "@/components/PendingRepliesBanner";
import FileAttachment from "@/components/FileAttachment";
import type { AttachedFile } from "@/components/FileAttachment";
import type { TaskStack, AgentConfig, AgentRuntime, HistoryEntry } from "@/lib/frontend-types";
import { sendAgentReply } from "@/lib/agent-actions";

interface AgentDashboardProps {
  agents: AgentRuntime[];
  historyData: Record<string, HistoryEntry[]>;
  agentMap: Record<string, { emoji: string; name: string }>;
  liveAgentStatuses: Array<{
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
  }>;
  pendingReplies: HistoryEntry[];
  orchestrateInput: string;
  isOrchestrating: boolean;
  dbConnected: boolean;
  pendingInstructions: Record<string, Array<{ id: string; content: string; createdAt: string; position: number }>>;
  pendingCount: number;
  queuedCommands: Record<string, Array<{ id: string; type: string; payload: Record<string, unknown>; createdAt: string; status: string }>>;
  queuedCommandsCount: number;
  queuedNotification: string | null;
  attachedFiles: AttachedFile[];
  uploadProgress: { current: number; total: number } | null;
  onOrchestrateInputChange: (value: string) => void;
  onOrchestrate: (e: React.FormEvent) => void;
  onFilesChange: (files: AttachedFile[]) => void;
  onAddTask: (agentId: string, task: string) => void;
  onStartTask: (agentId: string, task: string) => void;
  onPendingReply: (entry: HistoryEntry, replyText: string) => Promise<void>;
}

export default function AgentDashboard({
  agents,
  historyData,
  agentMap,
  liveAgentStatuses,
  pendingReplies,
  orchestrateInput,
  isOrchestrating,
  dbConnected,
  pendingInstructions,
  pendingCount,
  queuedCommands,
  queuedCommandsCount,
  queuedNotification,
  attachedFiles,
  uploadProgress,
  onOrchestrateInputChange,
  onOrchestrate,
  onFilesChange,
  onAddTask,
  onStartTask,
  onPendingReply,
}: AgentDashboardProps) {
  const [viewMode, setViewMode] = useState<"agents" | "timeline">("agents");
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | "dev" | "business" | "ops"
  >("all");

  // Handle reply to history entry (uses shared sendAgentReply utility)
  const handleReplyToEntry = async (
    entry: HistoryEntry,
    replyText: string
  ) => {
    try {
      const displayName = agentMap[entry.agentId]?.name || entry.agentId;
      await sendAgentReply(entry.agentId, entry.content, replyText, displayName);
    } catch (error) {
      console.error("Failed to send reply:", error);
      alert(`답신 전송 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    }
  };

  // Sort and filter agents
  const { activeAgents, dormantAgents, activeAgentsByCategory } = useMemo(() => {
    const filtered =
      categoryFilter === "all"
        ? agents
        : agents.filter((a) => a.config.category === categoryFilter);

    const active: AgentRuntime[] = [];
    const dormant: AgentRuntime[] = [];

    filtered.forEach((agent) => {
      const hasHistory = historyData[agent.config.id]?.length > 0;
      if (agent.status !== "idle" || hasHistory) {
        active.push(agent);
      } else {
        dormant.push(agent);
      }
    });

    // Sort active: running first, then by most recent history, then alphabetical
    active.sort((a, b) => {
      if (a.status === "running" && b.status !== "running") return -1;
      if (a.status !== "running" && b.status === "running") return 1;

      const aHistory = historyData[a.config.id] || [];
      const bHistory = historyData[b.config.id] || [];

      if (aHistory.length > 0 && bHistory.length > 0) {
        const aTime = new Date(aHistory[0].timestamp).getTime();
        const bTime = new Date(bHistory[0].timestamp).getTime();
        if (aTime !== bTime) return bTime - aTime;
      } else if (aHistory.length > 0) return -1;
      else if (bHistory.length > 0) return 1;

      return a.config.name.localeCompare(b.config.name);
    });

    // Sort dormant alphabetically
    dormant.sort((a, b) => a.config.name.localeCompare(b.config.name));

    // Group active agents by category
    const byCategory: Record<string, AgentRuntime[]> = {
      dev: [],
      business: [],
      ops: [],
    };
    active.forEach((agent) => {
      const category = agent.config.category || "ops";
      if (byCategory[category]) {
        byCategory[category].push(agent);
      }
    });

    return { activeAgents: active, dormantAgents: dormant, activeAgentsByCategory: byCategory };
  }, [agents, historyData, categoryFilter]);

  return (
    <div className="space-y-6 lg:space-y-4">
      {/* Orchestrate Bar */}
      <div className="bg-gray-800 rounded-xl p-3 sm:p-5 lg:p-3 border border-blue-500/20">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 sm:mb-3 lg:mb-2">전체 지시</h2>
        <form onSubmit={onOrchestrate} className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <input
              type="text"
              value={orchestrateInput}
              onChange={(e) => onOrchestrateInputChange(e.target.value)}
              placeholder="전체 지시를 입력하세요..."
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 lg:py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 min-h-[44px] lg:min-h-0 text-sm sm:text-base"
            />
            <button
              type="submit"
              disabled={!orchestrateInput.trim() || uploadProgress !== null}
              className="w-full sm:w-auto px-6 lg:px-4 py-3 lg:py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 min-h-[44px] lg:min-h-0 shrink-0"
            >
              {uploadProgress !== null ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>업로드중 {uploadProgress.current}/{uploadProgress.total}</span>
                </>
              ) : isOrchestrating ? (
                <>
                  <span>📋</span>
                  <span>큐에 추가</span>
                </>
              ) : (
                <>
                  <span>🎯</span>
                  <span>전체 지시</span>
                </>
              )}
            </button>
          </div>

          {/* File Attachment */}
          <FileAttachment
            attachedFiles={attachedFiles}
            onFilesChange={onFilesChange}
            disabled={uploadProgress !== null}
          />
        </form>

        {/* Queued notification */}
        {queuedNotification && (
          <div className="mt-3 flex items-center gap-2 text-green-400 text-sm">
            <span>✅</span>
            <span>{queuedNotification}</span>
          </div>
        )}

        {/* Pending Instructions Queue */}
        {pendingCount > 0 && (
          <div className="mt-3 sm:mt-4 lg:mt-2 bg-gray-900/50 rounded-lg p-2.5 sm:p-3 border border-gray-700/50">
            <div className="text-xs text-gray-400 font-medium mb-2">
              📋 대기중인 지시 ({pendingCount}개)
            </div>
            <div className="space-y-1">
              {Object.entries(pendingInstructions).map(([agentId, instructions]) =>
                instructions.map((inst) => (
                  <div key={inst.id} className="flex items-center gap-2 text-xs sm:text-sm">
                    <span className="text-gray-500 text-xs w-5 flex-shrink-0">#{inst.position}</span>
                    <span className="text-gray-300 truncate">{inst.content}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Queued Commands */}
        {queuedCommandsCount > 0 && (
          <div className="mt-3 sm:mt-4 lg:mt-2 bg-gray-900/50 rounded-lg p-2.5 sm:p-3 border border-amber-700/30">
            <div className="text-xs text-amber-400 font-medium mb-2">
              ⏳ 대기중인 명령 ({queuedCommandsCount}개)
            </div>
            <div className="space-y-1.5 sm:space-y-1">
              {Object.entries(queuedCommands).map(([agentId, commands]) =>
                commands.map((cmd) => (
                  <div key={cmd.id} className="flex flex-wrap sm:flex-nowrap items-center gap-1 sm:gap-2 text-xs">
                    <span className="text-amber-500/70 font-mono flex-shrink-0">{cmd.type}</span>
                    <span className="text-gray-400 flex-shrink-0">→ {agentId}</span>
                    <span className="text-gray-300 truncate w-full sm:w-auto">
                      {(cmd.payload?.task as string) || (cmd.payload?.message as string) || cmd.type}
                    </span>
                    <span className="text-gray-600 ml-auto flex-shrink-0">
                      {new Date(cmd.createdAt).toLocaleTimeString("ko-KR")}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {isOrchestrating && (
          <div className="mt-4 flex items-center gap-2 text-blue-400">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" />
              <span
                className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                style={{ animationDelay: "0.1s" }}
              />
              <span
                className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                style={{ animationDelay: "0.2s" }}
              />
            </div>
            <span className="text-sm">에이전트 팀이 작업 중입니다...</span>
          </div>
        )}
        {!dbConnected && (
          <div className="mt-3 flex items-center gap-2 text-yellow-400 text-sm">
            <span>⚠️</span>
            <span>DB 미연결 상태 — 명령은 전달되지만 히스토리가 저장되지 않습니다</span>
          </div>
        )}
      </div>

      {/* Pending Replies Banner */}
      {pendingReplies.length > 0 && (
        <PendingRepliesBanner
          pendingReplies={pendingReplies}
          agentMap={agentMap}
          onReply={onPendingReply}
        />
      )}

      {/* Live Monitor */}
      {liveAgentStatuses.length > 0 && (
        <LiveMonitor
          agentStatuses={liveAgentStatuses}
          historyData={historyData}
          agentMap={agentMap}
        />
      )}

      {/* View Mode Toggle */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 -mb-1">
        <div className="inline-flex rounded-lg bg-gray-800 p-1 flex-shrink-0" role="tablist">
          <button
            role="tab"
            aria-selected={viewMode === "agents"}
            onClick={() => setViewMode("agents")}
            className={`px-3 sm:px-4 py-2 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900 min-h-[38px] sm:min-h-0 ${
              viewMode === "agents"
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            에이전트
          </button>
          <button
            role="tab"
            aria-selected={viewMode === "timeline"}
            onClick={() => setViewMode("timeline")}
            className={`px-3 sm:px-4 py-2 sm:py-2 rounded-md text-xs sm:text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900 min-h-[38px] sm:min-h-0 ${
              viewMode === "timeline"
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            타임라인
          </button>
        </div>

        {/* Category Filter (only in agent view mode) */}
        {viewMode === "agents" && (
          <div className="inline-flex rounded-lg bg-gray-800 p-1 flex-shrink-0">
            {(["all", "dev", "business", "ops"] as const).map((cat) => {
              const labels = { all: "전체", dev: "개발", business: "경영", ops: "운영" };
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-md text-[11px] sm:text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900 min-h-[34px] sm:min-h-0 ${
                    categoryFilter === cat
                      ? "bg-gray-700 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {labels[cat]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Agent View Mode */}
      {viewMode === "agents" && (
        <div className="space-y-4 lg:space-y-3">
          {/* Active Agent Sections - Grouped by Category */}
          {categoryFilter === "all" ? (
            <>
              {/* Dev Category */}
              {activeAgentsByCategory.dev.length > 0 && (
                <div className="space-y-3 lg:space-y-2">
                  <h3 className="text-xs sm:text-sm font-semibold text-gray-400 uppercase tracking-wider px-1 flex items-center gap-2">
                    <span>🛠</span> <span>Dev</span>
                  </h3>
                  {activeAgentsByCategory.dev.map((agent) => (
                    <AgentSection
                      key={agent.config.id}
                      agent={agent}
                      historyEntries={historyData[agent.config.id] || []}
                      agentMap={agentMap}
                      onAddTask={onAddTask}
                      onStartTask={onStartTask}
                      onReplyToEntry={handleReplyToEntry}
                      defaultExpanded={agent.status === "running"}
                    />
                  ))}
                </div>
              )}

              {/* Business Category */}
              {activeAgentsByCategory.business.length > 0 && (
                <div className="space-y-3 lg:space-y-2">
                  <h3 className="text-xs sm:text-sm font-semibold text-gray-400 uppercase tracking-wider px-1 flex items-center gap-2">
                    <span>💼</span> <span>Business</span>
                  </h3>
                  {activeAgentsByCategory.business.map((agent) => (
                    <AgentSection
                      key={agent.config.id}
                      agent={agent}
                      historyEntries={historyData[agent.config.id] || []}
                      agentMap={agentMap}
                      onAddTask={onAddTask}
                      onStartTask={onStartTask}
                      onReplyToEntry={handleReplyToEntry}
                      defaultExpanded={agent.status === "running"}
                    />
                  ))}
                </div>
              )}

              {/* Ops Category */}
              {activeAgentsByCategory.ops.length > 0 && (
                <div className="space-y-3 lg:space-y-2">
                  <h3 className="text-xs sm:text-sm font-semibold text-gray-400 uppercase tracking-wider px-1 flex items-center gap-2">
                    <span>⚙️</span> <span>Ops</span>
                  </h3>
                  {activeAgentsByCategory.ops.map((agent) => (
                    <AgentSection
                      key={agent.config.id}
                      agent={agent}
                      historyEntries={historyData[agent.config.id] || []}
                      agentMap={agentMap}
                      onAddTask={onAddTask}
                      onStartTask={onStartTask}
                      onReplyToEntry={handleReplyToEntry}
                      defaultExpanded={agent.status === "running"}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            // Category filter active - show flat list
            activeAgents.map((agent) => (
              <AgentSection
                key={agent.config.id}
                agent={agent}
                historyEntries={historyData[agent.config.id] || []}
                agentMap={agentMap}
                onAddTask={onAddTask}
                onStartTask={onStartTask}
                onReplyToEntry={handleReplyToEntry}
                defaultExpanded={agent.status === "running"}
              />
            ))
          )}

          {/* Dormant Agents */}
          {dormantAgents.length > 0 && (
            <div className="bg-gray-800/50 rounded-xl p-3 sm:p-4 lg:p-3 border border-gray-700/50">
              <h3 className="text-xs sm:text-sm font-medium text-gray-400 mb-2 sm:mb-3 lg:mb-2">
                유휴 에이전트
              </h3>
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                {dormantAgents.map((agent) => (
                  <div
                    key={agent.config.id}
                    className="flex items-center gap-1 sm:gap-1.5 bg-gray-900/50 rounded-lg px-2 py-1 sm:px-2.5 sm:py-1.5 border border-gray-700/50"
                  >
                    <span className="text-xs sm:text-sm">{agent.config.emoji}</span>
                    <span className="text-[10px] sm:text-xs text-gray-400">
                      {agent.config.name}
                    </span>
                    <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-gray-500" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Timeline View Mode */}
      {viewMode === "timeline" && (
        <HistoryPanel
          historyData={historyData}
          agents={agents}
          agentMap={agentMap}
        />
      )}
    </div>
  );
}
