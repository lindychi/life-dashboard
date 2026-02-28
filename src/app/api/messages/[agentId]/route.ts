import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getMessages, getConversation, markAsRead, isValidAgentId, isValidISOTimestamp, isValidUUID } from "@/lib/messages";
import { isDbConnectionError } from "@/lib/db";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

/**
 * GET /api/messages/[agentId] - 특정 에이전트의 메시지 조회
 * Query params:
 *   - unreadOnly=true: 읽지 않은 메시지만 조회
 *   - with=otherAgentId: 특정 에이전트와의 대화 조회
 *   - since=ISO_TIMESTAMP: 이 시간 이후의 메시지만 조회 (증분 fetch)
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { agentId } = await context.params;

    // agentId 유효성 검증
    if (!isValidAgentId(agentId)) {
      return NextResponse.json(
        { error: `Invalid agentId: "${agentId}" is not a registered agent or "user"` },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const withAgent = searchParams.get("with");
    const since = searchParams.get("since") || undefined;

    // with 파라미터 유효성 검증
    if (withAgent && !isValidAgentId(withAgent)) {
      return NextResponse.json(
        { error: `Invalid "with" parameter: "${withAgent}" is not a registered agent or "user"` },
        { status: 400 }
      );
    }

    // since ISO 타임스탬프 형식 검증
    if (since && !isValidISOTimestamp(since)) {
      return NextResponse.json(
        { error: `Invalid "since" parameter: must be a valid ISO 8601 timestamp` },
        { status: 400 }
      );
    }

    let messages;

    if (withAgent) {
      // 대화 조회 (두 에이전트 간), since 지원
      messages = await getConversation(agentId, withAgent, 50, since);
    } else {
      // 일반 inbox 조회
      messages = await getMessages(agentId, unreadOnly);
    }

    return NextResponse.json({ agentId, messages });
  } catch (error) {
    if (isDbConnectionError(error)) {
      const { agentId } = await context.params;
      return NextResponse.json({ agentId, messages: [] });
    }
    console.error("Failed to get messages:", error);
    return NextResponse.json(
      { error: "Failed to get messages" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/messages/[agentId] - 메시지를 읽음으로 표시
 * Body: { messageId: string }
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { agentId } = await context.params;

    // agentId 유효성 검증
    if (!isValidAgentId(agentId)) {
      return NextResponse.json(
        { error: `Invalid agentId: "${agentId}" is not a registered agent or "user"` },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { messageId } = body;

    if (!messageId) {
      return NextResponse.json(
        { error: "Missing required field: messageId" },
        { status: 400 }
      );
    }

    // messageId가 문자열인지 검증
    if (typeof messageId !== "string") {
      return NextResponse.json(
        { error: "messageId must be a string" },
        { status: 400 }
      );
    }

    // messageId UUID 형식 검증
    if (!isValidUUID(messageId)) {
      return NextResponse.json(
        { error: "messageId must be a valid UUID" },
        { status: 400 }
      );
    }

    const success = await markAsRead(agentId, messageId);

    if (!success) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Failed to mark message as read:", error);
    return NextResponse.json(
      { error: "Failed to mark message as read" },
      { status: 500 }
    );
  }
}
