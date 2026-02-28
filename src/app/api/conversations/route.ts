import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createConversation, getConversations, CONVERSATION_STATUSES } from "@/lib/conversations";
import { isDbConnectionError } from "@/lib/db";
import { isValidAgentId } from "@/lib/messages";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

export const dynamic = "force-dynamic";

/**
 * GET /api/conversations - 대화 세션 목록 조회
 * Query params:
 *   - participantId: 참여자 ID로 필터링
 *   - status: active | archived | completed
 *   - createdBy: 생성자 ID로 필터링
 *   - limit: 최대 개수
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const participantId = searchParams.get("participantId") || undefined;
    const status = searchParams.get("status") as typeof CONVERSATION_STATUSES[number] | undefined;
    const createdBy = searchParams.get("createdBy") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;

    // participantId 검증
    if (participantId && !isValidAgentId(participantId)) {
      return NextResponse.json(
        { error: `Invalid participantId: "${participantId}" is not a registered agent or "user"` },
        { status: 400 }
      );
    }

    // status 검증
    if (status && !CONVERSATION_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status: must be one of ${CONVERSATION_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    // createdBy 검증
    if (createdBy && !isValidAgentId(createdBy)) {
      return NextResponse.json(
        { error: `Invalid createdBy: "${createdBy}" is not a registered agent or "user"` },
        { status: 400 }
      );
    }

    // limit 검증
    if (limit !== undefined && (isNaN(limit) || limit <= 0 || limit > 1000)) {
      return NextResponse.json(
        { error: "Invalid limit: must be a positive number <= 1000" },
        { status: 400 }
      );
    }

    const conversations = await getConversations({
      participantId,
      status,
      createdBy,
      limit,
    });

    return NextResponse.json({ conversations });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json({ conversations: [] });
    }
    console.error("Failed to get conversations:", error);
    return NextResponse.json(
      { error: "Failed to get conversations" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/conversations - 새 대화 세션 생성
 * Body: { title, participants, context?, createdBy }
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { title, participants, context, createdBy } = body;

    // 필수 필드 검증
    if (!title || !participants || !createdBy) {
      return NextResponse.json(
        { error: "Missing required fields: title, participants, createdBy" },
        { status: 400 }
      );
    }

    // 타입 검증
    if (typeof title !== "string") {
      return NextResponse.json(
        { error: "title must be a string" },
        { status: 400 }
      );
    }

    if (!Array.isArray(participants)) {
      return NextResponse.json(
        { error: "participants must be an array" },
        { status: 400 }
      );
    }

    if (participants.length === 0) {
      return NextResponse.json(
        { error: "participants array must not be empty" },
        { status: 400 }
      );
    }

    if (!participants.every((p) => typeof p === "string")) {
      return NextResponse.json(
        { error: "All participants must be strings" },
        { status: 400 }
      );
    }

    if (typeof createdBy !== "string") {
      return NextResponse.json(
        { error: "createdBy must be a string" },
        { status: 400 }
      );
    }

    // context 검증 (선택적)
    if (context !== undefined && (typeof context !== "object" || Array.isArray(context))) {
      return NextResponse.json(
        { error: "context must be an object" },
        { status: 400 }
      );
    }

    // participants ID 검증
    for (const participantId of participants) {
      if (!isValidAgentId(participantId)) {
        return NextResponse.json(
          { error: `Invalid participant ID: "${participantId}" is not a registered agent or "user"` },
          { status: 400 }
        );
      }
    }

    // createdBy 검증
    if (!isValidAgentId(createdBy)) {
      return NextResponse.json(
        { error: `Invalid createdBy: "${createdBy}" is not a registered agent or "user"` },
        { status: 400 }
      );
    }

    const conversation = await createConversation({
      title,
      participants,
      context,
      createdBy,
    });

    // Broadcast SSE event
    sseBroadcaster.broadcast({
      type: "conversation:created",
      data: { conversation },
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, conversation }, { status: 201 });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Failed to create conversation:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create conversation" },
      { status: 500 }
    );
  }
}
