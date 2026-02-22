"use client";

import React, { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface PendingReply {
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
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface PendingRepliesBannerProps {
  pendingReplies: PendingReply[];
  agentMap: Record<string, { emoji: string; name: string }>;
  onReply: (entry: PendingReply, replyText: string) => Promise<void>;
}

interface PendingReplyCardProps {
  entry: PendingReply;
  agentEmoji: string;
  agentName: string;
  isExpanded: boolean;
  onToggle: () => void;
  onReply: (entry: PendingReply, replyText: string) => Promise<void>;
}

function relativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;
  if (diff < 0) return "방금";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}초 전`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}

const PendingReplyCard = React.memo<PendingReplyCardProps>(
  ({ entry, agentEmoji, agentName, isExpanded, onToggle, onReply }) => {
    const [replyText, setReplyText] = useState("");
    const [replySending, setReplySending] = useState(false);

    const handleSubmit = useCallback(
      async (e: React.FormEvent) => {
        e.preventDefault();
        if (!replyText.trim() || replySending) return;

        setReplySending(true);
        try {
          await onReply(entry, replyText.trim());
          setReplyText("");
        } catch (error) {
          console.error("Failed to send reply:", error);
        } finally {
          setReplySending(false);
        }
      },
      [entry, replyText, replySending, onReply]
    );

    return (
      <div className="bg-white/5 border border-yellow-500/20 rounded-lg p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{agentEmoji}</span>
              <span className="text-sm font-medium text-white/90">
                {agentName}
              </span>
              <span className="text-xs text-white/50">
                {relativeTime(entry.timestamp)}
              </span>
            </div>
            <div
              className={`text-sm text-white/70 ${!isExpanded ? "line-clamp-2" : ""}`}
            >
              {isExpanded ? (
                <div className="prose prose-sm prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {entry.content}
                  </ReactMarkdown>
                </div>
              ) : (
                entry.content
              )}
            </div>
          </div>
          <button
            onClick={onToggle}
            className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors whitespace-nowrap"
          >
            {isExpanded ? "접기 ▲" : "펼치기 ▼"}
          </button>
        </div>
        {isExpanded && (
          <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="답신 입력..."
              className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded text-sm text-white placeholder-white/40 focus:outline-none focus:border-yellow-500/50"
              disabled={replySending}
            />
            <button
              type="submit"
              disabled={!replyText.trim() || replySending}
              className="px-4 py-1.5 bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-500/30 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
            >
              {replySending ? "전송중..." : "답신"}
            </button>
          </form>
        )}
      </div>
    );
  }
);

PendingReplyCard.displayName = "PendingReplyCard";

const PendingRepliesBanner = React.memo<PendingRepliesBannerProps>(
  ({ pendingReplies, agentMap, onReply }) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const toggleExpand = useCallback((id: string) => {
      setExpandedId((prev) => (prev === id ? null : id));
    }, []);

    if (pendingReplies.length === 0) return null;

    return (
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-6">
        <div className="mb-3">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <span>⏳</span>
            <span>응답 대기 ({pendingReplies.length})</span>
          </h3>
          <p className="text-sm text-white/60 mt-1">
            에이전트가 답신을 기다리고 있습니다
          </p>
        </div>
        <div className="space-y-2">
          {pendingReplies.map((entry) => {
            const agent = agentMap[entry.agentId] || {
              emoji: "🤖",
              name: "Unknown Agent",
            };
            return (
              <PendingReplyCard
                key={entry.id}
                entry={entry}
                agentEmoji={agent.emoji}
                agentName={agent.name}
                isExpanded={expandedId === entry.id}
                onToggle={() => toggleExpand(entry.id)}
                onReply={onReply}
              />
            );
          })}
        </div>
      </div>
    );
  }
);

PendingRepliesBanner.displayName = "PendingRepliesBanner";

export default PendingRepliesBanner;
