import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { queryOne } from "@/lib/db";

/**
 * GET /api/agent-calls/[id]
 * Get a single agent call by ID
 * Auth: session cookie or x-relay-key header
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const call = await queryOne(
      `SELECT * FROM agent_calls WHERE id = $1`,
      [id]
    );

    if (!call) {
      return NextResponse.json(
        { error: "에이전트 호출을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    return NextResponse.json({ call });
  } catch (error) {
    console.error("Failed to fetch agent call:", error);
    return NextResponse.json(
      { error: "에이전트 호출 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/agent-calls/[id]
 * Update agent call status
 * Auth: session cookie or x-relay-key header
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    const validStatuses = ["approved", "denied", "completed", "failed"];
    if (!body.status || !validStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: `status는 ${validStatuses.join(", ")} 중 하나여야 합니다` },
        { status: 400 }
      );
    }

    const existing = await queryOne(
      `SELECT id FROM agent_calls WHERE id = $1`,
      [id]
    );

    if (!existing) {
      return NextResponse.json(
        { error: "에이전트 호출을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    const responsePayload = body.responsePayload
      ? JSON.stringify(body.responsePayload)
      : null;

    const call = await queryOne(
      `UPDATE agent_calls
       SET status = $1,
           response_payload = COALESCE($2, response_payload),
           error = COALESCE($3, error),
           completed_at = CASE WHEN $1 IN ('completed', 'failed', 'denied') THEN NOW() ELSE completed_at END
       WHERE id = $4
       RETURNING *`,
      [body.status, responsePayload, body.error || null, id]
    );

    return NextResponse.json({ success: true, call });
  } catch (error) {
    console.error("Failed to update agent call:", error);
    return NextResponse.json(
      { error: "에이전트 호출 업데이트에 실패했습니다" },
      { status: 500 }
    );
  }
}
