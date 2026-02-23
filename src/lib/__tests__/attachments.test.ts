import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db module
const queryOneMock = vi.fn();
const queryMock = vi.fn();
vi.mock("../db", () => ({
  queryOne: (...args: any[]) => queryOneMock(...args),
  query: (...args: any[]) => queryMock(...args),
}));

// Mock storage module
const saveMock = vi.fn();
vi.mock("../storage", () => ({
  getStorageDriver: () => ({
    save: saveMock,
    read: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
    getUrl: vi.fn(),
  }),
  validateFileSize: vi.fn(),
}));

describe("attachments refKey validation", () => {
  beforeEach(() => {
    queryOneMock.mockReset();
    queryMock.mockReset();
    saveMock.mockReset();
  });

  it("rejects invalid refKey", async () => {
    const { saveAttachment } = await import("../attachments");

    await expect(
      saveAttachment(Buffer.from("hello"), "file.txt", "text/plain", "../evil")
    ).rejects.toThrow(/refKey/i);

    expect(queryOneMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("accepts valid 8-char refKey", async () => {
    const { saveAttachment } = await import("../attachments");

    queryOneMock
      .mockResolvedValueOnce(null) // uniqueness check
      .mockResolvedValueOnce({
        id: "att-1",
        message_id: null,
        original_filename: "file.txt",
        mime_type: "text/plain",
        size_bytes: "5",
        storage_key: "2024/01/abcd1234.txt",
        ref_key: "abcd1234",
        created_at: "2024-01-01T00:00:00Z",
      });

    const result = await saveAttachment(
      Buffer.from("hello"),
      "file.txt",
      "text/plain",
      "abcd1234"
    );

    expect(result.refKey).toBe("abcd1234");
    expect(saveMock).toHaveBeenCalled();
  });
});
