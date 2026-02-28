"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { looksLikeQuestion } from "@/lib/performance-utils";
import type { AgentConfig, AgentRuntime, HistoryEntry } from "@/lib/frontend-types";
import type { AgentMessageOverview } from "@/components/MessagesPanel";

// ===== Types =====

interface GatewayConnection {
  id: string;
  status: "connected" | "disconnected";
  lastHeartbeat: string;
}

interface User {
  email: string;
}

interface LiveAgentStatus {
  id: string;
  name: string;
  status: "running" | "idle" | "waiting" | "error" | "stale";
  currentTask?: string;
  updatedAt: string;
  liveOutput?: {
    lastChunk: string;
    totalChars: number;
    lastActivityAt: string;
    chunksReceived: number;
    recentEvents?: Array<{
      type: "tool_use" | "text" | "health" | "warning" | "stderr";
      timestamp: string;
      tool?: string;
      target?: string;
      content?: string;
    }>;
  };
}

interface PendingInstruction {
  id: string;
  content: string;
  createdAt: string;
  position: number;
}

interface QueuedCommand {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  status: string;
}

// ===== Hook: useAgents =====

export function useAgents() {
  const [agents, setAgents] = useState<AgentRuntime[]>([]);

  useEffect(() => {
    fetch("/api/agents")
      .then((res) => res.json())
      .then((data) => {
        if (data.agents) {
          const runtimeAgents: AgentRuntime[] = data.agents.map(
            (config: AgentConfig) => ({
              config,
              status: "idle" as const,
              stack: [],
              completedToday: 0,
            })
          );
          setAgents(runtimeAgents);
        }
      })
      .catch(console.error);
  }, []);

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

  return { agents, setAgents, agentMap };
}

// ===== Hook: useUser =====

export function useUser() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) setUser(data.user);
      })
      .catch(console.error);
  }, []);

  return user;
}

// ===== Hook: useGatewayStatus =====

