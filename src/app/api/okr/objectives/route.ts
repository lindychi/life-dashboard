/**
 * GET /api/okr/objectives - List all objectives
 * POST /api/okr/objectives - Create new objective
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getObjectives,
  createObjective,
  CreateObjectiveInput,
  ObjectiveStatus,
} from "@/lib/okr";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as ObjectiveStatus | null;

    const objectives = await getObjectives(status || undefined);
    return NextResponse.json({ objectives });
  } catch (error) {
    console.error("GET /api/okr/objectives error:", error);
    return NextResponse.json(
      { error: "Failed to fetch objectives" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateObjectiveInput = await request.json();

    // Validation
    if (!body.title || !body.period_type || !body.start_date || !body.end_date) {
      return NextResponse.json(
        { error: "Missing required fields: title, period_type, start_date, end_date" },
        { status: 400 }
      );
    }

    const objective = await createObjective(body);

    // Broadcast SSE event (non-blocking, errors logged but not thrown)
    try {
      sseBroadcaster.broadcast({
        type: "okr:objective:created",
        data: { objective },
        timestamp: new Date().toISOString(),
      });
    } catch (broadcastError) {
      console.error("Failed to broadcast SSE event:", broadcastError);
    }

    return NextResponse.json({ objective }, { status: 201 });
  } catch (error) {
    console.error("POST /api/okr/objectives error:", error);
    return NextResponse.json(
      { error: "Failed to create objective" },
      { status: 500 }
    );
  }
}
