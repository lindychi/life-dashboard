import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory storage for mock PostgreSQL - must be declared before vi.mock
const mockStorage = {
  gatewayConnections: [] as Array<{
    id: string;
    status: string;
    connected_at: string;
    last_heartbeat: string;
  }>,

  relayCommands: [] as Array<{
    id: string;
    gateway_id: string;
    type: string;
    payload: Record<string, unknown>;
    status: string;
    result: unknown;
    created_at: string;
    completed_at: string | null;
  }>,

  agentStatuses: [] as Array<{
    id: string;
    gateway_id: string;
    name: string;
    status: string;
    current_task: string | null;
    session_key: string | null;
    updated_at: string;
  }>,
};

// Mock the db module
vi.mock("@/lib/db", () => {
  const queryImpl = async (sql: string, params: any[] = []) => {
    // INSERT INTO gateway_connections
    if (sql.includes("INSERT INTO gateway_connections")) {
      const [gatewayId] = params;
      const now = new Date().toISOString();

      const existingIndex = mockStorage.gatewayConnections.findIndex((g) => g.id === gatewayId);

      if (existingIndex >= 0) {
        mockStorage.gatewayConnections[existingIndex] = {
          ...mockStorage.gatewayConnections[existingIndex],
          status: "connected",
          last_heartbeat: now,
        };
        return [mockStorage.gatewayConnections[existingIndex]];
      } else {
        const gateway = {
          id: gatewayId,
          status: "connected",
          connected_at: now,
          last_heartbeat: now,
        };
        mockStorage.gatewayConnections.push(gateway);
        return [gateway];
      }
    }

    // UPDATE gateway_connections (heartbeat)
    if (sql.includes("UPDATE gateway_connections") && sql.includes("last_heartbeat = NOW()")) {
      const [gatewayId] = params;
      const gateway = mockStorage.gatewayConnections.find((g) => g.id === gatewayId);

      if (gateway) {
        gateway.last_heartbeat = new Date().toISOString();
        gateway.status = "connected";
        return [{ id: gateway.id }];
      }
      return [];
    }

    // SELECT gateway_connections
    if (sql.includes("SELECT") && sql.includes("FROM gateway_connections")) {
      const now = Date.now();
      return mockStorage.gatewayConnections.map((g) => ({
        ...g,
        status: (now - new Date(g.last_heartbeat).getTime() <= 30000)
          ? "connected"
          : "disconnected",
      }));
    }

    // INSERT relay_commands
    if (sql.includes("INSERT INTO relay_commands")) {
      const [gatewayId, type, payloadJson] = params;
      const command = {
        id: crypto.randomUUID(),
        gateway_id: gatewayId,
        type,
        payload: JSON.parse(payloadJson),
        status: "pending",
        result: null,
        created_at: new Date().toISOString(),
        completed_at: null,
      };
      mockStorage.relayCommands.push(command);
      return [command];
    }

    // UPDATE relay_commands (getAndClearCommands)
    if (sql.includes("UPDATE relay_commands") && sql.includes("SET status = 'processing'")) {
      const [gatewayId] = params;
      const pendingCommands = mockStorage.relayCommands.filter(
        (c) => c.gateway_id === gatewayId && c.status === "pending"
      );

      pendingCommands.forEach((cmd) => {
        cmd.status = "processing";
      });

      return pendingCommands;
    }

    // UPDATE relay_commands (updateCommandResult)
    if (sql.includes("UPDATE relay_commands") && sql.includes("completed_at = NOW()")) {
      const [status, resultJson, commandId, gatewayId] = params;
      const command = mockStorage.relayCommands.find(
        (c) => c.id === commandId && c.gateway_id === gatewayId
      );

      if (command) {
        command.status = status;
        command.result = resultJson ? JSON.parse(resultJson) : null;
        command.completed_at = new Date().toISOString();
        return [{ id: command.id }];
      }
      return [];
    }

    // INSERT agent_statuses (UPSERT)
    if (sql.includes("INSERT INTO agent_statuses")) {
      const [agentId, gatewayId, name, status, currentTask, sessionKey] = params;
      const now = new Date().toISOString();

      const existingIndex = mockStorage.agentStatuses.findIndex(
        (a) => a.id === agentId && a.gateway_id === gatewayId
      );

      if (existingIndex >= 0) {
        mockStorage.agentStatuses[existingIndex] = {
          id: agentId,
          gateway_id: gatewayId,
          name,
          status,
          current_task: currentTask,
          session_key: sessionKey,
          updated_at: now,
        };
      } else {
        mockStorage.agentStatuses.push({
          id: agentId,
          gateway_id: gatewayId,
          name,
          status,
          current_task: currentTask,
          session_key: sessionKey,
          updated_at: now,
        });
      }
      return [];
    }

    // SELECT agent_statuses (single gateway)
    if (sql.includes("SELECT id, name, status") && sql.includes("WHERE gateway_id")) {
      const [gatewayId] = params;
      return mockStorage.agentStatuses.filter((a) => a.gateway_id === gatewayId);
    }

    // SELECT agent_statuses (all gateways) - with gateway_connected JOIN
    if (sql.includes("a.gateway_id") && sql.includes("agent_statuses a")) {
      const now = Date.now();
      return mockStorage.agentStatuses.map((a) => {
        const gw = mockStorage.gatewayConnections.find((g) => g.id === a.gateway_id);
        const gwConnected = gw ? (now - new Date(gw.last_heartbeat).getTime() <= 30000) : false;
        return { ...a, gateway_connected: gwConnected };
      });
    }

    // UPDATE agent_statuses to idle (registerGateway cleanup)
    if (sql.includes("UPDATE agent_statuses") && sql.includes("status = 'idle'")) {
      const [gatewayId] = params;
      mockStorage.agentStatuses
        .filter((a) => a.gateway_id === gatewayId && a.status === "running")
        .forEach((a) => { a.status = "idle"; a.current_task = null; });
      return [];
    }

    return [];
  };

  return {
    query: vi.fn(queryImpl),
    queryOne: vi.fn(async (sql: string, params: any[] = []) => {
      const results = await queryImpl(sql, params);
      return results[0] || null;
    }),
    pool: {},
  };
});

