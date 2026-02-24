/**
 * MCP Tool Attachment Tests
 *
 * Tests for scripts/mcp-attachments.ts functions:
 * - uploadAttachment: upload file → POST /api/attachments → return refKey
 * - sendMessageWithAttachments: upload files + append @file:refs → send message
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// Mock fs/promises for file reading
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
}));

describe("MCP Attachment Helpers", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("uploadAttachment", () => {
    it("should upload file and return refKey", async () => {
      const { readFile } = await import("fs/promises");
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("test content"));

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          success: true,
          attachment: {
            id: "att-1",
            refKey: "test1234",
            originalFilename: "test.txt",
          },
        }),
      });

      const { uploadAttachment } = await import("../../../scripts/mcp-attachments");
      const result = await uploadAttachment({
        dashboardUrl: "http://localhost:3000",
        relayApiKey: "dev-relay-key",
        filePath: "/tmp/test.txt",
      });

      expect(result.refKey).toBe("test1234");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:3000/api/attachments");
      expect(options.method).toBe("POST");
      expect(options.headers["x-relay-key"]).toBe("dev-relay-key");
    });

    it("should use custom refKey when provided", async () => {
      const { readFile } = await import("fs/promises");
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("data"));

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          attachment: { refKey: "cust1234" },
        }),
      });

      const { uploadAttachment } = await import("../../../scripts/mcp-attachments");
      const result = await uploadAttachment({
        dashboardUrl: "http://localhost:3000",
        relayApiKey: "key",
        filePath: "/tmp/file.txt",
        refKey: "cust1234",
      });

      expect(result.refKey).toBe("cust1234");
    });

    it("should throw on API error", async () => {
      const { readFile } = await import("fs/promises");
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("data"));

      fetchMock.mockResolvedValue({
        ok: false,
        status: 413,
        text: () => Promise.resolve("File too large"),
      });

      const { uploadAttachment } = await import("../../../scripts/mcp-attachments");

      await expect(
        uploadAttachment({
          dashboardUrl: "http://localhost:3000",
          relayApiKey: "key",
          filePath: "/tmp/huge.bin",
        })
      ).rejects.toThrow(/413.*File too large/);
    });

    it("should throw when response has no refKey", async () => {
      const { readFile } = await import("fs/promises");
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("data"));

      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ attachment: {} }),
      });

      const { uploadAttachment } = await import("../../../scripts/mcp-attachments");

      await expect(
        uploadAttachment({
          dashboardUrl: "http://localhost:3000",
          relayApiKey: "key",
          filePath: "/tmp/file.txt",
        })
      ).rejects.toThrow(/refKey/i);
    });
  });

  describe("sendMessageWithAttachments", () => {
    it("should upload attachments and append @file: refs to content", async () => {
      const { readFile } = await import("fs/promises");
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("file data"));

      // First call: upload attachment → success
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ attachment: { refKey: "file1234" } }),
        })
        // Second call: send message → success
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, message: { id: "msg-1" } }),
        });

      const { sendMessageWithAttachments } = await import("../../../scripts/mcp-attachments");
      await sendMessageWithAttachments({
        dashboardUrl: "http://localhost:3000",
        relayApiKey: "key",
        from: "agent-a",
        to: "agent-b",
        content: "여기 파일입니다",
        type: "text",
        attachments: [{ filePath: "/tmp/doc.pdf" }],
      });

      // Verify upload happened first
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [uploadUrl] = fetchMock.mock.calls[0];
      expect(uploadUrl).toBe("http://localhost:3000/api/attachments");

      // Verify message was sent with @file: ref appended
      const [msgUrl, msgOpts] = fetchMock.mock.calls[1];
      expect(msgUrl).toBe("http://localhost:3000/api/relay/messages");
      const body = JSON.parse(msgOpts.body);
      expect(body.content).toContain("여기 파일입니다");
      expect(body.content).toContain("@file:file1234");
    });

    it("should send message without attachments if none provided", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const { sendMessageWithAttachments } = await import("../../../scripts/mcp-attachments");
      await sendMessageWithAttachments({
        dashboardUrl: "http://localhost:3000",
        relayApiKey: "key",
        from: "a",
        to: "b",
        content: "hello",
        type: "text",
      });

      // Only one call (message send), no upload
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.content).toBe("hello");
    });

    it("should handle multiple attachments", async () => {
      const { readFile } = await import("fs/promises");
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("data"));

      fetchMock
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ attachment: { refKey: "ref1aaaa" } }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ attachment: { refKey: "ref2bbbb" } }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) });

      const { sendMessageWithAttachments } = await import("../../../scripts/mcp-attachments");
      await sendMessageWithAttachments({
        dashboardUrl: "http://localhost:3000",
        relayApiKey: "key",
        from: "a",
        to: "b",
        content: "files attached",
        type: "text",
        attachments: [
          { filePath: "/tmp/file1.txt" },
          { filePath: "/tmp/file2.txt" },
        ],
      });

      expect(fetchMock).toHaveBeenCalledTimes(3); // 2 uploads + 1 message
      const body = JSON.parse(fetchMock.mock.calls[2][1].body);
      expect(body.content).toContain("@file:ref1aaaa");
      expect(body.content).toContain("@file:ref2bbbb");
    });

    it("should throw when upload fails mid-way", async () => {
      const { readFile } = await import("fs/promises");
      (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from("data"));

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Server error"),
      });

      const { sendMessageWithAttachments } = await import("../../../scripts/mcp-attachments");

      await expect(
        sendMessageWithAttachments({
          dashboardUrl: "http://localhost:3000",
          relayApiKey: "key",
          from: "a",
          to: "b",
          content: "test",
          type: "text",
          attachments: [{ filePath: "/tmp/file.txt" }],
        })
      ).rejects.toThrow(/500/);
    });
  });
});
