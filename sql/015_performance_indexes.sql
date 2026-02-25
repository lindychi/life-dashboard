-- 015_performance_indexes.sql
-- 성능 최적화를 위한 누락 인덱스 추가

-- request_group_id 기반 히스토리 그룹핑용 인덱스 (NULL 제외)
CREATE INDEX IF NOT EXISTS idx_agent_history_request_group
  ON agent_history(request_group_id, created_at DESC)
  WHERE request_group_id IS NOT NULL;

-- relay_commands: 타입+상태 기반 필터링 최적화 (instruction 큐 드레인, 펜딩 커맨드 조회)
CREATE INDEX IF NOT EXISTS idx_relay_commands_type_status
  ON relay_commands(gateway_id, type, status, created_at);

-- broadcast 메시지 전용 인덱스 (브로드캐스트 읽음 상태 조회 최적화)
CREATE INDEX IF NOT EXISTS idx_messages_broadcast
  ON messages(to_id, created_at DESC)
  WHERE to_id = 'broadcast';

-- message_read_status: 메시지+에이전트별 읽음 조회 최적화
CREATE INDEX IF NOT EXISTS idx_message_read_status_lookup
  ON message_read_status(agent_id, message_id);
