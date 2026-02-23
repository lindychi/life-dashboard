// 에이전트 간 메시지 시스템 (PostgreSQL)

import { query, queryOne } from "./db";
import { getAgentIds } from "./agents";
import { linkAttachmentsFromContent, getMessageAttachments, type Attachment } from "./attachments";

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

// DB 행을 Message 인터페이스로 변환
function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    from: row.from_id,
    to: row.to_id,
    content: row.content,
    type: row.type as Message["type"],
    read: row.read,
    timestamp: row.created_at,
  };
}

/**
 * 메시지 전송
 * to가 "broadcast"인 경우 모든 에이전트에게 전송
 */
export async function sendMessage(
  msg: Omit<Message, "id" | "read" | "timestamp">
): Promise<Message> {
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
 */
export async function getConversation(
  agent1: string,
  agent2: string,
  limit: number = 50
): Promise<Message[]> {
  const results = await query<MessageRow>(
    `SELECT id, from_id, to_id, content, type, read, created_at
     FROM messages
     WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)
     ORDER BY created_at DESC
     LIMIT $3`,
    [agent1, agent2, limit]
  );

  // Reverse to get chronological order
  const messages = results.reverse().map(toMessage);

  // Load attachments for messages that reference files (병렬 로딩)
  await Promise.all(
    messages.map(async (msg) => {
      if (msg.content.includes("@file:")) {
        const attachments = await getMessageAttachments(msg.id);
        if (attachments.length > 0) {
          (msg as Message).attachments = attachments;
        }
      }
    })
  );

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
       lm.read as latest_read,
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
       WHERE to_id = a.agent_id OR to_id = 'broadcast'
       ORDER BY created_at DESC
       LIMIT 1
     ) lm ON true`,
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
