"use client";

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type FormEvent,
} from "react";
import { useToastContext } from "@/contexts/ToastContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { relativeTime } from "@/lib/format-utils";
import { useSessionSSE } from "@/hooks/useSessionSSE";
import type {
  ConversationMessage,
  ConversationStats,
  ConversationStatus,
} from "@/lib/conversations";

// ===== Types =====

interface SessionsPanelProps {
  agentMap: Record<string, { emoji: string; name: string }>;
}

// ===== Sub-Components =====

function StatusBadge({ status }: { status: ConversationStatus }) {
  const config = {
    active: { bg: "bg-green-500/10", text: "text-green-400", label: "활성" },
    completed: { bg: "bg-blue-500/10", text: "text-blue-400", label: "완료" },
    archived: { bg: "bg-gray-500/10", text: "text-gray-500", label: "보관" },
  };

  const { bg, text, label } = config[status];

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${bg} ${text} font-medium`}>
      {label}
    </span>
  );
}

function ParticipantAvatars({
  participants,
  agentMap,
  max = 3,
}: {
  participants: string[];
  agentMap: Record<string, { emoji: string; name: string }>;
  max?: number;
}) {
  const visible = participants.slice(0, max);
  const overflow = participants.length - max;

  return (
    <div className="flex -space-x-2">
      {visible.map((participantId) => {
        const agent = agentMap[participantId] || { emoji: "🤖", name: participantId };
        return (
          <div
            key={participantId}
            className="w-6 h-6 rounded-full bg-gray-700 border-2 border-gray-800 flex items-center justify-center text-xs"
            title={agent.name}
          >
            {agent.emoji}
          </div>
        );
      })}
      {overflow > 0 && (
        <div className="w-6 h-6 rounded-full bg-gray-600 border-2 border-gray-800 flex items-center justify-center text-[10px] text-gray-300">
          +{overflow}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center p-12">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 mx-auto mb-4 rounded-3xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 flex items-center justify-center border border-gray-700/50">
          <span className="text-4xl">💬</span>
        </div>
        <h3 className="text-lg font-semibold text-gray-300 mb-2">대화가 없습니다</h3>
        <p className="text-sm text-gray-500">
          새 대화 세션을 생성하여 에이전트와 협업을 시작하세요
        </p>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  agentMap,
}: {
  message: ConversationMessage;
  agentMap: Record<string, { emoji: string; name: string }>;
}) {
  const isUser = message.from === "user";
  const sender = agentMap[message.from] || { emoji: "🤖", name: message.from };

  return (
    <div
      className={`flex gap-2.5 mt-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
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

      <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} max-w-[75%]`}>
        <span className="text-[11px] text-gray-500 font-medium mb-0.5 ml-1">
          {sender.name}
        </span>

        <div
          className={`rounded-2xl px-3.5 py-2 border ${
            isUser
              ? "bg-blue-600/90 border-blue-500/50 text-white rounded-br-md"
              : "bg-gray-700/80 border-gray-600/50 text-gray-200 rounded-bl-md"
          }`}
        >
          <div className="prose prose-invert prose-sm max-w-none text-[13px] leading-relaxed break-words [&_p]:m-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>

          <div className="flex items-center gap-1 mt-1 justify-end">
            <span className="text-[10px] opacity-40">
              {new Date(message.createdAt).toLocaleTimeString("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Main Component =====

export default function SessionsPanel({ agentMap }: SessionsPanelProps) {
  const { addToast } = useToastContext();
  const [conversations, setConversations] = useState<ConversationStats[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    null
  );
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | "all">("all");

  // Create form state
  const [createTitle, setCreateTitle] = useState("");
  const [createParticipants, setCreateParticipants] = useState<string[]>(["user"]);
  const [createContext, setCreateContext] = useState("{}");

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }

      const res = await fetch(`/api/conversations?${params}`);
      const data = await res.json();

      if (data.conversations) {
        setConversations(data.conversations);
      }
    } catch (err) {
      console.error("Failed to fetch conversations:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  // Fetch messages for selected conversation
  const fetchMessages = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`);
      const data = await res.json();

      if (data.messages) {
        setMessages(data.messages);
      }
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Load messages when conversation selected
  useEffect(() => {
    if (selectedConversationId) {
      fetchMessages(selectedConversationId);
    } else {
      setMessages([]);
    }
  }, [selectedConversationId, fetchMessages]);

  // SSE handlers
  useSessionSSE({
    onConversationCreated: () => {
      // Refresh the list to get full stats
      fetchConversations();
    },
    onConversationUpdated: () => {
      // Refresh the list to get updated stats
      fetchConversations();
    },
    onConversationDeleted: ({ conversationId }) => {
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      if (selectedConversationId === conversationId) {
        setSelectedConversationId(null);
      }
    },
    onMessageAdded: ({ conversationId, message }) => {
      if (selectedConversationId === conversationId) {
        setMessages((prev) => [...prev, message]);
      }
      // Refresh list to update message counts
      fetchConversations();
    },
  });

  // Create conversation
  const handleCreateConversation = async (e: FormEvent) => {
    e.preventDefault();

    try {
      let contextObj = {};
      try {
        contextObj = JSON.parse(createContext);
      } catch {
        addToast("컨텍스트 필드의 JSON이 유효하지 않습니다", "error");
        return;
      }

      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createTitle,
          participants: createParticipants,
          context: contextObj,
          createdBy: "user",
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "대화 생성 실패");
      }

      setShowCreateModal(false);
      setCreateTitle("");
      setCreateParticipants(["user"]);
      setCreateContext("{}");
      fetchConversations();
    } catch (err) {
      console.error("Failed to create conversation:", err);
      addToast(err instanceof Error ? err.message : "대화 생성 실패", "error");
    }
  };

  // Send message
  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !selectedConversationId || sending) return;

    setSending(true);
    try {
      const res = await fetch(
        `/api/conversations/${selectedConversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "user",
            content: messageInput.trim(),
            type: "text",
          }),
        }
      );

      if (!res.ok) {
        throw new Error("메시지 전송 실패");
      }

      setMessageInput("");
    } catch (err) {
      console.error("Failed to send message:", err);
      addToast("메시지 전송 실패", "error");
    } finally {
      setSending(false);
    }
  };

  // Update conversation status
  const handleUpdateStatus = async (
    conversationId: string,
    newStatus: ConversationStatus
  ) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        throw new Error("상태 변경 실패");
      }

      fetchConversations();
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId),
    [conversations, selectedConversationId]
  );

  const filteredConversations = useMemo(
    () =>
      statusFilter === "all"
        ? conversations
        : conversations.filter((c) => c.status === statusFilter),
    [conversations, statusFilter]
  );

  return (
    <div className="flex flex-col md:flex-row gap-0 min-h-[560px] bg-gray-900 rounded-2xl border border-gray-700/50 overflow-hidden shadow-lg">
      {/* Left Sidebar: Conversation List — hidden on mobile when a conversation is selected */}
      <div className={`md:w-80 flex-shrink-0 border-r border-gray-700/50 bg-gray-800/80 flex flex-col ${selectedConversationId ? "hidden md:flex" : "flex"}`}>
        {/* Header */}
        <div className="p-3 border-b border-gray-700/50 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-300">대화 목록</h3>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg transition-colors"
            >
              + 새 대화
            </button>
          </div>

          {/* Status filter */}
          <div className="flex gap-1">
            {(["all", "active", "completed", "archived"] as const).map((status) => {
              const labels: Record<string, string> = { all: "전체", active: "활성", completed: "완료", archived: "보관" };
              return (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`text-xs px-2 py-1 rounded-md transition-colors ${
                    statusFilter === status
                      ? "bg-gray-600/60 text-gray-200 border border-gray-500/30"
                      : "bg-gray-800/50 text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {labels[status]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-700">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-4 text-gray-500 text-sm">
              <div className="w-4 h-4 border-2 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
              불러오는 중...
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">
              대화가 없습니다
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = selectedConversationId === conv.id;
              const unreadCount = Object.values(conv.readStatus || {}).reduce(
                (sum, status) => sum + (status.unread || 0),
                0
              );

              return (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConversationId(conv.id)}
                  className={`w-full text-left px-3 py-3 flex flex-col gap-2 transition-all border-l-2 ${
                    isSelected
                      ? "bg-blue-600/15 border-l-blue-500"
                      : "hover:bg-gray-700/30 border-l-transparent"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4
                      className={`text-sm font-medium truncate ${
                        isSelected ? "text-white" : "text-gray-200"
                      }`}
                    >
                      {conv.title}
                    </h4>
                    <StatusBadge status={conv.status} />
                  </div>

                  <div className="flex items-center justify-between">
                    <ParticipantAvatars participants={conv.participants} agentMap={agentMap} />
                    <div className="flex items-center gap-2">
                      {conv.lastMessageAt && (
                        <span className="text-[10px] text-gray-500">
                          {relativeTime(conv.lastMessageAt)}
                        </span>
                      )}
                      {unreadCount > 0 && (
                        <span className="bg-red-600 text-white text-[10px] rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                          {unreadCount}
                        </span>
                      )}
                    </div>
                  </div>

                  {conv.messageCount > 0 && (
                    <span className="text-[11px] text-gray-500">
                      {conv.messageCount}개 메시지
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Panel: Conversation Detail */}
      <div className="flex-1 flex flex-col min-w-0 bg-gray-900/50">
        {!selectedConversation ? (
          <EmptyState />
        ) : (
          <>
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/30 flex items-center justify-between">
              {/* Back button — mobile only */}
              <button
                onClick={() => setSelectedConversationId(null)}
                className="md:hidden mr-2 flex-shrink-0 flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors"
                aria-label="목록으로"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                목록
              </button>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-white truncate">
                  {selectedConversation.title}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <ParticipantAvatars
                    participants={selectedConversation.participants}
                    agentMap={agentMap}
                    max={5}
                  />
                  <span className="text-xs text-gray-500">
                    {selectedConversation.participants.length}명 참여
                  </span>
                </div>
              </div>

              {/* Status dropdown */}
              <select
                value={selectedConversation.status}
                onChange={(e) =>
                  handleUpdateStatus(
                    selectedConversation.id,
                    e.target.value as ConversationStatus
                  )
                }
                className="bg-gray-700 border border-gray-600 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
              >
                <option value="active">활성</option>
                <option value="completed">완료</option>
                <option value="archived">보관</option>
              </select>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-700">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-500 text-sm">메시지가 없습니다</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} agentMap={agentMap} />
                ))
              )}
            </div>

            {/* Message input */}
            <div className="border-t border-gray-700/50 bg-gray-800/30 p-3">
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder="메시지를 입력하세요..."
                  disabled={sending || selectedConversation.status !== "active"}
                  className="flex-1 bg-gray-700/50 border border-gray-600/50 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={
                    sending ||
                    !messageInput.trim() ||
                    selectedConversation.status !== "active"
                  }
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? "전송 중..." : "전송"}
                </button>
              </form>
              {selectedConversation.status !== "active" && (
                <p className="text-xs text-amber-500 mt-2">
                  이 대화는 {selectedConversation.status === "completed" ? "완료" : "보관"} 상태입니다. 메시지를 보내려면 &quot;활성&quot; 상태로 변경하세요.
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 max-w-md w-full">
            <h2 className="text-lg font-bold text-white mb-4">새 대화 생성</h2>

            <form onSubmit={handleCreateConversation} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">제목</label>
                <input
                  type="text"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  required
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  참여자 (쉼표로 구분)
                </label>
                <input
                  type="text"
                  value={createParticipants.join(", ")}
                  onChange={(e) =>
                    setCreateParticipants(
                      e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                    )
                  }
                  placeholder="user, agent-id-1, agent-id-2"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  컨텍스트 (JSON)
                </label>
                <textarea
                  value={createContext}
                  onChange={(e) => setCreateContext(e.target.value)}
                  rows={3}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
                >
                  생성
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
