import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  addConversationMessage,
  getConversationMessages,
  CONVERSATION_MESSAGE_TYPES,
} from "@/lib/conversations";
import { isDbConnectionError } from "@/lib/db";
import { isValidAgentId } from "@/lib/messages";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

/**
 * GET /api/conversations/[conversationId]/messages - 대화 세션의 메시지 조회
 * Query params:
 *   - limit: 최대 개수
 *   - since: ISO timestamp (이 시간 이후 메시지만)
 *   - parentMessageId: 특정 메시지의 답장만 조회 (null이면 최상위 메시지만)
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { conversationId } = await context.params;
    const { searchParams } = new URL(req.url);
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;
    const since = searchParams.get("since") || undefined;
    const parentMessageId = searchParams.has("parentMessageId")
      ? searchParams.get("parentMessageId") || undefined
      : undefined;

    // limit 검증
    if (limit !== undefined && (isNaN(limit) || limit <= 0 || limit > 1000)) {
      return NextResponse.json(
        { error: "Invalid limit: must be a positive number <= 1000" },
        { status: 400 }
      );
    }

    // since 검증
    if (since) {
      const sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        return NextResponse.json(
          { error: "Invalid since: must be a valid ISO timestamp" },
          { status: 400 }
        );
      }
    }

    const messages = await getConversationMessages(conversationId, {
      limit,
      since,
      parentMessageId,
    });

    return NextResponse.json({ conversationId, messages });
  } catch (error) {
    if (isDbConnectionError(error)) {
      const { conversationId } = await context.params;
      return NextResponse.json({ conversationId, messages: [] });
    }
    console.error("Failed to get conversation messages:", error);
    return NextResponse.json(
      { error: "Failed to get conversation messages" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/conversations/[conversationId]/messages - 대화 세션에 메시지 추가
 * Body: { from, content, type?, metadata?, parentMessageId? }
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { conversationId } = await context.params;
    const body = await req.json();
    const { from, content, type, metadata, parentMessageId } = body;

    // 필수 필드 검증
    if (!from || !content) {
      return NextResponse.json(
        { error: "Missing required fields: from, content" },
        { status: 400 }
      );
    }

    // 타입 검증
    if (typeof from !== "string") {
      return NextResponse.json(
        { error: "from must be a string" },
        { status: 400 }
      );
    }

    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "content must be a string" },
        { status: 400 }
      );
    }

    if (content.trim().length === 0) {
      return NextResponse.json(
        { error: "content must not be empty" },
        { status: 400 }
      );
    }

    // from ID 검증
    if (!isValidAgentId(from)) {
      return NextResponse.json(
        { error: `Invalid sender: "${from}" is not a registered agent or "user"` },
        { status: 400 }
      );
    }

    // type 검증
    if (type !== undefined && !CONVERSATION_MESSAGE_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type: must be one of ${CONVERSATION_MESSAGE_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    // metadata 검증
    if (metadata !== undefined && (typeof metadata !== "object" || Array.isArray(metadata))) {
      return NextResponse.json(
        { error: "metadata must be an object" },
        { status: 400 }
      );
    }

    // parentMessageId 검증
    if (parentMessageId !== undefined && typeof parentMessageId !== "string") {
      return NextResponse.json(
        { error: "parentMessageId must be a string" },
        { status: 400 }
      );
    }

    const message = await addConversationMessage({
      conversationId,
      from,
      content: content.trim(),
      type,
      metadata,
      parentMessageId,
    });

    // Broadcast SSE event
    sseBroadcaster.broadcast({
      type: "conversation:message:added",
      data: { conversationId, message },
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, message }, { status: 201 });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Failed to add conversation message:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add conversation message" },
      { status: 500 }
    );
  }
}
