import { NextRequest, NextResponse } from "next/server";
import { generateAnalyticsSummary } from "@/lib/analytics";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/analytics?days=30
 * 히스토리 데이터 패턴 분석 결과 반환
 */
export async function GET(req: NextRequest) {
  // 인증 확인
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "30", 10);

    if (days < 1 || days > 365) {
      return NextResponse.json(
        { error: "days must be between 1 and 365" },
        { status: 400 }
      );
    }

    const summary = await generateAnalyticsSummary({ days });

    return NextResponse.json(summary);
  } catch (error) {
    console.error("[analytics] Error generating summary:", error);
    return NextResponse.json(
      { error: "Failed to generate analytics summary" },
      { status: 500 }
    );
  }
}
