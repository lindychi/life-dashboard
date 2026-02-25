"use client";

import React, { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { relativeTime } from "@/lib/format-utils";

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
      <div className="bg-white/5 border border-yellow-500/20 rounded-lg p-2.5 sm:p-3">
        <div className="flex items-start justify-between gap-2 sm:gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
              <span className="text-base sm:text-lg">{agentEmoji}</span>
              <span className="text-xs sm:text-sm font-medium text-white/90 truncate">
                {agentName}
              </span>
              <span className="text-[10px] sm:text-xs text-white/50 flex-shrink-0">
                {relativeTime(entry.timestamp)}
              </span>
            </div>
            <div
              className={`text-xs sm:text-sm text-white/70 ${!isExpanded ? "line-clamp-2" : ""}`}
            >
              {isExpanded ? (
                <div className="prose prose-sm prose-invert max-w-none text-xs sm:text-sm">
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
            className="text-[10px] sm:text-xs text-yellow-400 hover:text-yellow-300 transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none flex-shrink-0 p-1"
          >
            {isExpanded ? "접기 ▲" : "펼치기 ▼"}
          </button>
        </div>
        {isExpanded && (
          <form onSubmit={handleSubmit} className="mt-2 sm:mt-3 flex flex-col sm:flex-row gap-1.5 sm:gap-2">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="답신 입력..."
              className="flex-1 px-2.5 sm:px-3 py-2 sm:py-1.5 bg-white/5 border border-white/10 rounded text-xs sm:text-sm text-white placeholder-white/40 focus:outline-none focus:border-yellow-500/50 focus-visible:ring-2 focus-visible:ring-yellow-500 min-h-[38px] sm:min-h-0"
              disabled={replySending}
            />
            <button
              type="submit"
              disabled={!replyText.trim() || replySending}
              className="px-4 py-2 sm:py-1.5 bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-500/30 disabled:cursor-not-allowed text-white text-xs sm:text-sm rounded transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none min-h-[38px] sm:min-h-0"
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
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 sm:p-4 mb-4 sm:mb-6">
        <div className="mb-2 sm:mb-3">
          <h3 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
            <span>⏳</span>
            <span>응답 대기 ({pendingReplies.length})</span>
          </h3>
          <p className="text-xs sm:text-sm text-white/60 mt-0.5 sm:mt-1">
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
