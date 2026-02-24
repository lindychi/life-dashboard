import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { validateRelayKey } from "@/lib/relay";
import {
  createRequestGroup,
  getActiveRequestGroups,
  getAllRequestGroups,
} from "@/lib/request-group";
import type { RequestGroupStatus } from "@/lib/request-group";
import { isDbConnectionError } from "@/lib/db";

/**
 * GET /api/request-groups
 * 요청 그룹 목록 조회
 * Query params:
 *   - status?: 'active' | 'completed' | 'failed' | 'cancelled' (기본: active만)
 *   - all?: 'true' (모든 상태 조회)
 *   - limit?: number (기본 50)
 */
export async function GET(request: NextRequest) {
  // 인증: session 또는 relay key
  const relayValid = validateRelayKey(
    request.headers.get("x-relay-key") || ""
  );
  const user = relayValid ? null : await getCurrentUser();
  if (!relayValid && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status") as RequestGroupStatus | null;
    const showAll = searchParams.get("all") === "true";
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    let groups;
    if (showAll || statusParam) {
      groups = await getAllRequestGroups({
        limit,
        status: statusParam || undefined,
      });
    } else {
      groups = await getActiveRequestGroups();
    }

    return NextResponse.json({ groups });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json({ groups: [] });
    }
    console.error("Request groups GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/request-groups
 * 새 요청 그룹 생성
 * Body: { content: string, title?: string, id?: string }
 * content → title 자동 생성 (title 미지정 시)
 */
export async function POST(request: NextRequest) {
  // 인증: session 또는 relay key
  const relayValid = validateRelayKey(
    request.headers.get("x-relay-key") || ""
  );
  const user = relayValid ? null : await getCurrentUser();
  if (!relayValid && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { content, title, id } = (await request.json()) as {
      content: string;
      title?: string;
      id?: string;
    };

    if (!content) {
      return NextResponse.json(
        { error: "content is required" },
        { status: 400 }
      );
    }

    const group = await createRequestGroup(content, { id, title });

    return NextResponse.json({ success: true, group });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Request groups POST error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
