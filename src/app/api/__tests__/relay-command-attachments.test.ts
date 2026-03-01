import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

const queueCommandMock = vi.fn();
const getConnectedGatewaysMock = vi.fn();
const validateRelayKeyMock = vi.fn();
const isDbAvailableMock = vi.fn();
const queueInstructionMock = vi.fn();
const isAgentBusyMock = vi.fn();
const linkAttachmentsToCommandMock = vi.fn();

const selectOptimalGatewayMock = vi.fn();

vi.mock("@/lib/relay", () => ({
  queueCommand: (...args: unknown[]) => queueCommandMock(...args),
  getConnectedGateways: (...args: unknown[]) => getConnectedGatewaysMock(...args),
  validateRelayKey: (...args: unknown[]) => validateRelayKeyMock(...args),
  isDbAvailable: (...args: unknown[]) => isDbAvailableMock(...args),
  queueInstruction: (...args: unknown[]) => queueInstructionMock(...args),
  isAgentBusy: (...args: unknown[]) => isAgentBusyMock(...args),
  linkAttachmentsToCommand: (...args: unknown[]) => linkAttachmentsToCommandMock(...args),
  selectOptimalGateway: (...args: unknown[]) => selectOptimalGatewayMock(...args),
}));

vi.mock("@/lib/db", () => ({
  isDbConnectionError: vi.fn(() => false),
}));

const saveAttachmentMock = vi.fn();
const getAttachmentByRefKeyMock = vi.fn();

vi.mock("@/lib/attachments", () => ({
  saveAttachment: (...args: unknown[]) => saveAttachmentMock(...args),
  getAttachmentByRefKey: (...args: unknown[]) => getAttachmentByRefKeyMock(...args),
}));

import { getCurrentUser } from "@/lib/auth";

function createPostRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/relay/command", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/relay/command with attachments", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    validateRelayKeyMock.mockReturnValue(true);
    isDbAvailableMock.mockReturnValue(true);
    getConnectedGatewaysMock.mockResolvedValue([{ id: "gw-1", status: "connected" }]);
    isAgentBusyMock.mockResolvedValue(false);
    queueCommandMock.mockResolvedValue({ id: "cmd-1", type: "spawn", payload: {} });
    linkAttachmentsToCommandMock.mockResolvedValue(undefined);
    selectOptimalGatewayMock.mockResolvedValue({ gatewayId: "gw-1", reason: "fallback" });
    const mod = await import("@/app/api/relay/command/route");
    POST = mod.POST as unknown as (req: Request) => Promise<Response>;
  });

  it("should return 401 when no auth is provided", async () => {
    validateRelayKeyMock.mockReturnValue(false);
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const req = createPostRequest({
      type: "spawn",
      payload: { agentId: "qa", task: "test" },
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("should send command without attachments", async () => {
    const req = createPostRequest(
      { type: "spawn", payload: { agentId: "qa", task: "run tests" } },
      { "x-relay-key": "dev-relay-key" }
    );
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.attachments).toBeUndefined();
    expect(linkAttachmentsToCommandMock).not.toHaveBeenCalled();
  });

  it("should resolve attachments and inject @file: references into task content", async () => {
    getAttachmentByRefKeyMock.mockResolvedValue({
      id: "att-uuid-1",
      originalFilename: "report.pdf",
      refKey: "abcd1234",
    });

    const req = createPostRequest(
      {
        type: "spawn",
        payload: { agentId: "qa", task: "분석해주세요" },
        attachments: [{ refKey: "abcd1234" }],
      },
      { "x-relay-key": "dev-relay-key" }
    );
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.attachments).toEqual({ linked: 1 });

    // Verify queueCommand was called with modified payload
    expect(queueCommandMock).toHaveBeenCalledTimes(1);
    const [, commandData] = queueCommandMock.mock.calls[0];
    expect(commandData.payload.task).toContain("@file:abcd1234");
    expect(commandData.payload.task).toContain("첨부파일:");
    expect(commandData.payload._attachmentRefKeys).toEqual(["abcd1234"]);
  });

  it("should handle multiple attachments", async () => {
    getAttachmentByRefKeyMock
      .mockResolvedValueOnce({
        id: "att-1",
        originalFilename: "file1.txt",
        refKey: "ref1aaaa",
      })
      .mockResolvedValueOnce({
        id: "att-2",
        originalFilename: "file2.png",
        refKey: "ref2bbbb",
      });

    const req = createPostRequest(
      {
        type: "spawn",
        payload: { agentId: "qa", task: "리뷰해주세요" },
        attachments: [{ refKey: "ref1aaaa" }, { refKey: "ref2bbbb" }],
      },
      { "x-relay-key": "dev-relay-key" }
    );
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.attachments).toEqual({ linked: 2 });

    const [, commandData] = queueCommandMock.mock.calls[0];
    expect(commandData.payload.task).toContain("@file:ref1aaaa");
    expect(commandData.payload.task).toContain("@file:ref2bbbb");
    expect(commandData.payload._attachmentRefKeys).toEqual(["ref1aaaa", "ref2bbbb"]);
  });

  it("should skip missing attachments (ref_key not found)", async () => {
    getAttachmentByRefKeyMock
      .mockResolvedValueOnce({
        id: "att-1",
        originalFilename: "exists.txt",
        refKey: "ref1aaaa",
      })
      .mockResolvedValueOnce(null); // not found

    const req = createPostRequest(
      {
        type: "spawn",
        payload: { agentId: "qa", task: "test task" },
        attachments: [{ refKey: "ref1aaaa" }, { refKey: "missing1" }],
      },
      { "x-relay-key": "dev-relay-key" }
    );
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.attachments).toEqual({ linked: 1 });

    const [, commandData] = queueCommandMock.mock.calls[0];
    expect(commandData.payload._attachmentRefKeys).toEqual(["ref1aaaa"]);
  });

  it("should inject into instruction field when task is absent", async () => {
    getAttachmentByRefKeyMock.mockResolvedValue({
      id: "att-1",
      originalFilename: "spec.md",
      refKey: "spec1234",
    });

    const req = createPostRequest(
      {
        type: "orchestrate",
        payload: { instruction: "이 스펙대로 구현해주세요" },
        attachments: [{ refKey: "spec1234" }],
      },
      { "x-relay-key": "dev-relay-key" }
    );
    const res = await POST(req);

    expect(res.status).toBe(200);
    const [, commandData] = queueCommandMock.mock.calls[0];
    expect(commandData.payload.instruction).toContain("@file:spec1234");
  });

  it("should link attachments to command in DB", async () => {
    getAttachmentByRefKeyMock.mockResolvedValue({
      id: "att-uuid-1",
      originalFilename: "file.txt",
      refKey: "abcd1234",
    });

    const req = createPostRequest(
      {
        type: "spawn",
        payload: { agentId: "qa", task: "test" },
        attachments: [{ refKey: "abcd1234" }],
      },
      { "x-relay-key": "dev-relay-key" }
    );
    await POST(req);

    expect(linkAttachmentsToCommandMock).toHaveBeenCalledWith("cmd-1", ["att-uuid-1"]);
  });

  it("should not fail when linkAttachmentsToCommand throws", async () => {
    getAttachmentByRefKeyMock.mockResolvedValue({
      id: "att-uuid-1",
      originalFilename: "file.txt",
      refKey: "abcd1234",
    });
    linkAttachmentsToCommandMock.mockRejectedValue(new Error("DB error"));

    const req = createPostRequest(
      {
        type: "spawn",
        payload: { agentId: "qa", task: "test" },
        attachments: [{ refKey: "abcd1234" }],
      },
      { "x-relay-key": "dev-relay-key" }
    );
    const res = await POST(req);

    // Should still succeed - linking is non-blocking
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("should handle empty attachments array gracefully", async () => {
    const req = createPostRequest(
      {
        type: "spawn",
        payload: { agentId: "qa", task: "test" },
        attachments: [],
      },
      { "x-relay-key": "dev-relay-key" }
    );
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.attachments).toBeUndefined();
    expect(getAttachmentByRefKeyMock).not.toHaveBeenCalled();
  });

  it("should return 400 when type or payload is missing", async () => {
    const req = createPostRequest(
      { type: "spawn" },
      { "x-relay-key": "dev-relay-key" }
    );
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("required");
  });
});
