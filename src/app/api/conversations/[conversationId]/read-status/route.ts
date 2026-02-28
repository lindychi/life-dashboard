import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { updateConversationReadStatus } from "@/lib/conversations";
import { isDbConnectionError } from "@/lib/db";
import { isValidAgentId } from "@/lib/messages";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

/**
 * POST /api/conversations/[conversationId]/read-status - 읽음 상태 업데이트
 * Body: { agentId, lastReadMessageId }
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { conversationId } = await context.params;
    const body = await req.json();
    const { agentId, lastReadMessageId } = body;

    // 필수 필드 검증
    if (!agentId || !lastReadMessageId) {
      return NextResponse.json(
        { error: "Missing required fields: agentId, lastReadMessageId" },
        { status: 400 }
      );
    }

    // 타입 검증
    if (typeof agentId !== "string") {
      return NextResponse.json(
        { error: "agentId must be a string" },
        { status: 400 }
      );
    }

    if (typeof lastReadMessageId !== "string") {
      return NextResponse.json(
        { error: "lastReadMessageId must be a string" },
        { status: 400 }
      );
    }

    // agentId 검증
    if (!isValidAgentId(agentId)) {
      return NextResponse.json(
        { error: `Invalid agentId: "${agentId}" is not a registered agent or "user"` },
        { status: 400 }
      );
    }

    const readStatus = await updateConversationReadStatus(
      conversationId,
      agentId,
      lastReadMessageId
    );

    // Broadcast SSE event
    sseBroadcaster.broadcast({
      type: "conversation:read-status:updated",
      data: { conversationId, agentId, lastReadMessageId },
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, readStatus });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Failed to update read status:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update read status" },
      { status: 500 }
    );
  }
}
