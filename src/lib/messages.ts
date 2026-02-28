// 에이전트 간 메시지 시스템 (PostgreSQL)

import { query, queryOne } from "./db";
import { getAgentIds } from "./agents";
import { linkAttachmentsFromContent, type Attachment } from "./attachments";

/** 허용되는 메시지 타입 */
export const VALID_MESSAGE_TYPES = ["text", "task", "result", "question", "answer"] as const;

/** 메시지 content 최대 길이 (100KB) */
export const MAX_CONTENT_LENGTH = 100_000;

/** 특수 ID (에이전트가 아닌 허용 ID) */
const SPECIAL_IDS = ["user", "broadcast"] as const;

/**
 * 유효한 에이전트/사용자 ID인지 검증
 * - "user": 대시보드 사용자
 * - agents.json에 등록된 에이전트 ID
 */
export function isValidAgentId(id: string): boolean {
  if (SPECIAL_IDS.includes(id as typeof SPECIAL_IDS[number])) return true;
  return getAgentIds().includes(id);
}

/**
 * ISO 8601 타임스탬프 형식 검증
 */
export function isValidISOTimestamp(value: string): boolean {
  const date = new Date(value);
  return !isNaN(date.getTime());
}

/**
 * UUID v4 형식 검증
 */
export function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export interface Message {
  id: string;
  from: string; // agentId or "user"
  to: string; // agentId or "broadcast"
  content: string;
  type: "text" | "task" | "result" | "question" | "answer";
  read: boolean;
  timestamp: string; // ISO timestamp from DB
  attachments?: Attachment[];
}

// DB 행 타입 정의
interface MessageRow {
  id: string;
  from_id: string;
  to_id: string;
  content: string;
  type: string;
  read: boolean;
  created_at: string;
}

// DB 행을 Message 인터페이스로 변환 (runtime validation 포함)
function toMessage(row: MessageRow): Message {
  const validTypes: readonly string[] = VALID_MESSAGE_TYPES;
  const type = validTypes.includes(row.type)
    ? (row.type as Message["type"])
    : "text"; // fallback for unknown types

  return {
    id: row.id,
    from: row.from_id,
    to: row.to_id,
    content: row.content,
    type,
    read: row.read,
    timestamp: row.created_at,
  };
}

/**
 * 메시지 전송
 * to가 "broadcast"인 경우 모든 에이전트에게 전송
 *
 * @throws {Error} 필수 필드 누락, 유효하지 않은 에이전트 ID, content 초과 등
 */
export async function sendMessage(
  msg: Omit<Message, "id" | "read" | "timestamp">
): Promise<Message> {
  // 라이브러리 레벨 방어적 검증 (API 레이어를 거치지 않는 직접 호출 대비)
  if (!msg.from || !msg.to || !msg.content || !msg.type) {
    throw new Error("sendMessage: missing required fields (from, to, content, type)");
  }

  if (!VALID_MESSAGE_TYPES.includes(msg.type)) {
    throw new Error(`sendMessage: invalid type "${msg.type}". Must be one of: ${VALID_MESSAGE_TYPES.join(", ")}`);
  }

  if (msg.content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`sendMessage: content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters`);
  }

  // 브로드캐스트와 직접 메시지 모두 동일한 INSERT 쿼리 사용
  // 브로드캐스트는 to_id = 'broadcast', 직접 메시지는 to_id = agentId
  const result = await queryOne<MessageRow>(
    `INSERT INTO messages (from_id, to_id, content, type, read)
     VALUES ($1, $2, $3, $4, FALSE)
     RETURNING id, from_id, to_id, content, type, read, created_at`,
    [msg.from, msg.to, msg.content, msg.type]
  );

  if (!result) {
    const errorMsg = msg.to === "broadcast"
      ? "Failed to insert broadcast message"
      : "Failed to insert message";
    throw new Error(errorMsg);
  }

  // Link attachments referenced in content via @file:ref_key
  await linkAttachmentsFromContent(msg.content, result.id);

  return toMessage(result);
}

/**
 * 에이전트의 메시지 조회
 * 브로드캐스트 메시지는 message_read_status 테이블로 에이전트별 읽음 상태 추적
 * @param agentId 에이전트 ID
 * @param unreadOnly 읽지 않은 메시지만 조회
 */
