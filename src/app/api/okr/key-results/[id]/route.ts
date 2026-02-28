/**
 * GET /api/okr/key-results/[id] - Get key result by ID
 * PATCH /api/okr/key-results/[id] - Update key result
 * DELETE /api/okr/key-results/[id] - Delete key result
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getKeyResultById,
  updateKeyResult,
  deleteKeyResult,
  UpdateKeyResultInput,
} from "@/lib/okr";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const keyResult = await getKeyResultById(id);

    if (!keyResult) {
      return NextResponse.json(
        { error: "Key result not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ keyResult });
  } catch (error) {
    console.error("GET /api/okr/key-results/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch key result" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body: UpdateKeyResultInput = await request.json();

    const keyResult = await updateKeyResult(id, body);

    if (!keyResult) {
      return NextResponse.json(
        { error: "Key result not found" },
        { status: 404 }
      );
    }

    // Broadcast SSE event (non-blocking, errors logged but not thrown)
    try {
      sseBroadcaster.broadcast({
      type: "okr:key-result:updated",
      data: { keyResult },
        timestamp: new Date().toISOString(),
      });
    } catch (broadcastError) {
      console.error("Failed to broadcast SSE event:", broadcastError);
    }

    return NextResponse.json({ keyResult });
  } catch (error) {
    console.error("PATCH /api/okr/key-results/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update key result" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const deleted = await deleteKeyResult(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Key result not found" },
        { status: 404 }
      );
    }

    // Broadcast SSE event (non-blocking, errors logged but not thrown)
    try {
      sseBroadcaster.broadcast({
      type: "okr:key-result:deleted",
      data: { keyResultId: id },
        timestamp: new Date().toISOString(),
      });
    } catch (broadcastError) {
      console.error("Failed to broadcast SSE event:", broadcastError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/okr/key-results/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete key result" },
      { status: 500 }
    );
  }
}
