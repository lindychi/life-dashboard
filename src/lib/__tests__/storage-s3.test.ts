import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// We test S3StorageDriver in isolation by mocking @aws-sdk/client-s3.
// The module uses process.env for config, so we set env vars before dynamic import.

const originalEnv = { ...process.env };

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// ===== AWS SDK v3 mock setup (class-based for Vitest v4 constructor support) =====
const mockSend = vi.fn();

// Vitest v4 requires class/function constructors (not arrow functions) for `new`
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockS3Client: any = vi.fn(function (this: any, ...args: any[]) {
  this.send = mockSend;
  this.destroy = vi.fn();
  return this;
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockPutObjectCommand: any = vi.fn(function (this: any, input: any) {
  this._type = "PutObjectCommand";
  this.input = input;
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockGetObjectCommand: any = vi.fn(function (this: any, input: any) {
  this._type = "GetObjectCommand";
  this.input = input;
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockDeleteObjectCommand: any = vi.fn(function (this: any, input: any) {
  this._type = "DeleteObjectCommand";
  this.input = input;
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockHeadObjectCommand: any = vi.fn(function (this: any, input: any) {
  this._type = "HeadObjectCommand";
  this.input = input;
});

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: MockS3Client,
  PutObjectCommand: MockPutObjectCommand,
  GetObjectCommand: MockGetObjectCommand,
  DeleteObjectCommand: MockDeleteObjectCommand,
  HeadObjectCommand: MockHeadObjectCommand,
}));

describe("S3StorageDriver (AWS SDK v3)", () => {
  beforeEach(() => {
    // Reset module cache to re-read env vars and re-create singleton
    vi.resetModules();
    mockSend.mockReset();
    MockS3Client.mockClear();

    // Re-register mock after resetModules
    vi.doMock("@aws-sdk/client-s3", () => ({
      S3Client: MockS3Client,
      PutObjectCommand: MockPutObjectCommand,
      GetObjectCommand: MockGetObjectCommand,
      DeleteObjectCommand: MockDeleteObjectCommand,
      HeadObjectCommand: MockHeadObjectCommand,
    }));

    // Set S3 env vars
    process.env.STORAGE_TYPE = "s3";
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_REGION = "us-east-1";
    process.env.S3_ACCESS_KEY = "test-access-key";
    process.env.S3_SECRET_KEY = "test-secret-key";
    process.env.S3_ENDPOINT = "http://localhost:9000";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ===== S3Client Configuration =====

  it("should create S3Client with correct config including forcePathStyle", async () => {
    mockSend.mockResolvedValue({});

    const { getStorageDriver } = await import("../storage");
    getStorageDriver();

    expect(MockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        region: "us-east-1",
        credentials: {
          accessKeyId: "test-access-key",
          secretAccessKey: "test-secret-key",
        },
        endpoint: "http://localhost:9000",
        forcePathStyle: true,
      })
    );
  });

  it("should NOT pass endpoint when S3_ENDPOINT is empty", async () => {
    process.env.S3_ENDPOINT = "";
    mockSend.mockResolvedValue({});

    const { getStorageDriver } = await import("../storage");
    getStorageDriver();

    const constructorCall = MockS3Client.mock.calls[0][0];
    expect(constructorCall).not.toHaveProperty("endpoint");
    expect(constructorCall.region).toBe("us-east-1");
    expect(constructorCall.forcePathStyle).toBe(true);
  });

  it("should reuse S3Client singleton (client not re-created)", async () => {
    mockSend.mockResolvedValue({});

    const { getStorageDriver } = await import("../storage");
    const driver1 = getStorageDriver();
    const driver2 = getStorageDriver();

    // Factory returns same driver (singleton), S3Client constructed once
    expect(driver1).toBe(driver2);
    expect(MockS3Client).toHaveBeenCalledTimes(1);
  });

  // ===== save() =====

  it("should call PutObjectCommand with correct params on save()", async () => {
    mockSend.mockResolvedValue({});
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    const buf = Buffer.from("hello world");
    await driver.save("2026/02/testkey.txt", buf);

    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "2026/02/testkey.txt",
      Body: new Uint8Array(buf),
      ContentType: "application/octet-stream",
      ContentLength: buf.length,
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("should throw on upload failure with descriptive error", async () => {
    mockSend.mockRejectedValue(new Error("Access Denied"));

    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    await expect(
      driver.save("2026/02/forbidden.txt", Buffer.from("data"))
    ).rejects.toThrow(/S3 upload failed.*Access Denied/);
  });

  it("should convert Buffer to Uint8Array for upload body (Next.js 16 compat)", async () => {
    mockSend.mockResolvedValue({});
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    const buf = Buffer.from("test data");
    await driver.save("key.txt", buf);

    const command = (PutObjectCommand as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Body should be Uint8Array, not Buffer
    expect(command.Body).toBeInstanceOf(Uint8Array);
  });

  // ===== read() =====

  it("should call GetObjectCommand and return Buffer on read()", async () => {
    const content = Buffer.from("file content here");
    // Simulate Node.js Readable stream from S3
    const mockStream = {
      pipe: vi.fn(),
      [Symbol.asyncIterator]: async function* () {
        yield content;
      },
    };
    mockSend.mockResolvedValue({ Body: mockStream });

    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    const result = await driver.read("2026/02/testkey.txt");

    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "2026/02/testkey.txt",
    });
    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString()).toBe("file content here");
  });

  it("should throw when S3 read returns empty body", async () => {
    mockSend.mockResolvedValue({ Body: null });

    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    await expect(driver.read("2026/02/empty.txt")).rejects.toThrow(
      /S3 read failed.*empty body/
    );
  });

  it("should throw on read failure with descriptive error", async () => {
    mockSend.mockRejectedValue(new Error("NoSuchKey: The specified key does not exist."));

    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    await expect(driver.read("2026/02/missing.txt")).rejects.toThrow(
      /S3 read failed.*NoSuchKey/
    );
  });

  // ===== delete() =====

  it("should call DeleteObjectCommand on delete()", async () => {
    mockSend.mockResolvedValue({});

    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    await driver.delete("2026/02/file.txt");

    expect(DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "2026/02/file.txt",
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("should handle NotFound error gracefully on delete (idempotent)", async () => {
    const notFoundErr = new Error("NoSuchKey");
    notFoundErr.message = "NoSuchKey";
    mockSend.mockRejectedValue(notFoundErr);

    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    // Should NOT throw for NotFound/NoSuchKey errors
    await expect(driver.delete("2026/02/gone.txt")).resolves.toBeUndefined();
  });

  it("should throw on delete with non-NotFound errors", async () => {
    mockSend.mockRejectedValue(new Error("InternalError: Something went wrong"));

    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    await expect(driver.delete("2026/02/error.txt")).rejects.toThrow(
      /S3 delete failed.*InternalError/
    );
  });

  // ===== exists() =====

  it("should return true when HeadObject succeeds", async () => {
    mockSend.mockResolvedValue({ ContentLength: 1024 });

    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    const result = await driver.exists("2026/02/exists.txt");

    expect(result).toBe(true);
    expect(HeadObjectCommand).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "2026/02/exists.txt",
    });
  });

  it("should return false when HeadObject throws NotFound", async () => {
    const notFoundErr = Object.assign(new Error("NotFound"), { name: "NotFound" });
    mockSend.mockRejectedValue(notFoundErr);

    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    const result = await driver.exists("2026/02/missing.txt");
    expect(result).toBe(false);
  });

  it("should return false when HeadObject throws NoSuchKey", async () => {
    const noKeyErr = Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
    mockSend.mockRejectedValue(noKeyErr);

    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    const result = await driver.exists("2026/02/missing.txt");
    expect(result).toBe(false);
  });

  it("should return false when HeadObject throws 404", async () => {
    const err404 = Object.assign(new Error("404"), { name: "404" });
    mockSend.mockRejectedValue(err404);

    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    const result = await driver.exists("2026/02/missing.txt");
    expect(result).toBe(false);
  });

  it("should throw on exists() with unexpected errors (e.g. auth failure)", async () => {
    const authErr = Object.assign(new Error("Access Denied"), {
      name: "AccessDenied",
    });
    mockSend.mockRejectedValue(authErr);

    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    await expect(driver.exists("2026/02/file.txt")).rejects.toThrow(
      /S3 exists check failed.*Access Denied/
    );
  });

  // ===== getUrl() =====

  it("should always proxy downloads through API route (getUrl)", async () => {
    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    const url = driver.getUrl("2026/02/file.txt");
    expect(url).toBe("/api/attachments/file/2026%2F02%2Ffile.txt");
  });

  // ===== Factory: getStorageDriver() =====

  it("should throw if S3_BUCKET is not set when STORAGE_TYPE=s3", async () => {
    process.env.S3_BUCKET = "";

    const { getStorageDriver } = await import("../storage");

    expect(() => getStorageDriver()).toThrow(/S3_BUCKET/);
  });

  it("should use default region ap-northeast-2 when S3_REGION is not set", async () => {
    process.env.S3_REGION = "";
    // Module reads env at import time; env has empty S3_REGION
    // Default in code is "ap-northeast-2"

    const { getStorageDriver } = await import("../storage");
    getStorageDriver();

    // The config reads: process.env.S3_REGION || "ap-northeast-2"
    // Empty string is falsy, so falls back to default
    const constructorCall = MockS3Client.mock.calls[0][0];
    expect(constructorCall.region).toBe("ap-northeast-2");
  });
});

// ===== streamToBuffer utility (tested indirectly via read()) =====

describe("S3StorageDriver streamToBuffer handling", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    MockS3Client.mockClear();

    // Re-register mock after resetModules
    vi.doMock("@aws-sdk/client-s3", () => ({
      S3Client: MockS3Client,
      PutObjectCommand: MockPutObjectCommand,
      GetObjectCommand: MockGetObjectCommand,
      DeleteObjectCommand: MockDeleteObjectCommand,
      HeadObjectCommand: MockHeadObjectCommand,
    }));

    process.env.STORAGE_TYPE = "s3";
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_REGION = "us-east-1";
    process.env.S3_ACCESS_KEY = "key";
    process.env.S3_SECRET_KEY = "secret";
    process.env.S3_ENDPOINT = "http://localhost:9000";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("should handle Node.js Readable-like stream (pipe method present)", async () => {
    const chunk1 = Buffer.from("part1");
    const chunk2 = Buffer.from("part2");

    const mockStream = {
      pipe: vi.fn(), // Marks it as Node.js Readable
      [Symbol.asyncIterator]: async function* () {
        yield chunk1;
        yield chunk2;
      },
    };
    mockSend.mockResolvedValue({ Body: mockStream });

    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    const result = await driver.read("multipart-file.bin");
    expect(result.toString()).toBe("part1part2");
  });

  it("should handle Web ReadableStream (getReader method present)", async () => {
    const content = Buffer.from("web stream content");

    const mockStream = {
      getReader: () => ({
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: new Uint8Array(content) })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      }),
    };
    mockSend.mockResolvedValue({ Body: mockStream });

    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    const result = await driver.read("web-stream.txt");
    expect(result.toString()).toBe("web stream content");
  });

  it("should handle Blob response (arrayBuffer method present)", async () => {
    const content = Buffer.from("blob content");

    const mockBlob = {
      arrayBuffer: () => Promise.resolve(content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength
      )),
    };
    mockSend.mockResolvedValue({ Body: mockBlob });

    const { getStorageDriver } = await import("../storage");
    const driver = getStorageDriver();

    const result = await driver.read("blob-file.dat");
    expect(result.toString()).toBe("blob content");
  });
});

// ===== validateFileSize (unchanged, independent of S3 driver) =====

describe("validateFileSize", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.UPLOAD_MAX_SIZE = "1048576"; // 1MB
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should accept file within size limit", async () => {
    const { validateFileSize } = await import("../storage");
    expect(() => validateFileSize(500000)).not.toThrow();
  });

  it("should reject file exceeding size limit", async () => {
    const { validateFileSize } = await import("../storage");
    expect(() => validateFileSize(2000000)).toThrow(/too large/i);
  });

  it("should accept file exactly at the limit", async () => {
    const { validateFileSize } = await import("../storage");
    expect(() => validateFileSize(1048576)).not.toThrow();
  });

  it("should reject file 1 byte over the limit", async () => {
    const { validateFileSize } = await import("../storage");
    expect(() => validateFileSize(1048577)).toThrow(/too large/i);
  });
});
