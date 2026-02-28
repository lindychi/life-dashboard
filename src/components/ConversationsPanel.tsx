"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { relativeTime } from "@/lib/format-utils";
import type {
  Conversation,
  ConversationMessage,
  ConversationStatus,
  ConversationMessageType,
} from "@/lib/conversations";

// ===== Types =====

export interface ConversationStats extends Conversation {
  messageCount: number;
  lastMessageAt?: string;
  readStatus: Record<string, { unread: number; last_read_at: string }>;
}

interface ConversationsPanelProps {
  currentUserId: string; // "user" or agent ID
  agentMap: Record<string, { emoji: string; name: string }>;
}

// ===== Constants =====

const STATUS_CONFIG: Record<
  ConversationStatus,
  { color: string; icon: string; label: string }
> = {
  active: { color: "green", icon: "●", label: "진행중" },
  completed: { color: "blue", icon: "✓", label: "완료" },
  archived: { color: "gray", icon: "📦", label: "보관됨" },
};

const MSG_TYPE_CONFIG: Record<
  ConversationMessageType,
  { style: string; label: string; icon: string; userStyle: string }
> = {
  text: {
    style: "bg-gray-700/80 border-gray-600/50 text-gray-200",
    userStyle: "bg-blue-600/90 border-blue-500/50 text-white",
    label: "",
    icon: "",
  },
  task: {
    style: "bg-blue-500/10 border-blue-500/30 text-blue-200",
    userStyle: "bg-blue-600 border-blue-400/50 text-white",
    label: "TASK",
    icon: "📋",
  },
  result: {
    style: "bg-emerald-500/10 border-emerald-500/30 text-emerald-200",
    userStyle: "bg-emerald-600 border-emerald-400/50 text-white",
    label: "RESULT",
    icon: "✅",
  },
  question: {
    style: "bg-amber-500/10 border-amber-500/30 text-amber-200",
    userStyle: "bg-amber-600 border-amber-400/50 text-white",
    label: "QUESTION",
    icon: "❓",
  },
  answer: {
    style: "bg-violet-500/10 border-violet-500/30 text-violet-200",
    userStyle: "bg-violet-600 border-violet-400/50 text-white",
    label: "ANSWER",
    icon: "💬",
  },
  system: {
    style: "bg-gray-600/10 border-gray-600/30 text-gray-400",
    userStyle: "bg-gray-600 border-gray-500/50 text-white",
    label: "SYSTEM",
    icon: "⚙️",
  },
};

// ===== Utility Functions =====

function formatMessageTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateSeparator(timestamp: string): string {
  const d = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "오늘";
  if (d.toDateString() === yesterday.toDateString()) return "어제";

  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function shouldShowDateSeparator(
  current: ConversationMessage,
  previous: ConversationMessage | undefined
): boolean {
  if (!previous) return true;
  const d1 = new Date(current.createdAt).toDateString();
  const d2 = new Date(previous.createdAt).toDateString();
  return d1 !== d2;
}

// ===== Sub-Components =====

/** Date separator between message groups */
function DateSeparator({ timestamp }: { timestamp: string }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 h-px bg-gray-700/60" />
      <span className="text-[11px] text-gray-500 font-medium px-2 py-0.5 rounded-full bg-gray-800/80 border border-gray-700/50">
        {formatDateSeparator(timestamp)}
      </span>
      <div className="flex-1 h-px bg-gray-700/60" />
    </div>
  );
}

