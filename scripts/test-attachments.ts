#!/usr/bin/env npx tsx
/**
 * Comprehensive Attachment System Verification Script
 * Tests: DB schema, storage, attachments CRUD, API endpoints, @file:ref_key linking
 */

import { Pool } from "pg";
import * as fs from "fs/promises";
import * as path from "path";
import { createHash, randomBytes } from "crypto";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://localhost:5432/life_dashboard";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const RELAY_KEY = process.env.RELAY_API_KEY || "";

const pool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(label: string) { passed++; console.log(`  ✅ ${label}`); }
function fail(label: string, err?: unknown) { failed++; console.log(`  ❌ ${label}${err ? `: ${err}` : ""}`); }
function skip(label: string, reason: string) { skipped++; console.log(`  ⏭️  ${label} — ${reason}`); }

// ============================================================
// 1. DATABASE SCHEMA VERIFICATION
// ============================================================
async function testDbSchema() {
  console.log("\n═══ 1. DATABASE SCHEMA VERIFICATION ═══");

  try {
    // Check table exists
    const tableResult = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'attachments'`
    );
    if (tableResult.rows.length > 0) {
      ok("attachments table exists");
    } else {
      fail("attachments table does NOT exist — run: psql life_dashboard < sql/002_attachments.sql");
      return false;
    }

    // Check columns
    const colResult = await pool.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'attachments'
       ORDER BY ordinal_position`
    );
    const cols = colResult.rows.map((r: any) => r.column_name);
    const expected = ["id", "message_id", "original_filename", "mime_type", "size_bytes", "storage_key", "ref_key", "created_at"];
    const missing = expected.filter(c => !cols.includes(c));
    if (missing.length === 0) {
      ok(`All expected columns present: ${expected.join(", ")}`);
    } else {
      fail(`Missing columns: ${missing.join(", ")}`);
    }

    // Check indexes
    const idxResult = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'attachments'`
    );
    const indexes = idxResult.rows.map((r: any) => r.indexname);
    if (indexes.some((i: string) => i.includes("message"))) {
      ok("Index on message_id exists");
    } else {
      fail("Missing index on message_id");
    }
    if (indexes.some((i: string) => i.includes("ref_key"))) {
      ok("Index on ref_key exists");
    } else {
      fail("Missing index on ref_key");
    }

    // Check FK to messages
    const fkResult = await pool.query(
      `SELECT tc.constraint_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
       WHERE tc.table_name = 'attachments' AND tc.constraint_type = 'FOREIGN KEY'
         AND ccu.table_name = 'messages'`
    );
    if (fkResult.rows.length > 0) {
      ok("Foreign key to messages table exists");
    } else {
      fail("Missing FK reference to messages table");
    }

    // Check UNIQUE constraint on ref_key
    const uniqResult = await pool.query(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'attachments' AND constraint_type = 'UNIQUE'`
    );
    if (uniqResult.rows.length > 0) {
      ok("UNIQUE constraint on ref_key exists");
    } else {
      fail("Missing UNIQUE constraint on ref_key");
    }

    return true;
  } catch (err) {
    fail("DB connection / schema check", err);
    return false;
  }
}

