-- 013_request_groups_tables.sql
-- 독립적인 request_groups 테이블 + request_group_agents 연결 테이블

-- 요청 그룹 상태 ENUM 타입
DO $$ BEGIN
  CREATE TYPE request_group_status AS ENUM ('active', 'completed', 'failed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- request_groups: 하나의 사용자 지시를 나타내는 최상위 엔티티
CREATE TABLE IF NOT EXISTS request_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  status request_group_status NOT NULL DEFAULT 'active',
  source_content TEXT,           -- 원본 지시 내용 (제목 생성 근거)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_groups_status
  ON request_groups(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_groups_created
  ON request_groups(created_at DESC);

-- request_group_agents: 요청 그룹에 소속된 에이전트
CREATE TABLE IF NOT EXISTS request_group_agents (
  request_group_id UUID NOT NULL REFERENCES request_groups(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned',  -- assigned, running, completed, failed
  task_summary TEXT,                         -- 에이전트에 할당된 태스크 요약
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (request_group_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_request_group_agents_agent
  ON request_group_agents(agent_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_group_agents_status
  ON request_group_agents(request_group_id, status);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- request_groups updated_at 트리거
DROP TRIGGER IF EXISTS trigger_request_groups_updated_at ON request_groups;
CREATE TRIGGER trigger_request_groups_updated_at
  BEFORE UPDATE ON request_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- request_group_agents updated_at 트리거
DROP TRIGGER IF EXISTS trigger_request_group_agents_updated_at ON request_group_agents;
CREATE TRIGGER trigger_request_group_agents_updated_at
  BEFORE UPDATE ON request_group_agents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
