// Agent별 이벤트 타임라인 저장 (PostgreSQL)

import { query } from "./db";

export interface HistoryEntry {
  id: string;
  agentId: string;
  type:
    | "task_started"
    | "task_completed"
    | "task_failed"
    | "message_sent"
    | "message_received"
    | "status_change"
    | "command_received"
    | "output";
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: string; // ISO string from PostgreSQL TIMESTAMPTZ
  requestGroupId?: string;
  requestTitle?: string;
}

/**
 * 히스토리 엔트리 추가
 */
export async function addHistoryEntry(
  agentId: string,
  entry: Omit<HistoryEntry, "id" | "timestamp">
): Promise<HistoryEntry> {
  const rows = await query<HistoryEntry>(
    `INSERT INTO agent_history (agent_id, type, content, metadata, request_group_id, request_title)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, agent_id as "agentId", type, content, metadata, created_at as timestamp,
               request_group_id as "requestGroupId", request_title as "requestTitle"`,
    [agentId, entry.type, entry.content, entry.metadata || null, entry.requestGroupId || null, entry.requestTitle || null]
  );
  return rows[0];
}

/**
 * 특정 에이전트의 히스토리 조회
 */
export async function getAgentHistory(
  agentId: string,
  limit: number = 50
): Promise<HistoryEntry[]> {
  const rows = await query<HistoryEntry>(
    `SELECT id, agent_id as "agentId", type, content, metadata, created_at as timestamp,
            request_group_id as "requestGroupId", request_title as "requestTitle"
     FROM agent_history
     WHERE agent_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [agentId, limit]
  );
  return rows.reverse(); // Return in chronological order (oldest to newest)
}

/**
 * 모든 에이전트의 히스토리 조회
 */
export async function getAllHistory(
  limit: number = 50
): Promise<Record<string, HistoryEntry[]>> {
  const rows = await query<HistoryEntry>(
    `SELECT id, agent_id as "agentId", type, content, metadata, created_at as timestamp,
            request_group_id as "requestGroupId", request_title as "requestTitle"
     FROM agent_history
     WHERE id IN (
       SELECT id FROM (
         SELECT id, agent_id,
                ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY created_at DESC) as rn
         FROM agent_history
       ) ranked
       WHERE rn <= $1
     )
     ORDER BY agent_id, created_at ASC`,
    [limit]
  );

  const result: Record<string, HistoryEntry[]> = {};
  rows.forEach((entry) => {
    if (!result[entry.agentId]) {
      result[entry.agentId] = [];
    }
    result[entry.agentId].push(entry);
  });
  return result;
}

/**
 * 특정 에이전트의 히스토리 삭제
 */
export async function clearAgentHistory(agentId: string): Promise<void> {
  await query(
    `DELETE FROM agent_history WHERE agent_id = $1`,
    [agentId]
  );
}

/**
 * 요청 그룹별 히스토리 인터페이스
 */
export interface GroupedHistoryEntry {
  requestGroupId: string;
  requestTitle: string;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  inProgressCount: number;
  startedAt: string;
  lastActivityAt: string;
  entries: HistoryEntry[];
}

/**
 * 요청 그룹별로 그룹화된 히스토리 조회
 */
export async function getGroupedHistory(
  limit: number = 20
): Promise<GroupedHistoryEntry[]> {
  // 그룹별 요약 통계 조회
  const groups = await query<{
    request_group_id: string;
    request_title: string;
    total_count: string;
    completed_count: string;
    failed_count: string;
    in_progress_count: string;
    started_at: string;
    last_activity_at: string;
  }>(
    `SELECT
       request_group_id,
       MAX(request_title) as request_title,
       COUNT(*) as total_count,
       COUNT(*) FILTER (WHERE type = 'task_completed') as completed_count,
       COUNT(*) FILTER (WHERE type = 'task_failed') as failed_count,
       COUNT(*) FILTER (WHERE type = 'task_started') as in_progress_count,
       MIN(created_at) as started_at,
       MAX(created_at) as last_activity_at
     FROM agent_history
     WHERE request_group_id IS NOT NULL
     GROUP BY request_group_id
     ORDER BY MAX(created_at) DESC
     LIMIT $1`,
    [limit]
  );

  // 각 그룹의 엔트리 조회
  const result: GroupedHistoryEntry[] = [];
  for (const group of groups) {
    const entries = await query<HistoryEntry>(
      `SELECT id, agent_id as "agentId", type, content, metadata, created_at as timestamp,
              request_group_id as "requestGroupId", request_title as "requestTitle"
       FROM agent_history
       WHERE request_group_id = $1
       ORDER BY created_at ASC`,
      [group.request_group_id]
    );

    result.push({
      requestGroupId: group.request_group_id,
      requestTitle: group.request_title || '제목 없음',
      totalCount: parseInt(group.total_count, 10),
      completedCount: parseInt(group.completed_count, 10),
      failedCount: parseInt(group.failed_count, 10),
      inProgressCount: parseInt(group.in_progress_count, 10),
      startedAt: group.started_at,
      lastActivityAt: group.last_activity_at,
      entries,
    });
  }

  return result;
}
