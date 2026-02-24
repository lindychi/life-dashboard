// Agent별 이벤트 타임라인 저장 (PostgreSQL)

import { query, queryOne } from "./db";

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
  // 단일 쿼리로 그룹 요약 + 엔트리를 함께 조회 (N+1 문제 해결)
  const allEntries = await query<HistoryEntry & {
    total_count: string;
    completed_count: string;
    failed_count: string;
    in_progress_count: string;
    group_started_at: string;
    group_last_activity_at: string;
    group_title: string;
  }>(
    `WITH group_summary AS (
       SELECT
         request_group_id,
         MAX(request_title) as group_title,
         COUNT(*) as total_count,
         COUNT(*) FILTER (WHERE type = 'task_completed') as completed_count,
         COUNT(*) FILTER (WHERE type = 'task_failed') as failed_count,
         GREATEST(0, COUNT(*) FILTER (WHERE type = 'task_started') - COUNT(*) FILTER (WHERE type = 'task_completed') - COUNT(*) FILTER (WHERE type = 'task_failed')) as in_progress_count,
         MIN(created_at) as group_started_at,
         MAX(created_at) as group_last_activity_at
       FROM agent_history
       WHERE request_group_id IS NOT NULL
       GROUP BY request_group_id
       ORDER BY MAX(created_at) DESC
       LIMIT $1
     )
     SELECT
       h.id, h.agent_id as "agentId", h.type, h.content, h.metadata,
       h.created_at as timestamp,
       h.request_group_id as "requestGroupId",
       h.request_title as "requestTitle",
       gs.total_count, gs.completed_count, gs.failed_count,
       gs.in_progress_count, gs.group_started_at, gs.group_last_activity_at,
       gs.group_title
     FROM agent_history h
     INNER JOIN group_summary gs ON h.request_group_id = gs.request_group_id
     ORDER BY gs.group_last_activity_at DESC, h.created_at ASC`,
    [limit]
  );

  // 애플리케이션 레벨에서 그룹화
  const groupMap = new Map<string, GroupedHistoryEntry>();
  for (const row of allEntries) {
    const groupId = row.requestGroupId!;
    if (!groupMap.has(groupId)) {
      groupMap.set(groupId, {
        requestGroupId: groupId,
        requestTitle: row.group_title || '제목 없음',
        totalCount: parseInt(row.total_count, 10),
        completedCount: parseInt(row.completed_count, 10),
        failedCount: parseInt(row.failed_count, 10),
        inProgressCount: parseInt(row.in_progress_count, 10),
        startedAt: row.group_started_at,
        lastActivityAt: row.group_last_activity_at,
        entries: [],
      });
    }
    groupMap.get(groupId)!.entries.push({
      id: row.id,
      agentId: row.agentId,
      type: row.type as HistoryEntry["type"],
      content: row.content,
      metadata: row.metadata,
      timestamp: row.timestamp,
      requestGroupId: row.requestGroupId,
      requestTitle: row.requestTitle,
    });
  }

  return Array.from(groupMap.values());
}

/**
 * 특정 히스토리 항목의 상세 정보 조회 (전체 output 포함)
 */
export interface HistoryDetailResponse {
  entry: HistoryEntry;
  /** content가 잘린 경우 전체 길이 */
  contentTotalLength: number;
  /** 현재 반환된 content의 시작 offset */
  contentOffset: number;
  /** 더 읽을 content가 남아있는지 */
  hasMoreContent: boolean;
  /** 같은 request group 내의 이웃 항목들 (context) */
  neighbors: HistoryEntry[];
}

