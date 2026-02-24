import { NextRequest, NextResponse } from "next/server";
import { validateRelayKey } from "@/lib/relay";
import { queryOne, isDbConnectionError } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const apiKey = request.headers.get("x-relay-key");

  if (!apiKey || !validateRelayKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const {
      status,
      lastOutput,
      toolCallsCount,
      totalOutputChars,
      lastActivityAt,
      completedAt,
      recoveryReason,
      subtaskResults,
    } = body;

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }

    if (lastOutput !== undefined) {
      updates.push(`last_output = $${paramIndex++}`);
      values.push(lastOutput);
    }

    if (toolCallsCount !== undefined) {
      updates.push(`tool_calls_count = $${paramIndex++}`);
      values.push(toolCallsCount);
    }

    if (totalOutputChars !== undefined) {
      updates.push(`total_output_chars = $${paramIndex++}`);
      values.push(totalOutputChars);
    }

    if (lastActivityAt !== undefined) {
      updates.push(`last_activity_at = $${paramIndex++}`);
      values.push(lastActivityAt);
    }

    if (completedAt !== undefined) {
      updates.push(`completed_at = $${paramIndex++}`);
      values.push(completedAt);
    }

    if (recoveryReason !== undefined) {
      updates.push(`recovery_reason = $${paramIndex++}`);
      values.push(recoveryReason);
    }

    if (subtaskResults !== undefined) {
      updates.push(`subtask_results = $${paramIndex++}`);
      values.push(JSON.stringify(subtaskResults));
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    values.push(id);

    const result = await queryOne<{ id: string }>(
      `
      UPDATE task_executions
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING id
      `,
      values
    );

    if (!result) {
      return NextResponse.json(
        { error: "Task execution not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Error updating task execution:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
