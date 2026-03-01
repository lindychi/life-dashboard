import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { getLearnedPreferences } from "@/lib/feedback";

/**
 * GET /api/preferences
 * List active learned preferences
 * Auth: session cookie or x-relay-key header
 */
export async function GET(request: NextRequest) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope") || undefined;

    const preferences = await getLearnedPreferences(scope);
    return NextResponse.json({ preferences });
  } catch (error) {
    console.error("Failed to fetch preferences:", error);
    return NextResponse.json(
      { error: "선호도 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}
