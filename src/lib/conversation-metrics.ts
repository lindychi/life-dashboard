// 대화 세션 메트릭 수집 시스템

import { query, queryOne } from "./db";

/**
 * 세션 메트릭 인터페이스
 */
export interface SessionMetrics {
  total: number;
  active: number;
  archived: number;
  completed: number;
  completionRate: number;
  avgDurationHours: number;
}

/**
 * 메시지 메트릭 인터페이스
 */
export interface MessageMetrics {
  total: number;
  perSession: number;
  unreadCount: number;
  unreadRate: number;
  insertionRatePerHour: number;
  avgLength: number;
}

/**
 * 성능 메트릭 인터페이스
 */
export interface PerformanceMetrics {
  avgQueryTimeMs: number;
  p95QueryTimeMs: number;
  tableSizeMb: number;
  indexSizeMb: number;
  deadTuplesCount: number;
  lastVacuumAt?: string;
}

/**
 * 참여자별 메트릭 인터페이스
 */
export interface ParticipantMetrics {
  agentId: string;
  sessionsCreated: number;
  messagesPosted: number;
  avgResponseTimeSeconds: number;
  unreadCountByAgent: number;
}

/**
 * 통합 메트릭 인터페이스
 */
export interface ConversationMetrics {
  timestamp: string;
  sessions: SessionMetrics;
  messages: MessageMetrics;
  performance: PerformanceMetrics;
  participants: ParticipantMetrics[];
  health: {
    isHealthy: boolean;
    warnings: string[];
    criticalIssues: string[];
  };
}

// ===== DB 행 타입 =====

interface SessionStatsRow {
  total: number;
  active: number;
  archived: number;
  completed: number;
  avg_duration_hours: number;
}

interface MessageStatsRow {
  total: number;
  avg_per_session: number;
  unread_count: number;
  insertion_rate_per_hour: number;
  avg_length: number;
}

interface PerformanceStatsRow {
  conversations_size_mb: number;
  messages_size_mb: number;
  total_index_size_mb: number;
  dead_tuples: number;
  last_vacuum_at: string | null;
}

interface ParticipantStatsRow {
  agent_id: string;
  sessions_created: number;
  messages_posted: number;
  avg_response_time_seconds: number;
  unread_count: number;
}

/**
 * 세션 메트릭 수집
 */
export async function collectSessionMetrics(): Promise<SessionMetrics> {
  const result = await queryOne<SessionStatsRow>(
    `SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'active') as active,
      COUNT(*) FILTER (WHERE status = 'archived') as archived,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COALESCE(
        EXTRACT(EPOCH FROM AVG(
          COALESCE(archived_at, NOW()) - created_at
        )) / 3600,
        0
      ) as avg_duration_hours
    FROM conversations`
  );

  if (!result) {
    throw new Error("Failed to collect session metrics");
  }

  const completionRate =
    result.total > 0 ? (result.completed / result.total) * 100 : 0;

  return {
    total: result.total,
    active: result.active,
    archived: result.archived,
    completed: result.completed,
    completionRate: Math.round(completionRate * 100) / 100,
    avgDurationHours: Math.round(result.avg_duration_hours * 100) / 100,
  };
}

/**
 * 메시지 메트릭 수집
 */
export async function collectMessageMetrics(): Promise<MessageMetrics> {
  const result = await queryOne<MessageStatsRow>(
    `SELECT
      COUNT(*) as total,
      COALESCE(
        COUNT(*) FILTER (WHERE conversation_id IS NOT NULL)::float /
        NULLIF((SELECT COUNT(*) FROM conversations WHERE status = 'active'), 0),
        0
      ) as avg_per_session,
      COALESCE(SUM(CASE WHEN crs.unread_count > 0 THEN 1 ELSE 0 END), 0) as unread_count,
      (SELECT COUNT(*) FROM conversation_messages
       WHERE created_at > NOW() - INTERVAL '1 hour') as insertion_rate_per_hour,
      COALESCE(AVG(LENGTH(content)), 0) as avg_length
    FROM conversation_messages cm
    LEFT JOIN conversation_read_status crs
      ON cm.conversation_id = crs.conversation_id
      AND cm.from_id != crs.agent_id`
  );

  if (!result) {
    throw new Error("Failed to collect message metrics");
  }

  const totalMessages = result.total;
  const unreadRate =
    totalMessages > 0 ? (result.unread_count / totalMessages) * 100 : 0;

  return {
    total: result.total,
    perSession: Math.round(result.avg_per_session * 100) / 100,
    unreadCount: result.unread_count,
    unreadRate: Math.round(unreadRate * 100) / 100,
    insertionRatePerHour: result.insertion_rate_per_hour,
    avgLength: Math.round(result.avg_length),
  };
}

/**
 * 성능 메트릭 수집
 */
