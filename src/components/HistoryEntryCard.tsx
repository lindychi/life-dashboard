"use client";

import React, { useState, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyToClipboard } from "@/lib/clipboard";

const HISTORY_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  task_started: { label: "시작", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  task_completed: { label: "완료", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  task_failed: { label: "실패", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  message_sent: { label: "발신", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  message_received: { label: "수신", color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" },
  status_change: { label: "상태", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  command_received: { label: "명령", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  output: { label: "Output", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
};

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

interface HistoryEntryCardProps {
  entry: {
    id: string;
    agentId: string;
    type: string;
    content: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
  };
  agentDisplay: { emoji: string; name: string };
  isExpanded: boolean;
  isReplying: boolean;
  isCopied: boolean;
  onToggleExpand: (id: string) => void;
  onToggleReply: (id: string) => void;
  onCopy: (id: string, content: string) => void;
  onReply: (entry: HistoryEntryCardProps['entry'], replyText: string) => void;
}

const HistoryEntryCard = memo(function HistoryEntryCard({
  entry,
  agentDisplay,
  isExpanded,
  isReplying,
  isCopied,
  onToggleExpand,
  onToggleReply,
  onCopy,
  onReply,
}: HistoryEntryCardProps) {
  const [replyText, setReplyText] = useState("");

  const { label, color } = HISTORY_TYPE_LABELS[entry.type] || {
    label: entry.type,
    color: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  };

  const needsCollapse = entry.content.length > 200;
  const showReplyButton = entry.type === "output" || entry.type === "task_completed";
  const showCopyButton = entry.type === "output" || entry.type === "task_completed" || entry.type === "task_failed";

  const handleReplySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (replyText.trim()) {
      onReply(entry, replyText);
      setReplyText("");
    }
  };

  return (
    <div className="border border-gray-700 rounded-lg p-3 bg-gray-800/50">
      <div className="flex items-start gap-2 mb-2">
        <span className="text-xl" title={agentDisplay.name}>
          {agentDisplay.emoji}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-300">
              {agentDisplay.name}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded border ${color}`}>
              {label}
            </span>
            <span className="text-xs text-gray-500">
              {relativeTime(entry.timestamp)}
            </span>
          </div>
          <div className="mt-2">
            <div
              className={`prose prose-invert prose-sm max-w-none ${
                needsCollapse && !isExpanded ? "line-clamp-3" : ""
              }`}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {entry.content}
              </ReactMarkdown>
            </div>
            {needsCollapse && (
              <button
                onClick={() => onToggleExpand(entry.id)}
                className="text-xs text-blue-400 hover:text-blue-300 mt-1"
              >
                {isExpanded ? "접기 ▲" : "더보기 ▼"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2">
            {showReplyButton && (
              <button
                onClick={() => onToggleReply(entry.id)}
                className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
              >
                {isReplying ? "취소" : "답장"}
              </button>
            )}
            {showCopyButton && (
              <button
                onClick={() => onCopy(entry.id, entry.content)}
                className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
              >
                {isCopied ? "복사됨!" : "복사"}
              </button>
            )}
          </div>
          {isReplying && (
            <form onSubmit={handleReplySubmit} className="mt-3 space-y-2">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="답장 입력..."
                className="w-full px-3 py-2 rounded bg-gray-900 border border-gray-700 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!replyText.trim()}
                  className="px-3 py-1 rounded bg-blue-500 text-white text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  전송
                </button>
                <button
                  type="button"
                  onClick={() => onToggleReply(entry.id)}
                  className="px-3 py-1 rounded bg-gray-700 text-gray-300 text-sm hover:bg-gray-600"
                >
                  취소
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Only re-render when these specific properties change
  return (
    prevProps.entry.id === nextProps.entry.id &&
    prevProps.entry.timestamp === nextProps.entry.timestamp &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.isReplying === nextProps.isReplying &&
    prevProps.isCopied === nextProps.isCopied
  );
});

export default HistoryEntryCard;
