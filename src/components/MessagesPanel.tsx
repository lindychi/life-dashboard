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
import type { AgentRuntime } from "@/lib/frontend-types";

// ===== Types =====

export interface Message {
  id: string;
  from: string;
  to: string;
  content: string;
  type: "text" | "task" | "result" | "question" | "answer";
  read: boolean;
  timestamp: string;
}

export interface AgentMessageOverview {
  unread: number;
  latest?: Message;
}

interface MessagesPanelProps {
  agents: AgentRuntime[];
  agentOverview: Record<string, AgentMessageOverview>;
  agentMap: Record<string, { emoji: string; name: string }>;
  onRefreshOverview: () => void;
}

// ===== Constants =====

const MSG_TYPE_CONFIG: Record<
  Message["type"],
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
    icon: "\u{1F4CB}",
  },
  result: {
    style: "bg-emerald-500/10 border-emerald-500/30 text-emerald-200",
    userStyle: "bg-emerald-600 border-emerald-400/50 text-white",
    label: "RESULT",
    icon: "\u2705",
  },
  question: {
    style: "bg-amber-500/10 border-amber-500/30 text-amber-200",
    userStyle: "bg-amber-600 border-amber-400/50 text-white",
    label: "QUESTION",
    icon: "\u2753",
  },
  answer: {
    style: "bg-violet-500/10 border-violet-500/30 text-violet-200",
    userStyle: "bg-violet-600 border-violet-400/50 text-white",
    label: "ANSWER",
    icon: "\u{1F4AC}",
  },
};

// ===== Utility =====

function formatMessageTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateSeparator(timestamp: string): string {
  const d = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "\uC624\uB298";
  if (d.toDateString() === yesterday.toDateString()) return "\uC5B4\uC81C";

  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function shouldShowDateSeparator(
  current: Message,
  previous: Message | undefined
): boolean {
  if (!previous) return true;
  const d1 = new Date(current.timestamp).toDateString();
  const d2 = new Date(previous.timestamp).toDateString();
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

/** Message status indicator (sent, delivered, read) */
function MessageStatus({ message }: { message: Message }) {
  if (message.from !== "user") return null;

  // Optimistic messages
  if (message.id.startsWith("optimistic-")) {
    return (
      <span className="text-gray-500 text-[10px] ml-1" title="\uC804\uC1A1\uC911...">
        <svg
          className="w-3 h-3 inline animate-pulse"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            strokeWidth="2"
            strokeDasharray="40"
            strokeDashoffset="10"
          />
        </svg>
      </span>
    );
  }

  return (
    <span className="text-blue-400/60 text-[10px] ml-1" title="\uC804\uC1A1\uB428">
      <svg className="w-3 h-3 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** Single message bubble */
function MessageBubble({
  message,
  agentMap,
  isConsecutive,
}: {
  message: Message;
  agentMap: Record<string, { emoji: string; name: string }>;
  isConsecutive: boolean;
}) {
  const isUser = message.from === "user";
  const config = MSG_TYPE_CONFIG[message.type];
  const bubbleStyle = isUser ? config.userStyle : config.style;
  const sender = agentMap[message.from] || { emoji: "\u{1F916}", name: message.from };
  const isLong = message.content.length > 200;

  return (
    <div
      className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"} ${
        isConsecutive ? "mt-0.5" : "mt-3"
      } group`}
    >
      {/* Avatar */}
      {!isConsecutive ? (
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${
            isUser
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
      <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} max-w-[78%] min-w-0`}>
        {/* Sender name for non-consecutive */}
        {!isConsecutive && !isUser && (
          <span className="text-[11px] text-gray-500 font-medium mb-0.5 ml-1">
            {sender.name}
          </span>
        )}

        <div
          className={`rounded-2xl px-3.5 py-2 border ${bubbleStyle} ${
            isUser
              ? "rounded-br-md"
              : "rounded-bl-md"
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

          {/* Timestamp + status */}
          <div
            className={`flex items-center gap-1 mt-1 ${
              isUser ? "justify-end" : "justify-start"
            }`}
          >
            <span className="text-[10px] opacity-40 select-none">
              {formatMessageTime(message.timestamp)}
            </span>
            <MessageStatus message={message} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Empty state when no agent is selected */
function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-xs">
        {/* Illustration */}
        <div className="relative mx-auto w-24 h-24 mb-5">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-violet-500/10 rounded-3xl rotate-6" />
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-violet-500/5 rounded-3xl -rotate-6" />
          <div className="relative w-full h-full flex items-center justify-center rounded-3xl bg-gray-800/80 border border-gray-700/50">
            <span className="text-4xl opacity-60">{"\u{1F4AC}"}</span>
          </div>
          {/* Floating dots */}
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500/40 rounded-full animate-pulse" />
          <div className="absolute -bottom-1 -left-2 w-2 h-2 bg-violet-500/40 rounded-full animate-pulse delay-300" />
        </div>

        <h3 className="text-gray-300 text-base font-semibold mb-1.5">
          {"\uB300\uD654\uD560 \uC5D0\uC774\uC804\uD2B8\uB97C \uC120\uD0DD\uD558\uC138\uC694"}
        </h3>
        <p className="text-gray-500 text-sm leading-relaxed">
          {"\uC0AC\uC774\uB4DC\uBC14\uC5D0\uC11C \uC5D0\uC774\uC804\uD2B8\uB97C \uC120\uD0DD\uD574 \uB300\uD654\uB97C \uC2DC\uC791\uD558\uC138\uC694.\n\uBA54\uC2DC\uC9C0, \uD0DC\uC2A4\uD06C, \uC9C8\uBB38\uC744 \uBCF4\uB0BC \uC218 \uC788\uC2B5\uB2C8\uB2E4."}
        </p>
      </div>
    </div>
  );
}

/** Empty conversation state */
function EmptyConversation({ agentName }: { agentName: string }) {
  return (
    <div className="flex-1 flex items-center justify-center py-12">
      <div className="text-center max-w-xs">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-700/50 border border-gray-600/30 flex items-center justify-center">
          <span className="text-2xl opacity-50">{"\u{1F44B}"}</span>
        </div>
        <p className="text-gray-400 text-sm font-medium mb-1">
          {agentName}{"\uACFC(\uC640)\uC758 \uCCAB \uB300\uD654"}
        </p>
        <p className="text-gray-600 text-xs">
          {"\uC544\uB798\uC5D0\uC11C \uCCAB \uBA54\uC2DC\uC9C0\uB97C \uBCF4\uB0B4\uBCF4\uC138\uC694"}
        </p>
      </div>
    </div>
  );
}

/** Agent search input for sidebar */
function AgentSearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"\uC5D0\uC774\uC804\uD2B8 \uAC80\uC0C9..."}
        className="w-full bg-gray-700/50 border border-gray-600/50 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:bg-gray-700/80 transition-colors"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** Category filter chips */
function CategoryFilters({
  active,
  onToggle,
  counts,
}: {
  active: Set<string>;
  onToggle: (cat: string) => void;
  counts: Record<string, number>;
}) {
  const categories = [
    { key: "dev", label: "Dev", icon: "\u{1F6E0}" },
    { key: "business", label: "Biz", icon: "\u{1F4BC}" },
    { key: "ops", label: "Ops", icon: "\u2699\uFE0F" },
  ];

  return (
    <div className="flex gap-1">
      {categories.map(({ key, label, icon }) => {
        const isActive = active.size === 0 || active.has(key);
        const count = counts[key] || 0;
        if (count === 0) return null;
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium transition-all ${
              isActive
                ? "bg-gray-600/60 text-gray-200 border border-gray-500/30"
                : "bg-gray-800/50 text-gray-600 border border-transparent hover:text-gray-400"
            }`}
          >
            {icon} {label}
          </button>
        );
      })}
    </div>
  );
}

