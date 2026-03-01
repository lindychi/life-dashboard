import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({ Pool: vi.fn(() => ({ query: vi.fn() })) }));

// DB mock — queryOne controls relay_commands COUNT results
const mockQueryOne = vi.fn();
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  pool: {},
  isDbConnectionError: () => false,
}));

import { selectOptimalGateway, getRunningTaskCount } from "../relay";
import type { GatewayConnection } from "../relay";

function makeGateway(
  id: string,
  status: "connected" | "disconnected" = "connected",
  lastHeartbeat = "2024-01-01T00:00:00.000Z"
): GatewayConnection {
  return { id, connectedAt: "2024-01-01T00:00:00.000Z", lastHeartbeat, status };
}

describe("selectOptimalGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GATEWAY_AFFINITY;
  });

  afterEach(() => {
    delete process.env.GATEWAY_AFFINITY;
  });

  it("1. single gateway — returns that gateway with reason fallback", async () => {
    const gws = [makeGateway("gw1")];
    const result = await selectOptimalGateway(gws);
    expect(result.gatewayId).toBe("gw1");
    expect(result.reason).toBe("fallback");
    // No DB query needed for single gateway
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it("2. multiple gateways with equal load — returns least-loaded (tiebreak: most recent heartbeat)", async () => {
    // gw1 older heartbeat, gw2 newer heartbeat — same load (0)
    const gws = [
      makeGateway("gw1", "connected", "2024-01-01T00:00:00.000Z"),
      makeGateway("gw2", "connected", "2024-01-01T00:01:00.000Z"),
    ];
    // Both return count 0
    mockQueryOne.mockResolvedValue({ count: "0" });
    const result = await selectOptimalGateway(gws);
    expect(result.gatewayId).toBe("gw2"); // newer heartbeat wins tiebreak
    expect(result.reason).toBe("least-loaded");
  });

  it("3. multiple gateways with unequal load — returns less-loaded gateway", async () => {
    const gws = [makeGateway("gw1"), makeGateway("gw2")];
    // gw1 → 3 tasks, gw2 → 1 task
    mockQueryOne
      .mockResolvedValueOnce({ count: "3" }) // gw1
      .mockResolvedValueOnce({ count: "1" }); // gw2
    const result = await selectOptimalGateway(gws);
    expect(result.gatewayId).toBe("gw2");
    expect(result.reason).toBe("least-loaded");
  });

  it("4. agentId with affinity — returns affinity gateway", async () => {
    process.env.GATEWAY_AFFINITY = JSON.stringify({ analyst: "gw2" });
    const gws = [makeGateway("gw1"), makeGateway("gw2")];
    // Both lightly loaded
    mockQueryOne.mockResolvedValue({ count: "0" });
    const result = await selectOptimalGateway(gws, "analyst");
    expect(result.gatewayId).toBe("gw2");
    expect(result.reason).toBe("affinity");
  });

  it("5. affinity gateway is disconnected — falls back to least-loaded", async () => {
    process.env.GATEWAY_AFFINITY = JSON.stringify({ analyst: "gw2" });
    // gw2 is disconnected
    const gws = [makeGateway("gw1", "connected"), makeGateway("gw2", "disconnected")];
    // Only gw1 is active, so single active gateway → fallback
    const result = await selectOptimalGateway(gws, "analyst");
    expect(result.gatewayId).toBe("gw1");
    // gw2 disconnected means only gw1 is in active list → single → fallback
    expect(["fallback", "least-loaded"]).toContain(result.reason);
  });

  it("6. affinity gateway is overloaded (>5 tasks) — falls back to least-loaded", async () => {
    process.env.GATEWAY_AFFINITY = JSON.stringify({ analyst: "gw2" });
    const gws = [makeGateway("gw1"), makeGateway("gw2")];
    // gw1 → 0 tasks, gw2 → 6 tasks (overloaded)
    mockQueryOne
      .mockResolvedValueOnce({ count: "0" }) // gw1
      .mockResolvedValueOnce({ count: "6" }); // gw2
    const result = await selectOptimalGateway(gws, "analyst");
    expect(result.gatewayId).toBe("gw1"); // gw1 wins least-loaded
    expect(result.reason).toBe("least-loaded");
  });

  it("7. DB error during count — falls back to first connected gateway", async () => {
    const gws = [makeGateway("gw1"), makeGateway("gw2")];
    // getRunningTaskCount catches errors internally and returns 0,
    // so Promise.all itself won't throw. Both counts will be 0.
    // Result: tiebreak by heartbeat (same heartbeat → gw1 wins since gw2 not newer)
    mockQueryOne.mockRejectedValue(new Error("DB down"));
    const result = await selectOptimalGateway(gws);
    // Both return 0 (error fallback in getRunningTaskCount), same heartbeat → gw1
    expect(result.gatewayId).toBe("gw1");
  });

  it("8. empty gateway list — throws", async () => {
    await expect(selectOptimalGateway([])).rejects.toThrow(
      "No connected gateways available"
    );
  });

  it("8b. all gateways disconnected — throws", async () => {
    const gws = [makeGateway("gw1", "disconnected"), makeGateway("gw2", "disconnected")];
    await expect(selectOptimalGateway(gws)).rejects.toThrow(
      "No connected gateways available"
    );
  });
});

describe("getRunningTaskCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns count from DB", async () => {
    mockQueryOne.mockResolvedValueOnce({ count: "3" });
    const count = await getRunningTaskCount("gw1");
    expect(count).toBe(3);
  });

  it("returns 0 on DB error", async () => {
    mockQueryOne.mockRejectedValueOnce(new Error("DB down"));
    const count = await getRunningTaskCount("gw1");
    expect(count).toBe(0);
  });

  it("returns 0 when queryOne returns null", async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const count = await getRunningTaskCount("gw1");
    expect(count).toBe(0);
  });
});
