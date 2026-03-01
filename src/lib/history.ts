// Agent별 이벤트 타임라인 저장 (PostgreSQL)

import { query, queryOne } from "./db";
import { generateRequestTitle } from "./request-group";
import { escapeIlike } from "./sql-utils";

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
    | "output"
    | "gateway_restart";
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
  entry: Omit<HistoryEntry, "id" | "timestamp" | "agentId">
): Promise<HistoryEntry> {
  // requestTitle이 없으면 content 기반으로 요약 제목을 자동 생성
  const requestTitle = entry.requestTitle || (entry.content ? generateRequestTitle(entry.content) : null);

  const rows = await query<HistoryEntry>(
    `INSERT INTO agent_history (agent_id, type, content, metadata, request_group_id, request_title)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, agent_id as "agentId", type, content, metadata, created_at as timestamp,
               request_group_id as "requestGroupId", request_title as "requestTitle"`,
    [agentId, entry.type, entry.content, entry.metadata || null, entry.requestGroupId || null, requestTitle]
  );
  return rows[0];
}

/**
 * 특정 에이전트의 히스토리 조회
 * 최적화: 안전한 limit + 네이티브 정렬 (reverse 제거)
 */
export async function getAgentHistory(
  agentId: string,
  limit: number = 50
): Promise<HistoryEntry[]> {
  const safeLimit = Math.max(1, Math.min(500, limit));
  const rows = await query<HistoryEntry>(
    `SELECT id, agent_id as "agentId", type, content, metadata, created_at as timestamp,
            request_group_id as "requestGroupId", request_title as "requestTitle"
     FROM agent_history
     WHERE agent_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [agentId, safeLimit]
  );
  return rows.reverse(); // Return in chronological order (oldest to newest)
}

/**
 * 모든 에이전트의 히스토리 조회
 * 최적화: ROW_NUMBER() WINDOW 함수로 에이전트별 최신 항목만 선택
 */
export async function getAllHistory(
  limit: number = 50
): Promise<Record<string, HistoryEntry[]>> {
  const safeLimit = Math.max(1, Math.min(500, limit));
  const rows = await query<HistoryEntry>(
    `SELECT id, agent_id as "agentId", type, content, metadata, created_at as timestamp,
            request_group_id as "requestGroupId", request_title as "requestTitle"
     FROM (
       SELECT *,
              ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY created_at DESC) as rn
       FROM agent_history
     ) ranked
     WHERE rn <= $1
     ORDER BY agent_id, created_at ASC`,
    [safeLimit]
  );

  // Single pass grouping
  const result: Record<string, HistoryEntry[]> = {};
  for (const entry of rows) {
    if (!result[entry.agentId]) {
      result[entry.agentId] = [];
    }
    result[entry.agentId].push(entry);
  }
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
 * 최적화: 단일 쿼리로 그룹과 엔트리를 함께 조회 (N+1 문제 해결)
 */
export async function getGroupedHistory(
  limit: number = 20,
  filters?: {
    agentId?: string;
  }
): Promise<GroupedHistoryEntry[]> {
  // Safe limit
  const safeLim = Math.max(1, Math.min(100, limit));
  const agentId = filters?.agentId;

  const params: unknown[] = [safeLim];
  const agentFilter = agentId ? 'AND agent_id = $2' : '';
  if (agentId) {
    params.push(agentId);
  }

  // Single query retrieves groups + all their entries in correct order
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
       WHERE request_group_id IS NOT NULL ${agentFilter}
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
     ${agentId ? 'WHERE h.agent_id = $2' : ''}
     ORDER BY gs.group_last_activity_at DESC, h.created_at ASC`,
    params
  );

  // Application-level grouping (single pass, no redundant operations)
  const groupMap = new Map<string, GroupedHistoryEntry>();
  for (const row of allEntries) {
    const groupId = row.requestGroupId!;

    // Lazy initialize group metadata
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

    // Append entry
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
 * 최적화: 선택적 SUBSTRING 및 이웃 항목 조회
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
  const contentOffset = Math.max(0, options?.contentOffset ?? 0);
  const contentLimit = Math.max(0, options?.contentLimit ?? 0); // 0 = 전체
  const includeNeighbors = options?.includeNeighbors !== false;

  // Use SUBSTRING only if contentLimit > 0 (optimization)
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
  const hasMoreContent = useSubstring && contentOffset + returnedContentLength < contentTotalLength;

  // Fetch neighbors in parallel if needed
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
 * 최적화: 동적 WHERE 절 구성 + 안전한 커서 페이지네이션
 */
export interface TimelineFilters {
  agentId?: string;
  types?: string[];
  search?: string;
  dateFrom?: string;  // ISO string
  dateTo?: string;    // ISO string
  excludeTypes?: string[];  // 기본 숨김 타입 (예: output)
  requestGroupId?: string;  // 특정 요청 그룹 필터링
  cursor?: string;    // ISO timestamp cursor for pagination (format: "timestamp|id")
  limit?: number;
}

export interface TimelineResponse {
  entries: HistoryEntry[];
  nextCursor: string | null;
  totalCount: number;
  hasMore: boolean;
}

/**
 * Parse composite cursor (format: "timestamp|id")
 * @param cursor Cursor string or null
 * @returns {timestamp, id} or null
 */
function parseCursor(cursor: string | undefined): { timestamp: string; id: string } | null {
  if (!cursor) return null;
  const parts = cursor.split('|', 2);
  if (parts.length !== 2) return null;
  return { timestamp: parts[0], id: parts[1] };
}

/**
 * Generate composite cursor for pagination
 * @param entry Last entry in result set
 * @returns Composite cursor string or null
 */
function generateCursor(entry: HistoryEntry | null): string | null {
  if (!entry) return null;
  return `${entry.timestamp}|${entry.id}`;
}

export async function getFilteredHistory(
  filters: TimelineFilters
): Promise<TimelineResponse> {
  const limit = Math.max(1, Math.min(100, filters.limit || 50));
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Build WHERE clause dynamically
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
    params.push(`%${escapeIlike(filters.search)}%`);
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
  const cursorData = parseCursor(filters.cursor);
  if (cursorData) {
    conditions.push(`(created_at, id) < ($${paramIndex++}, $${paramIndex++})`);
    params.push(cursorData.timestamp, cursorData.id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countWhere = countConditions.length > 0 ? `WHERE ${countConditions.join(' AND ')}` : '';

  // Execute count and entries queries in parallel
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
  const lastEntry = resultEntries[resultEntries.length - 1] || null;
  const nextCursor = hasMore ? generateCursor(lastEntry) : null;

  return {
    entries: resultEntries,
    nextCursor,
    totalCount,
    hasMore,
  };
}

/**
 * 미완료 작업 조회 (task_started이지만 task_completed가 없는 작업들)
 * 최적화: 단일 SQL 쿼리 + O(1) 상태 계산
 */
export interface IncompleteTaskGroup {
  requestGroupId: string | null;
  requestTitle: string | null;
  agentId: string;
  startedAt: string;
  lastActivityAt: string;
  startedCount: number;
  completedCount: number;
  failedCount: number;
  durationMinutes: number;
  durationHours: number;
  status: 'in_progress' | 'abandoned';
}

export interface IncompleteTasksSummary {
  totalCount: number;
  recentCount: number;
  abandonedCount: number;
  byAgent: Record<string, number>;
  tasks: IncompleteTaskGroup[];
}

/**
 * Calculate task duration in minutes and hours
 * @param startTime ISO string
 * @param endTime ISO string
 * @returns {durationMinutes, durationHours}
 */
function calculateDuration(startTime: string, endTime: string): { durationMinutes: number; durationHours: number } {
  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  const durationMs = endDate.getTime() - startDate.getTime();
  const durationMinutes = Math.floor(durationMs / (1000 * 60));
  const durationHours = Math.floor(durationMinutes / 60);
  return { durationMinutes, durationHours };
}

/**
 * Determine task status based on last activity time
 * @param lastActivityTime ISO string
 * @param referenceTime Date object (default: now)
 * @returns 'abandoned' if no activity for 24+ hours, else 'in_progress'
 */
function determineStatus(lastActivityTime: string, referenceTime: Date = new Date()): 'in_progress' | 'abandoned' {
  const lastDate = new Date(lastActivityTime);
  const hoursStale = (referenceTime.getTime() - lastDate.getTime()) / (1000 * 60 * 60);
  return hoursStale > 24 ? 'abandoned' : 'in_progress';
}

export async function getIncompleteTasks(
  filters?: {
    days?: number;
    agentId?: string;
    status?: 'in_progress' | 'abandoned';
    limit?: number;
  }
): Promise<IncompleteTasksSummary> {
  const days = Math.max(1, Math.min(365, filters?.days || 7));
  const agentId = filters?.agentId;
  const statusFilter = filters?.status;
  const limit = Math.max(1, Math.min(100, filters?.limit || 50));

  // Build parameterized WHERE clause
  const params: unknown[] = [days];
  const conditions: string[] = [
    `ah.type IN ('task_started', 'task_completed', 'task_failed')`,
    `ah.created_at >= NOW() - ($1 * INTERVAL '1 day')`,
  ];

  if (agentId) {
    conditions.push(`ah.agent_id = $${params.length + 1}`);
    params.push(agentId);
  }

  const whereClause = conditions.join(' AND ');

  // Single optimized query to get all incomplete tasks with aggregate info
  const results = await query<{
    request_group_id: string | null;
    request_title: string | null;
    agent_id: string;
    min_created_at: string;
    max_created_at: string;
    started_count: string;
    completed_count: string;
    failed_count: string;
  }>(
    `
    WITH task_analysis AS (
      SELECT
        request_group_id,
        MAX(request_title) as request_title,
        agent_id,
        MIN(created_at) as min_created_at,
        MAX(created_at) as max_created_at,
        COUNT(*) FILTER (WHERE type = 'task_started') as started_count,
        COUNT(*) FILTER (WHERE type = 'task_completed') as completed_count,
        COUNT(*) FILTER (WHERE type = 'task_failed') as failed_count
      FROM agent_history
      WHERE ${whereClause}
      GROUP BY request_group_id, agent_id
      HAVING COUNT(*) FILTER (WHERE type = 'task_started') > 0
        AND COUNT(*) FILTER (WHERE type = 'task_completed') = 0
        AND COUNT(*) FILTER (WHERE type = 'task_failed') = 0
    )
    SELECT *
    FROM task_analysis
    ORDER BY max_created_at DESC
    LIMIT $${params.length + 1}
    `,
    [...params, limit]
  );

  // Build tasks and statistics in single pass
  const tasks: IncompleteTaskGroup[] = [];
  const byAgentMap = new Map<string, number>();
  const referenceTime = new Date();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  let recentCount = 0;
  let abandonedCount = 0;

  for (const row of results) {
    const { durationMinutes, durationHours } = calculateDuration(row.min_created_at, row.max_created_at);
    const status = determineStatus(row.max_created_at, referenceTime);

    // Apply status filter
    if (statusFilter && status !== statusFilter) {
      continue;
    }

    const task: IncompleteTaskGroup = {
      requestGroupId: row.request_group_id,
      requestTitle: row.request_title,
      agentId: row.agent_id,
      startedAt: row.min_created_at,
      lastActivityAt: row.max_created_at,
      startedCount: parseInt(row.started_count, 10),
      completedCount: parseInt(row.completed_count, 10),
      failedCount: parseInt(row.failed_count, 10),
      durationMinutes,
      durationHours,
      status,
    };

    tasks.push(task);
    byAgentMap.set(row.agent_id, (byAgentMap.get(row.agent_id) || 0) + 1);

    // Count recent and abandoned in single pass
    if (new Date(task.startedAt) >= cutoffDate) {
      recentCount++;
    }
    if (status === 'abandoned') {
      abandonedCount++;
    }
  }

  // Convert byAgent map to object
  const byAgentObj: Record<string, number> = {};
  byAgentMap.forEach((count, agent) => {
    byAgentObj[agent] = count;
  });

  return {
    totalCount: tasks.length,
    recentCount,
    abandonedCount,
    byAgent: byAgentObj,
    tasks,
  };
}
