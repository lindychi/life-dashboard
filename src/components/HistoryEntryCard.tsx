"use client";

import React, { useState, memo, useMemo } from "react";
import { useToastContext } from "@/contexts/ToastContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { relativeTime } from "@/lib/format-utils";
import { HISTORY_TYPE_LABELS } from "@/lib/ui-constants";

// ===== Tool Call Types & Display =====

interface ToolCallData {
  name: string;
  input?: Record<string, unknown>;
  result?: string;
  timestamp?: string;
}

const TOOL_DISPLAY: Record<string, { emoji: string; color: string }> = {
  Read: { emoji: "📖", color: "text-emerald-400" },
  Write: { emoji: "✏️", color: "text-amber-400" },
  Edit: { emoji: "🔧", color: "text-orange-400" },
  Grep: { emoji: "🔍", color: "text-cyan-400" },
  Glob: { emoji: "📂", color: "text-blue-400" },
  Bash: { emoji: "💻", color: "text-purple-400" },
  TodoWrite: { emoji: "📝", color: "text-yellow-400" },
  Task: { emoji: "🚀", color: "text-pink-400" },
  WebFetch: { emoji: "🌐", color: "text-teal-400" },
  WebSearch: { emoji: "🔎", color: "text-indigo-400" },
};

function getToolDisplay(name: string): { emoji: string; color: string; shortName: string } {
  if (TOOL_DISPLAY[name]) {
    return { ...TOOL_DISPLAY[name], shortName: name };
  }
  if (name.startsWith("mcp__")) {
    const parts = name.split("__");
    return { emoji: "🔌", color: "text-violet-400", shortName: parts[parts.length - 1] || name };
  }
  return { emoji: "🔧", color: "text-gray-400", shortName: name };
}

function formatToolInputSummary(name: string, input: Record<string, unknown>): string {
  try {
    if (name === "Read" || name === "Write" || name === "Edit") {
      return input.file_path ? String(input.file_path).split("/").slice(-2).join("/") : "";
    }
    if (name === "Grep") return input.pattern ? String(input.pattern).slice(0, 60) : "";
    if (name === "Glob") return input.pattern ? String(input.pattern).slice(0, 60) : "";
    if (name === "Bash") return input.command ? String(input.command).slice(0, 80) : "";
    if (name.startsWith("mcp__")) {
      const firstStr = Object.values(input).find(v => typeof v === "string");
      return firstStr ? String(firstStr).slice(0, 60) : "";
    }
    return "";
  } catch { return ""; }
}

// ===== Tool Call Item Component =====

