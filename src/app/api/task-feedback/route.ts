import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Dynamic import to avoid bundling better-sqlite3 at build time
async function getProviderFeedbackFunctions() {
  const { recordProviderFeedback, getRecentUnratedTasks } = await import(
    "../../../../scripts/provider-feedback"
  );
  return { recordProviderFeedback, getRecentUnratedTasks };
}

/**
 * POST /api/task-feedback
 *
 * Submit user rating for a task result.
 * User only sees "good/bad" — provider identity is hidden.
 *
 * Request body:
 *   {
 *     commandId: string (required)
 *     rating: "good" | "bad" (required)
 *   }
 *
 * Response:
 *   { success: boolean }
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { commandId, rating } = body;

    // Validate required fields
    if (!commandId || !rating) {
      return NextResponse.json(
        { error: "commandId and rating are required" },
        { status: 400 }
      );
    }

    // Validate rating value
    if (rating !== "good" && rating !== "bad") {
      return NextResponse.json(
        { error: "rating must be 'good' or 'bad'" },
        { status: 400 }
      );
    }

    // Validate types
    if (typeof commandId !== "string") {
      return NextResponse.json({ error: "commandId must be a string" }, { status: 400 });
    }

    const { recordProviderFeedback } = await getProviderFeedbackFunctions();
    const success = recordProviderFeedback({
      commandId,
      rating,
      timestamp: new Date(),
    });

    if (!success) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Task feedback POST error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * GET /api/task-feedback?unrated=true&limit=10
 *
 * Get recent tasks that haven't been rated yet.
 * Provider info is NOT included in response — user only sees task metadata.
 *
 * Query parameters:
 *   - unrated: boolean (optional, default: false)
 *   - limit: number (optional, default: 10, max: 100)
 *
 * Response:
 *   {
 *     tasks: Array<{
 *       commandId: string,
 *       agentId: string,
 *       timestamp: string
 *     }>
 *   }
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const unrated = searchParams.get("unrated") === "true";
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") || "10", 10)));

    if (!unrated) {
      return NextResponse.json({ tasks: [] });
    }

    const { getRecentUnratedTasks } = await getProviderFeedbackFunctions();
    const tasks = getRecentUnratedTasks(limit);

    // Format response with ISO string timestamps
    // IMPORTANT: Provider info is NOT included — user must not see it
    const formattedTasks = tasks.map((task) => ({
      commandId: task.commandId,
      agentId: task.agentId,
      timestamp: task.timestamp.toISOString(),
    }));

    return NextResponse.json({ tasks: formattedTasks });
  } catch (error) {
    console.error("Task feedback GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
