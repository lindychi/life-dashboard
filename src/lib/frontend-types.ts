/**
 * Shared TypeScript types for frontend components.
 * Eliminates duplication across page.tsx, AgentDashboard.tsx, AgentSection.tsx, and HistoryPanel.tsx.
 */

/**
 * Represents a task in an agent's stack.
 */
export interface TaskStack {
  id: string;
  description: string;
  trigger: "on_complete" | "manual" | "on_idle";
  priority: "high" | "medium" | "low";
}

/**
 * Static configuration for an agent.
 */
export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  emoji: string;
  category: "dev" | "business" | "ops";
  systemPrompt: string;
  enabled: boolean;
  allowBash?: boolean; // Bash 도구 사용 허용 여부 (기본값: false)
  defaultModel?: "haiku" | "sonnet" | "opus"; // 기본 모델 (smart routing용)
  projects?: string[];
}

/**
 * Runtime state for an agent, combining config with dynamic execution state.
 */
export interface AgentRuntime {
  config: AgentConfig;
  status: "running" | "idle" | "waiting" | "error" | "stale";
  currentTask?: string;
  sessionKey?: string;
  stack: TaskStack[];
  completedToday: number;
  liveOutput?: {
    lastChunk: string;
    totalChars: number;
    lastActivityAt: string;
    chunksReceived: number;
    /** Recent structured progress events (newest first, max 20) */
    recentEvents?: Array<{
      type: "tool_use" | "text" | "health" | "warning" | "stderr";
      timestamp: string;
      tool?: string;
      target?: string;
      content?: string;
    }>;
  };
}

/**
 * A history entry representing an event in the agent system.
 */
export interface HistoryEntry {
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
    | "output"
    | "gateway_restart";
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
  requestGroupId?: string;
  requestTitle?: string;
}

/**
 * Timeline API response structure for cursor-based pagination.
 */
export interface TimelineResponse {
  entries: HistoryEntry[];
  nextCursor: string | null;
  totalCount: number;
  hasMore: boolean;
}