export async function collectPerformanceMetrics(): Promise<PerformanceMetrics> {
  const result = await queryOne<PerformanceStatsRow>(
    `SELECT
      COALESCE(pg_total_relation_size('conversations') / 1024 / 1024, 0) as conversations_size_mb,
      COALESCE(pg_total_relation_size('conversation_messages') / 1024 / 1024, 0) as messages_size_mb,
      COALESCE(
        (SELECT SUM(pg_relation_size(indexrelid)) FROM pg_index
         WHERE indrelname IN (
           'idx_conversations_status',
           'idx_conversations_participants',
           'idx_conversations_created_by',
           'idx_conversation_messages_conversation',
           'idx_conversation_messages_parent',
           'idx_conversation_messages_from',
           'idx_conversation_read_status_agent'
         )) / 1024 / 1024,
        0
      ) as total_index_size_mb,
      COALESCE((SELECT SUM(n_dead_tup) FROM pg_stat_user_tables
       WHERE relname IN ('conversations', 'conversation_messages', 'conversation_read_status')), 0) as dead_tuples,
      (SELECT last_vacuum FROM pg_stat_user_tables
       WHERE relname = 'conversation_messages'
       ORDER BY last_vacuum DESC LIMIT 1)::text as last_vacuum_at
    FROM (SELECT 1) t`
  );

  if (!result) {
    throw new Error("Failed to collect performance metrics");
  }

  return {
    avgQueryTimeMs: 0, // pg_stat_statements에서 별도 계산
    p95QueryTimeMs: 0,
    tableSizeMb: Math.round((result.conversations_size_mb + result.messages_size_mb) * 100) / 100,
    indexSizeMb: Math.round(result.total_index_size_mb * 100) / 100,
    deadTuplesCount: result.dead_tuples,
    lastVacuumAt: result.last_vacuum_at || undefined,
  };
}

/**
 * 참여자별 메트릭 수집
 */
export async function collectParticipantMetrics(): Promise<ParticipantMetrics[]> {
  const results = await query<ParticipantStatsRow>(
    `SELECT
      UNNEST(participants) as agent_id,
      COUNT(DISTINCT CASE WHEN created_by = UNNEST(participants) THEN id END) as sessions_created,
      COUNT(DISTINCT cm.id) as messages_posted,
      COALESCE(
        EXTRACT(EPOCH FROM AVG(
          LEAD(cm.created_at, 1) OVER (
            PARTITION BY cm.conversation_id, cm.from_id ORDER BY cm.created_at
          ) - cm.created_at
        )),
        0
      ) as avg_response_time_seconds,
      COALESCE(SUM(crs.unread_count), 0) as unread_count
    FROM conversations c
    LEFT JOIN conversation_messages cm ON c.id = cm.conversation_id
    LEFT JOIN conversation_read_status crs ON c.id = crs.conversation_id
    GROUP BY agent_id
    ORDER BY messages_posted DESC`
  );

  return results.map((row) => ({
    agentId: row.agent_id,
    sessionsCreated: row.sessions_created,
    messagesPosted: row.messages_posted,
    avgResponseTimeSeconds:
      Math.round(Math.max(0, row.avg_response_time_seconds) * 100) / 100,
    unreadCountByAgent: row.unread_count,
  }));
}

/**
 * 건강 상태 점검 및 경고 생성
 */
export function assessHealth(metrics: Omit<ConversationMetrics, "health">): {
  isHealthy: boolean;
  warnings: string[];
  criticalIssues: string[];
} {
  const warnings: string[] = [];
  const criticalIssues: string[] = [];

  // 1. 완료율 확인
  if (metrics.sessions.completionRate < 10) {
    warnings.push(
      `Low session completion rate: ${metrics.sessions.completionRate}% (expected > 10%)`
    );
  }

  // 2. 읽지 않은 메시지 비율 확인
  if (metrics.messages.unreadRate > 50) {
    warnings.push(
      `High unread message rate: ${metrics.messages.unreadRate}% (expected < 50%)`
    );
  }

  // 3. 메시지 삽입율 확인
  if (metrics.messages.insertionRatePerHour > 1000) {
    warnings.push(
      `High message insertion rate: ${metrics.messages.insertionRatePerHour} msg/hour (expected < 1000)`
    );
  }

  // 4. 테이블 크기 확인
  if (metrics.performance.tableSizeMb > 1000) {
    warnings.push(
      `Large conversation table: ${metrics.performance.tableSizeMb}MB (expected < 1000MB)`
    );
  }

  // 5. 데드 튜플 확인
  if (metrics.performance.deadTuplesCount > 100000) {
    warnings.push(
      `High dead tuples: ${metrics.performance.deadTuplesCount} (vacuum recommended)`
    );
  }

  // 6. 인덱스 크기 확인
  if (metrics.performance.indexSizeMb > 500) {
    warnings.push(
      `Large indexes: ${metrics.performance.indexSizeMb}MB (reindex might help)`
    );
  }

  // 7. 비상 문제: 세션이 너무 많으면서 활성 세션 비율이 매우 낮음
  if (
    metrics.sessions.total > 1000 &&
    metrics.sessions.active / metrics.sessions.total < 0.1
  ) {
    criticalIssues.push(
      `Too many inactive sessions: ${metrics.sessions.active}/${metrics.sessions.total}`
    );
  }

  return {
    isHealthy: criticalIssues.length === 0,
    warnings,
    criticalIssues,
  };
}

/**
 * 통합 메트릭 수집
 */
