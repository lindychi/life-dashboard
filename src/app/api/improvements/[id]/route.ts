import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import {
  getImprovementById,
  approveImprovement,
  applyImprovement,
  rejectImprovement,
} from "@/lib/feedback";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

/**
 * GET /api/improvements/[id]
 * Get a single improvement action
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
    const action = await getImprovementById(id);

    if (!action) {
      return NextResponse.json(
        { error: "개선 액션을 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    return NextResponse.json({ action });
  } catch (error) {
    console.error("Failed to fetch improvement action:", error);
    return NextResponse.json(
      { error: "개선 액션 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/improvements/[id]
 * Update improvement action status (approve/apply/reject)
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
    const { action: actionType, approvedBy } = body;

    if (!actionType || !["approve", "apply", "reject"].includes(actionType)) {
      return NextResponse.json(
        { error: "action은 'approve', 'apply', 'reject' 중 하나여야 합니다" },
        { status: 400 }
      );
    }

    let result;
    switch (actionType) {
      case "approve":
        result = await approveImprovement(id, approvedBy);
        break;
      case "apply":
        result = await applyImprovement(id);
        break;
      case "reject":
        result = await rejectImprovement(id);
        break;
    }

    if (!result) {
      return NextResponse.json(
        { error: "개선 액션을 찾을 수 없거나 현재 상태에서 변경할 수 없습니다" },
        { status: 404 }
      );
    }

    // Broadcast SSE event for apply action
    if (actionType === "apply") {
      try {
        sseBroadcaster.broadcast({
          type: "improvement:applied",
          data: { action: result },
          timestamp: new Date().toISOString(),
        });
      } catch (broadcastError) {
        console.error("Failed to broadcast SSE event:", broadcastError);
      }
    }

    return NextResponse.json({ success: true, action: result });
  } catch (error) {
    console.error("Failed to update improvement action:", error);
    return NextResponse.json(
      { error: "개선 액션 업데이트에 실패했습니다" },
      { status: 500 }
    );
  }
}
