/**
 * POST /api/relay/restart-event
 *
 * Gateway가 재시작하기 전에 호출하는 엔드포인트.
 * 재시작 이벤트와 함께 pending 태스크 목록을 DB에 기록합니다.
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getRelayApiKey } from "@/lib/config";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("x-relay-key");
  if (authHeader !== getRelayApiKey()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json() as {
      gatewayId: string;
      reason: string;
      pendingTaskIds?: string[];
    };

    const { gatewayId, reason, pendingTaskIds = [] } = body;

    if (!gatewayId || !reason) {
      return NextResponse.json(
        { error: "Missing required fields: gatewayId, reason" },
        { status: 400 }
      );
    }

    // 1. gateway_connections에서 gateway DB ID 조회
    const gatewayRow = await query<{ id: string }>(
      `SELECT id FROM gateway_connections WHERE gateway_id = $1 LIMIT 1`,
      [gatewayId]
    );

    if (gatewayRow.length === 0) {
      return NextResponse.json(
        { error: `Gateway not found: ${gatewayId}` },
        { status: 404 }
      );
    }

    const gatewayDbId = gatewayRow[0].id;

    // 2. gateway_restart_history에 재시작 이벤트 기록
    await query(
      `INSERT INTO gateway_restart_history
       (gateway_id, restart_reason, pending_tasks_count, pending_task_ids)
       VALUES ($1, $2, $3, $4)`,
      [
        gatewayDbId,
        reason,
        pendingTaskIds.length,
        pendingTaskIds, // PostgreSQL UUID[] 배열
      ]
    );

    // 3. pending 태스크들의 상태를 'interrupted'로 변경
    if (pendingTaskIds.length > 0) {
      await query(
        `UPDATE task_executions
         SET status = 'interrupted',
             recovery_reason = $1,
             completed_at = NOW()
         WHERE id = ANY($2) AND status IN ('running', 'pending')`,
        [`Gateway restart: ${reason}`, pendingTaskIds]
      );
    }

    return NextResponse.json({
      success: true,
      gatewayId,
      pendingTasksCount: pendingTaskIds.length,
    });
  } catch (error) {
    console.error("❌ [restart-event] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
