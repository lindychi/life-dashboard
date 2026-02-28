import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getConversation,
  getConversationStats,
  updateConversation,
  deleteConversation,
  CONVERSATION_STATUSES,
} from "@/lib/conversations";
import { isDbConnectionError } from "@/lib/db";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

/**
 * GET /api/conversations/[conversationId] - 대화 세션 조회 (통계 포함)
 * Query params:
 *   - stats=true: 통계 정보 포함
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { conversationId } = await context.params;
    const { searchParams } = new URL(req.url);
    const includeStats = searchParams.get("stats") === "true";

    if (includeStats) {
      const stats = await getConversationStats(conversationId);
      if (!stats) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ conversation: stats });
    } else {
      const conversation = await getConversation(conversationId);
      if (!conversation) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ conversation });
    }
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Failed to get conversation:", error);
    return NextResponse.json(
      { error: "Failed to get conversation" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/conversations/[conversationId] - 대화 세션 업데이트
 * Body: { title?, context?, status? }
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { conversationId } = await context.params;
    const body = await req.json();
    const { title, context: contextUpdates, status } = body;

    // 최소 하나의 업데이트 필드 필요
    if (title === undefined && contextUpdates === undefined && status === undefined) {
      return NextResponse.json(
        { error: "At least one field (title, context, status) must be provided" },
        { status: 400 }
      );
    }

    // title 검증
    if (title !== undefined && typeof title !== "string") {
      return NextResponse.json(
        { error: "title must be a string" },
        { status: 400 }
      );
    }

    // context 검증
    if (contextUpdates !== undefined && (typeof contextUpdates !== "object" || Array.isArray(contextUpdates))) {
      return NextResponse.json(
        { error: "context must be an object" },
        { status: 400 }
      );
    }

    // status 검증
    if (status !== undefined && !CONVERSATION_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status: must be one of ${CONVERSATION_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    const conversation = await updateConversation(conversationId, {
      title,
      context: contextUpdates,
      status,
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Broadcast SSE event
    sseBroadcaster.broadcast({
      type: "conversation:updated",
      data: { conversation },
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, conversation });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Failed to update conversation:", error);
    return NextResponse.json(
      { error: "Failed to update conversation" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/conversations/[conversationId] - 대화 세션 삭제
 */
export async function DELETE(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { conversationId } = await context.params;

    const success = await deleteConversation(conversationId);

    if (!success) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Broadcast SSE event
    sseBroadcaster.broadcast({
      type: "conversation:deleted",
      data: { conversationId },
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Failed to delete conversation:", error);
    return NextResponse.json(
      { error: "Failed to delete conversation" },
      { status: 500 }
    );
  }
}