/** Typing indicator animation */
function TypingIndicator({ agentName }: { agentName: string }) {
  return (
    <div className="flex items-center gap-2.5 mt-3">
      <div className="w-8 h-8 rounded-full bg-gray-700 border border-gray-600/50 flex items-center justify-center text-sm flex-shrink-0">
        {"\u{1F916}"}
      </div>
      <div className="bg-gray-700/60 border border-gray-600/30 rounded-2xl rounded-bl-md px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">{agentName}</span>
          <div className="flex gap-1 ml-1">
            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Auto-resizing textarea */
function AutoResizeTextarea({
  value,
  onChange,
  onKeyDown,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
      className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none resize-none min-h-[36px] max-h-[120px] leading-relaxed py-2"
    />
  );
}

// ===== Main Component =====

export default function MessagesPanel({
  agents,
  agentOverview,
  agentMap,
  onRefreshOverview,
}: MessagesPanelProps) {
  // State
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [messageType, setMessageType] = useState<Message["type"]>("text");
  const [sending, setSending] = useState(false);
  const [agentSearch, setAgentSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [isAgentTyping, setIsAgentTyping] = useState(false);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastFetchTimestampRef = useRef<string | null>(null);
  const typeSelectorRef = useRef<HTMLDivElement>(null);
  const pollingIntervalRef = useRef<number>(1000); // Adaptive polling interval
  const consecutiveEmptyFetches = useRef<number>(0);

  // ===== Data Fetching =====

  const fetchFullConversation = useCallback(
    async (agentId: string) => {
      try {
        const res = await fetch(`/api/messages/${agentId}?with=user`);
        const data = await res.json();
        if (data.messages) {
          const msgs = data.messages as Message[];
          const unreadIds = new Set(
            msgs.filter((m) => !m.read && m.to === agentId).map((m) => m.id)
          );

          // Optimistic update: 즉시 로컬 상태를 read: true로 설정
          const markedMsgs =
            unreadIds.size > 0
              ? msgs.map((m) =>
                  unreadIds.has(m.id) ? { ...m, read: true } : m
                )
              : msgs;
          setConversation(markedMsgs);

          if (msgs.length > 0) {
            lastFetchTimestampRef.current = msgs[msgs.length - 1].timestamp;
          }

          // 백그라운드에서 서버에 markAsRead 전송 (병렬 처리)
          if (unreadIds.size > 0) {
            // Batch mark as read requests in parallel for better performance
            Promise.all(
              Array.from(unreadIds).map((msgId) =>
                fetch(`/api/messages/${agentId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ messageId: msgId }),
                }).catch(() => {})
              )
            ).then(() => {
              // 모든 읽음 처리 완료 후 overview 갱신
              onRefreshOverview();
            });
          }
        }
      } catch (err) {
        console.error("Failed to fetch conversation:", err);
      }
    },
    [onRefreshOverview]
  );

  const fetchNewMessages = useCallback(
    async (agentId: string) => {
      if (!lastFetchTimestampRef.current) {
        return fetchFullConversation(agentId);
      }
      try {
        const since = encodeURIComponent(lastFetchTimestampRef.current);
        const res = await fetch(
          `/api/messages/${agentId}?with=user&since=${since}`
        );
        const data = await res.json();
        if (data.messages && (data.messages as Message[]).length > 0) {
          const newMsgs = data.messages as Message[];
          const unreadIds = new Set(
            newMsgs
              .filter((m) => !m.read && m.to === agentId)
              .map((m) => m.id)
          );

          // Optimistic update: 즉시 로컬 상태를 read: true로 설정
          const markedNewMsgs =
            unreadIds.size > 0
              ? newMsgs.map((m) =>
                  unreadIds.has(m.id) ? { ...m, read: true } : m
                )
              : newMsgs;

          setConversation((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const uniqueNew = markedNewMsgs.filter(
              (m) => !existingIds.has(m.id)
            );
            return uniqueNew.length > 0 ? [...prev, ...uniqueNew] : prev;
          });

          lastFetchTimestampRef.current =
            newMsgs[newMsgs.length - 1].timestamp;

          // 백그라운드에서 서버에 markAsRead 전송 (병렬 처리)
          if (unreadIds.size > 0) {
            Promise.all(
              Array.from(unreadIds).map((msgId) =>
                fetch(`/api/messages/${agentId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ messageId: msgId }),
                }).catch(() => {})
              )
            ).then(() => {
              // 모든 읽음 처리 완료 후 overview 갱신
              onRefreshOverview();
            });
          }

          // 에이전트 응답 수신 시 타이핑 표시 해제
          if (newMsgs.some((m) => m.from !== "user")) {
            setIsAgentTyping(false);
          }

          // Reset polling interval on new messages (adaptive polling)
          consecutiveEmptyFetches.current = 0;
          pollingIntervalRef.current = 1000;
        } else {
          // Exponential backoff when no new messages
          consecutiveEmptyFetches.current += 1;
          // Gradually increase interval: 1s → 2s → 3s → 5s (max)
          pollingIntervalRef.current = Math.min(
            1000 + consecutiveEmptyFetches.current * 1000,
            5000
          );
        }
      } catch (err) {
        console.error("Failed to fetch new messages:", err);
      }
    },
    [onRefreshOverview, fetchFullConversation]
  );

  // On agent switch
  useEffect(() => {
    if (!selectedAgent) return;
    lastFetchTimestampRef.current = null;
    setConversation([]);
    setIsAgentTyping(false);
    consecutiveEmptyFetches.current = 0;
    pollingIntervalRef.current = 1000;
    fetchFullConversation(selectedAgent);
  }, [selectedAgent, fetchFullConversation]);

  // Adaptive polling with exponential backoff
  useEffect(() => {
    if (!selectedAgent) return;

    let timeoutId: NodeJS.Timeout;

    const scheduleNext = () => {
      timeoutId = setTimeout(() => {
        fetchNewMessages(selectedAgent).then(() => {
          scheduleNext(); // Schedule next poll after current completes
        });
      }, pollingIntervalRef.current);
    };

    scheduleNext();

    return () => clearTimeout(timeoutId);
  }, [selectedAgent, fetchNewMessages]);

  // Auto-scroll
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    // Only auto-scroll if user is near bottom
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      100;
    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [conversation]);

  // Close type selector on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        typeSelectorRef.current &&
        !typeSelectorRef.current.contains(e.target as Node)
      ) {
        setShowTypeSelector(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ===== Send Message =====

  const handleSend = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!messageInput.trim() || !selectedAgent || sending) return;

    const content = messageInput.trim();
    const type = messageType;

    // Optimistic update: 사용자 메시지를 즉시 표시
    const optimisticMsg: Message = {
      id: `optimistic-${Date.now()}`,
      from: "user",
      to: selectedAgent,
      content,
      type,
      read: true,
      timestamp: new Date().toISOString(),
    };
    setConversation((prev) => [...prev, optimisticMsg]);
    setMessageInput("");

    // 사용자 메시지 전송 시 에이전트 타이핑 표시 활성화
    setIsAgentTyping(true);

    setSending(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "user",
          to: selectedAgent,
          content,
          type,
        }),
      });
      const data = await res.json();
      if (data.message) {
        // 서버에서 받은 실제 메시지로 교체
        setConversation((prev) =>
          prev.map((m) => (m.id === optimisticMsg.id ? data.message : m))
        );
      }
      // 즉시 overview 갱신
      onRefreshOverview();
    } catch (err) {
      console.error("Failed to send message:", err);
      // 실패 시 optimistic 메시지 제거 및 타이핑 표시 해제
      setConversation((prev) =>
        prev.filter((m) => m.id !== optimisticMsg.id)
      );
      setIsAgentTyping(false);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send, Shift+Enter for new line
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ===== Computed =====

  const getDisplay = (agentId: string) =>
    agentMap[agentId] || { emoji: "\u{1F916}", name: agentId };

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    agents.forEach((a) => {
      counts[a.config.category] = (counts[a.config.category] || 0) + 1;
    });
    return counts;
  }, [agents]);

  const handleCategoryToggle = (cat: string) => {
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const filteredGroupedAgents = useMemo(() => {
    const categoryOrder: Array<{
      key: "dev" | "business" | "ops";
      label: string;
      icon: string;
    }> = [
      { key: "dev", label: "Dev", icon: "\u{1F6E0}" },
      { key: "business", label: "Business", icon: "\u{1F4BC}" },
      { key: "ops", label: "Ops", icon: "\u2699\uFE0F" },
    ];

    const search = agentSearch.toLowerCase().trim();

    return categoryOrder.map(({ key, label, icon }) => ({
      key,
      label,
      icon,
      agents: [...agents]
        .filter((a) => {
          if (a.config.category !== key) return false;
          if (categoryFilter.size > 0 && !categoryFilter.has(key))
            return false;
          if (search) {
            return (
              a.config.name.toLowerCase().includes(search) ||
              a.config.id.toLowerCase().includes(search) ||
              a.config.role.toLowerCase().includes(search)
            );
          }
          return true;
        })
        .sort((a, b) => {
          const unreadA = agentOverview[a.config.id]?.unread || 0;
          const unreadB = agentOverview[b.config.id]?.unread || 0;
          if (unreadB !== unreadA) return unreadB - unreadA;
          return a.config.name.localeCompare(b.config.name);
        }),
    }));
  }, [agents, agentOverview, agentSearch, categoryFilter]);

  const totalFilteredAgents = filteredGroupedAgents.reduce(
    (sum, g) => sum + g.agents.length,
    0
  );

  const selectedAgentData = selectedAgent
    ? agents.find((a) => a.config.id === selectedAgent)
    : null;

  const selectedAgentLiveStatus = selectedAgentData?.status;

  // ===== Render =====

  return (
    <div className="flex flex-col md:flex-row gap-0 min-h-[560px] bg-gray-900 rounded-2xl border border-gray-700/50 overflow-hidden shadow-lg">
      {/* ===== Left Sidebar: Agent List ===== */}
      <div className="md:w-72 flex-shrink-0 border-r border-gray-700/50 bg-gray-850 flex flex-col">
        {/* Sidebar header */}
        <div className="p-3 border-b border-gray-700/50 space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">
              Agents
            </p>
            <span className="text-[10px] text-gray-600">
              {totalFilteredAgents}
            </span>
          </div>
          <AgentSearchBar value={agentSearch} onChange={setAgentSearch} />
          <CategoryFilters
            active={categoryFilter}
            onToggle={handleCategoryToggle}
            counts={categoryCounts}
          />
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto max-h-[200px] md:max-h-none scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-700">
          {totalFilteredAgents === 0 ? (
            <div className="p-4 text-center text-gray-600 text-xs">
              {agentSearch
                ? `"${agentSearch}" \uACB0\uACFC \uC5C6\uC74C`
                : "\uC5D0\uC774\uC804\uD2B8 \uC5C6\uC74C"}
            </div>
          ) : (
            filteredGroupedAgents.map(
              (group) =>
                group.agents.length > 0 && (
                  <div key={group.key}>
                    <div className="px-3 py-1.5 bg-gray-800/60 border-b border-gray-700/30 sticky top-0 z-10">
                      <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-widest">
                        {group.icon} {group.label}
                      </p>
                    </div>
                    {group.agents.map((agent) => {
                      const overview = agentOverview[agent.config.id];
                      const unread = overview?.unread || 0;
                      const isSelected = selectedAgent === agent.config.id;
                      const latestPreview = overview?.latest?.content;

                      return (
                        <button
                          key={agent.config.id}
                          onClick={() => setSelectedAgent(agent.config.id)}
                          className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-all focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
                            isSelected
                              ? "bg-blue-600/15 border-l-2 border-l-blue-500"
                              : "hover:bg-gray-700/30 border-l-2 border-l-transparent"
                          }`}
                        >
                          {/* Agent avatar with status dot */}
                          <div className="relative flex-shrink-0">
                            <div
                              className={`w-9 h-9 rounded-full flex items-center justify-center text-base ${
                                isSelected
                                  ? "bg-blue-600/20 border border-blue-500/30"
                                  : "bg-gray-700/60 border border-gray-600/30"
                              }`}
                            >
                              {agent.config.emoji}
                            </div>
                            {/* Online status dot */}
                            <div
                              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-gray-800 ${
                                agent.status === "running"
                                  ? "bg-green-500"
                                  : agent.status === "error"
                                  ? "bg-red-500"
                                  : agent.status === "waiting"
                                  ? "bg-yellow-500"
                                  : "bg-gray-600"
                              }`}
                            />
                          </div>

                          {/* Agent info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span
                                className={`text-sm font-medium truncate ${
                                  isSelected ? "text-white" : "text-gray-200"
                                }`}
                              >
                                {agent.config.name}
                              </span>
                              <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                                {overview?.latest && (
                                  <span className="text-[10px] text-gray-600">
                                    {relativeTime(overview.latest.timestamp)}
                                  </span>
                                )}
                                {unread > 0 && (
                                  <span className="bg-blue-600 text-white text-[10px] rounded-full px-1.5 py-0.5 min-w-[18px] text-center font-medium leading-none">
                                    {unread}
                                  </span>
                                )}
                              </div>
                            </div>
                            {latestPreview && (
                              <p
                                className={`text-[11px] truncate mt-0.5 ${
                                  unread > 0
                                    ? "text-gray-300 font-medium"
                                    : "text-gray-500"
                                }`}
                              >
                                {latestPreview}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )
            )
          )}
        </div>
      </div>

      {/* ===== Right Panel: Conversation ===== */}
      <div className="flex-1 flex flex-col min-w-0 bg-gray-900/50">
        {!selectedAgent ? (
          <EmptyState />
        ) : (
          <>
            {/* Chat header */}
            <div className="px-4 py-2.5 border-b border-gray-700/50 flex items-center justify-between bg-gray-800/30 backdrop-blur-sm">
              <div className="flex items-center gap-3 min-w-0">
                {/* Back button for mobile */}
                <button
                  onClick={() => setSelectedAgent(null)}
                  className="md:hidden text-gray-400 hover:text-white transition-colors p-1 -ml-1"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      d="M15 19l-7-7 7-7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-lg border ${
                    selectedAgentLiveStatus === "running"
                      ? "bg-green-500/10 border-green-500/30"
                      : "bg-gray-700 border-gray-600/50"
                  }`}
                >
                  {getDisplay(selectedAgent).emoji}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">
                    {getDisplay(selectedAgent).name}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[11px] ${
                        selectedAgentLiveStatus === "running"
                          ? "text-green-400"
                          : selectedAgentLiveStatus === "error"
                          ? "text-red-400"
                          : "text-gray-500"
                      }`}
                    >
                      {selectedAgentLiveStatus === "running"
                        ? "\u2022 \uC2E4\uD589\uC911"
                        : selectedAgentLiveStatus === "error"
                        ? "\u2022 \uC624\uB958"
                        : selectedAgentLiveStatus === "waiting"
                        ? "\u2022 \uB300\uAE30\uC911"
                        : "\u2022 \uC720\uD734"}
                    </span>
                    <span className="text-[11px] text-gray-600 truncate">
                      {selectedAgentData?.config.role}
                    </span>
                  </div>
                </div>
              </div>

              {/* Header actions */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    lastFetchTimestampRef.current = null;
                    fetchFullConversation(selectedAgent);
                  }}
                  className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-gray-700/50 transition-colors"
                  title={"\uC0C8\uB85C\uACE0\uCE68"}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
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
              className="flex-1 overflow-y-auto px-4 py-3 max-h-[500px] sm:max-h-[550px] scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-700"
            >
              {conversation.length === 0 ? (
                <EmptyConversation
                  agentName={getDisplay(selectedAgent).name}
                />
              ) : (
                <>
                  {conversation.map((msg, i) => {
                    const prev = i > 0 ? conversation[i - 1] : undefined;
                    const isConsecutive =
                      !!prev &&
                      prev.from === msg.from &&
                      new Date(msg.timestamp).getTime() -
                        new Date(prev.timestamp).getTime() <
                        120000;

                    return (
                      <div key={msg.id}>
                        {shouldShowDateSeparator(msg, prev) && (
                          <DateSeparator timestamp={msg.timestamp} />
                        )}
                        <MessageBubble
                          message={msg}
                          agentMap={agentMap}
                          isConsecutive={isConsecutive && !shouldShowDateSeparator(msg, prev)}
                        />
                      </div>
                    );
                  })}

                  {/* Typing indicator */}
                  {isAgentTyping && (
                    <TypingIndicator
                      agentName={getDisplay(selectedAgent).name}
                    />
                  )}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* ===== Input Area ===== */}
            <div className="border-t border-gray-700/50 bg-gray-800/30 p-3">
              {/* Type selector (floating popup) */}
              {showTypeSelector && (
                <div
                  ref={typeSelectorRef}
                  className="mb-2 flex flex-wrap gap-1.5 p-2 bg-gray-800 border border-gray-700/50 rounded-xl animate-in fade-in slide-in-from-bottom-2 duration-150"
                >
                  {(
                    Object.entries(MSG_TYPE_CONFIG) as [
                      Message["type"],
                      (typeof MSG_TYPE_CONFIG)[Message["type"]]
                    ][]
                  ).map(([type, cfg]) => (
                    <button
                      key={type}
                      onClick={() => {
                        setMessageType(type);
                        setShowTypeSelector(false);
                      }}
                      className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all ${
                        messageType === type
                          ? "bg-blue-600/20 text-blue-300 border border-blue-500/30"
                          : "bg-gray-700/50 text-gray-400 border border-transparent hover:bg-gray-700 hover:text-gray-200"
                      }`}
                    >
                      {cfg.icon || "\u{1F4DD}"}{" "}
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </button>
                  ))}
                </div>
              )}

              <form
                onSubmit={handleSend}
                className="flex items-end gap-2 bg-gray-800/60 border border-gray-700/50 rounded-xl px-3 py-1 focus-within:border-blue-500/40 focus-within:bg-gray-800/80 transition-all"
              >
                {/* Type toggle button */}
                <button
                  type="button"
                  onClick={() => setShowTypeSelector(!showTypeSelector)}
                  className={`flex-shrink-0 p-1.5 rounded-lg transition-all self-end mb-0.5 ${
                    messageType !== "text"
                      ? "text-blue-400 bg-blue-500/10"
                      : "text-gray-500 hover:text-gray-300 hover:bg-gray-700/50"
                  }`}
                  title={`\uBA54\uC2DC\uC9C0 \uD0C0\uC785: ${messageType}`}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>

                {/* Active type badge */}
                {messageType !== "text" && (
                  <div className="flex-shrink-0 self-end mb-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium uppercase tracking-wider">
                      {MSG_TYPE_CONFIG[messageType].icon}{" "}
                      {messageType}
                    </span>
                  </div>
                )}

                {/* Input */}
                <AutoResizeTextarea
                  value={messageInput}
                  onChange={setMessageInput}
                  onKeyDown={handleKeyDown}
                  placeholder={"\uBA54\uC2DC\uC9C0\uB97C \uC785\uB825\uD558\uC138\uC694... (Enter \uC804\uC1A1, Shift+Enter \uC904\uBC14\uAFC8)"}
                  disabled={sending}
                />

                {/* Send button */}
                <button
                  type="submit"
                  disabled={sending || !messageInput.trim()}
                  className={`flex-shrink-0 p-2 rounded-xl transition-all self-end mb-0.5 ${
                    messageInput.trim()
                      ? "bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-600/20"
                      : "text-gray-600 cursor-not-allowed"
                  }`}
                >
                  {sending ? (
                    <svg
                      className="w-4 h-4 animate-spin"
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
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path
                        d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </form>

              {/* Keyboard shortcut hint */}
              <div className="flex items-center justify-between mt-1.5 px-1">
                <span className="text-[10px] text-gray-600">
                  <kbd className="px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-[9px]">
                    Enter
                  </kbd>{" "}
                  {"\uC804\uC1A1"}{" "}
                  <kbd className="px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-[9px]">
                    Shift+Enter
                  </kbd>{" "}
                  {"\uC904\uBC14\uAFC8"}
                </span>
                {messageInput.length > 0 && (
                  <span
                    className={`text-[10px] ${
                      messageInput.length > 1000
                        ? "text-amber-500"
                        : "text-gray-600"
                    }`}
                  >
                    {messageInput.length}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