export function useGatewayStatus() {
  const [gateways, setGateways] = useState<GatewayConnection[]>([]);
  const [dbConnected, setDbConnected] = useState(true);

  useEffect(() => {
    const fetchStatus = () => {
      fetch("/api/relay/status")
        .then((res) => res.json())
        .then((data) => {
          if (data.gateways) setGateways(data.gateways);
          if (data.dbConnected !== undefined) setDbConnected(data.dbConnected);
        })
        .catch(console.error);
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const connectedGateways = useMemo(
    () => gateways.filter((g) => g.status === "connected"),
    [gateways]
  );

  return { gateways, connectedGateways, dbConnected, setDbConnected };
}

// ===== Hook: useLiveAgentStatuses =====

export function useLiveAgentStatuses(
  setAgents: React.Dispatch<React.SetStateAction<AgentRuntime[]>>,
  setDbConnected: (v: boolean) => void
) {
  const [liveAgentStatuses, setLiveAgentStatuses] = useState<LiveAgentStatus[]>([]);
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [pendingInstructions, setPendingInstructions] = useState<
    Record<string, PendingInstruction[]>
  >({});
  const [pendingCount, setPendingCount] = useState(0);
  const [queuedCommands, setQueuedCommands] = useState<
    Record<string, QueuedCommand[]>
  >({});
  const [queuedCommandsCount, setQueuedCommandsCount] = useState(0);

  useEffect(() => {
    const fetchStatuses = () => {
      fetch("/api/relay/status")
        .then((res) => res.json())
        .then((data) => {
          if (data.agents) {
            const all = Object.values(
              data.agents as Record<string, LiveAgentStatus[]>
            ).flat();
            setLiveAgentStatuses(all);

            // Merge liveOutput into agents state
            setAgents((prev) => {
              const liveMap = new Map(all.map((a) => [a.id, a]));
              let changed = false;
              const next = prev.map((agent) => {
                const live = liveMap.get(agent.config.id);
                if (!live) return agent;
                const newLiveOutput = live.liveOutput || undefined;
                const statusChanged = live.status !== agent.status;
                const taskChanged = live.currentTask !== agent.currentTask;
                const liveOutputChanged =
                  newLiveOutput?.chunksReceived !==
                  agent.liveOutput?.chunksReceived;
                if (!statusChanged && !taskChanged && !liveOutputChanged)
                  return agent;
                changed = true;
                return {
                  ...agent,
                  status: live.status,
                  currentTask: live.currentTask,
                  liveOutput: newLiveOutput,
                };
              });
              return changed ? next : prev;
            });

            // Auto-detect orchestration
            const hasRunning = all.some((a) => a.status === "running");
            if (hasRunning && !isOrchestrating) {
              setIsOrchestrating(true);
            } else if (!hasRunning && isOrchestrating) {
              setIsOrchestrating(false);
            }
          }
          if (data.pendingInstructions)
            setPendingInstructions(data.pendingInstructions);
          if (data.pendingCount !== undefined)
            setPendingCount(data.pendingCount);
          if (data.queuedCommands) setQueuedCommands(data.queuedCommands);
          if (data.queuedCommandsCount !== undefined)
            setQueuedCommandsCount(data.queuedCommandsCount);
          if (data.dbConnected !== undefined) setDbConnected(data.dbConnected);
        })
        .catch(console.error);
    };

    fetchStatuses();
    const pollInterval = isOrchestrating ? 2000 : 5000;
    const interval = setInterval(fetchStatuses, pollInterval);
    return () => clearInterval(interval);
  }, [isOrchestrating, setAgents, setDbConnected]);

  return {
    liveAgentStatuses,
    isOrchestrating,
    setIsOrchestrating,
    pendingInstructions,
    pendingCount,
    queuedCommands,
    queuedCommandsCount,
  };
}

// ===== Hook: useHistoryData =====

export function useHistoryData(isOrchestrating: boolean) {
  const [historyData, setHistoryData] = useState<
    Record<string, HistoryEntry[]>
  >({});

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

  return { historyData, setHistoryData };
}

// ===== Hook: useMessageOverview =====

export function useMessageOverview() {
  const [agentOverview, setAgentOverview] = useState<
    Record<string, AgentMessageOverview>
  >({});
  const [totalUnread, setTotalUnread] = useState(0);
  const [isStale, setIsStale] = useState(false);
  const etagRef = useRef<string | null>(null);
  const consecutiveNoChangesRef = useRef(0);
  const currentIntervalRef = useRef(2000);

  const fetchMessageOverview = useCallback(() => {
    const headers: HeadersInit = {};
    if (etagRef.current) {
      headers["If-None-Match"] = etagRef.current;
    }

    fetch("/api/messages", { headers })
      .then(async (res) => {
        // 304 Not Modified - no changes, use cached data
        if (res.status === 304) {
          consecutiveNoChangesRef.current++;
          currentIntervalRef.current = Math.min(
            2000 + consecutiveNoChangesRef.current * 1000,
            5000
          );
          setIsStale(false);
          return;
        }

        // Store new ETag
        const newEtag = res.headers.get("etag");
        if (newEtag) {
          etagRef.current = newEtag;
        }

        const data = await res.json();
        if (data.agents) {
          setAgentOverview(data.agents);
          const total = Object.values(
            data.agents as Record<string, AgentMessageOverview>
          ).reduce((sum, a) => sum + a.unread, 0);
          setTotalUnread(total);
          setIsStale(false);

          // Reset polling interval on changes
          consecutiveNoChangesRef.current = 0;
          currentIntervalRef.current = 2000;
        }
      })
      .catch((err) => {
        console.error("Failed to fetch message overview:", err);
        setIsStale(true);
      });
  }, []);

  useEffect(() => {
    fetchMessageOverview();

    // Adaptive polling with exponential backoff
    let timeoutId: NodeJS.Timeout;

    const scheduleNext = () => {
      timeoutId = setTimeout(() => {
        fetchMessageOverview();
        scheduleNext();
      }, currentIntervalRef.current);
    };

    scheduleNext();

    return () => clearTimeout(timeoutId);
  }, [fetchMessageOverview]);

  return { agentOverview, totalUnread, fetchMessageOverview, isStale };
}

// ===== Hook: usePendingReplies =====

export function usePendingReplies(historyData: Record<string, HistoryEntry[]>) {
  return useMemo(() => {
    const allEntries = Object.values(historyData).flat();
    const sorted = [...allEntries].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

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

    return Object.entries(agentLastQuestion)
      .filter(([agentId]) => !agentReplied.has(agentId))
      .map(([, entry]) => entry);
  }, [historyData]);
}

// ===== Hook: useProjects =====

export interface ProjectKPI {
  label: string;
  value: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  progress: number;
  url?: string | null;
  kpis: ProjectKPI[];
  created_at: string;
  updated_at: string;
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setProjects(data.projects || []);
    } catch (err) {
      console.error("Failed to fetch projects:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return { projects, isLoading, error, refetch: fetchProjects };
}
