import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getAgent,
  updateAgent,
  removeAgent,
  type AgentConfig,
} from "@/lib/agents";

interface RouteContext {
  params: Promise<{
    agentId: string;
  }>;
}

/**
 * GET /api/agents/[agentId]
 * 특정 에이전트 조회
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  const { agentId } = await context.params;
  const agent = getAgent(agentId);

  if (!agent) {
    return NextResponse.json(
      { error: "에이전트를 찾을 수 없습니다" },
      { status: 404 }
    );
  }

  return NextResponse.json({ agent });
}

/**
 * PATCH /api/agents/[agentId]
 * 에이전트 정보 수정
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const { agentId } = await context.params;
    const body = await request.json();

    // id 수정 방지
    if (body.id !== undefined) {
      return NextResponse.json(
        { error: "에이전트 ID는 수정할 수 없습니다" },
        { status: 400 }
      );
    }

    // 카테고리 검증 (제공된 경우)
    if (body.category !== undefined) {
      const validCategories: AgentConfig["category"][] = [
        "dev",
        "business",
        "ops",
      ];
      if (!validCategories.includes(body.category)) {
        return NextResponse.json(
          { error: "유효하지 않은 카테고리입니다" },
          { status: 400 }
        );
      }
    }

    const agent = updateAgent(agentId, body);

    if (!agent) {
      return NextResponse.json(
        { error: "에이전트를 찾을 수 없습니다" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, agent });
  } catch (error) {
    return NextResponse.json(
      { error: "에이전트 수정에 실패했습니다" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/agents/[agentId]
 * 에이전트 삭제
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  const { agentId } = await context.params;
  const success = removeAgent(agentId);

  if (!success) {
    return NextResponse.json(
      { error: "에이전트를 찾을 수 없습니다" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}
