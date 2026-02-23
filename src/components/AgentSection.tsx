"use client";

import React, { useState, memo, useEffect } from "react";
import HistoryEntryCard from "@/components/HistoryEntryCard";
import { copyToClipboard } from "@/lib/clipboard";
import { relativeTime, formatBytes } from "@/lib/format-utils";
import type { TaskStack, AgentConfig, AgentRuntime, HistoryEntry } from "@/lib/frontend-types";

interface AgentSectionProps {
  agent: AgentRuntime;
  historyEntries: HistoryEntry[];
  agentMap: Record<string, { emoji: string; name: string }>;
  onAddTask: (agentId: string, task: string) => void;
  onStartTask: (agentId: string, task: string) => void;
  onReplyToEntry: (entry: HistoryEntry, replyText: string) => Promise<void>;
  defaultExpanded?: boolean;
}

// Styles
const STATUS_STYLES: Record<AgentRuntime["status"], { class: string; label: string }> = {
  running: { class: "bg-green-500/20 text-green-400 border-green-500/30", label: "🟢 실행중" },
  idle: { class: "bg-gray-500/20 text-gray-400 border-gray-500/30", label: "⚫ 대기" },
  waiting: { class: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", label: "🟡 대기중" },
  error: { class: "bg-red-500/20 text-red-400 border-red-500/30", label: "🔴 에러" },
};

const CATEGORY_STYLES: Record<AgentConfig["category"], string> = {
  dev: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  business: "bg-green-500/20 text-green-400 border-green-500/30",
  ops: "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

// Keep this local as it's only used here
function isRecentActivity(timestamp: string): boolean {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  return (now - then) < 30000; // Within 30 seconds
}

const AgentSection = memo(function AgentSection({
  agent,
  historyEntries,
  agentMap,
  onAddTask,
  onStartTask,
  onReplyToEntry,
  defaultExpanded = false,
}: AgentSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showHistory, setShowHistory] = useState(defaultExpanded);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [showAddTaskForm, setShowAddTaskForm] = useState(false);
  const [newTaskText, setNewTaskText] = useState("");
  const [quickTaskText, setQuickTaskText] = useState("");
  const [showQuickTaskForm, setShowQuickTaskForm] = useState(false);
  const [pendingTask, setPendingTask] = useState<string | null>(null);

  const statusStyle = STATUS_STYLES[agent.status];
  const categoryStyle = CATEGORY_STYLES[agent.config.category];

  const displayedHistory = showAllHistory
    ? historyEntries.slice(0, 50)
    : historyEntries.slice(0, 3);

  const latestActivity = historyEntries.length > 0 ? historyEntries[0].timestamp : null;

  // Handlers
  const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  const handleToggleHistory = () => {
    setShowHistory(!showHistory);
  };

  const handleToggleAllHistory = () => {
    setShowAllHistory(!showAllHistory);
  };

  const handleToggleEntryExpand = (id: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleReply = (id: string) => {
    setReplyingTo((prev) => (prev === id ? null : id));
  };

  const handleCopy = async (id: string, content: string) => {
    const success = await copyToClipboard(content);
    if (success) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const handleReply = async (entry: { id: string; agentId: string; type: string; content: string; timestamp: string; metadata?: Record<string, unknown> }, replyText: string) => {
    await onReplyToEntry(entry as HistoryEntry, replyText);
    setReplyingTo(null);
  };

  const handleAddStackTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTaskText.trim()) {
      onAddTask(agent.config.id, newTaskText.trim());
      setNewTaskText("");
      setShowAddTaskForm(false);
    }
  };

  const handleQuickTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (quickTaskText.trim()) {
      setPendingTask(quickTaskText.trim());  // Show feedback immediately
      onStartTask(agent.config.id, quickTaskText.trim());
      setQuickTaskText("");
      setShowQuickTaskForm(false);
    }
  };

  const handleStartStack = () => {
    if (agent.stack.length > 0) {
      setPendingTask(agent.stack[0].description);  // Show feedback immediately
      onStartTask(agent.config.id, agent.stack[0].description);
    }
  };

  // Auto-clear pendingTask when agent status changes
  useEffect(() => {
    if (pendingTask && agent.status === "idle") {
      // If still idle after 5 seconds, the API call probably failed silently
      const timer = setTimeout(() => setPendingTask(null), 5000);
      return () => clearTimeout(timer);
    }
    if (pendingTask && agent.status !== "idle") {
      setPendingTask(null);
    }
  }, [agent.status, pendingTask]);

  return (
    <div className="border border-gray-700 rounded-lg bg-gray-800/30 overflow-hidden">
      {/* Agent Header */}
      <div className="p-4 border-b border-gray-700 bg-gray-800/50">
        <div className="flex items-start gap-3">
          <div className="text-3xl flex-shrink-0">{agent.config.emoji}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap overflow-x-auto">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                {agent.config.name}
                {agent.liveOutput && isRecentActivity(agent.liveOutput.lastActivityAt) && (
                  <span className="inline-block w-2 h-2 bg-green-400 rounded-full animate-pulse" title="실시간 출력 수신 중" />
                )}
              </h3>
              <span className={`text-xs px-2 py-1 rounded border ${categoryStyle}`}>
                {agent.config.category}
              </span>
              <span className={`text-xs px-2 py-1 rounded border ${statusStyle.class}`}>
                {statusStyle.label}
              </span>
              {latestActivity && (
                <span className="text-xs text-gray-500">
                  {relativeTime(latestActivity)}
                </span>
              )}
              <button
                onClick={handleToggleExpand}
                className="ml-auto text-gray-400 hover:text-white text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                aria-label={isExpanded ? "섹션 접기" : "섹션 펼치기"}
              >
                {isExpanded ? "▼" : "▶"}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">{agent.config.role}</p>
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-4 space-y-4">
          {/* Pending Task - shows immediately before agent status updates */}
          {pendingTask && agent.status === "idle" && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 animate-pulse">
              <div className="text-xs text-yellow-400 font-medium mb-1 flex items-center gap-2">
                <span className="inline-block w-2 h-2 bg-yellow-400 rounded-full animate-ping" />
                호출중...
              </div>
              <div className="text-sm text-white">{pendingTask}</div>
            </div>
          )}

          {/* Current Task */}
          {agent.currentTask && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <div className="text-xs text-blue-400 font-medium mb-1">현재 작업</div>
              <div className="text-sm text-white">{agent.currentTask}</div>
            </div>
          )}

          {/* Live Output */}
          {agent.status === "running" && agent.liveOutput && (
            <div className="rounded-lg bg-gray-900 p-3 font-mono text-xs text-green-400">
              <div className="mb-1 flex items-center justify-between text-gray-500">
                <span>📡 실시간 출력</span>
                <span>
                  {agent.liveOutput.chunksReceived} chunks · {formatBytes(agent.liveOutput.totalChars)}
                </span>
              </div>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                {agent.liveOutput.lastChunk}
              </div>
              <div className="mt-1 text-right text-gray-600">
                마지막 활동: {relativeTime(agent.liveOutput.lastActivityAt)}
              </div>
            </div>
          )}

          {/* Task Stack */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-300">
                작업 스택 ({agent.stack.length})
              </h4>
              {!showAddTaskForm && (
                <button
                  onClick={() => setShowAddTaskForm(true)}
                  className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                >
                  + 추가
                </button>
              )}
            </div>

            {agent.stack.length > 0 ? (
              <ul className="space-y-1">
                {agent.stack.map((task, idx) => (
                  <li
                    key={task.id}
                    className="text-sm text-gray-300 bg-gray-900/50 rounded px-3 py-2 border border-gray-700"
                  >
                    <span className="text-gray-500 mr-2">{idx + 1}.</span>
                    {task.description}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-500 italic">스택이 비어있습니다</p>
            )}

            {showAddTaskForm && (
              <form onSubmit={handleAddStackTask} className="space-y-2">
                <textarea
                  value={newTaskText}
                  onChange={(e) => setNewTaskText(e.target.value)}
                  placeholder="새 작업 입력..."
                  className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={!newTaskText.trim()}
                    className="px-3 py-1 rounded bg-blue-500 text-white text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    추가
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddTaskForm(false);
                      setNewTaskText("");
                    }}
                    className="px-3 py-1 rounded bg-gray-700 text-gray-300 text-sm hover:bg-gray-600"
                  >
                    취소
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Quick Actions */}
          <div className="flex gap-2">
            {pendingTask && agent.status === "idle" && (
              <button
                disabled
                className="px-4 py-2 rounded bg-yellow-500/20 text-yellow-400 text-sm cursor-wait border border-yellow-500/30 animate-pulse"
              >
                호출중...
              </button>
            )}
            {!pendingTask && agent.status === "idle" && agent.stack.length > 0 && (
              <button
                onClick={handleStartStack}
                className="px-4 py-2 rounded bg-green-500 text-white text-sm font-medium hover:bg-green-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
              >
                스택 실행
              </button>
            )}
            {!pendingTask && agent.status === "idle" && !showQuickTaskForm && (
              <button
                onClick={() => setShowQuickTaskForm(true)}
                className="px-4 py-2 rounded bg-gray-700 text-gray-300 text-sm hover:bg-gray-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
              >
                + 작업 할당
              </button>
            )}
            {agent.status === "running" && (
              <button
                disabled
                className="px-4 py-2 rounded bg-gray-700 text-gray-500 text-sm cursor-not-allowed"
              >
                실행중...
              </button>
            )}
          </div>

          {showQuickTaskForm && (
            <form onSubmit={handleQuickTask} className="space-y-2">
              <textarea
                value={quickTaskText}
                onChange={(e) => setQuickTaskText(e.target.value)}
                placeholder="즉시 실행할 작업 입력..."
                className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!quickTaskText.trim()}
                  className="px-3 py-1 rounded bg-green-500 text-white text-sm hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  실행
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowQuickTaskForm(false);
                    setQuickTaskText("");
                  }}
                  className="px-3 py-1 rounded bg-gray-700 text-gray-300 text-sm hover:bg-gray-600"
                >
                  취소
                </button>
              </div>
            </form>
          )}

          {/* History Section */}
          <div className="space-y-2">
            <button
              onClick={handleToggleHistory}
              className="text-sm font-semibold text-gray-300 hover:text-white flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
              aria-label={showHistory ? "기록 접기" : "기록 펼치기"}
            >
              📜 기록 {historyEntries.length}건
              <span className="text-xs text-gray-500">
                {showHistory ? "▼" : "▶"}
              </span>
            </button>

            {showHistory && (
              <div className="space-y-2">
                {displayedHistory.map((entry) => {
                  const agentDisplay = agentMap[entry.agentId] || {
                    emoji: "🤖",
                    name: entry.agentId,
                  };

                  return (
                    <HistoryEntryCard
                      key={entry.id}
                      entry={entry}
                      agentDisplay={agentDisplay}
                      isExpanded={expandedEntries.has(entry.id)}
                      isReplying={replyingTo === entry.id}
                      isCopied={copiedId === entry.id}
                      onToggleExpand={handleToggleEntryExpand}
                      onToggleReply={handleToggleReply}
                      onCopy={handleCopy}
                      onReply={handleReply}
                    />
                  );
                })}

                {historyEntries.length > 3 && (
                  <button
                    onClick={handleToggleAllHistory}
                    className="w-full text-xs text-blue-400 hover:text-blue-300 py-2 border border-gray-700 rounded bg-gray-900/50 hover:bg-gray-900 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                  >
                    {showAllHistory
                      ? "최근 3개만 보기 ▲"
                      : `모든 기록 보기 (${historyEntries.length}개) ▼`}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Stats Footer */}
          <div className="text-xs text-gray-500 border-t border-gray-700 pt-3">
            오늘 완료: {agent.completedToday}건
          </div>
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for memo
  const prevAgent = prevProps.agent;
  const nextAgent = nextProps.agent;

  return (
    prevAgent.config.id === nextAgent.config.id &&
    prevAgent.status === nextAgent.status &&
    prevAgent.currentTask === nextAgent.currentTask &&
    prevAgent.stack.length === nextAgent.stack.length &&
    prevAgent.completedToday === nextAgent.completedToday &&
    prevProps.historyEntries.length === nextProps.historyEntries.length &&
    (prevProps.historyEntries[0]?.timestamp ?? "") === (nextProps.historyEntries[0]?.timestamp ?? "") &&
    prevAgent.liveOutput?.chunksReceived === nextAgent.liveOutput?.chunksReceived &&
    prevAgent.liveOutput?.lastActivityAt === nextAgent.liveOutput?.lastActivityAt
  );
});

export default AgentSection;