export async function getMessages(
  agentId: string,
  unreadOnly?: boolean
): Promise<Message[]> {
  let sql: string;

  if (unreadOnly) {
    // Unread only: direct messages with read=FALSE + broadcasts not in read_status for this agent
    sql = `SELECT m.id, m.from_id, m.to_id, m.content, m.type, m.created_at,
             CASE
               WHEN m.to_id = 'broadcast' THEN (mrs.message_id IS NOT NULL)
               ELSE m.read
             END as read
           FROM messages m
           LEFT JOIN message_read_status mrs
             ON m.id = mrs.message_id AND mrs.agent_id = $1
           WHERE (m.to_id = $1 OR m.to_id = 'broadcast')
             AND CASE
               WHEN m.to_id = 'broadcast' THEN mrs.message_id IS NULL
               ELSE m.read = FALSE
             END
           ORDER BY m.created_at ASC`;
  } else {
    // All messages: compute per-agent read status for broadcasts
    sql = `SELECT m.id, m.from_id, m.to_id, m.content, m.type, m.created_at,
             CASE
               WHEN m.to_id = 'broadcast' THEN (mrs.message_id IS NOT NULL)
               ELSE m.read
             END as read
           FROM messages m
           LEFT JOIN message_read_status mrs
             ON m.id = mrs.message_id AND mrs.agent_id = $1
           WHERE (m.to_id = $1 OR m.to_id = 'broadcast')
           ORDER BY m.created_at ASC`;
  }

  const results = await query<MessageRow>(sql, [agentId]);

  return results.map(toMessage);
}

/**
 * 메시지를 읽음으로 표시
 * 직접 메시지: messages 테이블의 read 컬럼 업데이트
 * 브로드캐스트: message_read_status 테이블에 에이전트별 읽음 기록 삽입
 */
export async function markAsRead(
  agentId: string,
  messageId: string
): Promise<boolean> {
  // First, check if this is a broadcast message
  const msg = await queryOne<{ to_id: string }>(
    `SELECT to_id FROM messages WHERE id = $1`,
    [messageId]
  );

  if (!msg) return false;

  if (msg.to_id === "broadcast") {
    // Insert per-agent read status (ON CONFLICT for idempotency)
    await queryOne(
      `INSERT INTO message_read_status (message_id, agent_id)
       VALUES ($1, $2)
       ON CONFLICT (message_id, agent_id) DO NOTHING
       RETURNING message_id`,
      [messageId, agentId]
    );
    return true;
  } else {
    // Direct message: update the read flag if it belongs to this agent
    const result = await queryOne<{ count: number }>(
      `UPDATE messages
       SET read = TRUE
       WHERE id = $1 AND to_id = $2
       RETURNING 1 as count`,
      [messageId, agentId]
    );
    return result !== null;
  }
}

/**
 * 두 에이전트 간 대화 조회
 * @param agent1 첫 번째 에이전트 ID
 * @param agent2 두 번째 에이전트 ID
 * @param limit 최대 조회 개수 (기본값: 50)
 * @param since ISO timestamp — 이 시간 이후의 메시지만 조회 (증분 fetch)
 */
export async function getConversation(
  agent1: string,
  agent2: string,
  limit: number = 50,
  since?: string
): Promise<Message[]> {
  let sql: string;
  let params: (string | number)[];

  if (since) {
    sql = `SELECT id, from_id, to_id, content, type, read, created_at
           FROM messages
           WHERE ((from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1))
             AND created_at > $3
           ORDER BY created_at ASC
           LIMIT $4`;
    params = [agent1, agent2, since, limit];
  } else {
    sql = `SELECT id, from_id, to_id, content, type, read, created_at
           FROM messages
           WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)
           ORDER BY created_at DESC
           LIMIT $3`;
    params = [agent1, agent2, limit];
  }

  const results = await query<MessageRow>(sql, params);

  // since 쿼리는 이미 ASC, 전체 쿼리는 DESC이므로 reverse 필요
  const messages = since ? results.map(toMessage) : results.reverse().map(toMessage);

  // Batch load attachments for messages that reference files (single query instead of N+1)
  const messageIdsWithFiles = messages
    .filter((msg) => msg.content.includes("@file:"))
    .map((msg) => msg.id);

  if (messageIdsWithFiles.length > 0) {
    const attachmentRows = await query<AttachmentRow>(
      `SELECT id, message_id, original_filename, mime_type, size_bytes, storage_key, ref_key, created_at
       FROM attachments
       WHERE message_id = ANY($1)
       ORDER BY created_at ASC`,
      [messageIdsWithFiles]
    );

    // Group attachments by message_id
    const attachmentsByMessage = new Map<string, Attachment[]>();
    for (const row of attachmentRows) {
      if (!row.message_id) continue;
      const mapped = mapAttachmentRow(row);
      const list = attachmentsByMessage.get(row.message_id) || [];
      list.push(mapped);
      attachmentsByMessage.set(row.message_id, list);
    }

    // Assign to messages
    for (const msg of messages) {
      const atts = attachmentsByMessage.get(msg.id);
      if (atts && atts.length > 0) {
        (msg as Message).attachments = atts;
      }
    }
  }

  return messages;
}

