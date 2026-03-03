import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

/**
 * GET /api/suggestions
 * List suggestions with optional filters
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
    const category = searchParams.get("category");
    const urgency = searchParams.get("urgency");
    const sourceAgentId = searchParams.get("sourceAgentId");
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(status);
    }
    if (category) {
      conditions.push(`category = $${paramIdx++}`);
      params.push(category);
    }
    if (urgency) {
      conditions.push(`urgency = $${paramIdx++}`);
      params.push(urgency);
    }
    if (sourceAgentId) {
      conditions.push(`source_agent_id = $${paramIdx++}`);
      params.push(sourceAgentId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    params.push(limit);
    params.push(offset);

    const suggestions = await query(
      `SELECT * FROM agent_suggestions ${whereClause} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      params
    );

    const countParams = params.slice(0, params.length - 2);
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM agent_suggestions ${whereClause}`,
      countParams
    );

    return NextResponse.json({
      suggestions,
      total: parseInt(countResult?.count || "0", 10),
      limit,
      offset,
    });
  } catch (error) {
    console.error("Failed to fetch suggestions:", error);
    return NextResponse.json(
      { error: "제안 목록 조회에 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/suggestions
 * Create a new suggestion
 * Auth: session cookie or x-relay-key header
 */
export async function POST(request: NextRequest) {
  const authenticated = await authenticateRequest(request);
  if (!authenticated) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const body = await request.json();

    const requiredFields = [
      "sourceAgentId",
      "title",
      "description",
      "category",
      "priorityScore",
      "urgency",
      "executionPlan",
      "triggerType",
      "triggerData",
    ];

    for (const field of requiredFields) {
      if (body[field] === undefined || body[field] === null || body[field] === "") {
        return NextResponse.json(
          { error: `필수 필드가 누락되었습니다: ${field}` },
          { status: 400 }
        );
      }
    }

    // Dedup check: if dedupKey provided, ensure no pending/approved/executing suggestion with same key
    if (body.dedupKey) {
      const existing = await queryOne(
        `SELECT id FROM agent_suggestions WHERE dedup_key = $1 AND status IN ('pending', 'approved', 'executing')`,
        [body.dedupKey]
      );
      if (existing) {
        return NextResponse.json(
          { error: "동일한 dedupKey를 가진 진행 중인 제안이 이미 존재합니다" },
          { status: 409 }
        );
      }
    }

    const suggestion = await queryOne(
      `INSERT INTO agent_suggestions (
        source_agent_id, title, description, rationale, category,
        priority_score, urgency, target_agent_id, execution_plan,
        trigger_type, trigger_data, dedup_key, expires_at, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')
      RETURNING *`,
      [
        body.sourceAgentId,
        body.title,
        body.description,
        body.rationale || null,
        body.category,
        body.priorityScore,
        body.urgency,
        body.targetAgentId || null,
        body.executionPlan,
        body.triggerType,
        body.triggerData,
        body.dedupKey || null,
        body.expiresAt || null,
      ]
    );

    return NextResponse.json({ success: true, suggestion }, { status: 201 });
  } catch (error) {
    console.error("Failed to create suggestion:", error);
    return NextResponse.json(
      { error: "제안 생성에 실패했습니다" },
      { status: 500 }
    );
  }
}