import {
  validateRelayKey,
  registerGateway,
  updateHeartbeat,
  getConnectedGateways,
  queueCommand,
  getAndClearCommands,
  updateAgentStatuses,
  getAgentStatuses,
  getAllAgentStatuses,
  type RelayCommand,
  type AgentStatus,
} from "@/lib/relay";

describe("relay module", () => {
  beforeEach(() => {
    // Reset in-memory storage
    mockStorage.gatewayConnections = [];
    mockStorage.relayCommands = [];
    mockStorage.agentStatuses = [];

    // Clear mock call history
    vi.clearAllMocks();
  });

  describe("validateRelayKey", () => {
    it("should return true for correct key", () => {
      const correctKey = process.env.RELAY_API_KEY || "dev-relay-key";
      expect(validateRelayKey(correctKey)).toBe(true);
    });

    it("should return false for incorrect key", () => {
      expect(validateRelayKey("wrong-key")).toBe(false);
      expect(validateRelayKey("")).toBe(false);
      expect(validateRelayKey("invalid")).toBe(false);
    });
  });

  describe("registerGateway", () => {
    it("should create gateway with correct structure", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      const connection = await registerGateway(gatewayId);

      expect(connection.id).toBe(gatewayId);
      expect(connection.status).toBe("connected");
      expect(connection.connectedAt).toMatch(/^\d{4}-/);
      expect(connection.lastHeartbeat).toMatch(/^\d{4}-/);
    });

    it("should create empty command queue for new gateway", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      await registerGateway(gatewayId);

      const commands = await getAndClearCommands(gatewayId);
      expect(commands).toEqual([]);
    });

    it("should allow registering multiple gateways", async () => {
      const gateway1 = `test-gateway-${crypto.randomUUID()}`;
      const gateway2 = `test-gateway-${crypto.randomUUID()}`;

      const conn1 = await registerGateway(gateway1);
      const conn2 = await registerGateway(gateway2);

      expect(conn1.id).toBe(gateway1);
      expect(conn2.id).toBe(gateway2);
    });
  });

  describe("queueCommand", () => {
    it("should add command with generated id, createdAt, and status", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      await registerGateway(gatewayId);

      const command = await queueCommand(gatewayId, {
        type: "spawn",
        payload: { agentType: "executor" },
      });

      expect(command.id).toBeDefined();
      expect(typeof command.id).toBe("string");
      expect(command.createdAt).toMatch(/^\d{4}-/);
      expect(command.status).toBe("pending");
      expect(command.type).toBe("spawn");
      expect(command.payload).toEqual({ agentType: "executor" });
    });

    it("should queue multiple commands", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      await registerGateway(gatewayId);

      const cmd1 = await queueCommand(gatewayId, {
        type: "spawn",
        payload: { agentType: "executor" },
      });

      const cmd2 = await queueCommand(gatewayId, {
        type: "send",
        payload: { message: "test" },
      });

      const commands = await getAndClearCommands(gatewayId);
      expect(commands).toHaveLength(2);
      expect(commands[0].id).toBe(cmd1.id);
      expect(commands[1].id).toBe(cmd2.id);
    });

    it("should work for unregistered gateway", async () => {
      const gatewayId = `unregistered-gateway-${crypto.randomUUID()}`;

      const command = await queueCommand(gatewayId, {
        type: "status",
        payload: {},
      });

      expect(command.id).toBeDefined();
      expect(command.status).toBe("pending");

      const commands = await getAndClearCommands(gatewayId);
      expect(commands).toHaveLength(1);
    });
  });

  describe("getAndClearCommands", () => {
    it("should return pending commands and mark them as processing", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      await registerGateway(gatewayId);

      await queueCommand(gatewayId, {
        type: "spawn",
        payload: { agentType: "executor" },
      });

      await queueCommand(gatewayId, {
        type: "send",
        payload: { message: "hello" },
      });

      const commands = await getAndClearCommands(gatewayId);
      expect(commands).toHaveLength(2);
      expect(commands.every((c) => c.status === "processing")).toBe(true);

      // Queue should be cleared of pending commands
      const secondFetch = await getAndClearCommands(gatewayId);
      expect(secondFetch).toEqual([]);
    });

    it("should only return commands with status 'processing' after fetch", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      await registerGateway(gatewayId);

      await queueCommand(gatewayId, {
        type: "spawn",
        payload: { agentType: "executor" },
      });

      const commands = await getAndClearCommands(gatewayId);
      expect(commands.every((c) => c.status === "processing")).toBe(true);
    });

    it("should return empty array for unknown gateway", async () => {
      const commands = await getAndClearCommands(`unknown-${crypto.randomUUID()}`);
      expect(commands).toEqual([]);
    });
  });

  describe("updateHeartbeat", () => {
    it("should update heartbeat for registered gateway", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      await registerGateway(gatewayId);

      const result = await updateHeartbeat(gatewayId);
      expect(result).toBe(true);
    });

    it("should return false for unregistered gateway", async () => {
      const result = await updateHeartbeat(`unregistered-${crypto.randomUUID()}`);
      expect(result).toBe(false);
    });

    it("should update status to connected", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      await registerGateway(gatewayId);

      await updateHeartbeat(gatewayId);

      const gateways = await getConnectedGateways();
      const gateway = gateways.find((g) => g.id === gatewayId);

      expect(gateway).toBeDefined();
      expect(gateway?.status).toBe("connected");
    });

    it("should update lastHeartbeat timestamp", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      const connection = await registerGateway(gatewayId);
      const initialHeartbeat = new Date(connection.lastHeartbeat).getTime();

      // Wait a bit to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      await updateHeartbeat(gatewayId);

      const gateways = await getConnectedGateways();
      const gateway = gateways.find((g) => g.id === gatewayId);

      expect(new Date(gateway!.lastHeartbeat).getTime()).toBeGreaterThan(
        initialHeartbeat
      );
    });
  });

  describe("getConnectedGateways", () => {
    it("should return all gateways", async () => {
      const gateway1 = `test-gateway-${crypto.randomUUID()}`;
      const gateway2 = `test-gateway-${crypto.randomUUID()}`;

      await registerGateway(gateway1);
      await registerGateway(gateway2);

      const gateways = await getConnectedGateways();
      const ids = gateways.map((g) => g.id);

      expect(ids).toContain(gateway1);
      expect(ids).toContain(gateway2);
    });

    it("should mark gateway as disconnected if heartbeat > 30s old", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      await registerGateway(gatewayId);

      // Mock old heartbeat by directly modifying in-memory storage
      const gateway = mockStorage.gatewayConnections.find((g) => g.id === gatewayId);
      if (gateway) {
        gateway.last_heartbeat = new Date(Date.now() - 31000).toISOString();
      }

      const gateways = await getConnectedGateways();
      const found = gateways.find((g) => g.id === gatewayId);

      expect(found?.status).toBe("disconnected");
    });

    it("should mark gateway as connected if heartbeat < 30s old", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      await registerGateway(gatewayId);

      const gateways = await getConnectedGateways();
      const gateway = gateways.find((g) => g.id === gatewayId);

      expect(gateway?.status).toBe("connected");
    });

    it("should mark gateway at exactly 30s as disconnected", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      await registerGateway(gatewayId);

      // Mock heartbeat at exactly 30 seconds + 1ms
      const gateway = mockStorage.gatewayConnections.find((g) => g.id === gatewayId);
      if (gateway) {
        gateway.last_heartbeat = new Date(Date.now() - 30001).toISOString();
      }

      const gateways = await getConnectedGateways();
      const found = gateways.find((g) => g.id === gatewayId);

      expect(found?.status).toBe("disconnected");
    });
  });

  describe("updateAgentStatuses and getAgentStatuses", () => {
    it("should store and retrieve agent statuses", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      await registerGateway(gatewayId);

      const agents: Omit<AgentStatus, "updatedAt">[] = [
        {
          id: "agent-1",
          name: "executor",
          status: "running",
          currentTask: "processing",
        },
        {
          id: "agent-2",
          name: "architect",
          status: "idle",
        },
      ];

      await updateAgentStatuses(gatewayId, agents);

      const retrieved = await getAgentStatuses(gatewayId);
      expect(retrieved).toHaveLength(2);
      expect(retrieved[0].id).toBe("agent-1");
      expect(retrieved[0].name).toBe("executor");
      expect(retrieved[0].status).toBe("running");
      expect(retrieved[0].currentTask).toBe("processing");
      expect(retrieved[0].updatedAt).toMatch(/^\d{4}-/);

      expect(retrieved[1].id).toBe("agent-2");
      expect(retrieved[1].name).toBe("architect");
      expect(retrieved[1].status).toBe("idle");
      expect(retrieved[1].updatedAt).toMatch(/^\d{4}-/);
    });

    it("should add updatedAt timestamp to agents", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      await registerGateway(gatewayId);

      const agents: Omit<AgentStatus, "updatedAt">[] = [
        {
          id: "agent-1",
          name: "executor",
          status: "running",
        },
      ];

      await updateAgentStatuses(gatewayId, agents);

      const retrieved = await getAgentStatuses(gatewayId);
      expect(retrieved[0].updatedAt).toMatch(/^\d{4}-/);
    });

    it("should return empty array for unknown gateway", async () => {
      const statuses = await getAgentStatuses(`unknown-${crypto.randomUUID()}`);
      expect(statuses).toEqual([]);
    });

    it("should update existing agents via UPSERT", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      await registerGateway(gatewayId);

      await updateAgentStatuses(gatewayId, [
        { id: "agent-1", name: "executor", status: "running" },
      ]);

      await updateAgentStatuses(gatewayId, [
        { id: "agent-2", name: "architect", status: "idle" },
      ]);

      const retrieved = await getAgentStatuses(gatewayId);
      // PostgreSQL UPSERT doesn't delete - both agents exist
      expect(retrieved).toHaveLength(2);
      expect(retrieved.map((a) => a.id)).toContain("agent-1");
      expect(retrieved.map((a) => a.id)).toContain("agent-2");
    });
  });

  describe("getAllAgentStatuses", () => {
    it("should return statuses from all gateways", async () => {
      const gateway1 = `test-gateway-${crypto.randomUUID()}`;
      const gateway2 = `test-gateway-${crypto.randomUUID()}`;

      await registerGateway(gateway1);
      await registerGateway(gateway2);

      await updateAgentStatuses(gateway1, [
        { id: "agent-1", name: "executor", status: "running" },
      ]);

      await updateAgentStatuses(gateway2, [
        { id: "agent-2", name: "architect", status: "idle" },
      ]);

      const allStatuses = await getAllAgentStatuses();

      expect(allStatuses[gateway1]).toHaveLength(1);
      expect(allStatuses[gateway1][0].id).toBe("agent-1");

      expect(allStatuses[gateway2]).toHaveLength(1);
      expect(allStatuses[gateway2][0].id).toBe("agent-2");
    });

    it("should return empty object when no statuses exist", async () => {
      const allStatuses = await getAllAgentStatuses();
      expect(typeof allStatuses).toBe("object");
    });

    it("should not include gateways without agent statuses", async () => {
      const gatewayId = `test-gateway-${crypto.randomUUID()}`;
      await registerGateway(gatewayId);
      // Don't update any agent statuses

      const allStatuses = await getAllAgentStatuses();
      expect(allStatuses[gatewayId]).toBeUndefined();
    });
  });
});
