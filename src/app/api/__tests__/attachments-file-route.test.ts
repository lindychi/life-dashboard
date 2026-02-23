import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/relay", () => ({
  validateRelayKey: vi.fn(),
}));

vi.mock("@/lib/attachments", () => ({
  getAttachmentByStorageKey: vi.fn(),
  readAttachmentFile: vi.fn(),
}));

import { getCurrentUser } from "@/lib/auth";
import { validateRelayKey } from "@/lib/relay";
import { getAttachmentByStorageKey, readAttachmentFile } from "@/lib/attachments";

function createRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("GET /api/attachments/file/[key]", () => {
  let GET: (
    req: Request,
    context: { params: Promise<{ key: string }> }
  ) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/attachments/file/[key]/route");
    GET = mod.GET as unknown as typeof GET;
  });

  it("should return 401 when no auth is provided", async () => {
    (validateRelayKey as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const req = createRequest("http://localhost:3000/api/attachments/file/sample");
    const res = await GET(req, { params: Promise.resolve({ key: "sample" }) });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("should return 404 when attachment is missing", async () => {
    (validateRelayKey as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (getAttachmentByStorageKey as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const req = createRequest("http://localhost:3000/api/attachments/file/missing", {
      "x-relay-key": "dev-relay-key",
    });

    const res = await GET(req, { params: Promise.resolve({ key: "missing" }) });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Attachment not found");
  });

  it("should stream attachment bytes when found", async () => {
    (validateRelayKey as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (getAttachmentByStorageKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "att-1",
      messageId: null,
      originalFilename: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      storageKey: "2026/02/report.pdf",
      refKey: "abcd1234",
      createdAt: new Date().toISOString(),
    });
    (readAttachmentFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      Buffer.from("file-content")
    );

    const req = createRequest("http://localhost:3000/api/attachments/file/2026%2F02%2Freport.pdf", {
      "x-relay-key": "dev-relay-key",
    });

    const res = await GET(req, {
      params: Promise.resolve({ key: "2026/02/report.pdf" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain(
      'filename="report.pdf"'
    );

    const body = Buffer.from(await res.arrayBuffer()).toString("utf8");
    expect(body).toBe("file-content");
  });
});
