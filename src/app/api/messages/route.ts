import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { sendMessage, getAllAgentsOverview, VALID_MESSAGE_TYPES, MAX_CONTENT_LENGTH, isValidAgentId } from "@/lib/messages";
import { isDbConnectionError } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/messages - 메시지 전송
 * Body: { from, to, content, type }
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { from, to, content, type } = body;

    // 필수 필드 존재 및 타입 검증
    if (!from || !to || !content || !type) {
      return NextResponse.json(
        { error: "Missing required fields: from, to, content, type" },
        { status: 400 }
      );
    }

    if (typeof from !== "string" || typeof to !== "string" || typeof content !== "string" || typeof type !== "string") {
      return NextResponse.json(
        { error: "All fields must be strings" },
        { status: 400 }
      );
    }

    // from/to 에이전트 ID 유효성 검증 ("user"와 "broadcast"는 특수 ID로 허용)
    if (!isValidAgentId(from)) {
      return NextResponse.json(
        { error: `Invalid sender: "${from}" is not a registered agent or "user"` },
        { status: 400 }
      );
    }

    if (!isValidAgentId(to) && to !== "broadcast") {
      return NextResponse.json(
        { error: `Invalid recipient: "${to}" is not a registered agent, "user", or "broadcast"` },
        { status: 400 }
      );
    }

    // content 길이 검증
    const trimmedContent = content.trim();
    if (trimmedContent.length === 0) {
      return NextResponse.json(
        { error: "Content must not be empty" },
        { status: 400 }
      );
    }

    if (trimmedContent.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json(
        { error: `Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters` },
        { status: 400 }
      );
    }

    // 타입 검증
    if (!VALID_MESSAGE_TYPES.includes(type as typeof VALID_MESSAGE_TYPES[number])) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${VALID_MESSAGE_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const message = await sendMessage({ from, to, content: trimmedContent, type: type as typeof VALID_MESSAGE_TYPES[number] });

    return NextResponse.json({ success: true, message });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Failed to send message:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/messages - 모든 에이전트의 메시지 개요 조회
 * Returns: { agents: Record<string, { unread: number, latest?: Message }> }
 * Supports ETag-based caching for efficient polling
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const agents = await getAllAgentsOverview();

    // Generate ETag based on content hash for efficient polling
    const contentHash = Buffer.from(JSON.stringify(agents))
      .toString("base64")
      .slice(0, 32);
    const etag = `"${contentHash}"`;

    // Check If-None-Match header
    const clientEtag = req.headers.get("if-none-match");
    if (clientEtag === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          "ETag": etag,
          "Cache-Control": "no-cache",
        }
      });
    }

    return NextResponse.json({ agents }, {
      headers: {
        "ETag": etag,
        "Cache-Control": "no-cache",
      }
    });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json({ agents: {} });
    }
    console.error("Failed to get messages overview:", error);
    return NextResponse.json(
      { error: "Failed to get messages overview" },
      { status: 500 }
    );
  }
}
