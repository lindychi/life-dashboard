"use client";

import { useState } from "react";

// ===== Types =====
interface TaskStack {
  id: string;
  description: string;
  trigger: "on_complete" | "manual" | "on_idle";
  priority: "high" | "medium" | "low";
}

interface Agent {
  id: string;
  name: string;
  role: string;
  emoji: string;
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

// ===== Data =====
const initialAgents: Agent[] = [
  {
    id: "coder",
    name: "Coder",
    role: "코드 작성, 버그 수정, 리팩토링",
    emoji: "👨‍💻",
    status: "idle",
    stack: [],
    completedToday: 0,
  },
  {
    id: "researcher",
    name: "Researcher",
    role: "조사, 분석, 문서화",
    emoji: "🔍",
    status: "idle",
    stack: [],
    completedToday: 0,
  },
  {
    id: "designer",
    name: "Designer",
    role: "UI/UX 리뷰, 디자인 제안",
    emoji: "🎨",
    status: "idle",
    stack: [],
    completedToday: 0,
  },
  {
    id: "reviewer",
    name: "Reviewer",
    role: "코드 리뷰, 품질 검증",
    emoji: "✅",
    status: "idle",
    stack: [],
    completedToday: 0,
  },
  {
    id: "planner",
    name: "Planner",
    role: "작업 분해, 우선순위 설정",
    emoji: "📋",
    status: "idle",
    stack: [],
    completedToday: 0,
  },
];

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

function StatusBadge({ status }: { status: Agent["status"] }) {
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

function AgentCard({
  agent,
  onAddTask,
  onStartTask,
}: {
  agent: Agent;
  onAddTask: (agentId: string, task: string) => void;
  onStartTask: (agentId: string, task: string) => void;
}) {
  const [newTask, setNewTask] = useState("");
  const [showInput, setShowInput] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTask.trim()) {
      onAddTask(agent.id, newTask.trim());
      setNewTask("");
      setShowInput(false);
    }
  };

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 hover:border-gray-600 transition-all">
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{agent.emoji}</span>
          <div>
            <h3 className="text-lg font-bold text-white">{agent.name}</h3>
            <p className="text-gray-500 text-xs">{agent.role}</p>
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
            📥 Task Stack ({agent.stack.length})
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
                  {task.trigger === "on_complete" ? "🔗" : "⏸️"}
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
            onClick={() => onStartTask(agent.id, agent.stack[0].description)}
            className="flex-1 bg-green-600 hover:bg-green-500 text-white text-sm py-2 rounded-lg transition-colors"
          >
            ▶️ 스택 실행
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
      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

// ===== Main =====
export default function Home() {
  const [activeTab, setActiveTab] = useState<"agents" | "projects" | "finance">(
    "agents"
  );
  const [agents, setAgents] = useState<Agent[]>(initialAgents);

  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  const handleAddTask = (agentId: string, description: string) => {
    setAgents((prev) =>
      prev.map((agent) =>
        agent.id === agentId
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

  const handleStartTask = (agentId: string, task: string) => {
    setAgents((prev) =>
      prev.map((agent) =>
        agent.id === agentId
          ? {
              ...agent,
              status: "running" as const,
              currentTask: task,
              stack: agent.stack.slice(1),
            }
          : agent
      )
    );
    // TODO: Actually spawn OpenClaw session here
    console.log(`Starting task for ${agentId}: ${task}`);
  };

  const runningCount = agents.filter((a) => a.status === "running").length;
  const totalStacked = agents.reduce((sum, a) => sum + a.stack.length, 0);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold">🎛️ LifeDashboard</h1>
              <p className="text-gray-500 text-sm">{today}</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right text-sm">
                <p className="text-gray-400">
                  <span className="text-green-400">{runningCount}</span> 실행중
                  · <span className="text-blue-400">{totalStacked}</span> 대기
                </p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mt-4">
            <TabButton
              active={activeTab === "agents"}
              onClick={() => setActiveTab("agents")}
            >
              🤖 Agents
            </TabButton>
            <TabButton
              active={activeTab === "projects"}
              onClick={() => setActiveTab("projects")}
            >
              🚀 Projects
            </TabButton>
            <TabButton
              active={activeTab === "finance"}
              onClick={() => setActiveTab("finance")}
            >
              💰 Finance
            </TabButton>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {activeTab === "agents" && (
          <div>
            {/* Quick Actions */}
            <div className="flex gap-3 mb-6">
              <button className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                + 새 작업 분배
              </button>
              <button className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                🔄 상태 새로고침
              </button>
              <button className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                📊 오늘 리포트
              </button>
            </div>

            {/* Agent Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
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
