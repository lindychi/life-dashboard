/**
 * POST /api/okr/key-results - Create new key result
 */

import { NextRequest, NextResponse } from "next/server";
import { createKeyResult, CreateKeyResultInput } from "@/lib/okr";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body: CreateKeyResultInput = await request.json();

    // Validation
    if (
      !body.objective_id ||
      !body.title ||
      !body.metric_type ||
      body.target_value === undefined
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: objective_id, title, metric_type, target_value",
        },
        { status: 400 }
      );
    }

    const keyResult = await createKeyResult(body);

    // Broadcast SSE event (non-blocking, errors logged but not thrown)
    try {
      sseBroadcaster.broadcast({
        type: "okr:key-result:created",
        data: { keyResult },
        timestamp: new Date().toISOString(),
      });
    } catch (broadcastError) {
      console.error("Failed to broadcast SSE event:", broadcastError);
    }

    return NextResponse.json({ keyResult }, { status: 201 });
  } catch (error) {
    console.error("POST /api/okr/key-results error:", error);
    return NextResponse.json(
      { error: "Failed to create key result" },
      { status: 500 }
    );
  }
}
