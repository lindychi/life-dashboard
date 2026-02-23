import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { validateRelayKey } from "@/lib/relay";
import { getAttachmentByRefKey } from "@/lib/attachments";

/**
 * GET /api/attachments/by-ref/[refKey]
 * Get attachment metadata by ref_key
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ refKey: string }> }
) {
  // Auth: relay key or user session
  const relayValid = validateRelayKey(request.headers.get("x-relay-key") || "");
  const user = relayValid ? null : await getCurrentUser();
  if (!relayValid && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { refKey } = await params;
    const attachment = await getAttachmentByRefKey(refKey);

    if (!attachment) {
      return NextResponse.json(
        { error: "Attachment not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ attachment });
  } catch (error) {
    console.error("Attachment lookup error:", error);
    return NextResponse.json(
      { error: "Failed to lookup attachment" },
      { status: 500 }
    );
  }
}
