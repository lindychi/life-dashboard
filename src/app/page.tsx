"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { copyToClipboard } from "@/lib/clipboard";
import LiveMonitor from "@/components/LiveMonitor";
import HistoryEntryCard from "@/components/HistoryEntryCard";
import PendingRepliesBanner from "@/components/PendingRepliesBanner";
import { looksLikeQuestion, getVisibleRange, filterEntries } from "@/lib/performance-utils";

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

interface Project {
  name: string;
  description: string;
  status: string;
  progress: number;
  url?: string;
  kpis: { label: string; value: string }[];
}

interface HistoryEntry {
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
  metadata?: Record<string, unknown>;
  timestamp: string;
}

interface Message {
  id: string;
  from: string;
  to: string;
  content: string;
  type: "text" | "task" | "result" | "question" | "answer";
  read: boolean;
  timestamp: string;
}

interface AgentMessageOverview {
  unread: number;
  latest?: Message;
}

// ===== Data =====

const projects: Project[] = [
  {
    name: "MumMum",
    description: "영어 학습 앱",
    status: "🟢 배포됨",
    progress: 80,
    url: "https://mummum.up.railway.app",
    kpis: [
      { label: "목표", value: "$10K MRR" },
      { label: "현재", value: "성장 단계" },
    ],
  },
  {
    name: "Rezoom",
    description: "이력서 서비스",
    status: "🟡 진행중",
    progress: 20,
    kpis: [{ label: "현재 작업", value: "Import 페이지" }],
  },
  {
    name: "정화의 영역",
    description: "던전 빌딩 로그라이트",
    status: "📝 기획중",
    progress: 15,
    kpis: [{ label: "엔진", value: "Godot 4" }],
  },
  {
    name: "안부",
    description: "독거인을 위한 안부 알림 앱",
    status: "💡 아이디어",
    progress: 0,
    kpis: [{ label: "타겟", value: "독거 노인/1인 가구" }],
  },
  {
    name: "크레딧컨설팅",
    description: "빚쟁이를 위한 빚 관리 웹사이트",
    status: "🟡 진행중",
    progress: 10,
    kpis: [{ label: "타겟", value: "대출/빚 있는 사람" }],
  },
  {
    name: "LifeDashboard",
    description: "이 대시보드",
    status: "🆕 시작",
    progress: 5,
    kpis: [],
  },
];

