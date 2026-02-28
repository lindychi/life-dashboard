-- Conversation Sessions System
-- 대화 세션별 컨텍스트 관리 및 메시지 히스토리 저장

-- 대화 세션 테이블
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  participants TEXT[] NOT NULL, -- 참여자 ID 배열 (에이전트 ID 또는 "user")
  context JSONB DEFAULT '{}', -- 세션별 컨텍스트 데이터 (프로젝트 정보, 목표, 메타데이터 등)
  status TEXT DEFAULT 'active', -- active, archived, completed
  created_by TEXT NOT NULL, -- 세션 생성자 (에이전트 ID 또는 "user")
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_participants ON conversations USING GIN(participants);
CREATE INDEX IF NOT EXISTS idx_conversations_created_by ON conversations(created_by, created_at DESC);

-- 대화 세션 메시지 테이블 (기존 messages 테이블과 별도)
CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL, -- 발신자 (에이전트 ID 또는 "user")
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text', -- text, task, result, question, answer, system
  metadata JSONB DEFAULT '{}', -- 추가 메타데이터 (모델 정보, 토큰 사용량 등)
  parent_message_id UUID REFERENCES conversation_messages(id) ON DELETE SET NULL, -- 답장/스레드 지원
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation ON conversation_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_parent ON conversation_messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_from ON conversation_messages(from_id, created_at DESC);

-- 세션별 메시지 읽음 상태 (에이전트별로 어디까지 읽었는지 추적)
CREATE TABLE IF NOT EXISTS conversation_read_status (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  last_read_message_id UUID REFERENCES conversation_messages(id) ON DELETE SET NULL,
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  unread_count INTEGER DEFAULT 0,
  PRIMARY KEY (conversation_id, agent_id)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_conversation_read_status_agent ON conversation_read_status(agent_id, last_read_at DESC);

-- updated_at 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_conversation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversation_messages_update_conversation
  AFTER INSERT ON conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_updated_at();

-- 읽지 않은 메시지 수 자동 업데이트 함수
CREATE OR REPLACE FUNCTION update_conversation_unread_counts(
  p_conversation_id UUID,
  p_exclude_agent_id TEXT DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  participant TEXT;
  total_messages INTEGER;
  last_read_id UUID;
  unread INTEGER;
BEGIN
  -- 해당 대화의 총 메시지 수
  SELECT COUNT(*) INTO total_messages
  FROM conversation_messages
  WHERE conversation_id = p_conversation_id;

  -- 각 참여자별 읽지 않은 메시지 수 업데이트
  FOR participant IN
    SELECT UNNEST(participants)
    FROM conversations
    WHERE id = p_conversation_id
  LOOP
    -- 발신자는 자신의 메시지를 읽은 것으로 처리하므로 제외할 수 있음
    IF p_exclude_agent_id IS NOT NULL AND participant = p_exclude_agent_id THEN
      CONTINUE;
    END IF;

    -- 마지막 읽은 메시지 ID 조회
    SELECT last_read_message_id INTO last_read_id
    FROM conversation_read_status
    WHERE conversation_id = p_conversation_id
      AND agent_id = participant;

    -- 마지막 읽은 메시지 이후의 메시지 수 계산 (자신이 보낸 메시지 제외)
    IF last_read_id IS NULL THEN
      SELECT COUNT(*) INTO unread
      FROM conversation_messages
      WHERE conversation_id = p_conversation_id
        AND from_id != participant;
    ELSE
      SELECT COUNT(*) INTO unread
      FROM conversation_messages
      WHERE conversation_id = p_conversation_id
        AND created_at > (
          SELECT created_at
          FROM conversation_messages
          WHERE id = last_read_id
        )
        AND from_id != participant;
    END IF;

    -- conversation_read_status 업데이트
    INSERT INTO conversation_read_status (conversation_id, agent_id, unread_count)
    VALUES (p_conversation_id, participant, unread)
    ON CONFLICT (conversation_id, agent_id)
    DO UPDATE SET
      unread_count = unread,
      last_read_at = CASE
        WHEN EXCLUDED.last_read_message_id IS NOT NULL THEN NOW()
        ELSE conversation_read_status.last_read_at
      END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 메시지 삽입 시 읽지 않은 메시지 수 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION trigger_update_unread_on_message_insert()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM update_conversation_unread_counts(NEW.conversation_id, NEW.from_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversation_messages_update_unread
  AFTER INSERT ON conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_unread_on_message_insert();

-- 세션 통계 뷰 (편의를 위한 뷰)
CREATE OR REPLACE VIEW conversation_stats AS
SELECT
  c.id,
  c.title,
  c.participants,
  c.status,
  c.created_by,
  c.created_at,
  c.updated_at,
  COUNT(cm.id) as message_count,
  MAX(cm.created_at) as last_message_at,
  COALESCE(
    jsonb_object_agg(
      crs.agent_id,
      jsonb_build_object('unread', crs.unread_count, 'last_read_at', crs.last_read_at)
    ) FILTER (WHERE crs.agent_id IS NOT NULL),
    '{}'::jsonb
  ) as read_status
FROM conversations c
LEFT JOIN conversation_messages cm ON c.id = cm.conversation_id
LEFT JOIN conversation_read_status crs ON c.id = crs.conversation_id
GROUP BY c.id, c.title, c.participants, c.status, c.created_by, c.created_at, c.updated_at;

COMMENT ON TABLE conversations IS '대화 세션 테이블 - 에이전트 간 컨텍스트 기반 대화 세션 관리';
COMMENT ON TABLE conversation_messages IS '세션별 메시지 저장 - 대화 히스토리 및 스레드 지원';
COMMENT ON TABLE conversation_read_status IS '세션별 읽음 상태 추적 - 에이전트별 읽지 않은 메시지 수';
COMMENT ON VIEW conversation_stats IS '대화 세션 통계 뷰 - 메시지 수, 읽음 상태 집계';
