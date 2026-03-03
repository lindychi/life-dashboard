import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { queryOne } from "@/lib/db";

/**
 * POST /api/suggestions/[id]/execute
 * Execute an approved suggestion
 * Auth: session cookie or x-relay-key header
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const suggestion = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM agent_suggestions WHERE id = $1`,
      [id]
    );

    if (!suggestion) {
      return NextResponse.json(
        { error: "제안을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    if (suggestion.status !== "approved") {
      return NextResponse.json(
        { error: "승인된 제안만 실행할 수 있습니다" },
        { status: 400 }
      );
    }

    const updated = await queryOne(
      `UPDATE agent_suggestions
       SET status = 'executing', executed_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    return NextResponse.json({
      success: true,
      suggestion: updated,
      message: "제안 실행이 시작되었습니다. 게이트웨이에서 처리됩니다.",
    });
  } catch (error) {
    console.error("Failed to execute suggestion:", error);
    return NextResponse.json(
      { error: "제안 실행에 실패했습니다" },
      { status: 500 }
    );
  }
}