// ============================================================
// 2. DIRECT LIBRARY TESTS (attachments.ts + storage.ts)
// ============================================================
async function testLibraryFunctions() {
  console.log("\n═══ 2. LIBRARY FUNCTION TESTS ═══");

  // Test generateRefKey
  const { generateRefKey, parseFileReferences } = await import("../src/lib/attachments");

  const buf1 = Buffer.from("hello world test file");
  const key1 = generateRefKey(buf1);
  if (key1.length === 8) {
    ok(`generateRefKey returns 8-char key: "${key1}"`);
  } else {
    fail(`generateRefKey returned ${key1.length}-char key, expected 8`);
  }

  // Keys should be different for different content (most of the time)
  const buf2 = Buffer.from("different content here");
  const key2 = generateRefKey(buf2);
  // Note: first 4 chars are hash-based so should differ
  const hashPart1 = key1.slice(0, 4);
  const hashPart2 = key2.slice(0, 4);
  if (hashPart1 !== hashPart2) {
    ok(`Different content → different hash prefix: "${hashPart1}" vs "${hashPart2}"`);
  } else {
    skip("Hash prefix collision (rare but possible)", "both files hashed to same prefix");
  }

  // Test parseFileReferences
  const refs1 = parseFileReferences("Check this file @file:abc12345 and @file:def67890");
  if (refs1.length === 2 && refs1.includes("abc12345") && refs1.includes("def67890")) {
    ok("parseFileReferences extracts multiple refs correctly");
  } else {
    fail(`parseFileReferences returned ${JSON.stringify(refs1)}, expected ["abc12345","def67890"]`);
  }

  // Deduplication
  const refs2 = parseFileReferences("@file:same123 and again @file:same123");
  if (refs2.length === 1) {
    ok("parseFileReferences deduplicates refs");
  } else {
    fail(`Expected 1 deduplicated ref, got ${refs2.length}`);
  }

  // Empty content
  const refs3 = parseFileReferences("no files here");
  if (refs3.length === 0) {
    ok("parseFileReferences returns empty for no refs");
  } else {
    fail(`Expected 0 refs, got ${refs3.length}`);
  }

  // Test validateFileSize
  const { validateFileSize, MAX_FILE_SIZE } = await import("../src/lib/storage");
  try {
    validateFileSize(1000);
    ok(`validateFileSize(1000) passes (max=${MAX_FILE_SIZE})`);
  } catch (e) {
    fail("validateFileSize(1000) should not throw");
  }

  try {
    validateFileSize(MAX_FILE_SIZE + 1);
    fail("validateFileSize(oversized) should throw");
  } catch (e) {
    ok("validateFileSize rejects oversized files");
  }
}

// ============================================================
// 3. SAVE + READ ATTACHMENT (DB + LocalStorage)
// ============================================================
async function testSaveAndRead() {
  console.log("\n═══ 3. SAVE / READ / DELETE ATTACHMENT ═══");

  const { saveAttachment, getAttachment, getAttachmentByRefKey, readAttachmentFile, deleteAttachment } = await import("../src/lib/attachments");

  const testContent = `Test file created at ${new Date().toISOString()}`;
  const buffer = Buffer.from(testContent);
  const filename = "test-verify.txt";
  const mimeType = "text/plain";

  let savedAttachment: any;

  // Save
  try {
    savedAttachment = await saveAttachment(buffer, filename, mimeType);
    ok(`saveAttachment succeeded — id=${savedAttachment.id}, refKey="${savedAttachment.refKey}"`);
  } catch (err) {
    fail("saveAttachment failed", err);
    return;
  }

  // Verify DB record via getAttachment
  try {
    const found = await getAttachment(savedAttachment.id);
    if (found && found.id === savedAttachment.id) {
      ok(`getAttachment(id) returns correct record`);
    } else {
      fail("getAttachment(id) returned null or wrong record");
    }
  } catch (err) {
    fail("getAttachment(id) threw", err);
  }

  // Verify DB record via getAttachmentByRefKey
  try {
    const found = await getAttachmentByRefKey(savedAttachment.refKey);
    if (found && found.refKey === savedAttachment.refKey) {
      ok(`getAttachmentByRefKey("${savedAttachment.refKey}") returns correct record`);
    } else {
      fail("getAttachmentByRefKey returned null or wrong record");
    }
  } catch (err) {
    fail("getAttachmentByRefKey threw", err);
  }

  // Verify file on disk
  try {
    const readBuf = await readAttachmentFile(savedAttachment.storageKey);
    if (readBuf.toString() === testContent) {
      ok("readAttachmentFile reads correct content from disk");
    } else {
      fail(`readAttachmentFile content mismatch: "${readBuf.toString().slice(0, 50)}..."`);
    }
  } catch (err) {
    fail("readAttachmentFile threw", err);
  }

  // Verify uploads/ directory was created
  const uploadDir = path.join(process.cwd(), "uploads");
  try {
    await fs.access(uploadDir);
    ok(`uploads/ directory exists at ${uploadDir}`);
  } catch {
    fail("uploads/ directory was not created");
  }

  // Verify file exists at expected path
  const fullPath = path.join(uploadDir, savedAttachment.storageKey);
  try {
    const stat = await fs.stat(fullPath);
    if (stat.size === buffer.length) {
      ok(`File exists at ${savedAttachment.storageKey} (${stat.size} bytes)`);
    } else {
      fail(`File size mismatch: expected ${buffer.length}, got ${stat.size}`);
    }
  } catch {
    fail(`File not found at expected path: ${fullPath}`);
  }

  // Duplicate ref_key should fail
  try {
    await saveAttachment(buffer, filename, mimeType, savedAttachment.refKey);
    fail("Duplicate ref_key should have thrown");
  } catch (err: any) {
    if (err.message.includes("already exists")) {
      ok("Duplicate ref_key correctly rejected");
    } else {
      fail("Unexpected error for duplicate ref_key", err.message);
    }
  }

  // Delete
  try {
    const deleted = await deleteAttachment(savedAttachment.id);
    if (deleted) {
      ok("deleteAttachment returned true");
    } else {
      fail("deleteAttachment returned false");
    }
    // Verify record gone
    const gone = await getAttachment(savedAttachment.id);
    if (!gone) {
      ok("Attachment record removed from DB after delete");
    } else {
      fail("Attachment record still exists after delete");
    }
    // Verify file gone (LocalStorageDriver deletes file)
    try {
      await fs.access(fullPath);
      fail("File still exists on disk after delete");
    } catch {
      ok("File removed from disk after delete");
    }
  } catch (err) {
    fail("deleteAttachment threw", err);
  }
}