function ToolCallItem({ tc, index }: { tc: ToolCallData; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const display = getToolDisplay(tc.name);
  const summary = tc.input ? formatToolInputSummary(tc.name, tc.input) : "";
  const hasDetails = (tc.input && Object.keys(tc.input).length > 0) || tc.result;

  return (
    <div className="border-l-2 border-gray-700/50 pl-2 ml-1">
      <button
        type="button"
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`flex items-center gap-1.5 w-full text-left py-0.5 text-xs ${
          hasDetails ? "cursor-pointer hover:bg-gray-700/30 rounded-r" : "cursor-default"
        } transition-colors`}
      >
        <span className="text-gray-600 w-4 text-right font-mono">{index + 1}</span>
        <span>{display.emoji}</span>
        <span className={`font-medium ${display.color}`}>{display.shortName}</span>
        {summary && (
          <span className="text-gray-500 truncate flex-1 font-mono">{summary}</span>
        )}
        {hasDetails && (
          <span className="text-gray-600 text-[10px] flex-shrink-0 ml-auto">
            {expanded ? "▼" : "▶"}
          </span>
        )}
      </button>

      {expanded && hasDetails && (
        <div className="ml-6 mt-1 mb-2 space-y-1.5">
          {/* Input parameters */}
          {tc.input && Object.keys(tc.input).length > 0 && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Input</span>
              <pre className="mt-0.5 text-[11px] text-gray-400 bg-gray-900/50 rounded px-2 py-1.5 overflow-x-auto max-h-[200px] overflow-y-auto border border-gray-800 whitespace-pre-wrap break-words">
                {JSON.stringify(tc.input, null, 2)}
              </pre>
            </div>
          )}

          {/* Result output */}
          {tc.result && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-gray-600 font-medium">Result</span>
              <pre className="mt-0.5 text-[11px] text-gray-400 bg-gray-900/50 rounded px-2 py-1.5 overflow-x-auto max-h-[300px] overflow-y-auto border border-gray-800 whitespace-pre-wrap break-words">
                {tc.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== Tool Calls Panel =====

function ToolCallsPanel({ toolCalls }: { toolCalls: ToolCallData[] }) {
  const [showAll, setShowAll] = useState(false);

  // Count by tool name
  const toolCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tc of toolCalls) {
      counts.set(tc.name, (counts.get(tc.name) || 0) + 1);
    }
    return counts;
  }, [toolCalls]);

  // Summary badges
  const summaryBadges = useMemo(() => {
    const entries = Array.from(toolCounts.entries());
    return entries.map(([name, count]) => {
      const display = getToolDisplay(name);
      return { name: display.shortName, emoji: display.emoji, color: display.color, count };
    });
  }, [toolCounts]);

  if (toolCalls.length === 0) return null;

  return (
    <div className="mt-1.5 sm:mt-2 lg:mt-1 border border-gray-700/50 rounded-lg bg-gray-800/30 overflow-hidden">
      {/* Header with tool summary badges */}
      <button
        type="button"
        onClick={() => setShowAll(!showAll)}
        className="w-full flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 text-xs hover:bg-gray-700/20 transition-colors"
      >
        <span className="text-gray-500 font-medium text-[10px] sm:text-xs flex-shrink-0">🔧 ({toolCalls.length})</span>
        <div className="flex gap-1 flex-wrap flex-1 overflow-hidden">
          {summaryBadges.slice(0, 4).map(({ name, emoji, color, count }) => (
            <span
              key={name}
              className={`inline-flex items-center gap-0.5 px-1 sm:px-1.5 py-0.5 rounded bg-gray-900/50 border border-gray-700/50 ${color}`}
            >
              <span className="text-[9px] sm:text-[10px]">{emoji}</span>
              <span className="text-[9px] sm:text-[10px] font-mono">{name}</span>
              {count > 1 && <span className="text-[9px] sm:text-[10px] text-gray-500">×{count}</span>}
            </span>
          ))}
          {summaryBadges.length > 4 && (
            <span className="text-[9px] text-gray-500">+{summaryBadges.length - 4}</span>
          )}
        </div>
        <span className="text-gray-600 text-[10px] flex-shrink-0">
          {showAll ? "▲" : "▼"}
        </span>
      </button>

      {/* Expanded tool call list */}
      {showAll && (
        <div className="px-3 pb-2 space-y-0.5">
          {toolCalls.map((tc, i) => (
            <ToolCallItem key={`${tc.name}-${i}`} tc={tc} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Attachment Reference Parsing =====

interface FileReference {
  refKey: string;
  fullMatch: string;
}

function parseFileReferences(content: string): FileReference[] {
  const pattern = /@file:([a-zA-Z0-9_-]+)/g;
  const refs: FileReference[] = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    refs.push({ refKey: match[1], fullMatch: match[0] });
  }
  return refs;
}

function AttachmentBadge({ refKey }: { refKey: string }) {
  const { addToast } = useToastContext();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (downloading) return;

    setDownloading(true);
    try {
      // Look up attachment metadata to get the ID
      const res = await fetch(`/api/attachments/by-ref/${refKey}`);
      if (!res.ok) {
        addToast("첨부파일을 찾을 수 없습니다", "error");
        return;
      }
      const data = await res.json();
      if (data.attachment?.id) {
        // Open download in new tab
        window.open(`/api/attachments/${data.attachment.id}`, "_blank");
      }
    } catch {
      addToast("첨부파일 다운로드에 실패했습니다", "error");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={downloading}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 hover:text-blue-200 text-xs transition-colors disabled:opacity-50"
      title={`\uCCA8\uBD80\uD30C\uC77C \uB2E4\uC6B4\uB85C\uB4DC (${refKey})`}
    >
      <span>{"\u{1F4CE}"}</span>
      <span className="font-mono">{refKey}</span>
      {downloading ? (
        <span className="animate-spin inline-block w-3 h-3 border border-blue-300 border-t-transparent rounded-full" />
      ) : (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      )}
    </button>
  );
}

interface HistoryEntryCardProps {
  entry: {
    id: string;
    agentId: string;
    type: string;
    content: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
    requestGroupId?: string;
    requestTitle?: string;
  };
  agentDisplay: { emoji: string; name: string };
  isExpanded: boolean;
  isReplying: boolean;
  isCopied: boolean;
  onToggleExpand: (id: string) => void;
  onToggleReply: (id: string) => void;
  onCopy: (id: string, content: string) => void;
  onReply: (entry: HistoryEntryCardProps['entry'], replyText: string) => void;
  onFilterByGroup?: (requestGroupId: string, requestTitle: string) => void;
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
  onFilterByGroup,
}: HistoryEntryCardProps) {
  const [replyText, setReplyText] = useState("");

  const { label, color } = HISTORY_TYPE_LABELS[entry.type] || {
    label: entry.type,
    color: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  };

  const needsCollapse = entry.content.length > 200;
  const showReplyButton = entry.type === "output" || entry.type === "task_completed";
  const showCopyButton = entry.type === "output" || entry.type === "task_completed" || entry.type === "task_failed";

  // Parse file references from content
  const fileRefs = useMemo(() => {
    return parseFileReferences(entry.content);
  }, [entry.content]);

  const handleReplySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (replyText.trim()) {
      onReply(entry, replyText);
      setReplyText("");
    }
  };

  return (
    <div className="border border-gray-700 rounded-lg p-2.5 sm:p-3 lg:p-2 bg-gray-800/50">
      <div className="flex items-start gap-1.5 sm:gap-2 lg:gap-1.5 mb-1.5 sm:mb-2 lg:mb-1">
        <span className="text-lg sm:text-xl lg:text-lg flex-shrink-0" title={agentDisplay.name}>
          {agentDisplay.emoji}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
            <span className="text-xs sm:text-sm font-medium text-gray-300">
              {agentDisplay.name}
            </span>
            <span className={`text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded border ${color}`}>
              {label}
            </span>
            <span className="text-[10px] sm:text-xs text-gray-500">
              {relativeTime(entry.timestamp)}
            </span>
            {entry.requestGroupId && onFilterByGroup && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFilterByGroup(entry.requestGroupId!, entry.requestTitle || entry.requestGroupId!.slice(0, 8));
                }}
                className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors truncate max-w-[120px] sm:max-w-[150px] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                title={`요청 그룹: ${entry.requestTitle || entry.requestGroupId}`}
              >
                📋 {entry.requestTitle || entry.requestGroupId!.slice(0, 8)}
              </button>
            )}
          </div>
          <div className="mt-1.5 sm:mt-2 lg:mt-1">
            <div
              className={`prose prose-invert prose-sm max-w-none text-xs sm:text-sm [&_pre]:text-[11px] [&_pre]:overflow-x-auto [&_code]:text-[11px] [&_table]:text-xs ${
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
                className="text-xs text-blue-400 hover:text-blue-300 mt-1 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
              >
                {isExpanded ? "접기 ▲" : "더보기 ▼"}
              </button>
            )}

            {/* Attachment badges */}
            {fileRefs.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {fileRefs.map((ref, i) => (
                  <AttachmentBadge key={`${ref.refKey}-${i}`} refKey={ref.refKey} />
                ))}
              </div>
            ) : null}

            {/* Tool calls panel */}
            {entry.metadata?.toolCalls && Array.isArray(entry.metadata.toolCalls) && (entry.metadata.toolCalls as ToolCallData[]).length > 0 ? (
              <ToolCallsPanel toolCalls={entry.metadata.toolCalls as ToolCallData[]} />
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 mt-1.5 sm:mt-2 lg:mt-1">
            {showReplyButton && (
              <button
                onClick={() => onToggleReply(entry.id)}
                className="text-[11px] sm:text-xs px-2 sm:px-3 py-1.5 sm:py-2 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none min-h-[32px] sm:min-h-0 sm:py-1 sm:px-2"
              >
                {isReplying ? "취소" : "답장"}
              </button>
            )}
            {showCopyButton && (
              <button
                onClick={() => onCopy(entry.id, entry.content)}
                className="text-[11px] sm:text-xs px-2 sm:px-3 py-1.5 sm:py-2 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none min-h-[32px] sm:min-h-0 sm:py-1 sm:px-2"
              >
                {isCopied ? "복사됨!" : "복사"}
              </button>
            )}
          </div>
          {isReplying && (
            <form onSubmit={handleReplySubmit} className="mt-2 sm:mt-3 space-y-2">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="답장 입력..."
                className="w-full px-2.5 sm:px-3 py-2 rounded bg-gray-900 border border-gray-700 text-white text-xs sm:text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!replyText.trim()}
                  className="px-3 py-1.5 sm:py-1 rounded bg-blue-500 text-white text-xs sm:text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  전송
                </button>
                <button
                  type="button"
                  onClick={() => onToggleReply(entry.id)}
                  className="px-3 py-1.5 sm:py-1 rounded bg-gray-700 text-gray-300 text-xs sm:text-sm hover:bg-gray-600"
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
    prevProps.entry.metadata === nextProps.entry.metadata &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.isReplying === nextProps.isReplying &&
    prevProps.isCopied === nextProps.isCopied
  );
});

export default HistoryEntryCard;
