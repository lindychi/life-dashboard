import { NextRequest, NextResponse } from "next/server";
import { validateRelayKey } from "@/lib/relay";
import { query, queryOne, isDbConnectionError } from "@/lib/db";

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-relay-key");

  if (!apiKey || !validateRelayKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      gatewayId,
      agentId,
      commandId,
      commandType,
      task,
      systemPrompt,
      requestGroupId,
      requestTitle,
      attachmentRefKeys,
      orchestrationId,
      orchestrationPlan,
      subtaskIndex,
      attemptNumber,
      maxAttempts,
      recoveredFromId,
      recoveryReason,
    } = body;

    if (!gatewayId || !agentId || !task) {
      return NextResponse.json(
        { error: "gatewayId, agentId, and task are required" },
        { status: 400 }
      );
    }

    const result = await queryOne<{ id: string }>(
      `
      INSERT INTO task_executions (
        gateway_id, agent_id, command_id, command_type, task, system_prompt,
        request_group_id, request_title, attachment_ref_keys,
        orchestration_id, orchestration_plan, subtask_index,
        attempt_number, max_attempts, recovered_from_id, recovery_reason
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id
      `,
      [
        gatewayId,
        agentId,
        commandId || null,
        commandType || "spawn",
        task,
        systemPrompt || null,
        requestGroupId || null,
        requestTitle || null,
        attachmentRefKeys || null,
        orchestrationId || null,
        orchestrationPlan ? JSON.stringify(orchestrationPlan) : null,
        subtaskIndex !== undefined ? subtaskIndex : null,
        attemptNumber || 1,
        maxAttempts || 3,
        recoveredFromId || null,
        recoveryReason || null,
      ]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create task execution" },
        { status: 500 }
      );
    }

    return NextResponse.json({ id: result.id, success: true });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Error creating task execution:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const apiKey = request.headers.get("x-relay-key");

  if (!apiKey || !validateRelayKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const gatewayId = searchParams.get("gatewayId");
    const status = searchParams.get("status");

    if (!gatewayId) {
      return NextResponse.json(
        { error: "gatewayId is required" },
        { status: 400 }
      );
    }

    let queryStr = `
      SELECT
        id, gateway_id AS "gatewayId", agent_id AS "agentId",
        command_id AS "commandId", command_type AS "commandType",
        task, system_prompt AS "systemPrompt", status,
        last_output AS "lastOutput", tool_calls_count AS "toolCallsCount",
        total_output_chars AS "totalOutputChars",
        last_activity_at AS "lastActivityAt",
        orchestration_id AS "orchestrationId",
        orchestration_plan AS "orchestrationPlan",
        subtask_index AS "subtaskIndex",
        subtask_results AS "subtaskResults",
        request_group_id AS "requestGroupId",
        request_title AS "requestTitle",
        attempt_number AS "attemptNumber",
        max_attempts AS "maxAttempts",
        attachment_ref_keys AS "attachmentRefKeys",
        started_at AS "startedAt",
        completed_at AS "completedAt",
        recovered_from_id AS "recoveredFromId",
        recovery_reason AS "recoveryReason"
      FROM task_executions
      WHERE gateway_id = $1
    `;

    const params: unknown[] = [gatewayId];

    if (status) {
      params.push(status);
      queryStr += ` AND status = $${params.length}`;
    }

    queryStr += ` ORDER BY started_at DESC`;

    const tasks = await query(queryStr, params);

    return NextResponse.json({ tasks });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Error fetching task executions:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
