"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import HistoryEntryCard from "@/components/HistoryEntryCard";
import { copyToClipboard } from "@/lib/clipboard";
import { filterEntries } from "@/lib/performance-utils";
import { relativeTime } from "@/lib/format-utils";
import { HISTORY_TYPE_LABELS } from "@/lib/ui-constants";
import type { AgentRuntime, HistoryEntry } from "@/lib/frontend-types";

// ===== Types =====

interface GroupedHistoryEntry {
  requestGroupId: string;
  requestTitle: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  inProgressCount: number;
  startedAt: string;
  lastActivityAt: string;
  entries: HistoryEntry[];
}

interface HistoryPanelProps {
  historyData: Record<string, HistoryEntry[]>;
  agents: AgentRuntime[];
  agentMap: Record<string, { emoji: string; name: string }>;
}

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
  const [viewMode, setViewMode] = useState<"timeline" | "grouped">("timeline");
  const [groupedData, setGroupedData] = useState<GroupedHistoryEntry[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [loadingGroups, setLoadingGroups] = useState(false);

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

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {/* Agent filter */}
        <select
          value={filterAgent}
          onChange={(e) => setFilterAgent(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <option value="all">전체 에이전트</option>
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
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <option value="all">전체 타입</option>
          {allTypes.map((t) => (
            <option key={t} value={t}>
              {HISTORY_TYPE_LABELS[t as keyof typeof HISTORY_TYPE_LABELS]?.label || t}
            </option>
          ))}
        </select>

        <span className="flex items-center text-xs text-gray-500 ml-auto">
          {filtered.length}건
        </span>
      </div>

      {/* Timeline */}
      {filtered.length === 0 ? (
        <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 text-center">
          <p className="text-gray-500">아직 기록이 없습니다</p>
          <p className="text-gray-600 text-sm mt-1">
            에이전트 활동이 발생하면 여기에 표시됩니다
          </p>
        </div>
      ) : (
        <div className="max-h-[600px] overflow-y-auto space-y-2">
          {filtered.map((entry) => (
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
      )}
    </div>
  );
}
