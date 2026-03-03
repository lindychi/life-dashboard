import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

/**
 * GET /api/suggestions/scan-configs
 * List scan configs with optional agentId filter
 * Auth: session cookie or x-relay-key header
 */
export async function GET(request: NextRequest) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get("agentId");

    let configs;
    if (agentId) {
      configs = await query(
        `SELECT * FROM agent_scan_configs WHERE agent_id = $1 ORDER BY created_at DESC`,
        [agentId]
      );
    } else {
      configs = await query(
        `SELECT * FROM agent_scan_configs ORDER BY created_at DESC`
      );
    }

    return NextResponse.json({ configs });
  } catch (error) {
    console.error("Failed to fetch scan configs:", error);
    return NextResponse.json(
      { error: "스캔 설정 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/suggestions/scan-configs
 * Create or update a scan config (upsert on agent_id + scan_type)
 * Auth: session cookie or x-relay-key header
 */
export async function POST(request: NextRequest) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (!body.agentId || !body.scanType) {
      return NextResponse.json(
        { error: "필수 필드가 누락되었습니다: agentId, scanType" },
        { status: 400 }
      );
    }

    const config = await queryOne(
      `INSERT INTO agent_scan_configs (agent_id, scan_type, enabled, interval_minutes, config)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (agent_id, scan_type)
       DO UPDATE SET
         enabled = EXCLUDED.enabled,
         interval_minutes = EXCLUDED.interval_minutes,
         config = EXCLUDED.config,
         updated_at = NOW()
       RETURNING *`,
      [
        body.agentId,
        body.scanType,
        body.enabled !== undefined ? body.enabled : true,
        body.intervalMinutes || 60,
        body.config ? JSON.stringify(body.config) : null,
      ]
    );

    return NextResponse.json({ success: true, config }, { status: 201 });
  } catch (error) {
    console.error("Failed to upsert scan config:", error);
    return NextResponse.json(
      { error: "스캔 설정 저장에 실패했습니다" },
      { status: 500 }
    );
  }
}
