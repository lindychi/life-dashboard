"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { HistoryEntry } from "@/lib/frontend-types";
import AgentDashboard from "@/components/AgentDashboard";
import CronJobsPanel from "@/components/CronJobsPanel";
import MessagesPanel from "@/components/MessagesPanel";
import SessionsPanel from "@/components/SessionsPanel";
import PermissionApprovalBanner from "@/components/PermissionApprovalBanner";
import { uploadFiles } from "@/components/FileAttachment";
import type { AttachedFile, UploadedAttachment } from "@/components/FileAttachment";
import {
  useAgents,
  useUser,
  useGatewayStatus,
  useLiveAgentStatuses,
  useHistoryData,
  useMessageOverview,
  usePendingReplies,
  useProjects,
  type Project,
} from "@/hooks/useDashboardData";
import { usePermissionApprovals } from "@/hooks/usePermissionApprovals";

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

function ProjectCard({ project }: { project: Project }) {
  return (
    <div className="bg-gray-800 rounded-xl p-5 lg:p-3.5 hover:bg-gray-750 transition-colors border border-gray-700">
      <div className="flex justify-between items-start mb-3 lg:mb-2">
        <div>
          <h2 className="text-lg lg:text-base font-bold text-white">{project.name}</h2>
          <p className="text-gray-400 text-xs">{project.description}</p>
        </div>
        <span className="text-sm">{project.status}</span>
      </div>

      <div className="mb-3 lg:mb-2">
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>진행률</span>
          <span>{project.progress}%</span>
        </div>
        <ProgressBar progress={project.progress} />
      </div>

      {project.kpis && project.kpis.length > 0 && (
        <div className="space-y-1 lg:space-y-0.5">
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
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 sm:px-4 lg:px-3 py-2.5 sm:py-2 lg:py-1.5 rounded-lg text-xs sm:text-base lg:text-sm font-medium transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none min-h-[44px] lg:min-h-0 ${
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
  const [activeTab, setActiveTab] = useState<
    "agents" | "projects" | "finance" | "messages" | "sessions" | "cronjobs"
  >("agents");
  const [orchestrateInput, setOrchestrateInput] = useState("");
  const [queuedNotification, setQueuedNotification] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const router = useRouter();

  // Custom hooks
  const { agents, setAgents, agentMap } = useAgents();
  const user = useUser();
  const { connectedGateways, dbConnected, setDbConnected } = useGatewayStatus();
  const {
    liveAgentStatuses,
    isOrchestrating,
    pendingInstructions,
    pendingCount,
    queuedCommands,
    queuedCommandsCount,
  } = useLiveAgentStatuses(setAgents, setDbConnected);
  const { historyData, setHistoryData } = useHistoryData(isOrchestrating);
  const { agentOverview, totalUnread, fetchMessageOverview } = useMessageOverview();
  const pendingReplies = usePendingReplies(historyData);
  const { projects, isLoading: projectsLoading } = useProjects();
  const {
    pendingApprovals,
    approveRequest,
    denyRequest,
    hasPendingApprovals,
    pendingCount: approvalCount,
  } = usePermissionApprovals();

  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

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
    const agent = agents.find((a) => a.config.id === agentId);
    if (!agent) {
      console.error(`Agent ${agentId} not found`);
      return;
    }

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
      const response = await fetch("/api/relay/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "spawn",
          payload: {
            agentId,
            task,
            systemPrompt: agent.config.systemPrompt,
            allowBash: agent.config.allowBash || false,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      console.log(`Task spawned for ${agentId}:`, result);

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

      alert(`Failed to start task: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleOrchestrate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orchestrateInput.trim()) return;

    const task = orchestrateInput.trim();
    const filesToUpload = [...attachedFiles];

    setOrchestrateInput("");
    setAttachedFiles([]);

    try {
      let uploadedAttachments: UploadedAttachment[] = [];
      if (filesToUpload.length > 0) {
        setUploadProgress({ current: 0, total: filesToUpload.length });
        try {
          uploadedAttachments = await uploadFiles(filesToUpload, (current, total) => {
            setUploadProgress({ current, total });
          });
        } catch (uploadError) {
          setUploadProgress(null);
          setOrchestrateInput(task);
          setAttachedFiles(filesToUpload);
          alert(`파일 업로드 실패: ${uploadError instanceof Error ? uploadError.message : "알 수 없는 오류"}`);
          return;
        }
        setUploadProgress(null);
      }

      const commandBody: Record<string, unknown> = {
        type: "orchestrate",
        payload: { task },
      };

      if (uploadedAttachments.length > 0) {
        (commandBody as Record<string, unknown>).attachments = uploadedAttachments.map((a) => ({
          refKey: a.refKey,
        }));
      }

      const response = await fetch("/api/relay/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(commandBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      if (isOrchestrating) {
        setQueuedNotification(
          uploadedAttachments.length > 0
            ? `큐에 추가됨 (파일 ${uploadedAttachments.length}개 첨부)`
            : "큐에 추가됨"
        );
        setTimeout(() => setQueuedNotification(null), 3000);
      }
    } catch (error) {
      console.error("Orchestrate failed:", error);
      setOrchestrateInput(task);
      setAttachedFiles(filesToUpload);
      alert(`오케스트레이션 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
    }
  };

  const runningCount = agents.filter((a) => a.status === "running").length;
  const totalStacked = agents.reduce((sum, a) => sum + a.stack.length, 0);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 lg:py-2.5">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div className="flex items-center justify-between sm:block">
              <div>
                <h1 className="text-xl sm:text-2xl lg:text-xl font-bold">🎛️ LifeDashboard</h1>
                <p className="text-gray-500 text-xs sm:text-sm">{today}</p>
              </div>
              {user && (
                <button
                  onClick={handleLogout}
                  className="sm:hidden text-xs text-gray-500 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                >
                  로그아웃
                </button>
              )}
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 text-xs sm:text-sm">
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    connectedGateways.length > 0
                      ? "bg-green-500 animate-pulse"
                      : "bg-gray-500"
                  }`}
                />
                <span className="text-gray-400">
                  {connectedGateways.length > 0 ? `연결됨` : "미연결"}
                </span>
              </div>

              {!dbConnected && (
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-red-400">DB 연결 끊김</span>
                </div>
              )}

              <div className="text-gray-400">
                <span className="text-green-400">{runningCount}</span> 실행
                · <span className="text-blue-400">{totalStacked}</span> 대기
                {pendingReplies.length > 0 && (
                  <>
                    {" · "}
                    <button
                      onClick={() => setActiveTab("agents")}
                      className="text-yellow-400 hover:text-yellow-300 transition-colors"
                    >
                      {pendingReplies.length} 응답 대기
                    </button>
                  </>
                )}
                {hasPendingApprovals && (
                  <>
                    {" · "}
                    <span className="text-orange-400 animate-pulse">
                      🔐 {approvalCount} 승인 대기
                    </span>
                  </>
                )}
              </div>

              {user && (
                <div className="hidden sm:flex items-center gap-3">
                  <span className="text-gray-400">{user.email}</span>
                  <button
                    onClick={handleLogout}
                    className="text-gray-500 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                  >
                    로그아웃
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 sm:gap-2 mt-3 sm:mt-4 lg:mt-2 overflow-x-auto pb-1 -mb-1 scrollbar-none" role="tablist">
            <TabButton active={activeTab === "agents"} onClick={() => setActiveTab("agents")}>
              🤖 <span className="hidden sm:inline">Agents</span><span className="sm:hidden">에이전트</span>
            </TabButton>
            <TabButton active={activeTab === "projects"} onClick={() => setActiveTab("projects")}>
              🚀 <span className="hidden sm:inline">Projects</span><span className="sm:hidden">프로젝트</span>
            </TabButton>
            <TabButton active={activeTab === "finance"} onClick={() => setActiveTab("finance")}>
              💰 <span className="hidden sm:inline">Finance</span><span className="sm:hidden">재정</span>
            </TabButton>
            <TabButton active={activeTab === "messages"} onClick={() => setActiveTab("messages")}>
              <span className="relative">
                💬 <span className="hidden sm:inline">Messages</span><span className="sm:hidden">메시지</span>
                {totalUnread > 0 && (
                  <span className="absolute -top-2 -right-3 sm:-right-2 bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </span>
                )}
              </span>
            </TabButton>
            <TabButton active={activeTab === "sessions"} onClick={() => setActiveTab("sessions")}>
              💭 <span className="hidden sm:inline">Sessions</span><span className="sm:hidden">세션</span>
            </TabButton>
            <TabButton active={activeTab === "cronjobs"} onClick={() => setActiveTab("cronjobs")}>
              ⏰ <span className="hidden sm:inline">Cron Jobs</span><span className="sm:hidden">크론</span>
            </TabButton>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 lg:py-4">
        {/* Permission Approval Banner */}
        {hasPendingApprovals && (
          <PermissionApprovalBanner
            pendingApprovals={pendingApprovals}
            onApprove={approveRequest}
            onDeny={denyRequest}
          />
        )}

        {activeTab === "agents" && (
          <AgentDashboard
            agents={agents}
            historyData={historyData}
            agentMap={agentMap}
            liveAgentStatuses={liveAgentStatuses}
            pendingReplies={pendingReplies}
            orchestrateInput={orchestrateInput}
            isOrchestrating={isOrchestrating}
            dbConnected={dbConnected}
            pendingInstructions={pendingInstructions}
            pendingCount={pendingCount}
            queuedCommands={queuedCommands}
            queuedCommandsCount={queuedCommandsCount}
            queuedNotification={queuedNotification}
            attachedFiles={attachedFiles}
            uploadProgress={uploadProgress}
            onOrchestrateInputChange={setOrchestrateInput}
            onOrchestrate={handleOrchestrate}
            onFilesChange={setAttachedFiles}
            onAddTask={handleAddTask}
            onStartTask={handleStartTask}
            onPendingReply={async (entry, replyText) => {
              try {
                // Find agent config to get allowBash setting
                const agent = agents.find((a) => a.config.id === entry.agentId);

                const response = await fetch("/api/relay/command", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    type: "spawn",
                    payload: {
                      agentId: entry.agentId,
                      task: `사용자 피드백에 대해 응답하세요.\n\n이전 당신의 메시지:\n${entry.content.slice(0, 500)}\n\n사용자 답신:\n${replyText}`,
                      allowBash: agent?.config.allowBash || false,
                    },
                  }),
                });
                if (!response.ok) {
                  const errorData = await response.json().catch(() => ({}));
                  throw new Error(errorData.error || `HTTP ${response.status}`);
                }
                await fetch("/api/history", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    agentId: entry.agentId,
                    type: "message_sent",
                    content: `💬 사용자 → ${agentMap[entry.agentId]?.name || entry.agentId}: ${replyText}`,
                  }),
                });
              } catch (error) {
                console.error("Failed to send reply:", error);
                alert(`Failed to send reply: ${error instanceof Error ? error.message : "Unknown error"}`);
              }
            }}
          />
        )}

        {activeTab === "projects" && (
          <div>
            {projectsLoading ? (
              <div className="text-center text-gray-400 py-8">프로젝트 로딩 중...</div>
            ) : projects.length === 0 ? (
              <div className="text-center text-gray-400 py-8">프로젝트가 없습니다</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {projects.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "finance" && (
          <div className="space-y-6 lg:space-y-4">
            <div className="bg-gray-800 rounded-xl p-6 lg:p-4 border border-gray-700">
              <h3 className="text-lg font-bold mb-4 lg:mb-3">🎯 재정 목표</h3>
              <div className="space-y-4 lg:space-y-3">
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

            <div className="bg-gray-800 rounded-xl p-6 lg:p-4 border border-gray-700">
              <h3 className="text-lg font-bold mb-4 lg:mb-3">💸 이번 달 지출</h3>
              <p className="text-gray-500 text-sm">
                Supabase 연동 후 데이터 표시
              </p>
            </div>
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

        {activeTab === "sessions" && <SessionsPanel agentMap={agentMap} />}

        {activeTab === "cronjobs" && <CronJobsPanel />}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-12 lg:mt-8">
        <div className="max-w-7xl mx-auto px-6 py-4 lg:py-3 text-center text-gray-500 text-sm">
          Built with Next.js &bull; Inspired by oh-my-claudecode
        </div>
      </footer>
    </div>
  );
}
