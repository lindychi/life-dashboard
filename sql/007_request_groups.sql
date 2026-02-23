-- 007_request_groups.sql
-- 에이전트 히스토리에 요청 그룹 지원 추가

-- request_group_id: 관련된 히스토리 항목을 그룹화하기 위한 UUID
ALTER TABLE agent_history
  ADD COLUMN IF NOT EXISTS request_group_id UUID;

-- request_title: 요청 그룹의 사람이 읽을 수 있는 요약
ALTER TABLE agent_history
  ADD COLUMN IF NOT EXISTS request_title VARCHAR(200);

-- request_group_id로 효율적인 그룹 조회를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_agent_history_request_group_id
  ON agent_history(request_group_id);

-- 그룹별 시간 순서 쿼리를 위한 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_agent_history_group_created
  ON agent_history(request_group_id, created_at);
