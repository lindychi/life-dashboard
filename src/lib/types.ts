// Centralized type definitions for relay and queue systems

/** Gateway connection to the relay system */
export interface GatewayConnection {
  id: string;
  connectedAt: string;
  lastHeartbeat: string;
  status: "connected" | "disconnected";
}

/** Command types supported by the relay system */
export type RelayCommandType =
  | "spawn"
  | "send"
  | "status"
  | "message"
  | "orchestrate"
  | "instruction";

/** Status values for relay commands */
export type RelayCommandStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "queued";

/** A relay command queued for execution */
export interface RelayCommand {
  id: string;
  type: RelayCommandType;
  payload: Record<string, unknown>;
  createdAt: string;
  status: RelayCommandStatus;
  result?: unknown;
}

/** Agent status values */
export type AgentStatusValue = "running" | "idle" | "waiting" | "error";

/** Structured progress event emitted during task execution */
export interface ProgressEventEntry {
  type: "tool_use" | "text" | "health" | "warning" | "stderr";
  timestamp: string;
  /** Tool name (for tool_use events) */
  tool?: string;
  /** Tool target summary, e.g. file path (for tool_use events) */
  target?: string;
  /** Text content (for text/health/warning/stderr events, truncated) */
  content?: string;
}

/** Agent status tracked by the relay system */
export interface AgentStatus {
  id: string;
  name: string;
  status: AgentStatusValue;
  currentTask?: string;
  sessionKey?: string;
  updatedAt: string;
  liveOutput?: {
    lastChunk: string;
    totalChars: number;
    lastActivityAt: string;
    chunksReceived: number;
    /** Recent structured progress events (newest first, max 20) */
    recentEvents?: ProgressEventEntry[];
  };
}

/** A queued instruction waiting for a busy agent to become idle */
export interface QueuedInstruction {
  id: string;
  agentId: string;
  content: string;
  createdAt: string;
  position: number;
}

/** A pending command waiting to be picked up by a gateway */
export interface PendingCommand {
  id: string;
  gatewayId: string;
  type: string;
  payload: Record<string, unknown>;
  agentId: string;
  createdAt: string;
  position: number;
}

/** Queued command entry in the status API response (grouped by agent) */
export interface QueuedCommandEntry {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  status: string;
}

/** Status API response shape */
export interface RelayStatusResponse {
  gateways: GatewayConnection[];
  agents: Record<string, AgentStatus[]>;
  pendingInstructions: Record<string, Array<{ id: string; content: string; createdAt: string; position: number }>>;
  pendingCount: number;
  queuedCommands: Record<string, QueuedCommandEntry[]>;
  queuedCommandsCount: number;
  dbConnected: boolean;
  timestamp: string;
}
