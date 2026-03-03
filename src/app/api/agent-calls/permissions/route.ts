import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

/**
 * GET /api/agent-calls/permissions
 * List all agent call permissions
 * Auth: session cookie or x-relay-key header
 */
export async function GET(request: NextRequest) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const permissions = await query(
      `SELECT * FROM agent_call_permissions ORDER BY created_at DESC`
    );

    return NextResponse.json({ permissions });
  } catch (error) {
    console.error("Failed to fetch permissions:", error);
    return NextResponse.json(
      { error: "권한 목록 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/agent-calls/permissions
 * Create or update a permission (upsert on caller_agent_id + callee_agent_id)
 * Auth: session cookie or x-relay-key header
 */
export async function PUT(request: NextRequest) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (!body.callerAgentId || !body.calleeAgentId || !body.permission) {
      return NextResponse.json(
        { error: "필수 필드가 누락되었습니다: callerAgentId, calleeAgentId, permission" },
        { status: 400 }
      );
    }

    const validPermissions = ["allowed", "denied", "requires_approval"];
    if (!validPermissions.includes(body.permission)) {
      return NextResponse.json(
        { error: `permission은 ${validPermissions.join(", ")} 중 하나여야 합니다` },
        { status: 400 }
      );
    }

    const permission = await queryOne(
      `INSERT INTO agent_call_permissions (caller_agent_id, callee_agent_id, permission, max_calls_per_hour)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (caller_agent_id, callee_agent_id)
       DO UPDATE SET
         permission = EXCLUDED.permission,
         max_calls_per_hour = EXCLUDED.max_calls_per_hour,
         updated_at = NOW()
       RETURNING *`,
      [
        body.callerAgentId,
        body.calleeAgentId,
        body.permission,
        body.maxCallsPerHour || 10,
      ]
    );

    return NextResponse.json({ success: true, permission });
  } catch (error) {
    console.error("Failed to upsert permission:", error);
    return NextResponse.json(
      { error: "권한 저장에 실패했습니다" },
      { status: 500 }
    );
  }
}