// ============================================================
// 4. @file:ref_key AUTO-LINK IN MESSAGES
// ============================================================
async function testAutoLinking() {
  console.log("\n═══ 4. @file:ref_key AUTO-LINK IN MESSAGES ═══");

  const { saveAttachment, linkAttachmentsFromContent, getMessageAttachments, deleteAttachment } = await import("../src/lib/attachments");

  // Create a test attachment
  const buffer = Buffer.from("link test content");
  let attachment: any;
  try {
    attachment = await saveAttachment(buffer, "link-test.txt", "text/plain");
    ok(`Created test attachment: refKey="${attachment.refKey}"`);
  } catch (err) {
    fail("Failed to create test attachment for linking", err);
    return;
  }

  // Create a test message in DB
  let messageId: string;
  try {
    const msgResult = await pool.query(
      `INSERT INTO messages (from_id, to_id, content, type, read)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id`,
      ["test-sender", "test-receiver", `Check file @file:${attachment.refKey} please`, "text"]
    );
    messageId = msgResult.rows[0].id;
    ok(`Created test message: id=${messageId}`);
  } catch (err) {
    fail("Failed to create test message", err);
    // Cleanup
    await deleteAttachment(attachment.id).catch(() => {});
    return;
  }

  // Test linkAttachmentsFromContent
  try {
    const linked = await linkAttachmentsFromContent(
      `Check file @file:${attachment.refKey} please`,
      messageId
    );
    if (linked.length === 1 && linked[0] === attachment.refKey) {
      ok(`linkAttachmentsFromContent linked ref_key "${attachment.refKey}" to message`);
    } else {
      fail(`Expected 1 linked ref, got ${JSON.stringify(linked)}`);
    }
  } catch (err) {
    fail("linkAttachmentsFromContent threw", err);
  }

  // Verify via getMessageAttachments
  try {
    const msgAttachments = await getMessageAttachments(messageId);
    if (msgAttachments.length === 1 && msgAttachments[0].refKey === attachment.refKey) {
      ok(`getMessageAttachments returns linked attachment`);
    } else {
      fail(`getMessageAttachments returned ${msgAttachments.length} attachments`);
    }
  } catch (err) {
    fail("getMessageAttachments threw", err);
  }

  // Cleanup
  await deleteAttachment(attachment.id).catch(() => {});
  await pool.query(`DELETE FROM messages WHERE id = $1`, [messageId]).catch(() => {});
  ok("Cleaned up test data");
}

