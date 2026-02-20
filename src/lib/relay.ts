// In-memory store (Railway 재시작 시 초기화됨 - 나중에 Redis/PostgreSQL로 변경)

export interface GatewayConnection {
  id: string;
  connectedAt: Date;
  lastHeartbeat: Date;
  status: "connected" | "disconnected";
}

export interface RelayCommand {
  id: string;
  type: "spawn" | "send" | "status";
  payload: Record<string, unknown>;
  createdAt: Date;
  status: "pending" | "processing" | "completed" | "failed";
  result?: unknown;
}

export interface AgentStatus {
  id: string;
  name: string;
  status: "running" | "idle" | "waiting" | "error";
  currentTask?: string;
  sessionKey?: string;
  updatedAt: Date;
}

// In-memory stores
const gateways = new Map<string, GatewayConnection>();
const commandQueue = new Map<string, RelayCommand[]>(); // gatewayId -> commands
const agentStatuses = new Map<string, AgentStatus[]>(); // gatewayId -> agents

const RELAY_API_KEY = process.env.RELAY_API_KEY || "dev-relay-key";

export function validateRelayKey(key: string): boolean {
  return key === RELAY_API_KEY;
}

export function registerGateway(gatewayId: string): GatewayConnection {
  const connection: GatewayConnection = {
    id: gatewayId,
    connectedAt: new Date(),
    lastHeartbeat: new Date(),
    status: "connected",
  };
  gateways.set(gatewayId, connection);
  commandQueue.set(gatewayId, []);
  return connection;
}

export function updateHeartbeat(gatewayId: string): boolean {
  const gateway = gateways.get(gatewayId);
  if (!gateway) return false;
  gateway.lastHeartbeat = new Date();
  gateway.status = "connected";
  return true;
}

export function getConnectedGateways(): GatewayConnection[] {
  const now = Date.now();
  const timeout = 30000; // 30 seconds

  return Array.from(gateways.values()).map((g) => ({
    ...g,
    status:
      now - g.lastHeartbeat.getTime() > timeout ? "disconnected" : "connected",
  }));
}

export function queueCommand(
  gatewayId: string,
  command: Omit<RelayCommand, "id" | "createdAt" | "status">
): RelayCommand {
  const cmd: RelayCommand = {
    ...command,
    id: crypto.randomUUID(),
    createdAt: new Date(),
    status: "pending",
  };

  const queue = commandQueue.get(gatewayId) || [];
  queue.push(cmd);
  commandQueue.set(gatewayId, queue);

  return cmd;
}

export function getAndClearCommands(gatewayId: string): RelayCommand[] {
  const commands = commandQueue.get(gatewayId) || [];
  commandQueue.set(gatewayId, []);
  return commands.filter((c) => c.status === "pending");
}

export function updateCommandResult(
  gatewayId: string,
  commandId: string,
  status: RelayCommand["status"],
  result?: unknown
): boolean {
  // Command already cleared, store result separately if needed
  return true;
}

export function updateAgentStatuses(
  gatewayId: string,
  agents: Omit<AgentStatus, "updatedAt">[]
): void {
  agentStatuses.set(
    gatewayId,
    agents.map((a) => ({ ...a, updatedAt: new Date() }))
  );
}

export function getAgentStatuses(gatewayId: string): AgentStatus[] {
  return agentStatuses.get(gatewayId) || [];
}

export function getAllAgentStatuses(): Record<string, AgentStatus[]> {
  const result: Record<string, AgentStatus[]> = {};
  agentStatuses.forEach((agents, gatewayId) => {
    result[gatewayId] = agents;
  });
  return result;
}