/**
 * 읽지 않은 메시지 개수 조회
 * 직접 메시지: read = FALSE 카운트
 * 브로드캐스트: message_read_status에 없는 메시지 카운트
 */
export async function getUnreadCount(agentId: string): Promise<number> {
  const result = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM messages m
     LEFT JOIN message_read_status mrs
       ON m.id = mrs.message_id AND mrs.agent_id = $1
     WHERE (m.to_id = $1 OR m.to_id = 'broadcast')
       AND CASE
         WHEN m.to_id = 'broadcast' THEN mrs.message_id IS NULL
         ELSE m.read = FALSE
       END`,
    [agentId]
  );

  return result ? parseInt(result.count, 10) || 0 : 0;
}

/**
 * 모든 에이전트의 최신 메시지 및 읽지 않은 개수 조회
 * 단일 쿼리로 효율적으로 처리 (N+1 쿼리 문제 해결)
 */
export async function getAllAgentsOverview(): Promise<
  Record<string, { unread: number; latest?: Message }>
> {
  const agentIds = getAgentIds();

  // Single query: for each agent, get unread count and latest message
  // For broadcasts, compute per-agent read status via message_read_status
  // FIXED: Latest message read status must also consider broadcast read status
  const rows = await query<{
    agent_id: string;
    unread_count: string;
    latest_id: string | null;
    latest_from_id: string | null;
    latest_to_id: string | null;
    latest_content: string | null;
    latest_type: string | null;
    latest_read: boolean | null;
    latest_created_at: string | null;
  }>(
    `SELECT
       a.agent_id,
       COALESCE(uc.unread_count, 0) as unread_count,
       lm.id as latest_id,
       lm.from_id as latest_from_id,
       lm.to_id as latest_to_id,
       lm.content as latest_content,
       lm.type as latest_type,
       CASE
         WHEN lm.to_id = 'broadcast' THEN (lm_mrs.message_id IS NOT NULL)
         WHEN lm.to_id = a.agent_id THEN COALESCE(lm.read, FALSE)
         ELSE FALSE
       END as latest_read,
       lm.created_at as latest_created_at
     FROM unnest($1::text[]) AS a(agent_id)
     LEFT JOIN LATERAL (
       SELECT COUNT(*) as unread_count
       FROM messages m
       LEFT JOIN message_read_status mrs
         ON m.id = mrs.message_id AND mrs.agent_id = a.agent_id
       WHERE (m.to_id = a.agent_id OR m.to_id = 'broadcast')
         AND CASE
           WHEN m.to_id = 'broadcast' THEN mrs.message_id IS NULL
           ELSE m.read = FALSE
         END
     ) uc ON true
     LEFT JOIN LATERAL (
       SELECT id, from_id, to_id, content, type, read, created_at
       FROM messages
       WHERE (to_id = a.agent_id OR to_id = 'broadcast')
         AND from_id != a.agent_id
       ORDER BY created_at DESC
       LIMIT 1
     ) lm ON true
     LEFT JOIN message_read_status lm_mrs
       ON lm.id = lm_mrs.message_id AND lm_mrs.agent_id = a.agent_id
       AND lm.to_id = 'broadcast'`,
    [agentIds]
  );

  const overview: Record<string, { unread: number; latest?: Message }> = {};

  // Initialize all agents (in case some have no rows)
  for (const agentId of agentIds) {
    overview[agentId] = { unread: 0 };
  }

  for (const row of rows) {
    const latest = row.latest_id
      ? toMessage({
          id: row.latest_id,
          from_id: row.latest_from_id!,
          to_id: row.latest_to_id!,
          content: row.latest_content!,
          type: row.latest_type!,
          read: row.latest_read!,
          created_at: row.latest_created_at!,
        })
      : undefined;

    overview[row.agent_id] = {
      unread: parseInt(row.unread_count, 10) || 0,
      latest,
    };
  }

  return overview;
}

// ===== Internal Types for Batch Attachment Loading =====

interface AttachmentRow {
  id: string;
  message_id: string | null;
  original_filename: string;
  mime_type: string;
  size_bytes: string;
  storage_key: string;
  ref_key: string;
  created_at: string;
}

function mapAttachmentRow(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    messageId: row.message_id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: parseInt(row.size_bytes, 10),
    storageKey: row.storage_key,
    refKey: row.ref_key,
    createdAt: row.created_at,
  };
}
