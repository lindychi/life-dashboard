/**
 * GET /api/okr/objectives/[id] - Get objective by ID
 * PATCH /api/okr/objectives/[id] - Update objective
 * DELETE /api/okr/objectives/[id] - Delete objective
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getObjectiveWithKeyResults,
  updateObjective,
  deleteObjective,
  UpdateObjectiveInput,
} from "@/lib/okr";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const objective = await getObjectiveWithKeyResults(id);

    if (!objective) {
      return NextResponse.json(
        { error: "Objective not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ objective });
  } catch (error) {
    console.error("GET /api/okr/objectives/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch objective" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body: UpdateObjectiveInput = await request.json();

    const objective = await updateObjective(id, body);

    if (!objective) {
      return NextResponse.json(
        { error: "Objective not found" },
        { status: 404 }
      );
    }

    // Broadcast SSE event (non-blocking, errors logged but not thrown)
    try {
      sseBroadcaster.broadcast({
      type: "okr:objective:updated",
      data: { objective },
        timestamp: new Date().toISOString(),
      });
    } catch (broadcastError) {
      console.error("Failed to broadcast SSE event:", broadcastError);
    }

    return NextResponse.json({ objective });
  } catch (error) {
    console.error("PATCH /api/okr/objectives/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update objective" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const deleted = await deleteObjective(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Objective not found" },
        { status: 404 }
      );
    }

    // Broadcast SSE event (non-blocking, errors logged but not thrown)
    try {
      sseBroadcaster.broadcast({
      type: "okr:objective:deleted",
      data: { objectiveId: id },
        timestamp: new Date().toISOString(),
      });
    } catch (broadcastError) {
      console.error("Failed to broadcast SSE event:", broadcastError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/okr/objectives/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete objective" },
      { status: 500 }
    );
  }
}
