import { NextRequest, NextResponse } from "next/server";
import { validateRelayKey } from "@/lib/relay";
import { sendMessage, getMessages } from "@/lib/messages";
import { isDbConnectionError } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/relay/messages
 * Get messages for an agent
 * Query params:
 *   - agentId: required
 *   - unreadOnly?: boolean
 */
export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-relay-key");

  if (!apiKey || !validateRelayKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get("agentId");
    const unreadOnly = searchParams.get("unreadOnly") === "true";

    if (!agentId) {
      return NextResponse.json(
        { error: "agentId is required" },
        { status: 400 }
      );
    }

    const messages = await getMessages(agentId, unreadOnly);

    return NextResponse.json({ messages });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json({ messages: [] });
    }
    console.error("Relay messages GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/relay/messages
 * Send a message
 * Body: { from: string, to: string, content: string, type?: string }
 */
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-relay-key");

  if (!apiKey || !validateRelayKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { from, to, content, type } = body;

    // Required field validation
    if (!from || !to || !content) {
      return NextResponse.json(
        { error: "Missing required fields: from, to, content" },
        { status: 400 }
      );
    }

    // Default type to "text" if not provided
    const messageType = type || "text";

    // Type validation
    const validTypes = ["text", "task", "result", "question", "answer"];
    if (!validTypes.includes(messageType)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const message = await sendMessage({
      from,
      to,
      content,
      type: messageType,
    });

    return NextResponse.json({ success: true, message });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Relay messages POST error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