/** Message bubble component */
function MessageBubble({
  message,
  agentMap,
  currentUserId,
  isConsecutive,
}: {
  message: ConversationMessage;
  agentMap: Record<string, { emoji: string; name: string }>;
  currentUserId: string;
  isConsecutive: boolean;
}) {
  const isCurrentUser = message.from === currentUserId;
  const config = MSG_TYPE_CONFIG[message.type];
  const bubbleStyle = isCurrentUser ? config.userStyle : config.style;
  const sender = agentMap[message.from] || { emoji: "🤖", name: message.from };
  const isLong = message.content.length > 200;

  return (
    <div
      className={`flex gap-2.5 ${isCurrentUser ? "flex-row-reverse" : "flex-row"} ${
        isConsecutive ? "mt-0.5" : "mt-3"
      } group`}
    >
      {/* Avatar */}
      {!isConsecutive ? (
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${
            isCurrentUser
              ? "bg-blue-600/30 border border-blue-500/30"
              : "bg-gray-700 border border-gray-600/50"
          }`}
          title={sender.name}
        >
          {sender.emoji}
        </div>
      ) : (
        <div className="w-8 flex-shrink-0" />
      )}

      {/* Message content */}
      <div className={`flex flex-col ${isCurrentUser ? "items-end" : "items-start"} max-w-[78%] min-w-0`}>
        {/* Sender name for non-consecutive */}
        {!isConsecutive && !isCurrentUser && (
          <span className="text-[11px] text-gray-500 font-medium mb-0.5 ml-1">
            {sender.name}
          </span>
        )}

        <div
          className={`rounded-2xl px-3.5 py-2 border ${bubbleStyle} ${
            isCurrentUser ? "rounded-br-md" : "rounded-bl-md"
          } transition-all`}
        >
          {/* Type label */}
          {config.label && (
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[10px]">{config.icon}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">
                {config.label}
              </span>
            </div>
          )}

          {/* Message body with markdown */}
          <div
            className={`prose prose-invert prose-sm max-w-none text-[13px] leading-relaxed break-words
              [&_p]:m-0 [&_p+p]:mt-1.5
              [&_pre]:text-[11px] [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/30 [&_pre]:p-2 [&_pre]:my-1.5
              [&_code]:text-[11px] [&_code]:bg-black/20 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded
              [&_pre_code]:bg-transparent [&_pre_code]:p-0
              [&_table]:text-xs [&_table]:my-1.5
              [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0
              [&_a]:text-blue-400 [&_a]:underline [&_a]:decoration-blue-400/30
              [&_blockquote]:border-l-2 [&_blockquote]:border-gray-500 [&_blockquote]:pl-3 [&_blockquote]:my-1.5 [&_blockquote]:text-gray-400
              [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h4]:text-xs
              ${isLong ? "" : "[&_p:only-child]:inline"}`}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>

          {/* Timestamp */}
          <div
            className={`flex items-center gap-1 mt-1 ${
              isCurrentUser ? "justify-end" : "justify-start"
            }`}
          >
            <span className="text-[10px] opacity-40 select-none">
              {formatMessageTime(message.createdAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Empty state for conversation list */
function EmptyConversationList() {
  return (
    <div className="flex-1 flex items-center justify-center py-12">
      <div className="text-center max-w-xs">
        <div className="relative mx-auto w-20 h-20 mb-4">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-blue-500/10 rounded-3xl rotate-6" />
          <div className="relative w-full h-full flex items-center justify-center rounded-3xl bg-gray-800/80 border border-gray-700/50">
            <span className="text-3xl opacity-60">💬</span>
          </div>
        </div>
        <h3 className="text-gray-300 text-sm font-semibold mb-1">대화 세션 없음</h3>
        <p className="text-gray-500 text-xs leading-relaxed">
          새 대화를 시작하려면 + 버튼을 클릭하세요
        </p>
      </div>
    </div>
  );
}

/** Empty state for message area */
function EmptyMessages({ conversationTitle }: { conversationTitle: string }) {
  return (
    <div className="flex-1 flex items-center justify-center py-12">
      <div className="text-center max-w-xs">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-700/50 border border-gray-600/30 flex items-center justify-center">
          <span className="text-2xl opacity-50">👋</span>
        </div>
        <p className="text-gray-400 text-sm font-medium mb-1">
          {conversationTitle}의 첫 메시지
        </p>
        <p className="text-gray-600 text-xs">
          아래에서 첫 메시지를 보내보세요
        </p>
      </div>
    </div>
  );
}

/** Conversation list item */
function ConversationListItem({
  conversation,
  isSelected,
  currentUserId,
  agentMap,
  onClick,
}: {
  conversation: ConversationStats;
  isSelected: boolean;
  currentUserId: string;
  agentMap: Record<string, { emoji: string; name: string }>;
  onClick: () => void;
}) {
  const statusConfig = STATUS_CONFIG[conversation.status];
  const myUnread = conversation.readStatus[currentUserId]?.unread || 0;
  const participantEmojis = conversation.participants
    .slice(0, 3)
    .map((p) => agentMap[p]?.emoji || "🤖");

  // Context preview
  const contextPreview = useMemo(() => {
    if (conversation.context.projectId) return "🚀 프로젝트 관련";
    if (conversation.context.goal) return `🎯 ${conversation.context.goal}`;
    return null;
  }, [conversation.context]);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 transition-all focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none border-l-2 ${
        isSelected
          ? "bg-blue-600/15 border-l-blue-500"
          : "hover:bg-gray-700/30 border-l-transparent"
      }`}
    >
      <div className="flex items-start gap-2.5">
        {/* Participant avatars stack */}
        <div className="relative flex-shrink-0 w-9 h-9">
          {participantEmojis.length === 1 ? (
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center text-base ${
                isSelected
                  ? "bg-blue-600/20 border border-blue-500/30"
                  : "bg-gray-700/60 border border-gray-600/30"
              }`}
            >
              {participantEmojis[0]}
            </div>
          ) : (
            <div className="relative w-9 h-9">
              <div className="absolute top-0 left-0 w-6 h-6 rounded-full bg-gray-700/80 border border-gray-600/50 flex items-center justify-center text-xs">
                {participantEmojis[0]}
              </div>
              <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-gray-700/80 border border-gray-600/50 flex items-center justify-center text-xs">
                {participantEmojis[1]}
              </div>
              {participantEmojis.length > 2 && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-[8px] font-bold text-blue-300">
                  +{conversation.participants.length - 2}
                </div>
              )}
            </div>
          )}
          {/* Status indicator */}
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-gray-800 ${
              conversation.status === "active" ? "bg-green-500" : "bg-gray-600"
            }`}
          />
        </div>

        {/* Conversation info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4
              className={`text-sm font-medium truncate ${
                isSelected ? "text-white" : "text-gray-200"
              }`}
            >
              {conversation.title}
            </h4>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {conversation.lastMessageAt && (
                <span className="text-[10px] text-gray-600">
                  {relativeTime(conversation.lastMessageAt)}
                </span>
              )}
              {myUnread > 0 && (
                <span className="bg-blue-600 text-white text-[10px] rounded-full px-1.5 py-0.5 min-w-[18px] text-center font-medium leading-none">
                  {myUnread}
                </span>
              )}
            </div>
          </div>

          {/* Context or participant count */}
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-gray-500">
              {conversation.participants.length}명 참여
            </span>
            {contextPreview && (
              <>
                <span className="text-gray-700">•</span>
                <span className="text-[11px] text-gray-500 truncate">
                  {contextPreview}
                </span>
              </>
            )}
          </div>

          {/* Status badge */}
          <div className="mt-1">
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded bg-${statusConfig.color}-500/10 text-${statusConfig.color}-400 border border-${statusConfig.color}-500/20`}
            >
              {statusConfig.icon} {statusConfig.label}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

/** Search and filter bar */
function SearchAndFilterBar({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  participantFilter,
  onParticipantFilterChange,
  agentMap,
}: {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  statusFilter: ConversationStatus | "all";
  onStatusFilterChange: (v: ConversationStatus | "all") => void;
  participantFilter: string | "all";
  onParticipantFilterChange: (v: string | "all") => void;
  agentMap: Record<string, { emoji: string; name: string }>;
}) {
  return (
    <div className="p-3 border-b border-gray-700/50 space-y-2.5">
      {/* Search input */}
      <div className="relative">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="대화 검색..."
          className="w-full bg-gray-700/50 border border-gray-600/50 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:bg-gray-700/80 transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Status filter chips */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1">
        <button
          onClick={() => onStatusFilterChange("all")}
          className={`text-[10px] px-2 py-1 rounded-md font-medium whitespace-nowrap transition-all ${
            statusFilter === "all"
              ? "bg-blue-600/20 text-blue-300 border border-blue-500/30"
              : "bg-gray-800/50 text-gray-500 border border-transparent hover:text-gray-300"
          }`}
        >
          전체
        </button>
        {(Object.entries(STATUS_CONFIG) as [ConversationStatus, typeof STATUS_CONFIG[ConversationStatus]][]).map(
          ([status, config]) => (
            <button
              key={status}
              onClick={() => onStatusFilterChange(status)}
              className={`text-[10px] px-2 py-1 rounded-md font-medium whitespace-nowrap transition-all ${
                statusFilter === status
                  ? `bg-${config.color}-500/20 text-${config.color}-300 border border-${config.color}-500/30`
                  : "bg-gray-800/50 text-gray-500 border border-transparent hover:text-gray-300"
              }`}
            >
              {config.icon} {config.label}
            </button>
          )
        )}
      </div>
    </div>
  );
}

/** New conversation modal */
function NewConversationModal({
  isOpen,
  onClose,
  onCreate,
  agentMap,
  currentUserId,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: {
    title: string;
    participants: string[];
    context: Record<string, unknown>;
  }) => Promise<void>;
  agentMap: Record<string, { emoji: string; name: string }>;
  currentUserId: string;
}) {
  const [title, setTitle] = useState("");
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(
    new Set([currentUserId])
  );
  const [goal, setGoal] = useState("");
  const [creating, setCreating] = useState(false);

  const availableParticipants = useMemo(
    () => Object.entries(agentMap).filter(([id]) => id !== currentUserId),
    [agentMap, currentUserId]
  );

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || selectedParticipants.size < 2) return;

    setCreating(true);
    try {
      await onCreate({
        title: title.trim(),
        participants: Array.from(selectedParticipants),
        context: goal.trim() ? { goal: goal.trim() } : {},
      });
      setTitle("");
      setSelectedParticipants(new Set([currentUserId]));
      setGoal("");
      onClose();
    } catch (error) {
      console.error("Failed to create conversation:", error);
      alert("대화 생성에 실패했습니다.");
    } finally {
      setCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-2xl max-w-md w-full shadow-2xl">
        <div className="p-4 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white">새 대화 세션</h2>
        </div>

        <form onSubmit={handleCreate} className="p-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              대화 제목 *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 프로젝트 알파 기획"
              className="w-full bg-gray-700/50 border border-gray-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50"
              required
            />
          </div>

          {/* Goal */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              목표 (선택)
            </label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="예: 시스템 아키텍처 설계"
              className="w-full bg-gray-700/50 border border-gray-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50"
            />
          </div>

          {/* Participants */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              참여자 선택 * (최소 2명)
            </label>
            <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border border-gray-700/50 bg-gray-900/30 p-2">
              {/* Current user (always included) */}
              <div className="flex items-center gap-2 px-2 py-1.5 bg-blue-600/10 border border-blue-500/20 rounded">
                <span className="text-sm">{agentMap[currentUserId]?.emoji || "👤"}</span>
                <span className="text-sm text-gray-300">
                  {agentMap[currentUserId]?.name || currentUserId} (나)
                </span>
              </div>

              {/* Other participants */}
              {availableParticipants.map(([id, info]) => (
                <label
                  key={id}
                  className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-700/30 rounded cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedParticipants.has(id)}
                    onChange={(e) => {
                      const next = new Set(selectedParticipants);
                      if (e.target.checked) {
                        next.add(id);
                      } else {
                        next.delete(id);
                      }
                      setSelectedParticipants(next);
                    }}
                    className="w-4 h-4 rounded border-gray-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
                  />
                  <span className="text-sm">{info.emoji}</span>
                  <span className="text-sm text-gray-300">{info.name}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              선택된 참여자: {selectedParticipants.size}명
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={creating || !title.trim() || selectedParticipants.size < 2}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? "생성 중..." : "생성"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===== Main Component =====

export default function ConversationsPanel({
  currentUserId,
  agentMap,
}: ConversationsPanelProps) {
  // State
  const [conversations, setConversations] = useState<ConversationStats[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [messageType, setMessageType] = useState<ConversationMessageType>("text");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | "all">("all");
  const [participantFilter, setParticipantFilter] = useState<string | "all">("all");
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);
  const [showTypeSelector, setShowTypeSelector] = useState(false);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typeSelectorRef = useRef<HTMLDivElement>(null);

  // ===== Data Fetching =====

  const fetchConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("participantId", currentUserId);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/conversations?${params}`);
      const data = await res.json();

      if (data.conversations) {
        // Fetch stats for each conversation
        const conversationsWithStats = await Promise.all(
          data.conversations.map(async (conv: Conversation) => {
            const statsRes = await fetch(`/api/conversations/${conv.id}?stats=true`);
            const statsData = await statsRes.json();
            return statsData.conversation as ConversationStats;
          })
        );
        setConversations(conversationsWithStats);
      }
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
    } finally {
      setLoading(false);
    }
  }, [currentUserId, statusFilter]);

  const fetchMessages = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages?limit=100`);
      const data = await res.json();

      if (data.messages) {
        setMessages(data.messages);

        // Mark as read
        if (data.messages.length > 0) {
          const lastMessageId = data.messages[data.messages.length - 1].id;
          await fetch(`/api/conversations/${conversationId}/read-status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agentId: currentUserId,
              lastReadMessageId: lastMessageId,
            }),
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    }
  }, [currentUserId]);

  // Initial load
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Load messages when conversation is selected
  useEffect(() => {
    if (selectedConversationId) {
      fetchMessages(selectedConversationId);
    } else {
      setMessages([]);
    }
  }, [selectedConversationId, fetchMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Close type selector on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (typeSelectorRef.current && !typeSelectorRef.current.contains(e.target as Node)) {
        setShowTypeSelector(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ===== Handlers =====

  const handleCreateConversation = async (data: {
    title: string;
    participants: string[];
    context: Record<string, unknown>;
  }) => {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        createdBy: currentUserId,
      }),
    });

    if (!res.ok) throw new Error("Failed to create conversation");

    await fetchConversations();
  };

  const handleSendMessage = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!messageInput.trim() || !selectedConversationId || sending) return;

    const content = messageInput.trim();
    const type = messageType;

    // Optimistic update
    const optimisticMsg: ConversationMessage = {
      id: `optimistic-${Date.now()}`,
      conversationId: selectedConversationId,
      from: currentUserId,
      content,
      type,
      metadata: {},
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setMessageInput("");

    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${selectedConversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: currentUserId,
          content,
          type,
        }),
      });

      if (!res.ok) throw new Error("Failed to send message");

      const data = await res.json();
      if (data.message) {
        setMessages((prev) => prev.map((m) => (m.id === optimisticMsg.id ? data.message : m)));
      }

      // Refresh conversations list to update last message
      fetchConversations();
    } catch (error) {
      console.error("Failed to send message:", error);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // ===== Computed =====

  const filteredConversations = useMemo(() => {
    return conversations.filter((conv) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (
          !conv.title.toLowerCase().includes(query) &&
          !conv.participants.some((p) =>
            agentMap[p]?.name.toLowerCase().includes(query)
          )
        ) {
          return false;
        }
      }

      return true;
    });
  }, [conversations, searchQuery, agentMap]);

  const selectedConversation = selectedConversationId
    ? conversations.find((c) => c.id === selectedConversationId)
    : null;

  // ===== Render =====

  return (
    <>
      <div className="flex flex-col md:flex-row gap-0 min-h-[560px] bg-gray-900 rounded-2xl border border-gray-700/50 overflow-hidden shadow-lg">
        {/* ===== Left Sidebar: Conversation List ===== */}
        <div className="md:w-80 flex-shrink-0 border-r border-gray-700/50 bg-gray-850 flex flex-col">
          {/* Header */}
          <div className="p-3 border-b border-gray-700/50 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">대화 세션</h3>
            <button
              onClick={() => setShowNewConversationModal(true)}
              className="p-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              title="새 대화"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 4v16m8-8H4" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Search and filters */}
          <SearchAndFilterBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            participantFilter={participantFilter}
            onParticipantFilterChange={setParticipantFilter}
            agentMap={agentMap}
          />

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-700">
            {loading ? (
              <div className="p-4 text-center text-gray-500 text-xs">로딩 중...</div>
            ) : filteredConversations.length === 0 ? (
              <EmptyConversationList />
            ) : (
              filteredConversations.map((conv) => (
                <ConversationListItem
                  key={conv.id}
                  conversation={conv}
                  isSelected={selectedConversationId === conv.id}
                  currentUserId={currentUserId}
                  agentMap={agentMap}
                  onClick={() => setSelectedConversationId(conv.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* ===== Right Panel: Messages ===== */}
        <div className="flex-1 flex flex-col min-w-0 bg-gray-900/50">
          {!selectedConversation ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-xs">
                <div className="relative mx-auto w-24 h-24 mb-5">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-violet-500/10 rounded-3xl rotate-6" />
                  <div className="relative w-full h-full flex items-center justify-center rounded-3xl bg-gray-800/80 border border-gray-700/50">
                    <span className="text-4xl opacity-60">💬</span>
                  </div>
                </div>
                <h3 className="text-gray-300 text-base font-semibold mb-1.5">
                  대화를 선택하세요
                </h3>
                <p className="text-gray-500 text-sm leading-relaxed">
                  왼쪽에서 대화를 선택하거나 새로운 대화를 시작하세요
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/30 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={() => setSelectedConversationId(null)}
                      className="md:hidden text-gray-400 hover:text-white transition-colors p-1 -ml-1"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>

                    <div>
                      <h3 className="text-sm font-bold text-white">{selectedConversation.title}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-gray-500">
                          {selectedConversation.participants.length}명 참여
                        </span>
                        <span className="text-gray-700">•</span>
                        <span
                          className={`text-[11px] text-${STATUS_CONFIG[selectedConversation.status].color}-400`}
                        >
                          {STATUS_CONFIG[selectedConversation.status].label}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => fetchMessages(selectedConversation.id)}
                    className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700/50 transition-colors"
                    title="새로고침"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Messages area */}
              <div
                ref={messagesContainerRef}
                className="flex-1 overflow-y-auto px-4 py-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-700"
              >
                {messages.length === 0 ? (
                  <EmptyMessages conversationTitle={selectedConversation.title} />
                ) : (
                  messages.map((msg, i) => {
                    const prev = i > 0 ? messages[i - 1] : undefined;
                    const isConsecutive =
                      !!prev &&
                      prev.from === msg.from &&
                      new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < 120000;

                    return (
                      <div key={msg.id}>
                        {shouldShowDateSeparator(msg, prev) && (
                          <DateSeparator timestamp={msg.createdAt} />
                        )}
                        <MessageBubble
                          message={msg}
                          agentMap={agentMap}
                          currentUserId={currentUserId}
                          isConsecutive={isConsecutive && !shouldShowDateSeparator(msg, prev)}
                        />
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div className="border-t border-gray-700/50 bg-gray-800/30 p-3">
                {showTypeSelector && (
                  <div
                    ref={typeSelectorRef}
                    className="mb-2 flex flex-wrap gap-1.5 p-2 bg-gray-800 border border-gray-700/50 rounded-xl"
                  >
                    {(Object.entries(MSG_TYPE_CONFIG) as [ConversationMessageType, typeof MSG_TYPE_CONFIG[ConversationMessageType]][]).map(
                      ([type, cfg]) => (
                        <button
                          key={type}
                          onClick={() => {
                            setMessageType(type);
                            setShowTypeSelector(false);
                          }}
                          className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all ${
                            messageType === type
                              ? "bg-blue-600/20 text-blue-300 border border-blue-500/30"
                              : "bg-gray-700/50 text-gray-400 border border-transparent hover:bg-gray-700"
                          }`}
                        >
                          {cfg.icon || "📝"} {type.charAt(0).toUpperCase() + type.slice(1)}
                        </button>
                      )
                    )}
                  </div>
                )}

                <form
                  onSubmit={handleSendMessage}
                  className="flex items-end gap-2 bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-1 focus-within:border-blue-500/40"
                >
                  <button
                    type="button"
                    onClick={() => setShowTypeSelector(!showTypeSelector)}
                    className={`flex-shrink-0 p-1.5 rounded-lg transition-all self-end mb-0.5 ${
                      messageType !== "text"
                        ? "text-blue-400 bg-blue-500/10"
                        : "text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" strokeLinecap="round" />
                    </svg>
                  </button>

                  <textarea
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="메시지를 입력하세요..."
                    disabled={sending}
                    rows={1}
                    className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none resize-none min-h-[36px] max-h-[120px] leading-relaxed py-2"
                  />

                  <button
                    type="submit"
                    disabled={sending || !messageInput.trim()}
                    className={`flex-shrink-0 p-2 rounded-xl transition-all self-end mb-0.5 ${
                      messageInput.trim()
                        ? "bg-blue-600 text-white hover:bg-blue-500"
                        : "text-gray-600 cursor-not-allowed"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path
                        d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>

      {/* New conversation modal */}
      <NewConversationModal
        isOpen={showNewConversationModal}
        onClose={() => setShowNewConversationModal(false)}
        onCreate={handleCreateConversation}
        agentMap={agentMap}
        currentUserId={currentUserId}
      />
    </>
  );
}
