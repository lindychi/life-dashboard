/**
 * Attachment System Integration Tests
 *
 * Tests the full flow: upload → storage → DB record → reference linking → download
 * Also covers: large file boundary, error handling, and file format validation
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
}));

// Mock storage
const storageSaveMock = vi.fn();
const storageReadMock = vi.fn();
const storageDeleteMock = vi.fn();
const storageExistsMock = vi.fn();
const storageGetUrlMock = vi.fn();

vi.mock("../storage", () => ({
  getStorageDriver: () => ({
    save: storageSaveMock,
    read: storageReadMock,
    delete: storageDeleteMock,
    exists: storageExistsMock,
    getUrl: storageGetUrlMock,
  }),
  validateFileSize: (size: number) => {
    const MAX = 10485760; // 10MB
    if (size > MAX) {
      throw new Error(`File too large. Maximum size is ${(MAX / 1024 / 1024).toFixed(1)}MB`);
    }
  },
  MAX_FILE_SIZE: 10485760,
}));

describe("Attachment Full Flow Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageSaveMock.mockResolvedValue(undefined);
    storageReadMock.mockResolvedValue(Buffer.from("file content"));
    storageDeleteMock.mockResolvedValue(undefined);
  });

  describe("Upload → Store → DB → Download flow", () => {
    it("should save file to storage and create DB record", async () => {
      const { saveAttachment } = await import("../attachments");

      // Mock: no existing refKey conflict
      queryOneMock.mockResolvedValueOnce(null);
      // Mock: INSERT returns new record
      queryOneMock.mockResolvedValueOnce({
        id: "att-uuid-1",
        message_id: null,
        original_filename: "document.pdf",
        mime_type: "application/pdf",
        size_bytes: "1024",
        storage_key: "2026/02/abcd1234.pdf",
        ref_key: "abcd1234",
        created_at: "2026-02-24T00:00:00Z",
      });

      const buffer = Buffer.from("PDF content here");
      const result = await saveAttachment(buffer, "document.pdf", "application/pdf");

      // Verify storage was called
      expect(storageSaveMock).toHaveBeenCalledTimes(1);
      const [storageKey, savedBuffer] = storageSaveMock.mock.calls[0];
      expect(storageKey).toMatch(/^\d{4}\/\d{2}\//); // date-based directory
      expect(storageKey).toMatch(/\.pdf$/);
      expect(savedBuffer).toBe(buffer);

      // Verify DB insert was called
      expect(queryOneMock).toHaveBeenCalledTimes(2);
      expect(result.id).toBe("att-uuid-1");
      expect(result.originalFilename).toBe("document.pdf");
      expect(result.mimeType).toBe("application/pdf");
      expect(result.sizeBytes).toBe(1024);
    });

    it("should read file from storage via readAttachmentFile", async () => {
      const { readAttachmentFile } = await import("../attachments");
      const expected = Buffer.from("file content");
      storageReadMock.mockResolvedValue(expected);

      const result = await readAttachmentFile("2026/02/abcd1234.pdf");
      expect(storageReadMock).toHaveBeenCalledWith("2026/02/abcd1234.pdf");
      expect(result).toBe(expected);
    });

    it("should link attachment to message via content parsing", async () => {
      const { linkAttachmentsFromContent } = await import("../attachments");

      // Mock: linkAttachmentToMessage calls
      queryOneMock.mockResolvedValueOnce({ id: "att-1" }); // link success

      const linked = await linkAttachmentsFromContent(
        "여기 파일 참조: @file:abcd1234",
        "msg-uuid-1"
      );

      expect(linked).toEqual(["abcd1234"]);
      expect(queryOneMock).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE attachments SET message_id"),
        ["msg-uuid-1", "abcd1234"]
      );
    });

    it("should delete file and DB record", async () => {
      const { deleteAttachment } = await import("../attachments");

      // Mock: getAttachment returns attachment
      queryOneMock.mockResolvedValueOnce({
        id: "att-1",
        message_id: null,
        original_filename: "file.txt",
        mime_type: "text/plain",
        size_bytes: "100",
        storage_key: "2026/02/abcd1234.txt",
        ref_key: "abcd1234",
        created_at: "2026-02-24T00:00:00Z",
      });
      // Mock: DELETE returns row
      queryOneMock.mockResolvedValueOnce({ id: "att-1" });

      const result = await deleteAttachment("att-1");

      expect(result).toBe(true);
      expect(storageDeleteMock).toHaveBeenCalledWith("2026/02/abcd1234.txt");
    });
  });

  describe("parseFileReferences", () => {
    it("should extract all @file:refKey references", async () => {
      const { parseFileReferences } = await import("../attachments");

      const refs = parseFileReferences(
        "참조: @file:ref1aaaa 그리고 @file:ref2bbbb 끝"
      );
      expect(refs).toEqual(["ref1aaaa", "ref2bbbb"]);
    });

    it("should deduplicate repeated references", async () => {
      const { parseFileReferences } = await import("../attachments");

      const refs = parseFileReferences("@file:same1234 @file:same1234");
      expect(refs).toEqual(["same1234"]);
    });

    it("should return empty array when no references", async () => {
      const { parseFileReferences } = await import("../attachments");

      const refs = parseFileReferences("일반 메시지 내용");
      expect(refs).toEqual([]);
    });

    it("should handle @file: with hyphens and underscores", async () => {
      const { parseFileReferences } = await import("../attachments");

      const refs = parseFileReferences("@file:a-b_c123");
      expect(refs).toEqual(["a-b_c123"]);
    });
  });

  describe("generateRefKey", () => {
    it("should generate 8-character ref key", async () => {
      const { generateRefKey } = await import("../attachments");

      const key = generateRefKey(Buffer.from("test content"));
      expect(key).toHaveLength(8);
      expect(key).toMatch(/^[a-f0-9]{8}$/);
    });

    it("should generate consistent hash prefix for same content", async () => {
      const { generateRefKey } = await import("../attachments");

      const buffer = Buffer.from("identical content");
      const key1 = generateRefKey(buffer);
      const key2 = generateRefKey(buffer);

      // First 4 chars (hash) should be same
      expect(key1.slice(0, 4)).toBe(key2.slice(0, 4));
      // Last 4 chars (random) may differ
    });

    it("should generate different hash prefix for different content", async () => {
      const { generateRefKey } = await import("../attachments");

      const key1 = generateRefKey(Buffer.from("content A"));
      const key2 = generateRefKey(Buffer.from("content B"));

      // Hash prefixes should likely differ (not guaranteed but statistically certain)
      expect(key1.slice(0, 4)).not.toBe(key2.slice(0, 4));
    });
  });
});

describe("Large File Handling (Boundary Tests)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageSaveMock.mockResolvedValue(undefined);
  });

  it("should accept file exactly at 10MB limit", async () => {
    const { saveAttachment } = await import("../attachments");

    queryOneMock.mockResolvedValueOnce(null); // uniqueness check
    queryOneMock.mockResolvedValueOnce({
      id: "att-1",
      message_id: null,
      original_filename: "big.bin",
      mime_type: "application/octet-stream",
      size_bytes: "10485760",
      storage_key: "2026/02/abc12345.bin",
      ref_key: "abc12345",
      created_at: "2026-02-24T00:00:00Z",
    });

    const buffer = Buffer.alloc(10485760); // exactly 10MB
    const result = await saveAttachment(buffer, "big.bin", "application/octet-stream");
    expect(result.sizeBytes).toBe(10485760);
  });

  it("should reject file 1 byte over 10MB limit", async () => {
    const { saveAttachment } = await import("../attachments");

    const buffer = Buffer.alloc(10485761); // 10MB + 1 byte
    await expect(
      saveAttachment(buffer, "toobig.bin", "application/octet-stream")
    ).rejects.toThrow(/too large/i);
  });

  it("should accept zero-byte file", async () => {
    const { saveAttachment } = await import("../attachments");

    queryOneMock.mockResolvedValueOnce(null);
    queryOneMock.mockResolvedValueOnce({
      id: "att-1",
      message_id: null,
      original_filename: "empty.txt",
      mime_type: "text/plain",
      size_bytes: "0",
      storage_key: "2026/02/abc12345.txt",
      ref_key: "abc12345",
      created_at: "2026-02-24T00:00:00Z",
    });

    const buffer = Buffer.alloc(0);
    const result = await saveAttachment(buffer, "empty.txt", "text/plain");
    expect(result.sizeBytes).toBe(0);
  });
});

describe("Error Handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageSaveMock.mockResolvedValue(undefined);
    storageDeleteMock.mockResolvedValue(undefined);
  });

  it("should reject duplicate refKey", async () => {
    const { saveAttachment } = await import("../attachments");

    // Mock: refKey already exists
    queryOneMock.mockResolvedValueOnce({ id: "existing-att" });

    await expect(
      saveAttachment(Buffer.from("data"), "file.txt", "text/plain", "abcd1234")
    ).rejects.toThrow(/already exists/);
  });

  it("should cleanup storage when DB insert fails", async () => {
    const { saveAttachment } = await import("../attachments");

    queryOneMock.mockResolvedValueOnce(null); // uniqueness check passes
    queryOneMock.mockResolvedValueOnce(null); // INSERT returns null (failure)

    await expect(
      saveAttachment(Buffer.from("data"), "file.txt", "text/plain")
    ).rejects.toThrow(/Failed to save/);

    // Storage save was called but should be cleaned up
    expect(storageSaveMock).toHaveBeenCalledTimes(1);
    expect(storageDeleteMock).toHaveBeenCalledTimes(1);
  });

  it("should handle storage save failure gracefully", async () => {
    const { saveAttachment } = await import("../attachments");

    queryOneMock.mockResolvedValueOnce(null); // uniqueness check
    storageSaveMock.mockRejectedValue(new Error("Disk full"));

    await expect(
      saveAttachment(Buffer.from("data"), "file.txt", "text/plain")
    ).rejects.toThrow(/Disk full/);
  });

  it("should return null for non-existent attachment", async () => {
    const { getAttachment } = await import("../attachments");

    queryOneMock.mockResolvedValueOnce(null);
    const result = await getAttachment("non-existent-id");
    expect(result).toBeNull();
  });

  it("should return false when deleting non-existent attachment", async () => {
    const { deleteAttachment } = await import("../attachments");

    queryOneMock.mockResolvedValueOnce(null); // getAttachment returns null
    const result = await deleteAttachment("non-existent-id");
    expect(result).toBe(false);
  });

  it("should handle linkAttachmentsFromContent with no matches in DB", async () => {
    const { linkAttachmentsFromContent } = await import("../attachments");

    queryOneMock.mockResolvedValue(null); // no attachment found for refKey

    const linked = await linkAttachmentsFromContent(
      "@file:missing1 @file:missing2",
      "msg-1"
    );

    expect(linked).toEqual([]);
  });

  it("should handle files with no extension", async () => {
    const { saveAttachment } = await import("../attachments");

    queryOneMock.mockResolvedValueOnce(null);
    queryOneMock.mockResolvedValueOnce({
      id: "att-1",
      message_id: null,
      original_filename: "Makefile",
      mime_type: "application/octet-stream",
      size_bytes: "100",
      storage_key: "2026/02/abc12345",
      ref_key: "abc12345",
      created_at: "2026-02-24T00:00:00Z",
    });

    const result = await saveAttachment(
      Buffer.from("data"),
      "Makefile",
      "application/octet-stream"
    );
    expect(result.originalFilename).toBe("Makefile");
  });
});
