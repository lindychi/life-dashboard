import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { validateRelayKey } from "@/lib/relay";
import {
  getRequestGroup,
  updateRequestGroupStatus,
  addAgentToRequestGroup,
  removeAgentFromRequestGroup,
  updateAgentInRequestGroup,
} from "@/lib/request-group";
import type { RequestGroupStatus } from "@/lib/request-group";
import { isDbConnectionError } from "@/lib/db";

/**
 * GET /api/request-groups/[id]
 * 특정 요청 그룹 상세 조회
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const relayValid = validateRelayKey(
    request.headers.get("x-relay-key") || ""
  );
  const user = relayValid ? null : await getCurrentUser();
  if (!relayValid && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const group = await getRequestGroup(id);

    if (!group) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ group });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Request group GET error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/request-groups/[id]
 * 요청 그룹 상태 업데이트 또는 에이전트 관리
 *
 * Body 옵션:
 * - { status: 'completed' | 'failed' | 'cancelled' }  → 그룹 상태 변경
 * - { action: 'add_agent', agentId, taskSummary? }     → 에이전트 추가
 * - { action: 'remove_agent', agentId }                → 에이전트 제거
 * - { action: 'update_agent', agentId, agentStatus, taskSummary? } → 에이전트 상태 변경
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const relayValid = validateRelayKey(
    request.headers.get("x-relay-key") || ""
  );
  const user = relayValid ? null : await getCurrentUser();
  if (!relayValid && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = (await request.json()) as {
      status?: RequestGroupStatus;
      action?: string;
      agentId?: string;
      agentStatus?: string;
      taskSummary?: string;
    };

    // 그룹 상태 업데이트
    if (body.status) {
      const updated = await updateRequestGroupStatus(id, body.status);
      if (!updated) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, group: updated });
    }

    // 에이전트 관리 액션
    if (body.action) {
      switch (body.action) {
        case "add_agent": {
          if (!body.agentId) {
            return NextResponse.json(
              { error: "agentId is required" },
              { status: 400 }
            );
          }
          const agent = await addAgentToRequestGroup(
            id,
            body.agentId,
            body.taskSummary
          );
          return NextResponse.json({ success: true, agent });
        }

        case "remove_agent": {
          if (!body.agentId) {
            return NextResponse.json(
              { error: "agentId is required" },
              { status: 400 }
            );
          }
          await removeAgentFromRequestGroup(id, body.agentId);
          return NextResponse.json({ success: true });
        }

        case "update_agent": {
          if (!body.agentId || !body.agentStatus) {
            return NextResponse.json(
              { error: "agentId and agentStatus are required" },
              { status: 400 }
            );
          }
          const updated = await updateAgentInRequestGroup(
            id,
            body.agentId,
            body.agentStatus,
            body.taskSummary
          );
          if (!updated) {
            return NextResponse.json({ error: "Agent not found in group" }, { status: 404 });
          }
          return NextResponse.json({ success: true, agent: updated });
        }

        default:
          return NextResponse.json(
            { error: `Unknown action: ${body.action}` },
            { status: 400 }
          );
      }
    }

    return NextResponse.json(
      { error: "status or action is required" },
      { status: 400 }
    );
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Request group PATCH error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