// ===== Components =====
function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full bg-gray-700 rounded-full h-2">
      <div
        className="bg-green-500 h-2 rounded-full transition-all"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: AgentRuntime["status"] }) {
  const styles = {
    running: "bg-green-500/20 text-green-400 border-green-500/30",
    idle: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    waiting: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    error: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  const labels = {
    running: "🟢 실행중",
    idle: "⚫ 대기",
    waiting: "🟡 대기중",
    error: "🔴 에러",
  };
  return (
    <span className={`px-2 py-1 rounded-full text-xs border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

const CATEGORY_BADGE_STYLES: Record<AgentConfig["category"], string> = {
  dev: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  business: "bg-green-500/20 text-green-400 border-green-500/30",
  ops: "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

const CATEGORY_LABELS: Record<AgentConfig["category"], string> = {
  dev: "dev",
  business: "business",
  ops: "ops",
};

function AgentCard({
  agent,
  onAddTask,
  onStartTask,
}: {
  agent: AgentRuntime;
  onAddTask: (agentId: string, task: string) => void;
  onStartTask: (agentId: string, task: string) => void;
}) {
  const [newTask, setNewTask] = useState("");
  const [showInput, setShowInput] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTask.trim()) {
      onAddTask(agent.config.id, newTask.trim());
      setNewTask("");
      setShowInput(false);
    }
  };

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 hover:border-gray-600 transition-all">
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{agent.config.emoji}</span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold text-white">{agent.config.name}</h3>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${CATEGORY_BADGE_STYLES[agent.config.category]}`}
              >
                {CATEGORY_LABELS[agent.config.category]}
              </span>
            </div>
            <p className="text-gray-500 text-xs">{agent.config.role}</p>
          </div>
        </div>
        <StatusBadge status={agent.status} />
      </div>

      {agent.currentTask && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-3">
          <p className="text-xs text-blue-400 mb-1">현재 작업</p>
          <p className="text-sm text-white">{agent.currentTask}</p>
        </div>
      )}

      {/* Task Stack */}
      <div className="mb-3">
        <div className="flex justify-between items-center mb-2">
          <p className="text-xs text-gray-500">
            Task Stack ({agent.stack.length})
          </p>
          <button
            onClick={() => setShowInput(!showInput)}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            + 추가
          </button>
        </div>

        {showInput && (
          <form onSubmit={handleSubmit} className="mb-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                placeholder="완료 후 실행할 작업..."
                className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                autoFocus
              />
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded text-sm"
              >
                추가
              </button>
            </div>
          </form>
        )}

        {agent.stack.length > 0 ? (
          <div className="space-y-1">
            {agent.stack.map((task, i) => (
              <div
                key={task.id}
                className="flex items-center gap-2 text-sm bg-gray-700/50 rounded px-2 py-1"
              >
                <span className="text-gray-500">{i + 1}.</span>
                <span className="text-gray-300 flex-1 truncate">
                  {task.description}
                </span>
                <span className="text-xs text-gray-500">
                  {task.trigger === "on_complete" ? "chain" : "pause"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-600 italic">스택 비어있음</p>
        )}
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2">
        {agent.status === "idle" && agent.stack.length > 0 && (
          <button
            onClick={() => onStartTask(agent.config.id, agent.stack[0].description)}
            className="flex-1 bg-green-600 hover:bg-green-500 text-white text-sm py-2 rounded-lg transition-colors"
          >
            스택 실행
          </button>
        )}
        {agent.status === "idle" && (
          <button
            onClick={() => setShowInput(true)}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-2 rounded-lg transition-colors"
          >
            + 작업 할당
          </button>
        )}
        {agent.status === "running" && (
          <button className="flex-1 bg-gray-700 text-gray-400 text-sm py-2 rounded-lg cursor-not-allowed">
            실행중...
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="mt-3 pt-3 border-t border-gray-700 flex justify-between text-xs text-gray-500">
        <span>오늘 완료: {agent.completedToday}</span>
        {agent.sessionKey && <span>세션: {agent.sessionKey}</span>}
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <div className="bg-gray-800 rounded-xl p-5 hover:bg-gray-750 transition-colors border border-gray-700">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h2 className="text-lg font-bold text-white">{project.name}</h2>
          <p className="text-gray-400 text-xs">{project.description}</p>
        </div>
        <span className="text-sm">{project.status}</span>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>진행률</span>
          <span>{project.progress}%</span>
        </div>
        <ProgressBar progress={project.progress} />
      </div>

      {project.kpis.length > 0 && (
        <div className="space-y-1">
          {project.kpis.map((kpi, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-gray-400">{kpi.label}</span>
              <span className="text-white">{kpi.value}</span>
            </div>
          ))}
        </div>
      )}

      {project.url && (
        <a
          href={project.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block text-center text-sm text-blue-400 hover:text-blue-300"
        >
          방문하기 →
        </a>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm sm:text-base font-medium transition-colors whitespace-nowrap ${
        active
          ? "bg-blue-600 text-white"
          : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

// ===== Helper =====
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

const HISTORY_TYPE_LABELS_FOR_FILTERS: Record<HistoryEntry["type"], { label: string; color: string }> = {
  task_started: { label: "시작", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  task_completed: { label: "완료", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  task_failed: { label: "실패", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  message_sent: { label: "발신", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  message_received: { label: "수신", color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" },
  status_change: { label: "상태", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  command_received: { label: "명령", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  output: { label: "Output", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
};

const MSG_TYPE_STYLES: Record<Message["type"], string> = {
  text: "bg-gray-700 border-gray-600 text-gray-200",
  task: "bg-blue-500/10 border-blue-500/30 text-blue-200",
  result: "bg-green-500/10 border-green-500/30 text-green-200",
  question: "bg-yellow-500/10 border-yellow-500/30 text-yellow-200",
  answer: "bg-purple-500/10 border-purple-500/30 text-purple-200",
};

const MSG_TYPE_LABELS: Record<Message["type"], string> = {
  text: "",
  task: "TASK",
  result: "RESULT",
  question: "QUESTION",
  answer: "ANSWER",
};

// getAgentDisplay is now dynamic, created inside Home via agentMap useMemo

// ===== History Panel Component =====
function HistoryPanel({
  historyData,
  agents,
  agentMap,
}: {
  historyData: Record<string, HistoryEntry[]>;
  agents: AgentRuntime[];
  agentMap: Record<string, { emoji: string; name: string }>;
}) {
  const [filterAgent, setFilterAgent] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const getDisplay = (agentId: string) =>
    agentMap[agentId] || { emoji: "\u{1F916}", name: agentId };

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
              {HISTORY_TYPE_LABELS_FOR_FILTERS[t as keyof typeof HISTORY_TYPE_LABELS_FOR_FILTERS]?.label || t}
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

// ===== Messages Panel Component =====
function MessagesPanel({
  agents,
  agentOverview,
  agentMap,
  onRefreshOverview,
}: {
  agents: AgentRuntime[];
  agentOverview: Record<string, AgentMessageOverview>;
  agentMap: Record<string, { emoji: string; name: string }>;
  onRefreshOverview: () => void;
}) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [messageType, setMessageType] = useState<Message["type"]>("text");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversation when agent is selected
  const fetchConversation = useCallback(async (agentId: string) => {
    try {
      const res = await fetch(`/api/messages/${agentId}?with=user`);
      const data = await res.json();
      if (data.messages) {
        setConversation(data.messages);
      }
    } catch (err) {
      console.error("Failed to fetch conversation:", err);
    }
  }, []);

  useEffect(() => {
    if (!selectedAgent) return;
    fetchConversation(selectedAgent);
    const interval = setInterval(() => fetchConversation(selectedAgent), 3000);
    return () => clearInterval(interval);
  }, [selectedAgent, fetchConversation]);

  // Scroll to bottom when conversation updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !selectedAgent || sending) return;

    setSending(true);
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "user",
          to: selectedAgent,
          content: messageInput.trim(),
          type: messageType,
        }),
      });
      setMessageInput("");
      // Refresh conversation and overview
      await fetchConversation(selectedAgent);
      onRefreshOverview();
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setSending(false);
    }
  };

  const getDisplay = (agentId: string) =>
    agentMap[agentId] || { emoji: "\u{1F916}", name: agentId };

  // Sort agents by unread count (descending), then alphabetically
  const sortedAgents = [...agents].sort((a, b) => {
    const unreadA = agentOverview[a.config.id]?.unread || 0;
    const unreadB = agentOverview[b.config.id]?.unread || 0;
    if (unreadB !== unreadA) return unreadB - unreadA;
    return a.config.name.localeCompare(b.config.name);
  });

  return (
    <div className="flex flex-col md:flex-row gap-4 min-h-[500px]">
      {/* Left sidebar: Agent list */}
      <div className="md:w-64 flex-shrink-0">
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <div className="p-3 border-b border-gray-700">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
              Agents
            </p>
          </div>
          <div className="divide-y divide-gray-700">
            {sortedAgents.map((agent) => {
              const overview = agentOverview[agent.config.id];
              const unread = overview?.unread || 0;
              const isSelected = selectedAgent === agent.config.id;
              return (
                <button
                  key={agent.config.id}
                  onClick={() => setSelectedAgent(agent.config.id)}
                  className={`w-full text-left px-3 py-3 flex items-center gap-3 transition-colors ${
                    isSelected
                      ? "bg-blue-600/20 border-l-2 border-l-blue-500"
                      : "hover:bg-gray-700/50"
                  }`}
                >
                  <span className="text-xl">{agent.config.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white">
                        {agent.config.name}
                      </span>
                      {unread > 0 && (
                        <span className="bg-blue-600 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                          {unread}
                        </span>
                      )}
                    </div>
                    {overview?.latest && (
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {overview.latest.content}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right panel: Conversation */}
      <div className="flex-1 flex flex-col bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        {!selectedAgent ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-gray-500 text-lg">Select an agent to chat</p>
              <p className="text-gray-600 text-sm mt-1">
                Choose an agent from the sidebar to start a conversation
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-3">
              <span className="text-xl">
                {getDisplay(selectedAgent).emoji}
              </span>
              <div>
                <h3 className="text-sm font-bold text-white">
                  {getDisplay(selectedAgent).name}
                </h3>
                <p className="text-xs text-gray-500">
                  {agents.find((a) => a.config.id === selectedAgent)?.config.role}
                </p>
              </div>
            </div>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[400px]">
              {conversation.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 text-sm">No messages yet</p>
                  <p className="text-gray-600 text-xs mt-1">
                    Send the first message below
                  </p>
                </div>
              ) : (
                conversation.map((msg) => {
                  const isUser = msg.from === "user";
                  const style = MSG_TYPE_STYLES[msg.type];
                  const typeLabel = MSG_TYPE_LABELS[msg.type];
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-xl px-4 py-2.5 border ${style}`}
                      >
                        {typeLabel && (
                          <span className="text-[10px] font-bold uppercase tracking-wider opacity-70 block mb-1">
                            {typeLabel}
                          </span>
                        )}
                        <p className="text-sm break-words">{msg.content}</p>
                        <p className="text-[10px] opacity-50 mt-1 text-right">
                          {relativeTime(msg.timestamp)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <form
              onSubmit={handleSend}
              className="p-3 border-t border-gray-700 flex gap-2"
            >
              <select
                value={messageType}
                onChange={(e) => setMessageType(e.target.value as Message["type"])}
                className="bg-gray-700 border border-gray-600 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-blue-500 w-20 sm:w-24"
              >
                <option value="text">Text</option>
                <option value="task">Task</option>
                <option value="question">Question</option>
                <option value="result">Result</option>
                <option value="answer">Answer</option>
              </select>
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={sending || !messageInput.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {sending ? "..." : "Send"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ===== Types for API =====
interface GatewayConnection {
  id: string;
  status: "connected" | "disconnected";
  lastHeartbeat: string;
}

interface User {
  email: string;
}

// ===== Main =====
export default function Home() {
  const [activeTab, setActiveTab] = useState<
    "agents" | "projects" | "finance" | "history" | "messages"
  >("agents");
  const [agents, setAgents] = useState<AgentRuntime[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<"all" | "dev" | "business" | "ops">("all");
  const [user, setUser] = useState<User | null>(null);
  const [gateways, setGateways] = useState<GatewayConnection[]>([]);
  const [historyData, setHistoryData] = useState<Record<string, HistoryEntry[]>>({});
  const [agentOverview, setAgentOverview] = useState<Record<string, AgentMessageOverview>>({});
  const [totalUnread, setTotalUnread] = useState(0);
  const [orchestrateInput, setOrchestrateInput] = useState("");
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [liveAgentStatuses, setLiveAgentStatuses] = useState<
    Array<{
      id: string;
      name: string;
      status: "running" | "idle" | "waiting" | "error";
      currentTask?: string;
      updatedAt: string;
    }>
  >([]);
  const router = useRouter();

  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  // Fetch agents from API
  useEffect(() => {
    fetch("/api/agents")
      .then((res) => res.json())
      .then((data) => {
        if (data.agents) {
          const runtimeAgents: AgentRuntime[] = data.agents.map((config: AgentConfig) => ({
            config,
            status: "idle" as const,
            stack: [],
            completedToday: 0,
          }));
          setAgents(runtimeAgents);
        }
      })
      .catch(console.error);
  }, []);

  // Build dynamic agent map for HistoryPanel and MessagesPanel
  const agentMap = useMemo(() => {
    const map: Record<string, { emoji: string; name: string }> = {
      user: { emoji: "\u{1F464}", name: "User" },
      system: { emoji: "\u{1F5A5}\uFE0F", name: "System" },
    };
    agents.forEach((a) => {
      map[a.config.id] = { emoji: a.config.emoji, name: a.config.name };
    });
    return map;
  }, [agents]);

  // Fetch user info
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) setUser(data.user);
      })
      .catch(console.error);
  }, []);

  // Fetch gateway status (polling every 5s)
  useEffect(() => {
    const fetchStatus = () => {
      fetch("/api/relay/status")
        .then((res) => res.json())
        .then((data) => {
          if (data.gateways) setGateways(data.gateways);
        })
        .catch(console.error);
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch live agent statuses from relay (polling every 2s when orchestrating, else 5s)
  useEffect(() => {
    const fetchStatuses = () => {
      fetch("/api/relay/status")
        .then((res) => res.json())
        .then((data) => {
          if (data.agents) {
            // Flatten all gateway agent statuses
            const all = Object.values(data.agents as Record<string, Array<{
              id: string;
              name: string;
              status: "running" | "idle" | "waiting" | "error";
              currentTask?: string;
              updatedAt: string;
            }>>).flat();
            setLiveAgentStatuses(all);

            // Auto-detect orchestration: if any agent is running, keep fast polling
            const hasRunning = all.some((a) => a.status === "running");
            if (hasRunning && !isOrchestrating) {
              setIsOrchestrating(true);
            } else if (!hasRunning && isOrchestrating) {
              setIsOrchestrating(false);
            }
          }
        })
        .catch(console.error);
    };

    fetchStatuses();
    const pollInterval = isOrchestrating ? 2000 : 5000;
    const interval = setInterval(fetchStatuses, pollInterval);
    return () => clearInterval(interval);
  }, [isOrchestrating]);

  // Fetch history (polling every 2s when orchestrating, else 5s)
  useEffect(() => {
    const fetchHistory = () => {
      fetch("/api/history")
        .then((res) => res.json())
        .then((data) => {
          if (data.history) setHistoryData(data.history);
        })
        .catch(console.error);
    };

    fetchHistory();
    const pollInterval = isOrchestrating ? 2000 : 5000;
    const interval = setInterval(fetchHistory, pollInterval);
    return () => clearInterval(interval);
  }, [isOrchestrating]);

  // Fetch message overview (polling every 3s)
  const fetchMessageOverview = useCallback(() => {
    fetch("/api/messages")
      .then((res) => res.json())
      .then((data) => {
        if (data.agents) {
          setAgentOverview(data.agents);
          const total = Object.values(data.agents as Record<string, AgentMessageOverview>).reduce(
            (sum, a) => sum + a.unread,
            0
          );
          setTotalUnread(total);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetchMessageOverview();
    const interval = setInterval(fetchMessageOverview, 3000);
    return () => clearInterval(interval);
  }, [fetchMessageOverview]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  const connectedGateways = gateways.filter((g) => g.status === "connected");

  const handleAddTask = (agentId: string, description: string) => {
    setAgents((prev) =>
      prev.map((agent) =>
        agent.config.id === agentId
          ? {
              ...agent,
              stack: [
                ...agent.stack,
                {
                  id: crypto.randomUUID(),
                  description,
                  trigger: "on_complete" as const,
                  priority: "medium" as const,
                },
              ],
            }
          : agent
      )
    );
  };

  const handleStartTask = async (agentId: string, task: string) => {
    // Find the agent to get systemPrompt
    const agent = agents.find((a) => a.config.id === agentId);
    if (!agent) {
      console.error(`Agent ${agentId} not found`);
      return;
    }

    // Update UI state to running
    setAgents((prev) =>
      prev.map((agent) =>
        agent.config.id === agentId
          ? {
              ...agent,
              status: "running" as const,
              currentTask: task,
              stack: agent.stack.slice(1),
            }
          : agent
      )
    );

    try {
      // Call relay API to spawn task
      const response = await fetch("/api/relay/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "spawn",
          payload: {
            agentId,
            task,
            systemPrompt: agent.config.systemPrompt,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to spawn task: ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`Task spawned for ${agentId}:`, result);

      // Add success history entry
      const historyEntry: HistoryEntry = {
        id: crypto.randomUUID(),
        agentId,
        type: "task_started",
        content: task,
        timestamp: new Date().toISOString(),
      };

      setHistoryData((prev) => ({
        ...prev,
        [agentId]: [...(prev[agentId] || []), historyEntry],
      }));
    } catch (error) {
      console.error("Failed to start task:", error);

      // Revert agent status to idle on error
      setAgents((prev) =>
        prev.map((agent) =>
          agent.config.id === agentId
            ? {
                ...agent,
                status: "idle" as const,
                currentTask: undefined,
                stack: [
                  {
                    id: crypto.randomUUID(),
                    description: task,
                    trigger: "on_complete" as const,
                    priority: "medium" as const,
                  },
                  ...agent.stack,
                ],
              }
            : agent
        )
      );

      // Show error to user
      alert(`Failed to start task: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleOrchestrate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orchestrateInput.trim() || isOrchestrating) return;

    setIsOrchestrating(true);

    try {
      const response = await fetch("/api/relay/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "orchestrate",
          payload: { task: orchestrateInput.trim() },
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed: ${response.statusText}`);
      }

      setOrchestrateInput("");
      // Switch to history tab to see progress
      setActiveTab("history");
    } catch (error) {
      console.error("Orchestrate failed:", error);
      alert(`오케스트레이션 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    } finally {
      setIsOrchestrating(false);
    }
  };

  const runningCount = agents.filter((a) => a.status === "running").length;
  const totalStacked = agents.reduce((sum, a) => sum + a.stack.length, 0);

  // Compute entries awaiting user reply
  const pendingReplies = useMemo(() => {
    const allEntries = Object.values(historyData).flat();
    const sorted = [...allEntries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // For each agent, find the last output/task_completed that looks like a question
    const agentLastQuestion: Record<string, HistoryEntry> = {};
    const agentReplied: Set<string> = new Set();

    for (const entry of sorted) {
      if (
        (entry.type === "output" || entry.type === "task_completed") &&
        looksLikeQuestion(entry.content)
      ) {
        agentLastQuestion[entry.agentId] = entry;
        agentReplied.delete(entry.agentId);
      }
      if (entry.type === "message_sent" && entry.agentId) {
        agentReplied.add(entry.agentId);
      }
    }

    // Return entries that have not been replied to
    return Object.entries(agentLastQuestion)
      .filter(([agentId]) => !agentReplied.has(agentId))
      .map(([, entry]) => entry);
  }, [historyData]);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          {/* Mobile: 세로 배치 / Desktop: 가로 배치 */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            {/* 제목 + 날짜 */}
            <div className="flex items-center justify-between sm:block">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold">🎛️ LifeDashboard</h1>
                <p className="text-gray-500 text-xs sm:text-sm">{today}</p>
              </div>
              {/* Mobile only: 로그아웃 */}
              {user && (
                <button
                  onClick={handleLogout}
                  className="sm:hidden text-xs text-gray-500 hover:text-white"
                >
                  로그아웃
                </button>
              )}
            </div>

            {/* 상태 바 */}
            <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 text-xs sm:text-sm">
              {/* Gateway Status */}
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    connectedGateways.length > 0
                      ? "bg-green-500 animate-pulse"
                      : "bg-gray-500"
                  }`}
                />
                <span className="text-gray-400">
                  {connectedGateways.length > 0
                    ? `연결됨`
                    : "미연결"}
                </span>
              </div>

              {/* Stats */}
              <div className="text-gray-400">
                <span className="text-green-400">{runningCount}</span> 실행
                · <span className="text-blue-400">{totalStacked}</span> 대기
                {pendingReplies.length > 0 && (
                  <>
                    {" · "}
                    <button
                      onClick={() => setActiveTab("history")}
                      className="text-yellow-400 hover:text-yellow-300 transition-colors"
                    >
                      {pendingReplies.length} 응답 대기
                    </button>
                  </>
                )}
              </div>

              {/* User - Desktop only */}
              {user && (
                <div className="hidden sm:flex items-center gap-3">
                  <span className="text-gray-400">{user.email}</span>
                  <button
                    onClick={handleLogout}
                    className="text-gray-500 hover:text-white transition-colors"
                  >
                    로그아웃
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1.5 sm:gap-2 mt-3 sm:mt-4 overflow-x-auto">
            <TabButton
              active={activeTab === "agents"}
              onClick={() => setActiveTab("agents")}
            >
              🤖 <span className="hidden sm:inline">Agents</span>
            </TabButton>
            <TabButton
              active={activeTab === "projects"}
              onClick={() => setActiveTab("projects")}
            >
              🚀 <span className="hidden sm:inline">Projects</span>
            </TabButton>
            <TabButton
              active={activeTab === "finance"}
              onClick={() => setActiveTab("finance")}
            >
              💰 <span className="hidden sm:inline">Finance</span>
            </TabButton>
            <TabButton
              active={activeTab === "history"}
              onClick={() => setActiveTab("history")}
            >
              📜 <span className="hidden sm:inline">History</span>
            </TabButton>
            <TabButton
              active={activeTab === "messages"}
              onClick={() => setActiveTab("messages")}
            >
              <span className="relative">
                💬 <span className="hidden sm:inline">Messages</span>
                {totalUnread > 0 && (
                  <span className="absolute -top-2 -right-3 sm:-right-2 bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </span>
                )}
              </span>
            </TabButton>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {activeTab === "agents" && (
          <div>
            {/* Orchestrate Command Bar */}
            <div className="mb-4 sm:mb-6">
              <form onSubmit={handleOrchestrate} className="flex gap-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={orchestrateInput}
                    onChange={(e) => setOrchestrateInput(e.target.value)}
                    placeholder="전체 지시를 입력하세요... (예: 이번 주 블로그 쓰고, 매출 정리하고, 코드 리뷰해줘)"
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                    disabled={isOrchestrating}
                  />
                  {isOrchestrating && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={isOrchestrating || !orchestrateInput.trim()}
                  className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 px-4 sm:px-6 py-3 rounded-xl text-sm font-medium transition-colors whitespace-nowrap"
                >
                  {isOrchestrating ? "분배 중..." : "🎯 전체 지시"}
                </button>
              </form>
              {isOrchestrating && (
                <div className="mt-3 flex items-center gap-2 text-sm text-blue-400">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></div>
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
                  </div>
                  <span>에이전트 팀이 작업 중입니다... History 탭에서 진행상황을 확인하세요</span>
                </div>
              )}
            </div>

            {/* Live Monitor */}
            {liveAgentStatuses.length > 0 && (
              <LiveMonitor
                agentStatuses={liveAgentStatuses}
                historyData={historyData}
                agentMap={agentMap}
              />
            )}

            {/* Category Filter */}
            <div className="flex gap-2 mb-4">
              {([
                { key: "all", label: "전체" },
                { key: "dev", label: "개발" },
                { key: "business", label: "경영" },
                { key: "ops", label: "운영" },
              ] as const).map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => setCategoryFilter(cat.key)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    categoryFilter === cat.key
                      ? "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Agent Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {agents
                .filter((agent) =>
                  categoryFilter === "all"
                    ? true
                    : agent.config.category === categoryFilter
                )
                .map((agent) => (
                  <AgentCard
                    key={agent.config.id}
                    agent={agent}
                    onAddTask={handleAddTask}
                    onStartTask={handleStartTask}
                  />
                ))}
            </div>

            {/* Pipeline Preview */}
            <div className="mt-8 bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-lg font-bold mb-4">
                🔗 Pipeline (oh-my-claudecode style)
              </h3>
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                {["Plan", "PRD", "Execute", "Verify", "Fix"].map(
                  (stage, i, arr) => (
                    <div key={stage} className="flex items-center gap-2">
                      <div className="bg-gray-700 px-4 py-2 rounded-lg text-sm whitespace-nowrap">
                        {stage}
                      </div>
                      {i < arr.length - 1 && (
                        <span className="text-gray-600">→</span>
                      )}
                    </div>
                  )
                )}
              </div>
              <p className="text-gray-500 text-sm mt-3">
                복잡한 작업은 자동으로 파이프라인으로 분해됩니다
              </p>
            </div>
          </div>
        )}

        {activeTab === "projects" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard key={project.name} project={project} />
            ))}
          </div>
        )}

        {activeTab === "finance" && (
          <div className="space-y-6">
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-lg font-bold mb-4">🎯 재정 목표</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-400">MumMum $10K MRR</span>
                    <span className="text-white">0%</span>
                  </div>
                  <ProgressBar progress={0} />
                </div>
                <p className="text-gray-500 text-sm">
                  크레딧컨설팅 연동 예정
                </p>
              </div>
            </div>

            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h3 className="text-lg font-bold mb-4">💸 이번 달 지출</h3>
              <p className="text-gray-500 text-sm">
                Supabase 연동 후 데이터 표시
              </p>
            </div>
          </div>
        )}

        {activeTab === "history" && (
          <div>
            <PendingRepliesBanner
              pendingReplies={pendingReplies}
              agentMap={agentMap}
              onReply={async (entry, replyText) => {
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
              }}
            />
            <HistoryPanel historyData={historyData} agents={agents} agentMap={agentMap} />
          </div>
        )}

        {activeTab === "messages" && (
          <MessagesPanel
            agents={agents}
            agentOverview={agentOverview}
            agentMap={agentMap}
            onRefreshOverview={fetchMessageOverview}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-12">
        <div className="max-w-7xl mx-auto px-6 py-4 text-center text-gray-500 text-sm">
          Built with Next.js • Inspired by oh-my-claudecode
        </div>
      </footer>
    </div>
  );
}