export async function collectConversationMetrics(): Promise<ConversationMetrics> {
  const [sessions, messages, performance, participants] = await Promise.all([
    collectSessionMetrics(),
    collectMessageMetrics(),
    collectPerformanceMetrics(),
    collectParticipantMetrics(),
  ]);

  const metricsWithoutHealth = {
    timestamp: new Date().toISOString(),
    sessions,
    messages,
    performance,
    participants,
  };

  const health = assessHealth(metricsWithoutHealth);

  return {
    ...metricsWithoutHealth,
    health,
  };
}

/**
 * 메트릭 스냅샷 저장
 */
export async function saveMetricsSnapshot(
  metrics: ConversationMetrics
): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO conversation_metrics_history
     (sessions_json, messages_json, performance_json, participants_json, health_json, collected_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id`,
    [
      JSON.stringify(metrics.sessions),
      JSON.stringify(metrics.messages),
      JSON.stringify(metrics.performance),
      JSON.stringify(metrics.participants),
      JSON.stringify(metrics.health),
      metrics.timestamp,
    ]
  );

  if (!result) {
    throw new Error("Failed to save metrics snapshot");
  }

  return result.id;
}

/**
 * 메트릭 히스토리 조회 (기간별)
 */
export async function getMetricsHistory(
  hoursBack: number = 24
): Promise<ConversationMetrics[]> {
  const results = await query<{
    id: string;
    sessions_json: string;
    messages_json: string;
    performance_json: string;
    participants_json: string;
    health_json: string;
    collected_at: string;
  }>(
    `SELECT id, sessions_json, messages_json, performance_json,
            participants_json, health_json, collected_at
    FROM conversation_metrics_history
    WHERE collected_at > NOW() - INTERVAL '${hoursBack} hours'
    ORDER BY collected_at DESC`,
    []
  );

  return results.map((row) => ({
    timestamp: row.collected_at,
    sessions: JSON.parse(row.sessions_json),
    messages: JSON.parse(row.messages_json),
    performance: JSON.parse(row.performance_json),
    participants: JSON.parse(row.participants_json),
    health: JSON.parse(row.health_json),
  }));
}

/**
 * 최신 메트릭 조회
 */
export async function getLatestMetrics(): Promise<ConversationMetrics | null> {
  const result = await queryOne<{
    id: string;
    sessions_json: string;
    messages_json: string;
    performance_json: string;
    participants_json: string;
    health_json: string;
    collected_at: string;
  }>(
    `SELECT id, sessions_json, messages_json, performance_json,
            participants_json, health_json, collected_at
    FROM conversation_metrics_history
    ORDER BY collected_at DESC
    LIMIT 1`
  );

  if (!result) {
    return null;
  }

  return {
    timestamp: result.collected_at,
    sessions: JSON.parse(result.sessions_json),
    messages: JSON.parse(result.messages_json),
    performance: JSON.parse(result.performance_json),
    participants: JSON.parse(result.participants_json),
    health: JSON.parse(result.health_json),
  };
}

/**
 * 오래된 메트릭 정리 (90일 이상)
 */
export async function cleanupOldMetrics(daysOld: number = 90): Promise<number> {
  const result = await queryOne<{ count: number }>(
    `DELETE FROM conversation_metrics_history
    WHERE collected_at < NOW() - INTERVAL '${daysOld} days'
    RETURNING COUNT(*) as count`,
    []
  );

  return result?.count || 0;
}

/**
 * 메트릭 리포트 생성 (일일)
 */
export async function generateDailyReport(): Promise<{
  date: string;
  summary: string;
  metrics: ConversationMetrics;
  compareToPreviousDay: {
    sessionsChange: number;
    messagesChange: number;
    completionRateChange: number;
  };
}> {
  const today = await getLatestMetrics();
  if (!today) {
    throw new Error("No metrics available for today");
  }

  // 어제 메트릭 조회 (24-48시간 전)
  const yesterday = await queryOne<{
    sessions_json: string;
    messages_json: string;
  }>(
    `SELECT sessions_json, messages_json
    FROM conversation_metrics_history
    WHERE collected_at > NOW() - INTERVAL '48 hours'
      AND collected_at < NOW() - INTERVAL '24 hours'
    ORDER BY collected_at DESC
    LIMIT 1`
  );

  const yesterdayMetrics = yesterday
    ? {
        sessions: JSON.parse(yesterday.sessions_json),
        messages: JSON.parse(yesterday.messages_json),
      }
    : null;

  return {
    date: new Date().toISOString().split("T")[0],
    summary: `Conversation Sessions Report - ${today.health.isHealthy ? "✓ Healthy" : "⚠ Warning"}`,
    metrics: today,
    compareToPreviousDay: {
      sessionsChange: yesterdayMetrics
        ? today.sessions.total - yesterdayMetrics.sessions.total
        : 0,
      messagesChange: yesterdayMetrics
        ? today.messages.total - yesterdayMetrics.messages.total
        : 0,
      completionRateChange: yesterdayMetrics
        ? today.sessions.completionRate - yesterdayMetrics.sessions.completionRate
        : 0,
    },
  };
}
