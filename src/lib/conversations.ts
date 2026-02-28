// 대화 세션 시스템 - PostgreSQL 기반 컨텍스트 관리 및 메시지 히스토리

import { query, queryOne } from "./db";
import { isValidAgentId } from "./messages";

/** 대화 세션 상태 */
export const CONVERSATION_STATUSES = ["active", "archived", "completed"] as const;
export type ConversationStatus = typeof CONVERSATION_STATUSES[number];

/** 세션 메시지 타입 */
export const CONVERSATION_MESSAGE_TYPES = ["text", "task", "result", "question", "answer", "system"] as const;
export type ConversationMessageType = typeof CONVERSATION_MESSAGE_TYPES[number];

/** 대화 세션 인터페이스 */
export interface Conversation {
  id: string;
  title: string;
  participants: string[]; // 에이전트 ID 또는 "user"
  context: Record<string, unknown>; // 세션별 컨텍스트 데이터
  status: ConversationStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

/** 세션 메시지 인터페이스 */
export interface ConversationMessage {
  id: string;
  conversationId: string;
  from: string;
  content: string;
  type: ConversationMessageType;
  metadata: Record<string, unknown>;
  parentMessageId?: string;
  createdAt: string;
}

/** 세션 읽음 상태 인터페이스 */
export interface ConversationReadStatus {
  conversationId: string;
  agentId: string;
  lastReadMessageId?: string;
  lastReadAt: string;
  unreadCount: number;
}

/** 세션 통계 인터페이스 */
export interface ConversationStats {
  id: string;
  title: string;
  participants: string[];
  status: ConversationStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessageAt?: string;
  readStatus: Record<string, { unread: number; last_read_at: string }>;
}

// ===== DB 행 타입 정의 =====

interface ConversationRow {
  id: string;
  title: string;
  participants: string[];
  context: Record<string, unknown>;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface ConversationMessageRow {
  id: string;
  conversation_id: string;
  from_id: string;
  content: string;
  type: string;
  metadata: Record<string, unknown>;
  parent_message_id: string | null;
  created_at: string;
}

interface ConversationReadStatusRow {
  conversation_id: string;
  agent_id: string;
  last_read_message_id: string | null;
  last_read_at: string;
  unread_count: number;
}

interface ConversationStatsRow {
  id: string;
  title: string;
  participants: string[];
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  message_count: string;
  last_message_at: string | null;
  read_status: Record<string, { unread: number; last_read_at: string }>;
}

// ===== 변환 함수 =====

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    participants: row.participants,
    context: row.context,
    status: row.status as ConversationStatus,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at || undefined,
  };
}

function toConversationMessage(row: ConversationMessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    from: row.from_id,
    content: row.content,
    type: row.type as ConversationMessageType,
    metadata: row.metadata,
    parentMessageId: row.parent_message_id || undefined,
    createdAt: row.created_at,
  };
}

function toConversationReadStatus(row: ConversationReadStatusRow): ConversationReadStatus {
  return {
    conversationId: row.conversation_id,
    agentId: row.agent_id,
    lastReadMessageId: row.last_read_message_id || undefined,
    lastReadAt: row.last_read_at,
    unreadCount: row.unread_count,
  };
}

function toConversationStats(row: ConversationStatsRow): ConversationStats {
  return {
    id: row.id,
    title: row.title,
    participants: row.participants,
    status: row.status as ConversationStatus,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: parseInt(row.message_count, 10) || 0,
    lastMessageAt: row.last_message_at || undefined,
    readStatus: row.read_status,
  };
}

// ===== CRUD 함수 =====

/**
 * 새 대화 세션 생성
 */
export async function createConversation(data: {
  title: string;
  participants: string[];
  context?: Record<string, unknown>;
  createdBy: string;
}): Promise<Conversation> {
  // 참여자 ID 검증
  for (const participantId of data.participants) {
    if (!isValidAgentId(participantId)) {
      throw new Error(`Invalid participant ID: "${participantId}" is not a registered agent or "user"`);
    }
  }

  // createdBy 검증
  if (!isValidAgentId(data.createdBy)) {
    throw new Error(`Invalid createdBy: "${data.createdBy}" is not a registered agent or "user"`);
  }

  // 중복 참여자 제거
  const uniqueParticipants = Array.from(new Set(data.participants));

  const result = await queryOne<ConversationRow>(
    `INSERT INTO conversations (title, participants, context, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, participants, context, status, created_by, created_at, updated_at, archived_at`,
    [data.title, uniqueParticipants, JSON.stringify(data.context || {}), data.createdBy]
  );

  if (!result) {
    throw new Error("Failed to create conversation");
  }

  // 각 참여자별 읽음 상태 초기화
  for (const participantId of uniqueParticipants) {
    await query(
      `INSERT INTO conversation_read_status (conversation_id, agent_id, unread_count)
       VALUES ($1, $2, 0)
       ON CONFLICT (conversation_id, agent_id) DO NOTHING`,
      [result.id, participantId]
    );
  }

  return toConversation(result);
}

/**
 * 대화 세션 조회 (단일)
 */
