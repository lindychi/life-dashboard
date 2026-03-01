/**
 * Fix 3: Path Traversal in Storage
 *
 * Tests that filenames with `../` cannot escape the upload directory.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "path";

// Mock fs/promises
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn().mockResolvedValue(Buffer.from("test"));
const mockUnlink = vi.fn().mockResolvedValue(undefined);
const mockAccess = vi.fn().mockResolvedValue(undefined);

vi.mock("fs/promises", () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  access: (...args: unknown[]) => mockAccess(...args),
}));

// Mock S3 client
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
}));

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

describe("LocalStorageDriver - Path Traversal Prevention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reject keys with .. path components on save", async () => {
    const { getStorageDriver } = await import("@/lib/storage");
    const driver = getStorageDriver();
    const buffer = Buffer.from("malicious content");

    await expect(driver.save("../../etc/passwd", buffer)).rejects.toThrow();
  });

  it("should reject keys with .. path components on read", async () => {
    const { getStorageDriver } = await import("@/lib/storage");
    const driver = getStorageDriver();

    await expect(driver.read("../../../etc/shadow")).rejects.toThrow();
  });

  it("should reject keys with .. path components on delete", async () => {
    const { getStorageDriver } = await import("@/lib/storage");
    const driver = getStorageDriver();

    await expect(driver.delete("../../etc/hosts")).rejects.toThrow();
  });

  it("should reject keys with .. path components on exists", async () => {
    const { getStorageDriver } = await import("@/lib/storage");
    const driver = getStorageDriver();

    await expect(driver.exists("../../etc/passwd")).rejects.toThrow();
  });

  it("should allow normal nested paths", async () => {
    const { getStorageDriver } = await import("@/lib/storage");
    const driver = getStorageDriver();
    const buffer = Buffer.from("normal content");

    await driver.save("2024/01/abc123.png", buffer);

    // Verify the path stays within uploads directory
    const savedPath = mockWriteFile.mock.calls[0][0] as string;
    expect(savedPath.startsWith(UPLOAD_DIR)).toBe(true);
    expect(savedPath).not.toContain("..");
  });

  it("should reject encoded traversal attempts", async () => {
    const { getStorageDriver } = await import("@/lib/storage");
    const driver = getStorageDriver();
    const buffer = Buffer.from("malicious content");

    // Even if someone tries path normalization tricks
    await expect(driver.save("foo/../../etc/passwd", buffer)).rejects.toThrow();
  });
});
