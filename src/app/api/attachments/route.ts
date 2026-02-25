import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { validateRelayKey } from "@/lib/relay";
import { saveAttachment } from "@/lib/attachments";
import { isDbConnectionError } from "@/lib/db";
import { MAX_FILE_SIZE } from "@/lib/storage";

// Allowed MIME types for file uploads (deny-by-default for dangerous types)
const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".pif",
  ".sh", ".bash", ".csh", ".ksh",
  ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".ps1",
]);

function isBlockedFile(filename: string): boolean {
  const ext = filename.toLowerCase().split(".").pop();
  return ext ? BLOCKED_EXTENSIONS.has(`.${ext}`) : false;
}

/**
 * POST /api/attachments
 * Upload a file attachment (multipart/form-data)
 * Fields:
 *   - file: the file to upload (required)
 *   - refKey: optional custom ref_key
 */
export async function POST(request: NextRequest) {
  // Auth: relay key or user session
  const relayValid = validateRelayKey(request.headers.get("x-relay-key") || "");
  const user = relayValid ? null : await getCurrentUser();
  if (!relayValid && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const refKey = formData.get("refKey") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided. Use 'file' field in multipart form data." },
        { status: 400 }
      );
    }

    // Validate file type (block dangerous executables)
    if (isBlockedFile(file.name || "")) {
      return NextResponse.json(
        { error: "File type not allowed. Executable files are blocked for security." },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Save attachment
    const attachment = await saveAttachment(
      buffer,
      file.name || "unnamed",
      file.type || "application/octet-stream",
      refKey || undefined
    );

    return NextResponse.json({
      success: true,
      attachment,
      usage: `Reference this file in messages with: @file:${attachment.refKey}`,
    });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }

    const message = error instanceof Error ? error.message : "Upload failed";
    console.error("Attachment upload error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
