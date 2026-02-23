// 파일 첨부 시스템 (PostgreSQL + 로컬 스토리지)

import { query, queryOne } from "./db";
import { createHash, randomBytes } from "crypto";
import * as path from "path";
import { getStorageDriver, validateFileSize } from "./storage";

export interface Attachment {
  id: string;
  messageId: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  refKey: string;
  createdAt: string;
}

const REF_KEY_PATTERN = /^[a-zA-Z0-9_-]{8}$/;

export function assertValidRefKey(refKey: string): void {
  if (!REF_KEY_PATTERN.test(refKey)) {
    throw new Error("Invalid refKey format");
  }
}


/**
 * Generate a short ref_key from file content hash + random suffix
 * Format: first 4 chars of content hash + 4 random hex chars (8 chars total)
 */
export function generateRefKey(buffer: Buffer): string {
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 4);
  const rand = randomBytes(2).toString("hex");
  return `${hash}${rand}`;
}

/**
 * Save a file to local storage and create DB record
 */
export async function saveAttachment(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string,
  refKey?: string
): Promise<Attachment> {
  // Validate file size against environment configuration
  validateFileSize(buffer.length);

  if (refKey) {
    assertValidRefKey(refKey);
  }

  const storage = getStorageDriver();

  // Generate ref_key if not provided
  const finalRefKey = refKey || generateRefKey(buffer);

  // Check ref_key uniqueness
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM attachments WHERE ref_key = $1`,
    [finalRefKey]
  );
  if (existing) {
    throw new Error(`ref_key "${finalRefKey}" already exists`);
  }

  // Generate storage key with date-based directory structure
  const now = new Date();
  const dateDir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const ext = path.extname(originalFilename) || "";
  const storageKey = `${dateDir}/${finalRefKey}${ext}`;

  // Save to storage (local or S3)
  await storage.save(storageKey, buffer);

  // Insert DB record
  const result = await queryOne<{
    id: string;
    message_id: string | null;
    original_filename: string;
    mime_type: string;
    size_bytes: string;
    storage_key: string;
    ref_key: string;
    created_at: string;
  }>(
    `INSERT INTO attachments (original_filename, mime_type, size_bytes, storage_key, ref_key)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, message_id, original_filename, mime_type, size_bytes, storage_key, ref_key, created_at`,
    [originalFilename, mimeType, buffer.length, storageKey, finalRefKey]
  );

  if (!result) {
    // Cleanup file on DB failure
    await storage.delete(storageKey).catch(() => {});
    throw new Error("Failed to save attachment record");
  }

  return mapRow(result);
}

/**
 * Link an attachment to a message by ref_key
 */
export async function linkAttachmentToMessage(
  refKey: string,
  messageId: string
): Promise<boolean> {
  const result = await queryOne<{ id: string }>(
    `UPDATE attachments SET message_id = $1 WHERE ref_key = $2 RETURNING id`,
    [messageId, refKey]
  );
  return result !== null;
}

/**
 * Link multiple attachments to a message (by ref_keys found in content)
 */
export async function linkAttachmentsFromContent(
  content: string,
  messageId: string
): Promise<string[]> {
  const refKeys = parseFileReferences(content);
  const linked: string[] = [];

  for (const refKey of refKeys) {
    const success = await linkAttachmentToMessage(refKey, messageId);
    if (success) linked.push(refKey);
  }

  return linked;
}

/**
 * Parse @file:ref_key patterns from message content
 */
export function parseFileReferences(content: string): string[] {
  const pattern = /@file:([a-zA-Z0-9_-]+)/g;
  const refs: string[] = [];
  let match;
  while ((match = pattern.exec(content)) !== null) {
    refs.push(match[1]);
  }
  return [...new Set(refs)]; // deduplicate
}

/**
 * Get attachment by ID
 */
export async function getAttachment(id: string): Promise<Attachment | null> {
  const row = await queryOne<AttachmentRow>(
    `SELECT id, message_id, original_filename, mime_type, size_bytes, storage_key, ref_key, created_at
     FROM attachments WHERE id = $1`,
    [id]
  );
  return row ? mapRow(row) : null;
}

/**
 * Get attachment by ref_key
 */
export async function getAttachmentByRefKey(refKey: string): Promise<Attachment | null> {
  const row = await queryOne<AttachmentRow>(
    `SELECT id, message_id, original_filename, mime_type, size_bytes, storage_key, ref_key, created_at
     FROM attachments WHERE ref_key = $1`,
    [refKey]
  );
  return row ? mapRow(row) : null;
}

/**
 * Get attachment by storage_key
 */
export async function getAttachmentByStorageKey(
  storageKey: string
): Promise<Attachment | null> {
  const row = await queryOne<AttachmentRow>(
    `SELECT id, message_id, original_filename, mime_type, size_bytes, storage_key, ref_key, created_at
     FROM attachments WHERE storage_key = $1`,
    [storageKey]
  );
  return row ? mapRow(row) : null;
}

/**
 * Get all attachments for a message
 */
export async function getMessageAttachments(messageId: string): Promise<Attachment[]> {
  const rows = await query<AttachmentRow>(
    `SELECT id, message_id, original_filename, mime_type, size_bytes, storage_key, ref_key, created_at
     FROM attachments WHERE message_id = $1
     ORDER BY created_at ASC`,
    [messageId]
  );
  return rows.map(mapRow);
}

/**
 * Read file content from storage (local or S3)
 */
export async function readAttachmentFile(storageKey: string): Promise<Buffer> {
  const storage = getStorageDriver();
  return storage.read(storageKey);
}

/**
 * Delete an attachment (file + DB record)
 */
export async function deleteAttachment(id: string): Promise<boolean> {
  const attachment = await getAttachment(id);
  if (!attachment) return false;

  // Delete file from storage (local or S3)
  const storage = getStorageDriver();
  await storage.delete(attachment.storageKey).catch(() => {});

  // Delete DB record
  const result = await queryOne<{ id: string }>(
    `DELETE FROM attachments WHERE id = $1 RETURNING id`,
    [id]
  );

  return result !== null;
}

// ===== Internal Helpers =====

interface AttachmentRow {
  id: string;
  message_id: string | null;
  original_filename: string;
  mime_type: string;
  size_bytes: string;
  storage_key: string;
  ref_key: string;
  created_at: string;
}

function mapRow(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    messageId: row.message_id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: parseInt(row.size_bytes, 10),
    storageKey: row.storage_key,
    refKey: row.ref_key,
    createdAt: row.created_at,
  };
}
