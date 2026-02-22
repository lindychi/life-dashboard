import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getAgents,
  getAllAgents,
  getAgentsByCategory,
  addAgent,
  type AgentConfig,
} from "@/lib/agents";

/**
 * GET /api/agents
 * 에이전트 목록 조회
 * Query params:
 *   - all=true : 비활성화된 에이전트도 포함
 *   - category=dev|business|ops : 특정 카테고리만 필터링
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const showAll = searchParams.get("all") === "true";
  const category = searchParams.get("category") as
    | AgentConfig["category"]
    | null;

  let agents: AgentConfig[];

  if (category) {
    // 카테고리 필터링 (enabled 여부에 관계없이 모두 반환)
    agents = getAgentsByCategory(category);
    if (!showAll) {
      agents = agents.filter((a) => a.enabled);
    }
  } else if (showAll) {
    agents = getAllAgents();
  } else {
    agents = getAgents();
  }

  return NextResponse.json({ agents });
}

/**
 * POST /api/agents
 * 새 에이전트 추가
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // 필수 필드 검증
    const requiredFields: (keyof AgentConfig)[] = [
      "id",
      "name",
      "role",
      "emoji",
      "category",
      "systemPrompt",
      "enabled",
    ];

    for (const field of requiredFields) {
      if (
        body[field] === undefined ||
        body[field] === null ||
        body[field] === ""
      ) {
        return NextResponse.json(
          { error: `필수 필드가 누락되었습니다: ${field}` },
          { status: 400 }
        );
      }
    }

    // 카테고리 검증
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

    const agent = addAgent(body);
    return NextResponse.json({ success: true, agent });
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) {
      return NextResponse.json(
        { error: "이미 존재하는 에이전트 ID입니다" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "에이전트 추가에 실패했습니다" },
      { status: 500 }
    );
  }
}
