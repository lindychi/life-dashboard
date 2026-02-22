"use client";

import React, { useMemo, useState } from "react";
import AgentSection from "@/components/AgentSection";
import HistoryPanel from "@/components/HistoryPanel";
import LiveMonitor from "@/components/LiveMonitor";
import PendingRepliesBanner from "@/components/PendingRepliesBanner";

// Types
interface TaskStack {
  id: string;
  description: string;
  trigger: "on_complete" | "manual" | "on_idle";
  priority: "high" | "medium" | "low";
}

interface AgentConfig {
  id: string;
  name: string;
  role: string;
  emoji: string;
  category: "dev" | "business" | "ops";
  systemPrompt: string;
  enabled: boolean;
  projects?: string[];
}

interface AgentRuntime {
  config: AgentConfig;
  status: "running" | "idle" | "waiting" | "error";
  currentTask?: string;
  sessionKey?: string;
  stack: TaskStack[];
  completedToday: number;
}

interface HistoryEntry {
  id: string;
  agentId: string;
  type:
    | "task_started"
    | "task_completed"
    | "task_failed"
    | "message_sent"
    | "message_received"
    | "status_change"
    | "command_received"
    | "output";
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

interface AgentDashboardProps {
  agents: AgentRuntime[];
  historyData: Record<string, HistoryEntry[]>;
  agentMap: Record<string, { emoji: string; name: string }>;
  liveAgentStatuses: Array<{
    id: string;
    name: string;
    status: "running" | "idle" | "waiting" | "error";
    currentTask?: string;
    updatedAt: string;
  }>;
  pendingReplies: HistoryEntry[];
  orchestrateInput: string;
  isOrchestrating: boolean;
  onOrchestrateInputChange: (value: string) => void;
  onOrchestrate: (e: React.FormEvent) => void;
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
  onOrchestrateInputChange,
  onOrchestrate,
  onAddTask,
  onStartTask,
  onPendingReply,
}: AgentDashboardProps) {
  const [viewMode, setViewMode] = useState<"agents" | "timeline">("agents");
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | "dev" | "business" | "ops"
  >("all");

  // Handle reply to history entry
  const handleReplyToEntry = async (
    entry: HistoryEntry,
    replyText: string
  ) => {
    try {
      const response = await fetch("/api/relay/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "spawn",
          payload: {
            agentId: entry.agentId,
            task: `사용자 피드백에 대해 응답하세요.\n\n이전 당신의 메시지:\n${entry.content.slice(0, 500)}\n\n사용자 답신:\n${replyText}`,
          },
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: entry.agentId,
          type: "message_sent",
          content: `💬 사용자 → ${agentMap[entry.agentId]?.name || entry.agentId}: ${replyText}`,
        }),
      });
    } catch (error) {
      console.error("Failed to send reply:", error);
      alert(`답신 전송 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    }
  };

  // Sort and filter agents
  const { activeAgents, dormantAgents } = useMemo(() => {
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

    return { activeAgents: active, dormantAgents: dormant };
  }, [agents, historyData, categoryFilter]);

  return (
    <div className="space-y-6">
      {/* Orchestrate Bar */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <form onSubmit={onOrchestrate} className="space-y-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={orchestrateInput}
              onChange={(e) => onOrchestrateInputChange(e.target.value)}
              placeholder="전체 지시를 입력하세요... (예: 이번 주 블로그 쓰고, 매출 정리하고, 코드 리뷰해줘)"
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              disabled={isOrchestrating}
            />
            <button
              type="submit"
              disabled={isOrchestrating || !orchestrateInput.trim()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {isOrchestrating ? (
                <>
                  <svg
                    className="animate-spin h-5 w-5"
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
                  <span>처리 중...</span>
                </>
              ) : (
                <>
                  <span>🎯</span>
                  <span>전체 지시</span>
                </>
              )}
            </button>
          </div>
        </form>
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
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg bg-gray-800 p-1">
          <button
            onClick={() => setViewMode("agents")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              viewMode === "agents"
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            에이전트
          </button>
          <button
            onClick={() => setViewMode("timeline")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
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
          <div className="inline-flex rounded-lg bg-gray-800 p-1">
            <button
              onClick={() => setCategoryFilter("all")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                categoryFilter === "all"
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              전체
            </button>
            <button
              onClick={() => setCategoryFilter("dev")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                categoryFilter === "dev"
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              개발
            </button>
            <button
              onClick={() => setCategoryFilter("business")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                categoryFilter === "business"
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              경영
            </button>
            <button
              onClick={() => setCategoryFilter("ops")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                categoryFilter === "ops"
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              운영
            </button>
          </div>
        )}
      </div>

      {/* Agent View Mode */}
      {viewMode === "agents" && (
        <div className="space-y-4">
          {/* Active Agent Sections */}
          {activeAgents.map((agent) => (
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

          {/* Dormant Agents */}
          {dormantAgents.length > 0 && (
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
              <h3 className="text-sm font-medium text-gray-400 mb-3">
                유휴 에이전트
              </h3>
              <div className="flex flex-wrap gap-2">
                {dormantAgents.map((agent) => (
                  <div
                    key={agent.config.id}
                    className="flex items-center gap-1.5 bg-gray-900/50 rounded-lg px-2.5 py-1.5 border border-gray-700/50"
                  >
                    <span className="text-sm">{agent.config.emoji}</span>
                    <span className="text-xs text-gray-400">
                      {agent.config.name}
                    </span>
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
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

      {/* Pipeline Preview */}
      <div className="mt-8 bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h3 className="text-lg font-bold mb-4">
          🔗 Pipeline (oh-my-claudecode style)
        </h3>
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {["Plan", "PRD", "Execute", "Verify", "Fix"].map((stage, i, arr) => (
            <React.Fragment key={stage}>
              <div className="flex flex-col items-center gap-1 min-w-[80px]">
                <div className="w-12 h-12 rounded-lg bg-gray-700 border border-gray-600 flex items-center justify-center text-sm font-medium">
                  {stage}
                </div>
                <span className="text-xs text-gray-500">{stage}</span>
              </div>
              {i < arr.length - 1 && (
                <div className="flex-shrink-0 w-8 h-0.5 bg-gray-600" />
              )}
            </React.Fragment>
          ))}
        </div>
        <p className="text-gray-500 text-sm mt-3">
          복잡한 작업은 자동으로 파이프라인으로 분해됩니다
        </p>
      </div>
    </div>
  );
}