// ============================================================
// 5. API ENDPOINT TESTS (requires running dev server)
// ============================================================
async function testApiEndpoints() {
  console.log("\n═══ 5. API ENDPOINT TESTS ═══");

  // Check if server is running
  let serverUp = false;
  try {
    const resp = await fetch(`${BASE_URL}/api/relay/status`);
    serverUp = resp.ok || resp.status === 401;
    if (serverUp) {
      ok(`Dev server is reachable at ${BASE_URL}`);
    }
  } catch {
    skip("All API endpoint tests", `Dev server not reachable at ${BASE_URL}. Start with: pnpm dev`);
    return;
  }

  // Read RELAY_API_KEY from .env if not in env
  let relayKey = RELAY_KEY;
  if (!relayKey) {
    try {
      const envContent = await fs.readFile(path.join(process.cwd(), ".env"), "utf-8");
      const match = envContent.match(/RELAY_API_KEY=(.+)/);
      if (match) relayKey = match[1].trim();
    } catch {}
    try {
      const envContent = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf-8");
      const match = envContent.match(/RELAY_API_KEY=(.+)/);
      if (match) relayKey = match[1].trim();
    } catch {}
  }

  if (!relayKey) {
    skip("API tests with x-relay-key auth", "RELAY_API_KEY not found in env or .env file");
    return;
  }

  const headers: Record<string, string> = {
    "x-relay-key": relayKey,
  };

  // 5a. POST /api/attachments — upload a test file
  let uploadedId: string | null = null;
  let uploadedRefKey: string | null = null;

  try {
    const formData = new FormData();
    const testBlob = new Blob(["API test content " + Date.now()], { type: "text/plain" });
    formData.append("file", testBlob, "api-test-file.txt");

    const resp = await fetch(`${BASE_URL}/api/attachments`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data.success && data.attachment?.id && data.attachment?.refKey) {
        uploadedId = data.attachment.id;
        uploadedRefKey = data.attachment.refKey;
        ok(`POST /api/attachments → 200: id=${uploadedId}, refKey="${uploadedRefKey}"`);
        if (data.usage?.includes("@file:")) {
          ok("Response includes @file: usage hint");
        }
      } else {
        fail(`POST /api/attachments returned unexpected body: ${JSON.stringify(data).slice(0, 200)}`);
      }
    } else {
      const text = await resp.text();
      fail(`POST /api/attachments → ${resp.status}: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    fail("POST /api/attachments threw", err);
  }

  if (!uploadedId || !uploadedRefKey) {
    skip("GET endpoint tests", "Upload failed, skipping download/lookup tests");
    return;
  }

  // 5b. GET /api/attachments/[id] — download file
  try {
    const resp = await fetch(`${BASE_URL}/api/attachments/${uploadedId}`, { headers });
    if (resp.ok) {
      const ct = resp.headers.get("content-type");
      const cl = resp.headers.get("content-length");
      const cc = resp.headers.get("cache-control");
      const body = await resp.text();

      if (body.startsWith("API test content")) {
        ok(`GET /api/attachments/${uploadedId} → file content correct`);
      } else {
        fail(`Downloaded content mismatch: "${body.slice(0, 50)}..."`);
      }
      if (ct?.includes("text/plain")) {
        ok("Content-Type is text/plain");
      } else {
        fail(`Unexpected Content-Type: ${ct}`);
      }
      if (cc?.includes("immutable")) {
        ok("Cache-Control includes immutable");
      } else {
        fail(`Cache-Control missing immutable: ${cc}`);
      }
    } else {
      fail(`GET /api/attachments/${uploadedId} → ${resp.status}`);
    }
  } catch (err) {
    fail("GET /api/attachments/[id] threw", err);
  }

  // 5c. GET /api/attachments/by-ref/[refKey] — metadata lookup
  try {
    const resp = await fetch(`${BASE_URL}/api/attachments/by-ref/${uploadedRefKey}`, { headers });
    if (resp.ok) {
      const data = await resp.json();
      if (data.attachment?.id === uploadedId && data.attachment?.refKey === uploadedRefKey) {
        ok(`GET /api/attachments/by-ref/${uploadedRefKey} → correct metadata`);
      } else {
        fail(`by-ref lookup returned wrong data: ${JSON.stringify(data).slice(0, 200)}`);
      }
    } else {
      fail(`GET /api/attachments/by-ref/${uploadedRefKey} → ${resp.status}`);
    }
  } catch (err) {
    fail("GET /api/attachments/by-ref/[refKey] threw", err);
  }

  // 5d. GET /api/attachments/[id] with non-existent ID → 404
  try {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const resp = await fetch(`${BASE_URL}/api/attachments/${fakeId}`, { headers });
    if (resp.status === 404) {
      ok("GET non-existent attachment returns 404");
    } else {
      fail(`Expected 404 for non-existent attachment, got ${resp.status}`);
    }
  } catch (err) {
    fail("GET non-existent attachment threw", err);
  }

  // Cleanup uploaded test attachment
  try {
    await pool.query(`DELETE FROM attachments WHERE id = $1`, [uploadedId]);
    // Also remove file
    const storageRow = await pool.query(`SELECT storage_key FROM attachments WHERE id = $1`, [uploadedId]);
    // Already deleted from DB, try to cleanup file
    ok("Cleaned up API test attachment from DB");
  } catch {
    // Already cleaned or doesn't matter
  }
}

// ============================================================
// 6. MCP SERVER TOOL VERIFICATION
// ============================================================
async function testMcpServerCode() {
  console.log("\n═══ 6. MCP SERVER TOOL VERIFICATION ═══");

  // Read MCP server source and verify tool definitions
  const mcpSource = await fs.readFile(path.join(process.cwd(), "scripts/mcp-server.ts"), "utf-8");

  // Check dashboard_upload_attachment tool is registered
  if (mcpSource.includes('"dashboard_upload_attachment"')) {
    ok("dashboard_upload_attachment tool is registered");
  } else {
    fail("dashboard_upload_attachment tool NOT found in MCP server");
  }

  // Check dashboard_send_message has attachments support
  if (mcpSource.includes("attachments") && mcpSource.includes("filePath")) {
    ok("dashboard_send_message schema includes attachments parameter");
  } else {
    fail("dashboard_send_message missing attachments support");
  }

  // Check SendMessageSchema has attachments field
  if (mcpSource.includes("SendMessageSchema") && mcpSource.includes("filePath")) {
    ok("SendMessageSchema includes filePath in attachments");
  } else {
    fail("SendMessageSchema missing filePath");
  }

  // Check UploadAttachmentSchema
  if (mcpSource.includes("UploadAttachmentSchema")) {
    ok("UploadAttachmentSchema is defined");
  } else {
    fail("UploadAttachmentSchema not found");
  }

  // CRITICAL: Check if dashboard_upload_attachment has a handler in the switch statement
  if (mcpSource.includes('case "dashboard_upload_attachment"')) {
    ok("dashboard_upload_attachment has a case handler");
  } else {
    fail("⚠️  dashboard_upload_attachment is registered but has NO case handler in switch!");
    console.log("     → This means the tool will hit the 'default' case and throw 'Unknown tool'");
  }

  // Check if dashboard_send_message handler processes attachments
  // The handler just forwards to apiCall — check if it processes attachments before sending
  const sendMsgHandlerMatch = mcpSource.match(/case "dashboard_send_message"[\s\S]*?(?=case "|default:)/);
  if (sendMsgHandlerMatch) {
    const handler = sendMsgHandlerMatch[0];
    if (handler.includes("attachment") || handler.includes("filePath") || handler.includes("upload")) {
      ok("dashboard_send_message handler processes attachments");
    } else {
      fail("⚠️  dashboard_send_message handler does NOT process attachments!");
      console.log("     → It just forwards raw params to /api/relay/messages");
      console.log("     → The API would need to handle file uploads from filePath, which it doesn't");
      console.log("     → attachments with filePaths will be silently ignored");
    }
  }
}

// ============================================================
// 7. RELAY MESSAGES API (attachment forwarding)
// ============================================================
async function testRelayMessagesApi() {
  console.log("\n═══ 7. RELAY MESSAGES API ═══");

  // Check if relay messages API handles attachments
  const relayMsgPath = path.join(process.cwd(), "src/app/api/relay/messages/route.ts");
  try {
    const source = await fs.readFile(relayMsgPath, "utf-8");
    if (source.includes("attachment") || source.includes("upload")) {
      ok("Relay messages API mentions attachments");
    } else {
      skip("Relay messages API attachment handling", "No attachment logic found in relay messages route");
      console.log("     → MCP server sends attachments to /api/relay/messages");
      console.log("     → But this route may not handle file upload from filePath");
    }
  } catch {
    skip("Relay messages API check", "Could not read relay messages route");
  }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log("╔════════════════════════════════════════════════╗");
  console.log("║   ATTACHMENT SYSTEM VERIFICATION              ║");
  console.log("╚════════════════════════════════════════════════╝");

  const dbOk = await testDbSchema();
  if (dbOk) {
    await testLibraryFunctions();
    await testSaveAndRead();
    await testAutoLinking();
  } else {
    console.log("\n⚠️  DB schema check failed — skipping DB-dependent tests");
    console.log("   Run: psql life_dashboard < sql/002_attachments.sql");

    // Still run pure function tests
    try {
      await testLibraryFunctions();
    } catch (err) {
      fail("Library function test failed (likely DB import side-effect)", err);
    }
  }

  await testApiEndpoints();
  await testMcpServerCode();
  await testRelayMessagesApi();

  console.log("\n╔════════════════════════════════════════════════╗");
  console.log(`║   RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log("╚════════════════════════════════════════════════╝");

  if (failed > 0) {
    console.log("\n🔴 Some tests FAILED — see details above");
  } else {
    console.log("\n🟢 All tests PASSED");
  }

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
