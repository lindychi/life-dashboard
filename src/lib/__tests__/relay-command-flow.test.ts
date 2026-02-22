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
  registerGateway,
  queueCommand,
  getAndClearCommands,
  getConnectedGateways,
} from "@/lib/relay";

describe("Relay Command Flow", () => {
  beforeEach(() => {
    // Reset in-memory storage
    mockStorage.gatewayConnections = [];
    mockStorage.relayCommands = [];

    // Clear mock call history
    vi.clearAllMocks();
  });

  describe("Command Queueing and Retrieval", () => {
    it("should queue a spawn command and retrieve it with getAndClearCommands", async () => {
      const gatewayId = crypto.randomUUID();
      await registerGateway(gatewayId);

      const command = await queueCommand(gatewayId, {
        type: "spawn",
        payload: {
          agentId: "pm",
          task: "Review Q1 growth metrics",
          systemPrompt: "You are the PM agent...",
        },
      });

      expect(command).toMatchObject({
        type: "spawn",
        status: "pending",
      });
      expect(command.payload.agentId).toBe("pm");
      expect(command.payload.task).toBe("Review Q1 growth metrics");
      expect(command.payload.systemPrompt).toBe("You are the PM agent...");
      expect(command.id).toBeDefined();
      expect(command.createdAt).toMatch(/^\d{4}-/);

      const commands = await getAndClearCommands(gatewayId);
      expect(commands).toHaveLength(1);
      expect(commands[0].id).toBe(command.id);
      expect(commands[0].status).toBe("processing");
    });

    it("should include agentId, task, and systemPrompt in spawn payload", async () => {
      const gatewayId = crypto.randomUUID();
      await registerGateway(gatewayId);

      const command = await queueCommand(gatewayId, {
        type: "spawn",
        payload: {
          agentId: "pm",
          task: "Review Q1 growth metrics",
          systemPrompt: "You are the PM agent responsible for growth.",
        },
      });

      expect(command.payload).toEqual({
        agentId: "pm",
        task: "Review Q1 growth metrics",
        systemPrompt: "You are the PM agent responsible for growth.",
      });
    });

    it("should queue multiple commands and return them together", async () => {
      const gatewayId = crypto.randomUUID();
      await registerGateway(gatewayId);

      await queueCommand(gatewayId, {
        type: "spawn",
        payload: { agentId: "pm", task: "Task 1", systemPrompt: "Prompt 1" },
      });
      await queueCommand(gatewayId, {
        type: "spawn",
        payload: { agentId: "dev", task: "Task 2", systemPrompt: "Prompt 2" },
      });
      await queueCommand(gatewayId, {
        type: "spawn",
        payload: {
          agentId: "reviewer",
          task: "Task 3",
          systemPrompt: "Prompt 3",
        },
      });

      const commands = await getAndClearCommands(gatewayId);
      expect(commands).toHaveLength(3);
    });

    it("should clear queue after getAndClearCommands", async () => {
      const gatewayId = crypto.randomUUID();
      await registerGateway(gatewayId);

      await queueCommand(gatewayId, {
        type: "spawn",
        payload: { agentId: "pm", task: "Task", systemPrompt: "Prompt" },
      });

      const firstCall = await getAndClearCommands(gatewayId);
      expect(firstCall).toHaveLength(1);

      const secondCall = await getAndClearCommands(gatewayId);
      expect(secondCall).toHaveLength(0);
    });

    it("should auto-create queue for non-existent gateway", async () => {
      const gatewayId = crypto.randomUUID();

      const command = await queueCommand(gatewayId, {
        type: "spawn",
        payload: { agentId: "pm", task: "Task", systemPrompt: "Prompt" },
      });

      expect(command).toBeDefined();
      expect(command.status).toBe("pending");

      const commands = await getAndClearCommands(gatewayId);
      expect(commands).toHaveLength(1);
    });

    it("should generate unique command id and createdAt", async () => {
      const gatewayId = crypto.randomUUID();
      await registerGateway(gatewayId);

      const cmd1 = await queueCommand(gatewayId, {
        type: "spawn",
        payload: { agentId: "pm", task: "Task 1", systemPrompt: "P1" },
      });
      const cmd2 = await queueCommand(gatewayId, {
        type: "spawn",
        payload: { agentId: "dev", task: "Task 2", systemPrompt: "P2" },
      });

      expect(cmd1.id).not.toBe(cmd2.id);
      expect(cmd1.createdAt).toMatch(/^\d{4}-/);
      expect(cmd2.createdAt).toMatch(/^\d{4}-/);
      expect(cmd1.status).toBe("pending");
      expect(cmd2.status).toBe("pending");
    });
  });

  describe("handleStartTask Payload Structure", () => {
    it("should produce correct spawn command shape", async () => {
      const gatewayId = crypto.randomUUID();
      await registerGateway(gatewayId);

      // This mirrors what handleStartTask will send via POST /api/relay/command
      const command = await queueCommand(gatewayId, {
        type: "spawn",
        payload: {
          agentId: "pm",
          task: "Review Q1 growth metrics",
          systemPrompt:
            "You are the PM agent responsible for growth metrics.",
        },
      });

      expect(command.type).toBe("spawn");
      expect(command.payload.agentId).toBe("pm");
      expect(command.payload.task).toBe("Review Q1 growth metrics");
      expect(command.payload.systemPrompt).toBe(
        "You are the PM agent responsible for growth metrics."
      );
    });

    it("should support different agent types with their prompts", async () => {
      const gatewayId = crypto.randomUUID();
      await registerGateway(gatewayId);

      const agents = [
        {
          id: "pm",
          systemPrompt: "You are the PM agent.",
          task: "Review metrics",
        },
        {
          id: "dev",
          systemPrompt: "You are the Dev agent.",
          task: "Fix bugs",
        },
        {
          id: "content",
          systemPrompt: "You are the Content agent.",
          task: "Write blog",
        },
      ];

      const commands = await Promise.all(
        agents.map((agent) =>
          queueCommand(gatewayId, {
            type: "spawn",
            payload: {
              agentId: agent.id,
              task: agent.task,
              systemPrompt: agent.systemPrompt,
            },
          })
        )
      );

      expect(commands).toHaveLength(3);
      commands.forEach((command, i) => {
        expect(command.payload.agentId).toBe(agents[i].id);
        expect(command.payload.task).toBe(agents[i].task);
        expect(command.payload.systemPrompt).toBe(agents[i].systemPrompt);
      });

      const retrieved = await getAndClearCommands(gatewayId);
      expect(retrieved).toHaveLength(3);
    });
  });

  describe("Gateway Management", () => {
    it("should list connected gateways as objects", async () => {
      const gatewayId = crypto.randomUUID();
      await registerGateway(gatewayId);

      const gateways = await getConnectedGateways();
      const ids = gateways.map((g) => g.id);
      expect(ids).toContain(gatewayId);
    });

    it("should handle commands for multiple gateways independently", async () => {
      const gw1 = crypto.randomUUID();
      const gw2 = crypto.randomUUID();
      await registerGateway(gw1);
      await registerGateway(gw2);

      await queueCommand(gw1, {
        type: "spawn",
        payload: { agentId: "pm", task: "GW1 task", systemPrompt: "P1" },
      });
      await queueCommand(gw2, {
        type: "spawn",
        payload: { agentId: "dev", task: "GW2 task", systemPrompt: "P2" },
      });

      const commands1 = await getAndClearCommands(gw1);
      const commands2 = await getAndClearCommands(gw2);

      expect(commands1).toHaveLength(1);
      expect(commands1[0].payload.agentId).toBe("pm");

      expect(commands2).toHaveLength(1);
      expect(commands2[0].payload.agentId).toBe("dev");
    });
  });
});
