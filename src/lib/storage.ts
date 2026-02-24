// Storage abstraction layer (local filesystem / S3-compatible)

import * as fs from "fs/promises";
import * as path from "path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import type { Readable } from "stream";

// ===== Configuration =====

const STORAGE_TYPE = process.env.STORAGE_TYPE || "local";
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const MAX_FILE_SIZE = parseInt(process.env.UPLOAD_MAX_SIZE || "10485760", 10); // 10MB default

// S3 configuration
const S3_CONFIG = {
  bucket: process.env.S3_BUCKET || "",
  region: process.env.S3_REGION || "ap-northeast-2",
  accessKey: process.env.S3_ACCESS_KEY || "",
  secretKey: process.env.S3_SECRET_KEY || "",
  endpoint: process.env.S3_ENDPOINT || "",
};

export { MAX_FILE_SIZE };

// ===== Storage Interface =====

export interface StorageDriver {
  save(key: string, buffer: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getUrl(key: string): string;
}

// ===== Local Filesystem Driver =====

class LocalStorageDriver implements StorageDriver {
  async save(key: string, buffer: Buffer): Promise<void> {
    const fullPath = path.join(UPLOAD_DIR, key);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, buffer);
  }

  async read(key: string): Promise<Buffer> {
    const fullPath = path.join(UPLOAD_DIR, key);
    return fs.readFile(fullPath);
  }

  async delete(key: string): Promise<void> {
    const fullPath = path.join(UPLOAD_DIR, key);
    await fs.unlink(fullPath).catch(() => {});
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = path.join(UPLOAD_DIR, key);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  getUrl(key: string): string {
    return `/api/attachments/file/${encodeURIComponent(key)}`;
  }
}

// ===== S3-Compatible Driver (AWS SDK v3) =====

function createS3Client(): S3Client {
  return new S3Client({
    region: S3_CONFIG.region,
    credentials: {
      accessKeyId: S3_CONFIG.accessKey,
      secretAccessKey: S3_CONFIG.secretKey,
    },
    ...(S3_CONFIG.endpoint && { endpoint: S3_CONFIG.endpoint }),
    forcePathStyle: true, // Required for MinIO and S3-compatible storage
  });
}

async function streamToBuffer(stream: Readable | ReadableStream | Blob): Promise<Buffer> {
  // Handle Node.js Readable stream
  if ("pipe" in stream && typeof (stream as Readable).pipe === "function") {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as Readable) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
  }
  // Handle Web ReadableStream
  if ("getReader" in stream) {
    const reader = (stream as ReadableStream).getReader();
    const chunks: Uint8Array[] = [];
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) chunks.push(result.value);
    }
    return Buffer.concat(chunks);
  }
  // Handle Blob
  if ("arrayBuffer" in stream) {
    const arrayBuffer = await (stream as Blob).arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
  throw new Error("Unsupported S3 response body type");
}

class S3StorageDriver implements StorageDriver {
  private client: S3Client;

  constructor() {
    this.client = createS3Client();
  }

  async save(key: string, buffer: Buffer): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: S3_CONFIG.bucket,
          Key: key,
          Body: new Uint8Array(buffer),
          ContentType: "application/octet-stream",
          ContentLength: buffer.length,
        })
      );
    } catch (err) {
      throw new Error(
        `S3 upload failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async read(key: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: S3_CONFIG.bucket,
          Key: key,
        })
      );
      if (!response.Body) {
        throw new Error("S3 read returned empty body");
      }
      return streamToBuffer(response.Body as Readable | ReadableStream | Blob);
    } catch (err) {
      throw new Error(
        `S3 read failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: S3_CONFIG.bucket,
          Key: key,
        })
      );
    } catch (err) {
      // S3 DeleteObject is idempotent, but catch unexpected errors
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("NotFound") && !message.includes("NoSuchKey")) {
        throw new Error(`S3 delete failed: ${message}`);
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: S3_CONFIG.bucket,
          Key: key,
        })
      );
      return true;
    } catch (err) {
      // HeadObject throws NotFound/NoSuchKey when object doesn't exist
      const name = (err as { name?: string })?.name || "";
      if (name === "NotFound" || name === "NoSuchKey" || name === "404") {
        return false;
      }
      throw new Error(
        `S3 exists check failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  getUrl(key: string): string {
    // Proxy through our API for auth
    return `/api/attachments/file/${encodeURIComponent(key)}`;
  }
}

// ===== Factory =====

let _driver: StorageDriver | null = null;

export function getStorageDriver(): StorageDriver {
  if (!_driver) {
    if (STORAGE_TYPE === "s3") {
      if (!S3_CONFIG.bucket) {
        throw new Error("S3_BUCKET environment variable is required when STORAGE_TYPE=s3");
      }
      console.log(`[Storage] Using S3 driver (bucket: ${S3_CONFIG.bucket})`);
      _driver = new S3StorageDriver();
    } else {
      console.log(`[Storage] Using local filesystem driver (dir: ${UPLOAD_DIR})`);
      _driver = new LocalStorageDriver();
    }
  }
  return _driver;
}

// ===== Validation =====

export function validateFileSize(sizeBytes: number): void {
  if (sizeBytes > MAX_FILE_SIZE) {
    throw new Error(
      `File too large. Maximum size is ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(1)}MB`
    );
  }
}

export function getStorageType(): string {
  return STORAGE_TYPE;
}
