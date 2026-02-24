import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getHistoryDetail } from "@/lib/history";
import { isDbConnectionError } from "@/lib/db";

interface RouteParams {
  params: Promise<{
    entryId: string;
  }>;
}

/**
 * GET /api/history/detail/[entryId]
 * 특정 히스토리 항목의 전체 상세 로그 반환
 *
 * Query params:
 *   - contentOffset: number (기본 0) — content 시작 위치 (문자 단위)
 *   - contentLimit: number (기본 0=전체) — 반환할 content 최대 길이 (문자 단위)
 *   - includeNeighbors: "true"|"false" (기본 "true") — 같은 request group의 이웃 항목 포함
 *
 * Response:
 *   {
 *     entry: HistoryEntry,        // 상세 히스토리 항목 (content 포함)
 *     contentTotalLength: number,  // content 전체 길이
 *     contentOffset: number,       // 현재 반환된 content의 시작 offset
 *     hasMoreContent: boolean,     // 더 읽을 content가 있는지
 *     neighbors: HistoryEntry[]    // 같은 request group의 이웃 항목들
 *   }
 *
 * 대량 로그 대응:
 *   contentLimit를 설정하면 content를 청크 단위로 페이지네이션 가능.
 *   예: ?contentLimit=50000&contentOffset=0 → 첫 50,000자
 *       ?contentLimit=50000&contentOffset=50000 → 다음 50,000자
 */
export async function GET(request: NextRequest, props: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const params = await props.params;
    const { entryId } = params;

    // UUID 형식 검증
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(entryId)) {
      return NextResponse.json(
        { error: "Invalid entry ID format" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const contentOffset = parseInt(searchParams.get("contentOffset") || "0", 10);
    const contentLimit = parseInt(searchParams.get("contentLimit") || "0", 10);
    const includeNeighbors = searchParams.get("includeNeighbors") !== "false";

    // 음수 방지
    if (contentOffset < 0 || contentLimit < 0) {
      return NextResponse.json(
        { error: "contentOffset and contentLimit must be non-negative" },
        { status: 400 }
      );
    }

    const result = await getHistoryDetail(entryId, {
      contentOffset,
      contentLimit,
      includeNeighbors,
    });

    if (!result) {
      return NextResponse.json(
        { error: "History entry not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("History detail GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