export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const result = await queryOne<ConversationRow>(
    `SELECT id, title, participants, context, status, created_by, created_at, updated_at, archived_at
     FROM conversations
     WHERE id = $1`,
    [conversationId]
  );

  return result ? toConversation(result) : null;
}

/**
 * 대화 세션 목록 조회
 * @param filters 필터 조건
 */
export async function getConversations(filters?: {
  participantId?: string;
  status?: ConversationStatus;
  createdBy?: string;
  limit?: number;
}): Promise<Conversation[]> {
  let sql = `SELECT id, title, participants, context, status, created_by, created_at, updated_at, archived_at
             FROM conversations
             WHERE 1=1`;
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters?.participantId) {
    sql += ` AND $${paramIndex} = ANY(participants)`;
    params.push(filters.participantId);
    paramIndex++;
  }

  if (filters?.status) {
    sql += ` AND status = $${paramIndex}`;
    params.push(filters.status);
    paramIndex++;
  }

  if (filters?.createdBy) {
    sql += ` AND created_by = $${paramIndex}`;
    params.push(filters.createdBy);
    paramIndex++;
  }

  sql += ` ORDER BY updated_at DESC`;

  if (filters?.limit) {
    sql += ` LIMIT $${paramIndex}`;
    params.push(filters.limit);
  }

  const results = await query<ConversationRow>(sql, params);
  return results.map(toConversation);
}

/**
 * 대화 세션 통계 조회 (메시지 수, 읽음 상태 포함)
 */
export async function getConversationStats(conversationId: string): Promise<ConversationStats | null> {
  const result = await queryOne<ConversationStatsRow>(
    `SELECT * FROM conversation_stats WHERE id = $1`,
    [conversationId]
  );

  return result ? toConversationStats(result) : null;
}

/**
 * 대화 세션 업데이트
 */
export async function updateConversation(
  conversationId: string,
  updates: {
    title?: string;
    context?: Record<string, unknown>;
    status?: ConversationStatus;
  }
): Promise<Conversation | null> {
  const fields: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (updates.title !== undefined) {
    fields.push(`title = $${paramIndex}`);
    params.push(updates.title);
    paramIndex++;
  }

  if (updates.context !== undefined) {
    fields.push(`context = $${paramIndex}`);
    params.push(JSON.stringify(updates.context));
    paramIndex++;
  }

  if (updates.status !== undefined) {
    fields.push(`status = $${paramIndex}`);
    params.push(updates.status);
    paramIndex++;

    // archived 상태로 변경 시 archived_at 설정
    if (updates.status === "archived") {
      fields.push(`archived_at = NOW()`);
    }
  }

  if (fields.length === 0) {
    return getConversation(conversationId);
  }

  fields.push(`updated_at = NOW()`);

  const sql = `UPDATE conversations
               SET ${fields.join(", ")}
               WHERE id = $${paramIndex}
               RETURNING id, title, participants, context, status, created_by, created_at, updated_at, archived_at`;
  params.push(conversationId);

  const result = await queryOne<ConversationRow>(sql, params);
  return result ? toConversation(result) : null;
}

/**
 * 대화 세션 삭제
 */
export async function deleteConversation(conversationId: string): Promise<boolean> {
  const result = await queryOne<{ count: number }>(
    `DELETE FROM conversations WHERE id = $1 RETURNING 1 as count`,
    [conversationId]
  );

  return result !== null;
}

/**
 * 대화 세션에 메시지 추가
 */
