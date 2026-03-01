import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({ Pool: vi.fn(() => ({ query: vi.fn() })) }));

// Mock DB
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  pool: {},
  isDbConnectionError: () => false,
}));

// Mock relay — spy on selectOptimalGateway and control its return value
const mockSelectOptimalGateway = vi.fn();
const mockGetConnectedGateways = vi.fn();
const mockQueueCommand = vi.fn();
const mockValidateRelayKey = vi.fn().mockReturnValue(true);
const mockIsDbAvailable = vi.fn().mockReturnValue(true);
const mockIsAgentBusy = vi.fn().mockReturnValue(false);
const mockQueueInstruction = vi.fn();
const mockLinkAttachmentsToCommand = vi.fn();

vi.mock("@/lib/relay", () => ({
  selectOptimalGateway: (...args: unknown[]) => mockSelectOptimalGateway(...args),
  getConnectedGateways: () => mockGetConnectedGateways(),
  queueCommand: (...args: unknown[]) => mockQueueCommand(...args),
  validateRelayKey: (...args: unknown[]) => mockValidateRelayKey(...args),
  isDbAvailable: () => mockIsDbAvailable(),
  isAgentBusy: (...args: unknown[]) => mockIsAgentBusy(...args),
  queueInstruction: (...args: unknown[]) => mockQueueInstruction(...args),
  linkAttachmentsToCommand: (...args: unknown[]) => mockLinkAttachmentsToCommand(...args),
}));

// Mock auth — always authenticated
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(() => ({ email: "test@example.com" })),
}));

// Mock attachments
vi.mock("@/lib/attachments", () => ({
  saveAttachment: vi.fn(),
  getAttachmentByRefKey: vi.fn(),
}));

import { NextRequest } from "next/server";
import { POST } from "../command/route";

function makeRequest(body: Record<string, unknown>, relayKey = "test-key") {
  return new NextRequest("http://localhost/api/relay/command", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-relay-key": relayKey,
    },
    body: JSON.stringify(body),
  });
}

const connectedGateways = [
  { id: "gw1", status: "connected", connectedAt: "2024-01-01T00:00:00Z", lastHeartbeat: "2024-01-01T00:00:00Z" },
  { id: "gw2", status: "connected", connectedAt: "2024-01-01T00:00:00Z", lastHeartbeat: "2024-01-01T00:01:00Z" },
];

const fakeCommand = {
  id: "cmd-123",
  type: "spawn",
  payload: { agentId: "agent-1", task: "do something" },
  createdAt: "2024-01-01T00:00:00Z",
  status: "pending",
};

describe("command route — gateway selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateRelayKey.mockReturnValue(true);
    mockIsDbAvailable.mockReturnValue(true);
    mockIsAgentBusy.mockResolvedValue(false);
    mockQueueCommand.mockResolvedValue(fakeCommand);
    mockSelectOptimalGateway.mockResolvedValue({ gatewayId: "gw2", reason: "least-loaded" });
    mockGetConnectedGateways.mockResolvedValue(connectedGateways);
  });

  it("1. explicit gatewayId — selectOptimalGateway is NOT called", async () => {
    const req = makeRequest({
      gatewayId: "gw1",
      type: "spawn",
      payload: { agentId: "agent-1", task: "do something" },
    });
    const res = await POST(req);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(mockSelectOptimalGateway).not.toHaveBeenCalled();
    expect(mockQueueCommand).toHaveBeenCalledWith("gw1", expect.anything());
  });

  it("2. no gatewayId — selectOptimalGateway IS called with connected gateways and agentId", async () => {
    const req = makeRequest({
      type: "spawn",
      payload: { agentId: "agent-1", task: "do something" },
    });
    const res = await POST(req);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(mockSelectOptimalGateway).toHaveBeenCalledOnce();
    // Called with the connected-filtered gateways and the agentId
    const [gwsArg, agentIdArg] = mockSelectOptimalGateway.mock.calls[0];
    expect(Array.isArray(gwsArg)).toBe(true);
    expect(gwsArg.every((g: { status: string }) => g.status === "connected")).toBe(true);
    expect(agentIdArg).toBe("agent-1");
  });

  it("3. selected gateway from selectOptimalGateway is used in queueCommand", async () => {
    mockSelectOptimalGateway.mockResolvedValue({ gatewayId: "gw2", reason: "least-loaded" });

    const req = makeRequest({
      type: "spawn",
      payload: { agentId: "agent-1", task: "do something" },
    });
    await POST(req);

    expect(mockQueueCommand).toHaveBeenCalledWith("gw2", expect.anything());
  });
});
