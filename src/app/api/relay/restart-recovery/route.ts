/**
 * POST /api/relay/restart-recovery
 *
 * Gateway가 재시작 후 복구 프로세스를 완료했을 때 호출하는 엔드포인트.
 * 가장 최근의 recovery_completed_at이 NULL인 재시작 이벤트를 찾아서 완료 시각을 기록합니다.
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
      recoveredCount: number;
    };

    const { gatewayId, recoveredCount } = body;

    if (!gatewayId) {
      return NextResponse.json(
        { error: "Missing required field: gatewayId" },
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

    // 2. 가장 최근의 미완료된 재시작 이벤트 찾아서 완료 시각 기록
    await query(
      `UPDATE gateway_restart_history
       SET recovery_completed_at = NOW()
       WHERE id = (
         SELECT id FROM gateway_restart_history
         WHERE gateway_id = $1 AND recovery_completed_at IS NULL
         ORDER BY restarted_at DESC
         LIMIT 1
       )`,
      [gatewayDbId]
    );

    return NextResponse.json({
      success: true,
      gatewayId,
      recoveredCount,
    });
  } catch (error) {
    console.error("❌ [restart-recovery] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