export async function addConversationMessage(data: {
  conversationId: string;
  from: string;
  content: string;
  type?: ConversationMessageType;
  metadata?: Record<string, unknown>;
  parentMessageId?: string;
}): Promise<ConversationMessage> {
  // 발신자 ID 검증
  if (!isValidAgentId(data.from)) {
    throw new Error(`Invalid sender: "${data.from}" is not a registered agent or "user"`);
  }

  // 대화 세션 존재 확인
  const conversation = await getConversation(data.conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${data.conversationId}`);
  }

  // 발신자가 참여자인지 확인
  if (!conversation.participants.includes(data.from)) {
    throw new Error(`Sender "${data.from}" is not a participant in this conversation`);
  }

  const result = await queryOne<ConversationMessageRow>(
    `INSERT INTO conversation_messages (conversation_id, from_id, content, type, metadata, parent_message_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, conversation_id, from_id, content, type, metadata, parent_message_id, created_at`,
    [
      data.conversationId,
      data.from,
      data.content,
      data.type || "text",
      JSON.stringify(data.metadata || {}),
      data.parentMessageId || null,
    ]
  );

  if (!result) {
    throw new Error("Failed to add conversation message");
  }

  return toConversationMessage(result);
}

/**
 * 대화 세션의 메시지 목록 조회
 */
export async function getConversationMessages(
  conversationId: string,
  options?: {
    limit?: number;
    since?: string; // ISO timestamp
    parentMessageId?: string; // 특정 메시지의 답장만 조회
  }
): Promise<ConversationMessage[]> {
  let sql = `SELECT id, conversation_id, from_id, content, type, metadata, parent_message_id, created_at
             FROM conversation_messages
             WHERE conversation_id = $1`;
  const params: unknown[] = [conversationId];
  let paramIndex = 2;

  if (options?.since) {
    sql += ` AND created_at > $${paramIndex}`;
    params.push(options.since);
    paramIndex++;
  }

  if (options?.parentMessageId !== undefined) {
    if (options.parentMessageId === null) {
      // 최상위 메시지만 조회 (스레드 루트)
      sql += ` AND parent_message_id IS NULL`;
    } else {
      // 특정 메시지의 답장만 조회
      sql += ` AND parent_message_id = $${paramIndex}`;
      params.push(options.parentMessageId);
      paramIndex++;
    }
  }

  sql += ` ORDER BY created_at ASC`;

  if (options?.limit) {
    sql += ` LIMIT $${paramIndex}`;
    params.push(options.limit);
  }

  const results = await query<ConversationMessageRow>(sql, params);
  return results.map(toConversationMessage);
}

/**
 * 메시지 트리 조회 (스레드 구조)
 */
export async function getMessageThread(messageId: string): Promise<ConversationMessage[]> {
  // 재귀 CTE로 메시지 트리 조회
  const results = await query<ConversationMessageRow>(
    `WITH RECURSIVE message_tree AS (
       -- 루트 메시지
       SELECT id, conversation_id, from_id, content, type, metadata, parent_message_id, created_at, 0 as depth
       FROM conversation_messages
       WHERE id = $1

       UNION ALL

       -- 자식 메시지들
       SELECT cm.id, cm.conversation_id, cm.from_id, cm.content, cm.type, cm.metadata, cm.parent_message_id, cm.created_at, mt.depth + 1
       FROM conversation_messages cm
       INNER JOIN message_tree mt ON cm.parent_message_id = mt.id
     )
     SELECT id, conversation_id, from_id, content, type, metadata, parent_message_id, created_at
     FROM message_tree
     ORDER BY depth ASC, created_at ASC`,
    [messageId]
  );

  return results.map(toConversationMessage);
}

/**
 * 대화 세션의 읽음 상태 업데이트
 */
export async function updateConversationReadStatus(
  conversationId: string,
  agentId: string,
  lastReadMessageId: string
): Promise<ConversationReadStatus> {
  // 에이전트가 참여자인지 확인
  const conversation = await getConversation(conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }

  if (!conversation.participants.includes(agentId)) {
    throw new Error(`Agent "${agentId}" is not a participant in this conversation`);
  }

  const result = await queryOne<ConversationReadStatusRow>(
    `INSERT INTO conversation_read_status (conversation_id, agent_id, last_read_message_id, last_read_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (conversation_id, agent_id)
     DO UPDATE SET
       last_read_message_id = EXCLUDED.last_read_message_id,
       last_read_at = NOW()
     RETURNING conversation_id, agent_id, last_read_message_id, last_read_at, unread_count`,
    [conversationId, agentId, lastReadMessageId]
  );

  if (!result) {
    throw new Error("Failed to update read status");
  }

  // 읽지 않은 메시지 수 재계산
  await query(`SELECT update_conversation_unread_counts($1)`, [conversationId]);

  // 업데이트된 상태 조회
  const updatedStatus = await queryOne<ConversationReadStatusRow>(
    `SELECT conversation_id, agent_id, last_read_message_id, last_read_at, unread_count
     FROM conversation_read_status
     WHERE conversation_id = $1 AND agent_id = $2`,
    [conversationId, agentId]
  );

  if (!updatedStatus) {
    throw new Error("Failed to fetch updated read status");
  }

  return toConversationReadStatus(updatedStatus);
}

/**
 * 에이전트의 읽지 않은 대화 세션 조회
 */
export async function getUnreadConversations(agentId: string): Promise<
  Array<ConversationStats & { unreadCount: number }>
> {
  const results = await query<ConversationStatsRow & { agent_unread_count: number }>(
    `SELECT cs.*, COALESCE(crs.unread_count, 0) as agent_unread_count
     FROM conversation_stats cs
     LEFT JOIN conversation_read_status crs
       ON cs.id = crs.conversation_id AND crs.agent_id = $1
     WHERE $1 = ANY(cs.participants)
       AND cs.status = 'active'
       AND COALESCE(crs.unread_count, 0) > 0
     ORDER BY cs.updated_at DESC`,
    [agentId]
  );

  return results.map((row) => ({
    ...toConversationStats(row),
    unreadCount: row.agent_unread_count,
  }));
}

/**
 * 대화 세션 컨텍스트 업데이트 (부분 병합)
 */
export async function updateConversationContext(
  conversationId: string,
  contextUpdates: Record<string, unknown>
): Promise<Conversation | null> {
  const result = await queryOne<ConversationRow>(
    `UPDATE conversations
     SET context = context || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2
     RETURNING id, title, participants, context, status, created_by, created_at, updated_at, archived_at`,
    [JSON.stringify(contextUpdates), conversationId]
  );

  return result ? toConversation(result) : null;
}