export async function getHistoryDetail(
  entryId: string,
  options?: {
    /** content 시작 offset (characters). 기본값 0 */
    contentOffset?: number;
    /** content 최대 길이 (characters). 기본값 전체, 0이면 전체 */
    contentLimit?: number;
    /** 같은 request group의 이웃 항목 포함 여부. 기본값 true */
    includeNeighbors?: boolean;
  }
): Promise<HistoryDetailResponse | null> {
  const contentOffset = options?.contentOffset ?? 0;
  const contentLimit = options?.contentLimit ?? 0; // 0 = 전체
  const includeNeighbors = options?.includeNeighbors ?? true;

  // content를 SUBSTRING으로 잘라서 반환 + 전체 길이 포함
  const useSubstring = contentLimit > 0;

  const row = useSubstring
    ? await queryOne<HistoryEntry & { content_total_length: string }>(
        `SELECT id, agent_id as "agentId", type,
                SUBSTRING(content FROM $2 FOR $3) as content,
                metadata, created_at as timestamp,
                request_group_id as "requestGroupId",
                request_title as "requestTitle",
                LENGTH(content) as content_total_length
         FROM agent_history
         WHERE id = $1`,
        [entryId, contentOffset + 1, contentLimit]
      )
    : await queryOne<HistoryEntry & { content_total_length: string }>(
        `SELECT id, agent_id as "agentId", type, content, metadata,
                created_at as timestamp,
                request_group_id as "requestGroupId",
                request_title as "requestTitle",
                LENGTH(content) as content_total_length
         FROM agent_history
         WHERE id = $1`,
        [entryId]
      );

  if (!row) return null;

  const contentTotalLength = parseInt(row.content_total_length, 10);
  const returnedContentLength = row.content?.length ?? 0;
  const hasMoreContent = useSubstring
    ? contentOffset + returnedContentLength < contentTotalLength
    : false;

  // 같은 request group의 이웃 항목 조회 (현재 항목 제외, output 타입은 content 잘라서)
  let neighbors: HistoryEntry[] = [];
  if (includeNeighbors && row.requestGroupId) {
    neighbors = await query<HistoryEntry>(
      `SELECT id, agent_id as "agentId", type,
              CASE WHEN LENGTH(content) > 500
                   THEN SUBSTRING(content FROM 1 FOR 500) || '...[truncated]'
                   ELSE content
              END as content,
              metadata, created_at as timestamp,
              request_group_id as "requestGroupId",
              request_title as "requestTitle"
       FROM agent_history
       WHERE request_group_id = $1 AND id != $2
       ORDER BY created_at ASC
       LIMIT 50`,
      [row.requestGroupId, entryId]
    );
  }

  const entry: HistoryEntry = {
    id: row.id,
    agentId: row.agentId,
    type: row.type as HistoryEntry["type"],
    content: row.content,
    metadata: row.metadata,
    timestamp: row.timestamp,
    requestGroupId: row.requestGroupId,
    requestTitle: row.requestTitle,
  };

  return {
    entry,
    contentTotalLength,
    contentOffset,
    hasMoreContent,
    neighbors,
  };
}

/**
 * 필터링 + 커서 기반 페이지네이션을 지원하는 타임라인 히스토리 조회
 */
export interface TimelineFilters {
  agentId?: string;
  types?: string[];
  search?: string;
  dateFrom?: string;  // ISO string
  dateTo?: string;    // ISO string
  excludeTypes?: string[];  // 기본 숨김 타입 (예: output)
  requestGroupId?: string;  // 특정 요청 그룹 필터링
  cursor?: string;    // ISO timestamp cursor for pagination
  limit?: number;
}

export interface TimelineResponse {
  entries: HistoryEntry[];
  nextCursor: string | null;
  totalCount: number;
  hasMore: boolean;
}

export async function getFilteredHistory(
  filters: TimelineFilters
): Promise<TimelineResponse> {
  const limit = filters.limit || 50;
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters.agentId) {
    conditions.push(`agent_id = $${paramIndex++}`);
    params.push(filters.agentId);
  }

  if (filters.types && filters.types.length > 0) {
    conditions.push(`type = ANY($${paramIndex++})`);
    params.push(filters.types);
  }

  if (filters.excludeTypes && filters.excludeTypes.length > 0) {
    conditions.push(`type != ALL($${paramIndex++})`);
    params.push(filters.excludeTypes);
  }

  if (filters.search) {
    conditions.push(`content ILIKE $${paramIndex++}`);
    params.push(`%${filters.search}%`);
  }

  if (filters.requestGroupId) {
    conditions.push(`request_group_id = $${paramIndex++}`);
    params.push(filters.requestGroupId);
  }

  if (filters.dateFrom) {
    conditions.push(`created_at >= $${paramIndex++}`);
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    conditions.push(`created_at <= $${paramIndex++}`);
    params.push(filters.dateTo);
  }

  // Save count query params before adding cursor condition
  const countConditions = [...conditions];
  const countParams = [...params];

  // Add cursor condition (excluded from count query)
  if (filters.cursor) {
    // Composite cursor: "timestamp|id" for stable pagination with duplicate timestamps
    const [cursorTimestamp, cursorId] = filters.cursor.includes("|")
      ? filters.cursor.split("|", 2)
      : [filters.cursor, null];

    if (cursorId) {
      conditions.push(`(created_at, id) < ($${paramIndex++}, $${paramIndex++})`);
      params.push(cursorTimestamp, cursorId);
    } else {
      // Backward compatible: plain timestamp cursor
      conditions.push(`created_at < $${paramIndex++}`);
      params.push(cursorTimestamp);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countWhere = countConditions.length > 0 ? `WHERE ${countConditions.join(' AND ')}` : '';

  const [countResult, entries] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(*) as count FROM agent_history ${countWhere}`,
      countParams
    ),
    query<HistoryEntry>(
      `SELECT id, agent_id as "agentId", type, content, metadata, created_at as timestamp,
              request_group_id as "requestGroupId", request_title as "requestTitle"
       FROM agent_history
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${paramIndex}`,
      [...params, limit + 1]
    ),
  ]);

  const totalCount = parseInt(countResult[0]?.count || '0', 10);
  const hasMore = entries.length > limit;
  const resultEntries = hasMore ? entries.slice(0, limit) : entries;
  const lastEntry = resultEntries[resultEntries.length - 1];
  const nextCursor = hasMore && lastEntry ? `${lastEntry.timestamp}|${lastEntry.id}` : null;

  return {
    entries: resultEntries,
    nextCursor,
    totalCount,
    hasMore,
  };
}
