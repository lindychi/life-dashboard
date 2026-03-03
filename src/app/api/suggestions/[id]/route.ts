import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { queryOne } from "@/lib/db";

/**
 * GET /api/suggestions/[id]
 * Get a single suggestion by ID
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
    const suggestion = await queryOne(
      `SELECT * FROM agent_suggestions WHERE id = $1`,
      [id]
    );

    if (!suggestion) {
      return NextResponse.json(
        { error: "제안을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    return NextResponse.json({ suggestion });
  } catch (error) {
    console.error("Failed to fetch suggestion:", error);
    return NextResponse.json(
      { error: "제안 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/suggestions/[id]
 * Update suggestion status (approve or reject)
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

    const { status, rejectedReason } = body;

    if (!status || !["approved", "rejected"].includes(status)) {
      return NextResponse.json(
        { error: "status는 'approved' 또는 'rejected'여야 합니다" },
        { status: 400 }
      );
    }

    // Verify suggestion exists
    const existing = await queryOne(
      `SELECT id, status FROM agent_suggestions WHERE id = $1`,
      [id]
    );

    if (!existing) {
      return NextResponse.json(
        { error: "제안을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    let suggestion;
    if (status === "approved") {
      suggestion = await queryOne(
        `UPDATE agent_suggestions
         SET status = 'approved', approved_at = NOW(), approved_by = $1
         WHERE id = $2
         RETURNING *`,
        [body.approvedBy || null, id]
      );
    } else {
      suggestion = await queryOne(
        `UPDATE agent_suggestions
         SET status = 'rejected', rejected_at = NOW(), rejected_reason = $1
         WHERE id = $2
         RETURNING *`,
        [rejectedReason || null, id]
      );
    }

    return NextResponse.json({ success: true, suggestion });
  } catch (error) {
    console.error("Failed to update suggestion:", error);
    return NextResponse.json(
      { error: "제안 업데이트에 실패했습니다" },
      { status: 500 }
    );
  }
}
