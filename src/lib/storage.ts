// Storage abstraction layer (local filesystem / S3-compatible)

import * as fs from "fs/promises";
import * as path from "path";

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

// ===== S3-Compatible Driver =====

class S3StorageDriver implements StorageDriver {
  private getHeaders(method: string, key: string, contentType?: string): Record<string, string> {
    // Minimal S3 signature - for production, use @aws-sdk/client-s3
    const date = new Date().toUTCString();
    const headers: Record<string, string> = {
      Date: date,
      Host: this.getHost(),
    };
    if (contentType) {
      headers["Content-Type"] = contentType;
    }
    return headers;
  }

  private getHost(): string {
    if (S3_CONFIG.endpoint) {
      return new URL(S3_CONFIG.endpoint).host;
    }
    return `${S3_CONFIG.bucket}.s3.${S3_CONFIG.region}.amazonaws.com`;
  }

  private getBaseUrl(): string {
    if (S3_CONFIG.endpoint) {
      return `${S3_CONFIG.endpoint}/${S3_CONFIG.bucket}`;
    }
    return `https://${S3_CONFIG.bucket}.s3.${S3_CONFIG.region}.amazonaws.com`;
  }

  async save(key: string, buffer: Buffer): Promise<void> {
    const url = `${this.getBaseUrl()}/${key}`;
    const response = await fetch(url, {
      method: "PUT",
      body: new Uint8Array(buffer),
      headers: {
        ...this.getHeaders("PUT", key, "application/octet-stream"),
        "Content-Length": buffer.length.toString(),
      },
    });
    if (!response.ok) {
      throw new Error(`S3 upload failed: ${response.status} ${response.statusText}`);
    }
  }

  async read(key: string): Promise<Buffer> {
    const url = `${this.getBaseUrl()}/${key}`;
    const response = await fetch(url, {
      method: "GET",
      headers: this.getHeaders("GET", key),
    });
    if (!response.ok) {
      throw new Error(`S3 read failed: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async delete(key: string): Promise<void> {
    const url = `${this.getBaseUrl()}/${key}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: this.getHeaders("DELETE", key),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 delete failed: ${response.status} ${response.statusText}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    const url = `${this.getBaseUrl()}/${key}`;
    const response = await fetch(url, {
      method: "HEAD",
      headers: this.getHeaders("HEAD", key),
    });
    return response.ok;
  }

  getUrl(key: string): string {
    // For S3, we still proxy through our API for auth
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
