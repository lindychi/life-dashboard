/**
 * POST /api/task-executions/force-retry
 *
 * 특정 태스크를 강제로 재시도하는 엔드포인트.
 * interrupted 또는 failed 상태의 태스크를 다시 큐에 추가합니다.
 *
 * 사용 예시:
 * - PM 에이전트가 유실된 작업을 발견했을 때
 * - 사용자가 대시보드에서 수동으로 재시도를 요청했을 때
 */

import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { queueCommand } from "@/lib/relay";
import { getRelayApiKey } from "@/lib/config";

export async function POST(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get("x-relay-key");
  const sessionToken = req.cookies.get("auth-token")?.value;

  if (!authHeader && !sessionToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (authHeader && authHeader !== getRelayApiKey()) {
    return NextResponse.json({ error: "Invalid relay key" }, { status: 401 });
  }

  try {
    const body = await req.json() as {
      taskId: string;
      reason?: string;
    };

    const { taskId, reason = "Manual retry request" } = body;

    if (!taskId) {
      return NextResponse.json(
        { error: "Missing required field: taskId" },
        { status: 400 }
      );
    }

    // 1. 태스크 정보 조회
    const taskRow = await queryOne<{
      id: string;
      gateway_id: string;
      agent_id: string;
      command_type: "spawn" | "orchestrate";
      task: string;
      system_prompt?: string;
      status: string;
      attempt_number: number;
      max_attempts: number;
      request_group_id?: string;
      request_title?: string;
      attachment_ref_keys?: string[];
      orchestration_id?: string;
      orchestration_plan?: Record<string, unknown>;
      subtask_index?: number;
      last_output?: string;
    }>(
      `SELECT id, gateway_id, agent_id, command_type, task, system_prompt,
              status, attempt_number, max_attempts, request_group_id, request_title,
              attachment_ref_keys, orchestration_id, orchestration_plan, subtask_index, last_output
       FROM task_executions
       WHERE id = $1`,
      [taskId]
    );

    if (!taskRow) {
      return NextResponse.json(
        { error: `Task not found: ${taskId}` },
        { status: 404 }
      );
    }

    // 2. 상태 검증 (interrupted 또는 failed만 재시도 가능)
    if (!["interrupted", "failed"].includes(taskRow.status)) {
      return NextResponse.json(
        { error: `Task cannot be retried (current status: ${taskRow.status})` },
        { status: 400 }
      );
    }

    // 3. 최대 시도 횟수 확인
    if (taskRow.attempt_number >= taskRow.max_attempts) {
      return NextResponse.json(
        { error: `Task exceeded max attempts (${taskRow.max_attempts})` },
        { status: 400 }
      );
    }

    // 4. 새 릴레이 커맨드로 재시도 요청
    const command = await queueCommand(taskRow.gateway_id, {
      type: taskRow.command_type,
      payload: {
        agentId: taskRow.agent_id,
        task: `[강제 재시도 요청: ${reason}]\n이전 작업이 중단되었습니다. 이전 진행 상태를 참고하여 작업을 이어서 완료해주세요.\n\n이전 출력 (마지막 부분):\n${taskRow.last_output || "(없음)"}\n\n원래 작업:\n${taskRow.task}`,
        systemPrompt: taskRow.system_prompt,
        _attachmentRefKeys: taskRow.attachment_ref_keys,
        requestGroupId: taskRow.request_group_id,
        requestTitle: taskRow.request_title,
        _requeueAttempt: taskRow.attempt_number,
        _recoveredFromId: taskRow.id,
        _recoveryReason: reason,
      },
    });
    const commandId = command.id;

    return NextResponse.json({
      success: true,
      taskId,
      newCommandId: commandId,
      message: `Task re-queued successfully (attempt ${taskRow.attempt_number + 1}/${taskRow.max_attempts})`,
    });
  } catch (error) {
    console.error("❌ [force-retry] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
