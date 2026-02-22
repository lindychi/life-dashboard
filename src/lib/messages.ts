// 에이전트 간 메시지 시스템 (PostgreSQL)

import { query, queryOne } from "./db";
import { getAgentIds } from "./agents";

export interface Message {
  id: string;
  from: string; // agentId or "user"
  to: string; // agentId or "broadcast"
  content: string;
  type: "text" | "task" | "result" | "question" | "answer";
  read: boolean;
  timestamp: string; // ISO timestamp from DB
}

/**
 * 메시지 전송
 * to가 "broadcast"인 경우 모든 에이전트에게 전송
 */
export async function sendMessage(
  msg: Omit<Message, "id" | "read" | "timestamp">
): Promise<Message> {
  if (msg.to === "broadcast") {
    // Insert a single row with to_id = 'broadcast'
    // Queries will handle fetching broadcast messages for each agent
    const result = await queryOne<{
      id: string;
      from_id: string;
      to_id: string;
      content: string;
      type: string;
      read: boolean;
      created_at: string;
    }>(
      `INSERT INTO messages (from_id, to_id, content, type, read)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id, from_id, to_id, content, type, read, created_at`,
      [msg.from, "broadcast", msg.content, msg.type]
    );

    if (!result) {
      throw new Error("Failed to insert broadcast message");
    }

    return {
      id: result.id,
      from: result.from_id,
      to: result.to_id,
      content: result.content,
      type: result.type as Message["type"],
      read: result.read,
      timestamp: result.created_at,
    };
  } else {
    // Insert message for specific agent
    const result = await queryOne<{
      id: string;
      from_id: string;
      to_id: string;
      content: string;
      type: string;
      read: boolean;
      created_at: string;
    }>(
      `INSERT INTO messages (from_id, to_id, content, type, read)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id, from_id, to_id, content, type, read, created_at`,
      [msg.from, msg.to, msg.content, msg.type]
    );

    if (!result) {
      throw new Error("Failed to insert message");
    }

    return {
      id: result.id,
      from: result.from_id,
      to: result.to_id,
      content: result.content,
      type: result.type as Message["type"],
      read: result.read,
      timestamp: result.created_at,
    };
  }
}

/**
 * 에이전트의 메시지 조회
 * @param agentId 에이전트 ID
 * @param unreadOnly 읽지 않은 메시지만 조회
 */
export async function getMessages(
  agentId: string,
  unreadOnly?: boolean
): Promise<Message[]> {
  const readFilter = unreadOnly ? "AND read = FALSE" : "";

  const results = await query<{
    id: string;
    from_id: string;
    to_id: string;
    content: string;
    type: string;
    read: boolean;
    created_at: string;
  }>(
    `SELECT id, from_id, to_id, content, type, read, created_at
     FROM messages
     WHERE (to_id = $1 OR to_id = 'broadcast') ${readFilter}
     ORDER BY created_at ASC`,
    [agentId]
  );

  return results.map((row) => ({
    id: row.id,
    from: row.from_id,
    to: row.to_id,
    content: row.content,
    type: row.type as Message["type"],
    read: row.read,
    timestamp: row.created_at,
  }));
}

/**
 * 메시지를 읽음으로 표시
 */
export async function markAsRead(
  agentId: string,
  messageId: string
): Promise<boolean> {
  const result = await queryOne<{ count: number }>(
    `UPDATE messages
     SET read = TRUE
     WHERE id = $1 AND (to_id = $2 OR to_id = 'broadcast')
     RETURNING 1 as count`,
    [messageId, agentId]
  );

  return result !== null;
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
  const results = await query<{
    id: string;
    from_id: string;
    to_id: string;
    content: string;
    type: string;
    read: boolean;
    created_at: string;
  }>(
    `SELECT id, from_id, to_id, content, type, read, created_at
     FROM messages
     WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)
     ORDER BY created_at DESC
     LIMIT $3`,
    [agent1, agent2, limit]
  );

  // Reverse to get chronological order
  return results.reverse().map((row) => ({
    id: row.id,
    from: row.from_id,
    to: row.to_id,
    content: row.content,
    type: row.type as Message["type"],
    read: row.read,
    timestamp: row.created_at,
  }));
}

/**
 * 읽지 않은 메시지 개수 조회
 */
export async function getUnreadCount(agentId: string): Promise<number> {
  const result = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM messages
     WHERE (to_id = $1 OR to_id = 'broadcast') AND read = FALSE`,
    [agentId]
  );

  return result ? parseInt(result.count, 10) : 0;
}

/**
 * 모든 에이전트의 최신 메시지 및 읽지 않은 개수 조회
 */
export async function getAllAgentsOverview(): Promise<
  Record<string, { unread: number; latest?: Message }>
> {
  const overview: Record<string, { unread: number; latest?: Message }> = {};

  const agentIds = getAgentIds();

  for (const agentId of agentIds) {
    const unread = await getUnreadCount(agentId);

    const latestRow = await queryOne<{
      id: string;
      from_id: string;
      to_id: string;
      content: string;
      type: string;
      read: boolean;
      created_at: string;
    }>(
      `SELECT id, from_id, to_id, content, type, read, created_at
       FROM messages
       WHERE to_id = $1 OR to_id = 'broadcast'
       ORDER BY created_at DESC
       LIMIT 1`,
      [agentId]
    );

    const latest = latestRow
      ? {
          id: latestRow.id,
          from: latestRow.from_id,
          to: latestRow.to_id,
          content: latestRow.content,
          type: latestRow.type as Message["type"],
          read: latestRow.read,
          timestamp: latestRow.created_at,
        }
      : undefined;

    overview[agentId] = { unread, latest };
  }

  return overview;
}
