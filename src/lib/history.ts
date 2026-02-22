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
}

/**
 * 히스토리 엔트리 추가
 */
export async function addHistoryEntry(
  agentId: string,
  entry: Omit<HistoryEntry, "id" | "timestamp">
): Promise<HistoryEntry> {
  const rows = await query<HistoryEntry>(
    `INSERT INTO agent_history (agent_id, type, content, metadata)
     VALUES ($1, $2, $3, $4)
     RETURNING id, agent_id as "agentId", type, content, metadata, created_at as timestamp`,
    [agentId, entry.type, entry.content, entry.metadata || null]
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
    `SELECT id, agent_id as "agentId", type, content, metadata, created_at as timestamp
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
    `SELECT id, agent_id as "agentId", type, content, metadata, created_at as timestamp
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
