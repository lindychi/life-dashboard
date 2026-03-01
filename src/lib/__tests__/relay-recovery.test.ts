/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * relay-recovery.test.ts
 *
 * Tests for Fix 1: registerGateway() resets orphaned 'processing' commands
 * back to 'pending' so they can be re-picked up after a gateway crash.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory storage — declared BEFORE vi.mock so the factory closure captures it
// ---------------------------------------------------------------------------

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

  // task_executions rows referenced by orphan-recovery query
  taskExecutions: [] as Array<{
    command_id: string | null;
    gateway_id: string;
    status: string;
  }>,
};

// ---------------------------------------------------------------------------
// DB mock
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => {
  const queryImpl = async (sql: string, params: any[] = []) => {
    // INSERT INTO gateway_connections (register / re-register)
    if (sql.includes("INSERT INTO gateway_connections")) {
      const [gatewayId] = params;
      const now = new Date().toISOString();
      const existingIndex = mockStorage.gatewayConnections.findIndex(
        (g) => g.id === gatewayId
      );
      if (existingIndex >= 0) {
        mockStorage.gatewayConnections[existingIndex] = {
          ...mockStorage.gatewayConnections[existingIndex],
          status: "connected",
          last_heartbeat: now,
        };
        return [mockStorage.gatewayConnections[existingIndex]];
      }
      const gateway = {
        id: gatewayId,
        status: "connected",
        connected_at: now,
        last_heartbeat: now,
      };
      mockStorage.gatewayConnections.push(gateway);
      return [gateway];
    }

    // UPDATE agent_statuses to idle (registerGateway cleanup)
    if (
      sql.includes("UPDATE agent_statuses") &&
      sql.includes("status = 'idle'")
    ) {
      const [gatewayId] = params;
      mockStorage.agentStatuses
        .filter((a) => a.gateway_id === gatewayId && a.status === "running")
        .forEach((a) => {
          a.status = "idle";
          a.current_task = null;
        });
      return [];
    }

    // UPDATE relay_commands: orphan processing→pending (Fix 1)
    // SQL contains "SET status = 'pending'" and "status = 'processing'"
    if (
      sql.includes("UPDATE relay_commands") &&
      sql.includes("SET status = 'pending'") &&
      sql.includes("status = 'processing'")
    ) {
      const [gatewayId] = params;

      // Collect command_ids that are tracked in task_executions for this gateway
      const trackedCommandIds = new Set(
        mockStorage.taskExecutions
          .filter(
            (te) =>
              te.command_id !== null &&
              te.gateway_id === gatewayId &&
              (te.status === "running" || te.status === "interrupted")
          )
          .map((te) => te.command_id as string)
      );

      // Find orphaned processing commands (not tracked)
      const orphans = mockStorage.relayCommands.filter(
        (c) =>
          c.gateway_id === gatewayId &&
          c.status === "processing" &&
          !trackedCommandIds.has(c.id)
      );

      orphans.forEach((c) => {
        c.status = "pending";
      });

      return orphans.map((c) => ({ id: c.id }));
    }

    // UPDATE relay_commands (getAndClearCommands — pending→processing)
    if (
      sql.includes("UPDATE relay_commands") &&
      sql.includes("SET status = 'processing'") &&
      sql.includes("status = 'pending'")
    ) {
      const [gatewayId] = params;
      const pending = mockStorage.relayCommands.filter(
        (c) => c.gateway_id === gatewayId && c.status === "pending"
      );
      pending.forEach((c) => {
        c.status = "processing";
      });
      return pending;
    }

    return [];
  };

  return {
    query: vi.fn(queryImpl),
    queryOne: vi.fn(async (sql: string, params: any[] = []) => {
      const results = await queryImpl(sql, params);
      return results[0] ?? null;
    }),
    isDbConnectionError: vi.fn().mockReturnValue(false),
    pool: {},
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { registerGateway, getAndClearCommands } from "@/lib/relay";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addCommand(
  gatewayId: string,
  status: "pending" | "processing" | "completed" | "failed",
  id?: string
): string {
  const cmdId = id ?? crypto.randomUUID();
  mockStorage.relayCommands.push({
    id: cmdId,
    gateway_id: gatewayId,
    type: "spawn",
    payload: { task: "test" },
    status,
    result: null,
    created_at: new Date().toISOString(),
    completed_at: null,
  });
  return cmdId;
}

function addTaskExecution(
  commandId: string,
  gatewayId: string,
  status: "running" | "interrupted" | "completed" | "failed"
): void {
  mockStorage.taskExecutions.push({ command_id: commandId, gateway_id: gatewayId, status });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerGateway — Fix 1: orphan processing→pending reset", () => {
  beforeEach(() => {
    mockStorage.gatewayConnections = [];
    mockStorage.relayCommands = [];
    mockStorage.agentStatuses = [];
    mockStorage.taskExecutions = [];
    vi.clearAllMocks();
  });

  it("resets a single processing command to pending on re-registration", async () => {
    const gatewayId = `gw-${crypto.randomUUID()}`;
    const cmdId = addCommand(gatewayId, "processing");

    await registerGateway(gatewayId);

    const cmd = mockStorage.relayCommands.find((c) => c.id === cmdId);
    expect(cmd?.status).toBe("pending");
  });

  it("resets multiple orphaned processing commands to pending", async () => {
    const gatewayId = `gw-${crypto.randomUUID()}`;
    const ids = [
      addCommand(gatewayId, "processing"),
      addCommand(gatewayId, "processing"),
      addCommand(gatewayId, "processing"),
    ];

    await registerGateway(gatewayId);

    for (const id of ids) {
      const cmd = mockStorage.relayCommands.find((c) => c.id === id);
      expect(cmd?.status).toBe("pending");
    }
  });

  it("does not reset commands that are already completed", async () => {
    const gatewayId = `gw-${crypto.randomUUID()}`;
    const completedId = addCommand(gatewayId, "completed");

    await registerGateway(gatewayId);

    const cmd = mockStorage.relayCommands.find((c) => c.id === completedId);
    expect(cmd?.status).toBe("completed");
  });

  it("does not reset commands that are already failed", async () => {
    const gatewayId = `gw-${crypto.randomUUID()}`;
    const failedId = addCommand(gatewayId, "failed");

    await registerGateway(gatewayId);

    const cmd = mockStorage.relayCommands.find((c) => c.id === failedId);
    expect(cmd?.status).toBe("failed");
  });

  it("does not reset commands that are pending (already in correct state)", async () => {
    const gatewayId = `gw-${crypto.randomUUID()}`;
    const pendingId = addCommand(gatewayId, "pending");

    await registerGateway(gatewayId);

    const cmd = mockStorage.relayCommands.find((c) => c.id === pendingId);
    expect(cmd?.status).toBe("pending");
  });

  it("only resets processing commands for the specific gateway_id, not other gateways", async () => {
    const gatewayA = `gw-a-${crypto.randomUUID()}`;
    const gatewayB = `gw-b-${crypto.randomUUID()}`;

    const cmdA = addCommand(gatewayA, "processing");
    const cmdB = addCommand(gatewayB, "processing");

    // Register gateway A — should only reset A's commands
    await registerGateway(gatewayA);

    const cmdARow = mockStorage.relayCommands.find((c) => c.id === cmdA);
    const cmdBRow = mockStorage.relayCommands.find((c) => c.id === cmdB);

    expect(cmdARow?.status).toBe("pending");   // A's command reset
    expect(cmdBRow?.status).toBe("processing"); // B's command untouched
  });

  it("does not reset processing commands tracked in task_executions (running)", async () => {
    const gatewayId = `gw-${crypto.randomUUID()}`;
    const trackedId = addCommand(gatewayId, "processing");
    addTaskExecution(trackedId, gatewayId, "running");

    await registerGateway(gatewayId);

    const cmd = mockStorage.relayCommands.find((c) => c.id === trackedId);
    // Tracked commands are managed by taskStateManager recovery — should NOT be reset
    expect(cmd?.status).toBe("processing");
  });

  it("does not reset processing commands tracked in task_executions (interrupted)", async () => {
    const gatewayId = `gw-${crypto.randomUUID()}`;
    const trackedId = addCommand(gatewayId, "processing");
    addTaskExecution(trackedId, gatewayId, "interrupted");

    await registerGateway(gatewayId);

    const cmd = mockStorage.relayCommands.find((c) => c.id === trackedId);
    expect(cmd?.status).toBe("processing");
  });

  it("resets untracked processing commands while leaving tracked ones alone", async () => {
    const gatewayId = `gw-${crypto.randomUUID()}`;

    const orphanId = addCommand(gatewayId, "processing");  // not tracked
    const trackedId = addCommand(gatewayId, "processing"); // tracked in task_executions
    addTaskExecution(trackedId, gatewayId, "running");

    await registerGateway(gatewayId);

    const orphanCmd = mockStorage.relayCommands.find((c) => c.id === orphanId);
    const trackedCmd = mockStorage.relayCommands.find((c) => c.id === trackedId);

    expect(orphanCmd?.status).toBe("pending");     // orphan → reset
    expect(trackedCmd?.status).toBe("processing"); // tracked → untouched
  });

  it("reset commands are re-pickup-able via getAndClearCommands", async () => {
    const gatewayId = `gw-${crypto.randomUUID()}`;
    addCommand(gatewayId, "processing");

    await registerGateway(gatewayId);

    const commands = await getAndClearCommands(gatewayId);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands[0].status).toBe("processing"); // getAndClearCommands marks as processing
  });

  it("returns a valid GatewayConnection even when commands are reset", async () => {
    const gatewayId = `gw-${crypto.randomUUID()}`;
    addCommand(gatewayId, "processing");

    const conn = await registerGateway(gatewayId);

    expect(conn.id).toBe(gatewayId);
    expect(conn.status).toBe("connected");
  });
});
