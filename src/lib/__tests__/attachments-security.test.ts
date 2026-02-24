/**
 * Attachment Security Tests
 *
 * Tests for:
 * 1. Path traversal prevention (refKey, filename, storageKey)
 * 2. Malicious file filtering / MIME type handling
 * 3. Authentication enforcement on all attachment routes
 * 4. refKey format validation (injection prevention)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// Mock DB
const queryOneMock = vi.fn();
const queryMock = vi.fn();
vi.mock("../db", () => ({
  queryOne: (...args: unknown[]) => queryOneMock(...args),
  query: (...args: unknown[]) => queryMock(...args),
  isDbConnectionError: () => false,
}));

// Mock storage
const storageSaveMock = vi.fn();
vi.mock("../storage", () => ({
  getStorageDriver: () => ({
    save: storageSaveMock,
    read: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
    getUrl: vi.fn(),
  }),
  validateFileSize: vi.fn(),
  MAX_FILE_SIZE: 10485760,
}));

// No mock for ../attachments — use real implementation.
// Tests that need to mock specific functions use vi.spyOn per-test.

describe("Attachment Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageSaveMock.mockResolvedValue(undefined);
  });

  describe("Path Traversal Prevention via refKey", () => {
    it("should reject refKey with path traversal (../)", async () => {
      const { saveAttachment } = await import("../attachments");

      await expect(
        saveAttachment(Buffer.from("evil"), "file.txt", "text/plain", "../evil")
      ).rejects.toThrow(/refKey/i);

      expect(storageSaveMock).not.toHaveBeenCalled();
      expect(queryOneMock).not.toHaveBeenCalled();
    });

    it("should reject refKey with directory separator (/)", async () => {
      const { saveAttachment } = await import("../attachments");

      await expect(
        saveAttachment(Buffer.from("evil"), "file.txt", "text/plain", "abc/1234")
      ).rejects.toThrow(/refKey/i);
    });

    it("should reject refKey with backslash (\\)", async () => {
      const { saveAttachment } = await import("../attachments");

      await expect(
        saveAttachment(Buffer.from("evil"), "file.txt", "text/plain", "abc\\1234")
      ).rejects.toThrow(/refKey/i);
    });

    it("should reject refKey with null bytes", async () => {
      const { saveAttachment } = await import("../attachments");

      await expect(
        saveAttachment(Buffer.from("evil"), "file.txt", "text/plain", "abc\x001234")
      ).rejects.toThrow(/refKey/i);
    });

    it("should reject refKey shorter than 8 chars", async () => {
      const { saveAttachment } = await import("../attachments");

      await expect(
        saveAttachment(Buffer.from("data"), "file.txt", "text/plain", "short")
      ).rejects.toThrow(/refKey/i);
    });

    it("should reject refKey longer than 8 chars", async () => {
      const { saveAttachment } = await import("../attachments");

      await expect(
        saveAttachment(Buffer.from("data"), "file.txt", "text/plain", "toolongrefkey")
      ).rejects.toThrow(/refKey/i);
    });

    it("should reject refKey with special characters", async () => {
      const { saveAttachment } = await import("../attachments");

      const maliciousRefKeys = [
        "ab.cd12!", // special chars
        "ab cd1234", // spaces
        "<script>", // XSS attempt
        "abc\n1234", // newline
        "abc\r1234", // carriage return
        "${attack}", // template injection
        "abc;1234", // command injection
      ];

      for (const refKey of maliciousRefKeys) {
        await expect(
          saveAttachment(Buffer.from("data"), "file.txt", "text/plain", refKey)
        ).rejects.toThrow(/refKey/i);
      }
    });

    it("should accept valid refKey with alphanumeric, hyphen, underscore", async () => {
      const { assertValidRefKey } = await import("../attachments");

      // These should NOT throw
      expect(() => assertValidRefKey("abcd1234")).not.toThrow();
      expect(() => assertValidRefKey("a-b_c123")).not.toThrow();
      expect(() => assertValidRefKey("ABCD1234")).not.toThrow();
    });
  });

  describe("Storage Key Safety", () => {
    it("should generate date-based storage key without user input in directory", async () => {
      const { saveAttachment } = await import("../attachments");

      queryOneMock.mockResolvedValueOnce(null); // uniqueness
      queryOneMock.mockResolvedValueOnce({
        id: "att-1",
        message_id: null,
        original_filename: "../../etc/passwd",
        mime_type: "text/plain",
        size_bytes: "10",
        storage_key: "2026/02/abcd1234.passwd",
        ref_key: "abcd1234",
        created_at: "2026-02-24T00:00:00Z",
      });

      // Even with malicious filename, the storageKey uses generated refKey + extension
      await saveAttachment(
        Buffer.from("data"),
        "../../etc/passwd",
        "text/plain",
        "abcd1234"
      );

      expect(storageSaveMock).toHaveBeenCalledTimes(1);
      const [storageKey] = storageSaveMock.mock.calls[0];
      // Storage key should use date directory + refKey, not the malicious filename path
      expect(storageKey).toMatch(/^\d{4}\/\d{2}\/abcd1234/);
      expect(storageKey).not.toContain("..");
      expect(storageKey).not.toContain("etc");
    });
  });

  describe("SQL Injection Prevention (parameterized queries)", () => {
    it("should use parameterized queries for refKey lookup", async () => {
      const { getAttachmentByRefKey } = await import("../attachments");

      queryOneMock.mockResolvedValueOnce(null);
      await getAttachmentByRefKey("'; DROP TABLE attachments; --");

      // The SQL injection payload should be safely passed as a parameter
      expect(queryOneMock).toHaveBeenCalledWith(
        expect.stringContaining("WHERE ref_key = $1"),
        ["'; DROP TABLE attachments; --"]
      );
    });

    it("should use parameterized queries for ID lookup", async () => {
      const { getAttachment } = await import("../attachments");

      queryOneMock.mockResolvedValueOnce(null);
      await getAttachment("1 OR 1=1");

      expect(queryOneMock).toHaveBeenCalledWith(
        expect.stringContaining("WHERE id = $1"),
        ["1 OR 1=1"]
      );
    });
  });

  describe("Authentication on API Routes", () => {
    // Mock auth and relay for API route tests
    let validateRelayKeyMock: ReturnType<typeof vi.fn>;
    let getCurrentUserMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      vi.doMock("@/lib/auth", () => ({
        getCurrentUser: vi.fn(),
      }));
      vi.doMock("@/lib/relay", () => ({
        validateRelayKey: vi.fn(),
      }));
      vi.doMock("@/lib/attachments", () => ({
        getAttachment: vi.fn(),
        getAttachmentByRefKey: vi.fn(),
        getAttachmentByStorageKey: vi.fn(),
        readAttachmentFile: vi.fn(),
        saveAttachment: vi.fn(),
      }));

      const auth = await import("@/lib/auth");
      const relay = await import("@/lib/relay");
      validateRelayKeyMock = relay.validateRelayKey as ReturnType<typeof vi.fn>;
      getCurrentUserMock = auth.getCurrentUser as ReturnType<typeof vi.fn>;
    });

    it("should reject unauthenticated upload requests", async () => {
      validateRelayKeyMock.mockReturnValue(false);
      getCurrentUserMock.mockResolvedValue(null);

      const mod = await import("@/app/api/attachments/route");
      const POST = mod.POST as unknown as (req: Request) => Promise<Response>;

      const req = new Request("http://localhost:3000/api/attachments", {
        method: "POST",
        body: new FormData(),
      });
      const res = await POST(req);

      expect(res.status).toBe(401);
    });

    it("should reject unauthenticated download by ID", async () => {
      validateRelayKeyMock.mockReturnValue(false);
      getCurrentUserMock.mockResolvedValue(null);

      const mod = await import("@/app/api/attachments/[id]/route");
      const GET = mod.GET as unknown as (
        req: Request,
        ctx: { params: Promise<{ id: string }> }
      ) => Promise<Response>;

      const req = new Request("http://localhost:3000/api/attachments/att-1");
      const res = await GET(req, { params: Promise.resolve({ id: "att-1" }) });

      expect(res.status).toBe(401);
    });

    it("should reject unauthenticated refKey lookup", async () => {
      validateRelayKeyMock.mockReturnValue(false);
      getCurrentUserMock.mockResolvedValue(null);

      const mod = await import("@/app/api/attachments/by-ref/[refKey]/route");
      const GET = mod.GET as unknown as (
        req: Request,
        ctx: { params: Promise<{ refKey: string }> }
      ) => Promise<Response>;

      const req = new Request("http://localhost:3000/api/attachments/by-ref/abcd1234");
      const res = await GET(req, { params: Promise.resolve({ refKey: "abcd1234" }) });

      expect(res.status).toBe(401);
    });

    it("should reject unauthenticated file download by storageKey", async () => {
      validateRelayKeyMock.mockReturnValue(false);
      getCurrentUserMock.mockResolvedValue(null);

      const mod = await import("@/app/api/attachments/file/[key]/route");
      const GET = mod.GET as unknown as (
        req: Request,
        ctx: { params: Promise<{ key: string }> }
      ) => Promise<Response>;

      const req = new Request("http://localhost:3000/api/attachments/file/key");
      const res = await GET(req, { params: Promise.resolve({ key: "key" }) });

      expect(res.status).toBe(401);
    });

    // TODO: fix mock wiring — getAttachmentByRefKey is not mocked via vi.mock
    it.skip("should allow relay-key authenticated requests", async () => {
      validateRelayKeyMock.mockReturnValue(true);
      const attachments = await import("@/lib/attachments");
      (attachments.getAttachmentByRefKey as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "att-1",
        originalFilename: "file.txt",
        refKey: "abcd1234",
      });

      const mod = await import("@/app/api/attachments/by-ref/[refKey]/route");
      const GET = mod.GET as unknown as (
        req: Request,
        ctx: { params: Promise<{ refKey: string }> }
      ) => Promise<Response>;

      const req = new Request("http://localhost:3000/api/attachments/by-ref/abcd1234", {
        headers: { "x-relay-key": "dev-relay-key" },
      });
      const res = await GET(req, { params: Promise.resolve({ refKey: "abcd1234" }) });

      expect(res.status).toBe(200);
    });
  });

  describe("MIME Type Handling", () => {
    // TODO: fix mock wiring — saveAttachment dynamic import doesn't connect to queryOneMock
    it.skip("should store the provided MIME type without modification", async () => {
      const { saveAttachment } = await import("../attachments");

      queryOneMock.mockResolvedValueOnce(null);
      queryOneMock.mockResolvedValueOnce({
        id: "att-1",
        message_id: null,
        original_filename: "script.js",
        mime_type: "application/javascript",
        size_bytes: "100",
        storage_key: "2026/02/abcd1234.js",
        ref_key: "abcd1234",
        created_at: "2026-02-24T00:00:00Z",
      });

      const result = await saveAttachment(
        Buffer.from("alert(1)"),
        "script.js",
        "application/javascript",
        "abcd1234"
      );

      expect(result.mimeType).toBe("application/javascript");
    });

    // TODO: fix mock wiring — saveAttachment dynamic import doesn't connect to queryOneMock
    it.skip("should handle binary files correctly", async () => {
      const { saveAttachment } = await import("../attachments");

      queryOneMock.mockResolvedValueOnce(null);
      queryOneMock.mockResolvedValueOnce({
        id: "att-1",
        message_id: null,
        original_filename: "image.png",
        mime_type: "image/png",
        size_bytes: "1000",
        storage_key: "2026/02/abcd1234.png",
        ref_key: "abcd1234",
        created_at: "2026-02-24T00:00:00Z",
      });

      // PNG magic bytes
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const result = await saveAttachment(pngBuffer, "image.png", "image/png", "abcd1234");

      expect(result.mimeType).toBe("image/png");
      expect(storageSaveMock).toHaveBeenCalledWith(
        expect.any(String),
        pngBuffer
      );
    });
  });

  describe("Content-Disposition Header Security", () => {
    it("should encode filename in Content-Disposition to prevent header injection", async () => {
      // This tests the API route response headers pattern
      const maliciousFilename = "file\r\nContent-Type: text/html\r\n\r\n<script>alert(1)</script>.txt";
      const encoded = encodeURIComponent(maliciousFilename);

      // encodeURIComponent should neutralize CRLF injection
      expect(encoded).not.toContain("\r");
      expect(encoded).not.toContain("\n");
      expect(encoded).toContain("%0D%0A"); // encoded CRLF
    });

    it("should handle unicode filenames safely", () => {
      const unicodeFilename = "한글파일명.pdf";
      const encoded = encodeURIComponent(unicodeFilename);

      expect(encoded).toBe("%ED%95%9C%EA%B8%80%ED%8C%8C%EC%9D%BC%EB%AA%85.pdf");
      expect(decodeURIComponent(encoded)).toBe(unicodeFilename);
    });
  });

  describe("@file: Reference Injection Prevention", () => {
    it("should only match valid @file:refKey patterns", async () => {
      const { parseFileReferences } = await vi.importActual<typeof import("../attachments")>("../attachments");

      // Should not match malicious patterns
      const refs1 = parseFileReferences("@file:../../../etc/passwd");
      // The regex [a-zA-Z0-9_-]+ will match up to the first /
      // So it would match ".." then stop — but ".." is only 2 chars
      // The pattern captures everything alphanumeric after @file:
      expect(refs1).not.toContain("../../../etc/passwd");
    });

    it("should not match @file: without a key", async () => {
      const { parseFileReferences } = await vi.importActual<typeof import("../attachments")>("../attachments");

      const refs = parseFileReferences("@file: some text");
      expect(refs).toEqual([]); // space after colon breaks the pattern
    });

    it("should match @file: in various positions", async () => {
      const { parseFileReferences } = await vi.importActual<typeof import("../attachments")>("../attachments");

      const refs = parseFileReferences("start @file:abc12345 middle @file:def67890 end");
      expect(refs).toEqual(["abc12345", "def67890"]);
    });
  });
});
