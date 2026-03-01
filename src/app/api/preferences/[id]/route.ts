import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { updatePreference, deletePreference } from "@/lib/feedback";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

/**
 * PUT /api/preferences/[id]
 * Update a learned preference
 * Auth: session cookie or x-relay-key header
 */
export async function PUT(
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

    const preference = await updatePreference(id, body);

    if (!preference) {
      return NextResponse.json(
        { error: "선호도를 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    // Broadcast SSE event (non-blocking)
    try {
      sseBroadcaster.broadcast({
        type: "preferences:updated",
        data: { preference },
        timestamp: new Date().toISOString(),
      });
    } catch (broadcastError) {
      console.error("Failed to broadcast SSE event:", broadcastError);
    }

    return NextResponse.json({ success: true, preference });
  } catch (error) {
    console.error("Failed to update preference:", error);
    return NextResponse.json(
      { error: "선호도 업데이트에 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/preferences/[id]
 * Soft-delete a learned preference (set status to 'rejected')
 * Auth: session cookie or x-relay-key header
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const success = await deletePreference(id);

    if (!success) {
      return NextResponse.json(
        { error: "선호도를 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete preference:", error);
    return NextResponse.json(
      { error: "선호도 삭제에 실패했습니다" },
      { status: 500 }
    );
  }
}
