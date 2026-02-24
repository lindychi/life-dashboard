// 요청 그룹 관리 라이브러리 (PostgreSQL-backed)

import { query, queryOne } from "./db";
import type { HistoryEntry } from "./history";

// ── 타입 정의 ──────────────────────────────────────────────────────

export type RequestGroupStatus = "active" | "completed" | "failed" | "cancelled";

export interface RequestGroupRow {
  id: string;
  title: string;
  status: RequestGroupStatus;
  sourceContent: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestGroupAgentRow {
  requestGroupId: string;
  agentId: string;
  status: string;
  taskSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestGroupWithAgents extends RequestGroupRow {
  agents: RequestGroupAgentRow[];
}

/** 레거시 호환: 히스토리 기반 그룹 뷰 */
export interface RequestGroup {
  requestGroupId: string;
  requestTitle: string;
  entries: HistoryEntry[];
  summary: {
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
  };
  startedAt: string;
  lastActivityAt: string;
}

// ── 유틸리티 함수 ──────────────────────────────────────────────────

/**
 * 새로운 요청 그룹 ID 생성
 */
export function createRequestGroupId(): string {
  return crypto.randomUUID();
}

/**
 * 태스크/커맨드 내용에서 간결한 한글 요약 제목 생성 (최대 50자)
 *
 * 키워드 매칭 기반 패턴 인식:
 * - 공통 작업 패턴 감지 (리팩토링, 인증, API, 테스트, 배포, 버그 수정, 빌드, DB, UI, 설정)
 * - 여러 패턴 매칭 시 상위 2개를 조합
 * - 패턴 미매칭 시 원본 내용을 50자로 축약
 */
export function generateRequestTitle(content: string): string {
  // 마크다운, 코드 블록, 과도한 공백 제거
  const cleaned = content
    .replace(/```[\s\S]*?```/g, "") // 코드 블록 제거
    .replace(/`[^`]+`/g, "") // 인라인 코드 제거
    .replace(/[*_~]/g, "") // 마크다운 포맷 제거
    .replace(/\s+/g, " ") // 연속 공백 제거
    .trim();

  const lower = cleaned.toLowerCase();

  // 패턴 매칭 (우선순위 순)
  const patterns: Array<{ keywords: string[]; title: string }> = [
    { keywords: ["refactor", "리팩토링", "리팩터링"], title: "리팩토링" },
    { keywords: ["auth", "인증", "로그인", "login"], title: "인증 시스템" },
    { keywords: ["api", "endpoint", "엔드포인트"], title: "API" },
    { keywords: ["test", "테스트", "testing"], title: "테스트" },
    { keywords: ["deploy", "배포", "deployment"], title: "배포" },
    { keywords: ["fix", "bug", "수정", "버그"], title: "버그 수정" },
    { keywords: ["build", "빌드"], title: "빌드" },
    { keywords: ["database", "db", "migration", "데이터베이스", "마이그레이션"], title: "DB 작업" },
    { keywords: ["ui", "frontend", "컴포넌트", "component"], title: "UI 작업" },
    { keywords: ["config", "설정", "configuration"], title: "설정 변경" },
  ];

  const matched: string[] = [];

  for (const pattern of patterns) {
    if (pattern.keywords.some((keyword) => lower.includes(keyword))) {
      matched.push(pattern.title);
      if (matched.length >= 2) break; // 최대 2개 조합
    }
  }

  if (matched.length > 0) {
    return matched.join(" + ");
  }

  // 패턴 미매칭 시 원본 내용 축약
  if (cleaned.length <= 50) {
    return cleaned;
  }

  // 50자로 자르되, 단어 경계에서 자르기
  const truncated = cleaned.substring(0, 50);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > 30) {
    // 30자 이상 위치에서 공백이 있으면 거기서 자름
    return truncated.substring(0, lastSpace) + "...";
  }

  return truncated + "...";
}

// ── DB 조작 함수 ──────────────────────────────────────────────────

/**
 * 새 요청 그룹 생성
 * content를 기반으로 제목을 자동 생성하고 UUID를 발급한다.
 */
export async function createRequestGroup(
  content: string,
  options?: { id?: string; title?: string }
): Promise<RequestGroupRow> {
  const id = options?.id ?? createRequestGroupId();
  const title = options?.title ?? generateRequestTitle(content);

  const row = await queryOne<{
    id: string;
    title: string;
    status: string;
    source_content: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO request_groups (id, title, status, source_content)
     VALUES ($1, $2, 'active', $3)
     RETURNING id, title, status, source_content, created_at, updated_at`,
    [id, title, content]
  );

  if (!row) {
    throw new Error("Failed to create request group");
  }

  return {
    id: row.id,
    title: row.title,
    status: row.status as RequestGroupStatus,
    sourceContent: row.source_content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 활성(미완료) 요청 그룹 목록 조회 (소속 에이전트 포함)
 */
export async function getActiveRequestGroups(): Promise<RequestGroupWithAgents[]> {
  // 그룹 + 에이전트를 LEFT JOIN으로 한번에 조회
  const rows = await query<{
    id: string;
    title: string;
    status: string;
    source_content: string | null;
    created_at: string;
    updated_at: string;
    agent_id: string | null;
    agent_status: string | null;
    task_summary: string | null;
    agent_created_at: string | null;
    agent_updated_at: string | null;
  }>(
    `SELECT
       rg.id, rg.title, rg.status, rg.source_content,
       rg.created_at, rg.updated_at,
       rga.agent_id, rga.status AS agent_status,
       rga.task_summary,
       rga.created_at AS agent_created_at,
       rga.updated_at AS agent_updated_at
     FROM request_groups rg
     LEFT JOIN request_group_agents rga ON rg.id = rga.request_group_id
     WHERE rg.status = 'active'
     ORDER BY rg.updated_at DESC, rga.created_at ASC`
  );

  // 애플리케이션 레벨에서 그룹화
  const groupMap = new Map<string, RequestGroupWithAgents>();
  for (const row of rows) {
    if (!groupMap.has(row.id)) {
      groupMap.set(row.id, {
        id: row.id,
        title: row.title,
        status: row.status as RequestGroupStatus,
        sourceContent: row.source_content,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        agents: [],
      });
    }

    if (row.agent_id) {
      groupMap.get(row.id)!.agents.push({
        requestGroupId: row.id,
        agentId: row.agent_id,
        status: row.agent_status!,
        taskSummary: row.task_summary,
        createdAt: row.agent_created_at!,
        updatedAt: row.agent_updated_at!,
      });
    }
  }

  return Array.from(groupMap.values());
}

/**
 * 모든 요청 그룹 목록 조회 (에이전트 포함, 페이지네이션)
 */
export async function getAllRequestGroups(
  options?: { limit?: number; status?: RequestGroupStatus }
): Promise<RequestGroupWithAgents[]> {
  const limit = options?.limit ?? 50;
  const statusFilter = options?.status;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (statusFilter) {
    conditions.push(`rg.status = $${paramIndex++}`);
    params.push(statusFilter);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await query<{
    id: string;
    title: string;
    status: string;
    source_content: string | null;
    created_at: string;
    updated_at: string;
    agent_id: string | null;
    agent_status: string | null;
    task_summary: string | null;
    agent_created_at: string | null;
    agent_updated_at: string | null;
  }>(
    `SELECT
       rg.id, rg.title, rg.status, rg.source_content,
       rg.created_at, rg.updated_at,
       rga.agent_id, rga.status AS agent_status,
       rga.task_summary,
       rga.created_at AS agent_created_at,
       rga.updated_at AS agent_updated_at
     FROM (
       SELECT * FROM request_groups ${whereClause}
       ORDER BY updated_at DESC
       LIMIT $${paramIndex}
     ) rg
     LEFT JOIN request_group_agents rga ON rg.id = rga.request_group_id
     ORDER BY rg.updated_at DESC, rga.created_at ASC`,
    [...params, limit]
  );

  const groupMap = new Map<string, RequestGroupWithAgents>();
  for (const row of rows) {
    if (!groupMap.has(row.id)) {
      groupMap.set(row.id, {
        id: row.id,
        title: row.title,
        status: row.status as RequestGroupStatus,
        sourceContent: row.source_content,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        agents: [],
      });
    }

    if (row.agent_id) {
      groupMap.get(row.id)!.agents.push({
        requestGroupId: row.id,
        agentId: row.agent_id,
        status: row.agent_status!,
        taskSummary: row.task_summary,
        createdAt: row.agent_created_at!,
        updatedAt: row.agent_updated_at!,
      });
    }
  }

  return Array.from(groupMap.values());
}

/**
 * 특정 요청 그룹 조회
 */
export async function getRequestGroup(id: string): Promise<RequestGroupWithAgents | null> {
  const rows = await query<{
    id: string;
    title: string;
    status: string;
    source_content: string | null;
    created_at: string;
    updated_at: string;
    agent_id: string | null;
    agent_status: string | null;
    task_summary: string | null;
    agent_created_at: string | null;
    agent_updated_at: string | null;
  }>(
    `SELECT
       rg.id, rg.title, rg.status, rg.source_content,
       rg.created_at, rg.updated_at,
       rga.agent_id, rga.status AS agent_status,
       rga.task_summary,
       rga.created_at AS agent_created_at,
       rga.updated_at AS agent_updated_at
     FROM request_groups rg
     LEFT JOIN request_group_agents rga ON rg.id = rga.request_group_id
     WHERE rg.id = $1`,
    [id]
  );

  if (rows.length === 0) return null;

  const first = rows[0];
  const group: RequestGroupWithAgents = {
    id: first.id,
    title: first.title,
    status: first.status as RequestGroupStatus,
    sourceContent: first.source_content,
    createdAt: first.created_at,
    updatedAt: first.updated_at,
    agents: [],
  };

  for (const row of rows) {
    if (row.agent_id) {
      group.agents.push({
        requestGroupId: row.id,
        agentId: row.agent_id,
        status: row.agent_status!,
        taskSummary: row.task_summary,
        createdAt: row.agent_created_at!,
        updatedAt: row.agent_updated_at!,
      });
    }
  }

  return group;
}

/**
 * 요청 그룹 상태 업데이트
 */
export async function updateRequestGroupStatus(
  id: string,
  status: RequestGroupStatus
): Promise<RequestGroupRow | null> {
  const row = await queryOne<{
    id: string;
    title: string;
    status: string;
    source_content: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE request_groups
     SET status = $2
     WHERE id = $1
     RETURNING id, title, status, source_content, created_at, updated_at`,
    [id, status]
  );

  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    status: row.status as RequestGroupStatus,
    sourceContent: row.source_content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 요청 그룹에 에이전트 연결 (UPSERT)
 */
export async function addAgentToRequestGroup(
  groupId: string,
  agentId: string,
  taskSummary?: string
): Promise<RequestGroupAgentRow> {
  const row = await queryOne<{
    request_group_id: string;
    agent_id: string;
    status: string;
    task_summary: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO request_group_agents (request_group_id, agent_id, status, task_summary)
     VALUES ($1, $2, 'assigned', $3)
     ON CONFLICT (request_group_id, agent_id) DO UPDATE
     SET task_summary = COALESCE($3, request_group_agents.task_summary),
         updated_at = NOW()
     RETURNING request_group_id, agent_id, status, task_summary, created_at, updated_at`,
    [groupId, agentId, taskSummary || null]
  );

  if (!row) {
    throw new Error("Failed to add agent to request group");
  }

  return {
    requestGroupId: row.request_group_id,
    agentId: row.agent_id,
    status: row.status,
    taskSummary: row.task_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 요청 그룹에서 에이전트 해제
 */
export async function removeAgentFromRequestGroup(
  groupId: string,
  agentId: string
): Promise<boolean> {
  const result = await query(
    `DELETE FROM request_group_agents
     WHERE request_group_id = $1 AND agent_id = $2`,
    [groupId, agentId]
  );
  return (result as unknown[]).length >= 0; // DELETE doesn't return rows, but query won't throw
}

/**
 * 요청 그룹 내 에이전트 상태 업데이트
 */
export async function updateAgentInRequestGroup(
  groupId: string,
  agentId: string,
  status: string,
  taskSummary?: string
): Promise<RequestGroupAgentRow | null> {
  const row = await queryOne<{
    request_group_id: string;
    agent_id: string;
    status: string;
    task_summary: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE request_group_agents
     SET status = $3${taskSummary !== undefined ? ", task_summary = $4" : ""}
     WHERE request_group_id = $1 AND agent_id = $2
     RETURNING request_group_id, agent_id, status, task_summary, created_at, updated_at`,
    taskSummary !== undefined
      ? [groupId, agentId, status, taskSummary]
      : [groupId, agentId, status]
  );

  if (!row) return null;

  return {
    requestGroupId: row.request_group_id,
    agentId: row.agent_id,
    status: row.status,
    taskSummary: row.task_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 모든 에이전트가 completed/failed일 때 자동으로 그룹 상태를 완료 처리
 */
export async function autoCompleteRequestGroup(groupId: string): Promise<boolean> {
  const row = await queryOne<{ total: string; done: string; failed: string }>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status IN ('completed', 'failed')) AS done,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed
     FROM request_group_agents
     WHERE request_group_id = $1`,
    [groupId]
  );

  if (!row) return false;

  const total = parseInt(row.total, 10);
  const done = parseInt(row.done, 10);
  const failed = parseInt(row.failed, 10);

  if (total === 0 || done < total) return false;

  // 모든 에이전트 완료: 하나라도 failed면 그룹도 failed, 아니면 completed
  const groupStatus: RequestGroupStatus = failed > 0 ? "failed" : "completed";
  await updateRequestGroupStatus(groupId, groupStatus);
  return true;
}
