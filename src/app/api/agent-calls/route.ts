import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

/**
 * GET /api/agent-calls
 * List agent calls with optional filters
 * Auth: session cookie or x-relay-key header
 */
export async function GET(request: NextRequest) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const callerAgentId = searchParams.get("callerAgentId");
    const calleeAgentId = searchParams.get("calleeAgentId");
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(status);
    }
    if (callerAgentId) {
      conditions.push(`caller_agent_id = $${paramIdx++}`);
      params.push(callerAgentId);
    }
    if (calleeAgentId) {
      conditions.push(`callee_agent_id = $${paramIdx++}`);
      params.push(calleeAgentId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    const calls = await query(
      `SELECT * FROM agent_calls ${whereClause} ORDER BY created_at DESC LIMIT $${paramIdx++}`,
      params
    );

    return NextResponse.json({ calls });
  } catch (error) {
    console.error("Failed to fetch agent calls:", error);
    return NextResponse.json(
      { error: "에이전트 호출 목록 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/agent-calls
 * Create a new inter-agent call
 * Auth: session cookie or x-relay-key header
 */
export async function POST(request: NextRequest) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const body = await request.json();

    const requiredFields = ["callerAgentId", "calleeAgentId", "purpose", "requestPayload"];
    for (const field of requiredFields) {
      if (body[field] === undefined || body[field] === null || body[field] === "") {
        return NextResponse.json(
          { error: `필수 필드가 누락되었습니다: ${field}` },
          { status: 400 }
        );
      }
    }

    const callChain: string[] = body.callChain || [];

    // Cycle detection: calleeAgentId must not already be in the call chain
    if (callChain.includes(body.calleeAgentId)) {
      return NextResponse.json(
        { error: "순환 호출이 감지되었습니다" },
        { status: 400 }
      );
    }

    // Depth check: call chain must be less than 3 deep
    if (callChain.length >= 3) {
      return NextResponse.json(
        { error: "최대 호출 깊이(3)를 초과했습니다" },
        { status: 400 }
      );
    }

    // Permission check
    const permission = await queryOne<{ permission: string; max_calls_per_hour: number }>(
      `SELECT permission, max_calls_per_hour FROM agent_call_permissions
       WHERE caller_agent_id = $1 AND callee_agent_id = $2`,
      [body.callerAgentId, body.calleeAgentId]
    );

    if (permission && permission.permission === "denied") {
      return NextResponse.json(
        { error: "해당 에이전트 호출 권한이 없습니다" },
        { status: 403 }
      );
    }

    // Rate limit: count calls from caller in last hour
    const maxCallsPerHour = permission?.max_calls_per_hour || 10;
    const recentCallsResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM agent_calls
       WHERE caller_agent_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [body.callerAgentId]
    );
    const recentCalls = parseInt(recentCallsResult?.count || "0", 10);
    if (recentCalls >= maxCallsPerHour) {
      return NextResponse.json(
        { error: "시간당 호출 한도를 초과했습니다" },
        { status: 429 }
      );
    }

    const call = await queryOne(
      `INSERT INTO agent_calls (
        caller_agent_id, callee_agent_id, purpose, request_payload,
        call_chain, parent_call_id, suggestion_id, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
      RETURNING *`,
      [
        body.callerAgentId,
        body.calleeAgentId,
        body.purpose,
        JSON.stringify(body.requestPayload),
        JSON.stringify([...callChain, body.callerAgentId]),
        body.parentCallId || null,
        body.suggestionId || null,
      ]
    );

    return NextResponse.json({ success: true, call }, { status: 201 });
  } catch (error) {
    console.error("Failed to create agent call:", error);
    return NextResponse.json(
      { error: "에이전트 호출 생성에 실패했습니다" },
      { status: 500 }
    );
  }
}
