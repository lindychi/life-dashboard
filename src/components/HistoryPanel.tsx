"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import HistoryEntryCard from "@/components/HistoryEntryCard";
import { copyToClipboard } from "@/lib/clipboard";
import { filterEntries, getVisibleRange } from "@/lib/performance-utils";

// ===== Types =====
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
  type: "task_started" | "task_completed" | "task_failed" | "message_sent" | "message_received" | "status_change" | "command_received" | "output";
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

interface HistoryPanelProps {
  historyData: Record<string, HistoryEntry[]>;
  agents: AgentRuntime[];
  agentMap: Record<string, { emoji: string; name: string }>;
}

// ===== Constants =====
const HISTORY_TYPE_LABELS: Record<HistoryEntry["type"], { label: string; color: string }> = {
  task_started: { label: "시작", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  task_completed: { label: "완료", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  task_failed: { label: "실패", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  message_sent: { label: "발신", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  message_received: { label: "수신", color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" },
  status_change: { label: "상태", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  command_received: { label: "명령", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  output: { label: "Output", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
};

export default function HistoryPanel({
  historyData,
  agents,
  agentMap,
}: HistoryPanelProps) {
  const [filterAgent, setFilterAgent] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const getDisplay = (agentId: string) =>
    agentMap[agentId] || { emoji: "🤖", name: agentId };

  const toggleExpand = useCallback((id: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCopy = useCallback(async (entryId: string, content: string) => {
    const success = await copyToClipboard(content);
    if (success) {
      setCopiedId(entryId);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }, []);

  const handleReply = useCallback(async (entry: { id: string; agentId: string; type: string; content: string; timestamp: string; metadata?: Record<string, unknown> }, replyText: string) => {
    try {
      await fetch("/api/relay/command", {
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
      await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: entry.agentId,
          type: "message_sent",
          content: `💬 사용자 → ${agentMap[entry.agentId]?.name || entry.agentId}: ${replyText}`,
        }),
      });
      setReplyingTo(null);
    } catch (error) {
      console.error("Reply failed:", error);
    }
  }, [agentMap]);

  const allEntries = useMemo(() =>
    Object.values(historyData).flat().sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ), [historyData]);

  const filtered = useMemo(() =>
    filterEntries(allEntries, filterAgent, filterType),
    [allEntries, filterAgent, filterType]
  );

  const allTypes = useMemo(() =>
    Array.from(new Set(allEntries.map((e) => e.type))),
    [allEntries]
  );

  // Virtual scrolling constants
  const ITEM_HEIGHT = 120;
  const CONTAINER_HEIGHT = 600;

  const { start, end, totalHeight } = useMemo(() =>
    getVisibleRange(scrollTop, CONTAINER_HEIGHT, ITEM_HEIGHT, filtered.length),
    [scrollTop, filtered.length]
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Agent filter */}
        <select
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="all">All Agents</option>
          {agents.map((a) => (
            <option key={a.config.id} value={a.config.id}>
              {a.config.emoji} {a.config.name}
            </option>
          ))}
        </select>

        {/* Type filter */}
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="all">All Types</option>
          {allTypes.map((t) => (
            <option key={t} value={t}>
              {HISTORY_TYPE_LABELS[t as keyof typeof HISTORY_TYPE_LABELS]?.label || t}
            </option>
          ))}
        </select>

        <span className="flex items-center text-xs text-gray-500 ml-auto">
          {filtered.length} entries
        </span>
      </div>

      {/* Timeline */}
      {filtered.length === 0 ? (
        <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 text-center">
          <p className="text-gray-500">No history entries yet</p>
          <p className="text-gray-600 text-sm mt-1">
            Agent activities will appear here as they occur
          </p>
        </div>
      ) : (
        <div
          ref={scrollContainerRef}
          style={{ height: CONTAINER_HEIGHT, overflowY: 'auto' }}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          className="relative"
        >
          <div style={{ height: totalHeight, position: 'relative' }}>
            <div style={{ position: 'absolute', top: start * ITEM_HEIGHT, left: 0, right: 0 }} className="space-y-2">
              {filtered.slice(start, end).map((entry) => (
                <HistoryEntryCard
                  key={entry.id}
                  entry={entry}
                  agentDisplay={getDisplay(entry.agentId)}
                  isExpanded={expandedEntries.has(entry.id)}
                  isReplying={replyingTo === entry.id}
                  isCopied={copiedId === entry.id}
                  onToggleExpand={toggleExpand}
                  onToggleReply={(id) => { setReplyingTo(replyingTo === id ? null : id); }}
                  onCopy={handleCopy}
                  onReply={handleReply}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
