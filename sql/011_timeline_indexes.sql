-- 011_timeline_indexes.sql
-- 타임라인 뷰를 위한 인덱스 최적화

-- 에이전트 + 시간 순서 필터링용 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_agent_history_agent_created
  ON agent_history(agent_id, created_at DESC);

-- 타입 + 시간 순서 필터링용 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_agent_history_type_created
  ON agent_history(type, created_at DESC);

-- 전문 검색을 위한 GIN 인덱스 (content 컬럼)
CREATE INDEX IF NOT EXISTS idx_agent_history_content_trgm
  ON agent_history USING gin (content gin_trgm_ops);

-- 커서 기반 페이지네이션을 위한 created_at DESC 인덱스
CREATE INDEX IF NOT EXISTS idx_agent_history_created_desc
  ON agent_history(created_at DESC);
