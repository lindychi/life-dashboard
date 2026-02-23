import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";

import { uploadAttachment, sendMessageWithAttachments } from "../mcp-attachments";

describe("mcp-attachments helpers", () => {
  const dashboardUrl = "http://localhost:3000";
  const relayApiKey = "test-relay-key";
  let tempFilePath: string;

  beforeEach(async () => {
    tempFilePath = path.join(os.tmpdir(), `mcp-attach-${Date.now()}.txt`);
    await fs.writeFile(tempFilePath, "hello world");
  });

  afterEach(async () => {
    await fs.unlink(tempFilePath).catch(() => {});
    vi.restoreAllMocks();
  });

  it("uploads attachment and returns refKey", async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith("/api/attachments")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            attachment: { refKey: "abc123" },
          }),
          text: async () => "OK",
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadAttachment({
      dashboardUrl,
      relayApiKey,
      filePath: tempFilePath,
    });

    expect(result.refKey).toBe("abc123");
    expect(fetchMock).toHaveBeenCalledWith(
      `${dashboardUrl}/api/attachments`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-relay-key": relayApiKey,
        }),
      })
    );
  });

  it("appends @file refs and sends message payload", async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith("/api/attachments")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            attachment: { refKey: "ref999" },
          }),
          text: async () => "OK",
        } as Response;
      }

      if (url.endsWith("/api/relay/messages")) {
        return {
          ok: true,
          json: async () => ({ success: true }),
          text: async () => "OK",
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    await sendMessageWithAttachments({
      dashboardUrl,
      relayApiKey,
      from: "dev",
      to: "pm",
      content: "Hello!",
      type: "text",
      attachments: [{ filePath: tempFilePath }],
    });

    const messageCall = fetchMock.mock.calls.find(([url]) =>
      (url as string).endsWith("/api/relay/messages")
    );
    expect(messageCall).toBeDefined();

    const [, options] = messageCall!;
    const body = JSON.parse(options?.body as string);
    expect(body.content).toContain("@file:ref999");
  });
});
