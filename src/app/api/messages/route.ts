import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { sendMessage, getAllAgentsOverview } from "@/lib/messages";
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

    // 필수 필드 검증
    if (!from || !to || !content || !type) {
      return NextResponse.json(
        { error: "Missing required fields: from, to, content, type" },
        { status: 400 }
      );
    }

    // 타입 검증
    const validTypes = ["text", "task", "result", "question", "answer"];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const message = await sendMessage({ from, to, content, type });

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
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const agents = await getAllAgentsOverview();
    return NextResponse.json({ agents });
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
