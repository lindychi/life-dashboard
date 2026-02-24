import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/relay", () => ({
  queueCommand: vi.fn(),
  getConnectedGateways: vi.fn().mockResolvedValue([{ id: "gw-1", status: "connected" }]),
  validateRelayKey: vi.fn().mockReturnValue(false),
  isDbAvailable: vi.fn().mockReturnValue(true),
  queueInstruction: vi.fn().mockResolvedValue({ id: "inst-1", position: 1 }),
  isAgentBusy: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ email: "test@test.com" }),
}));

function makeRequest(body: unknown) {
  return new NextRequest(new URL("/api/relay/command", "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/relay/command - queueing with payload.task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues instruction when queue=true and payload.task is provided", async () => {
    const { POST } = await import("@/app/api/relay/command/route");

    const request = makeRequest({
      type: "spawn",
      queue: true,
      payload: {
        agentId: "dev",
        task: "Fix queue logic",
      },
    });

    const response = await POST(request);
    const data = await response.json();

    const relay = await import("@/lib/relay");
    expect(vi.mocked(relay.queueInstruction)).toHaveBeenCalledWith(
      "gw-1",
      "dev",
      "Fix queue logic",
      undefined
    );
    expect(vi.mocked(relay.queueCommand)).not.toHaveBeenCalled();
    expect(data.queued).toBe(true);
  });

  it("queues instruction when agent is busy and payload.task is provided", async () => {
    const relay = await import("@/lib/relay");
    vi.mocked(relay.isAgentBusy).mockResolvedValueOnce(true);

    const { POST } = await import("@/app/api/relay/command/route");

    const request = makeRequest({
      type: "spawn",
      payload: {
        agentId: "dev",
        task: "Queue me",
      },
    });

    const response = await POST(request);
    const data = await response.json();

    expect(vi.mocked(relay.queueInstruction)).toHaveBeenCalledWith(
      "gw-1",
      "dev",
      "Queue me",
      undefined
    );
    expect(data.queued).toBe(true);
  });
});
