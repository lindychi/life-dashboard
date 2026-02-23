-- Task Queue: 우선순위 기반 태스크 큐잉 시스템
-- 동시 실행 제한(concurrency limit)과 concurrency_group 지원

CREATE TABLE IF NOT EXISTS task_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'generic',
  payload JSONB NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,              -- 높을수록 우선순위 높음
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed')),
  concurrency_group TEXT NOT NULL DEFAULT 'default', -- 동시 실행 제한 그룹
  assigned_agent TEXT,                               -- 할당된 에이전트 ID
  max_retries INTEGER NOT NULL DEFAULT 3,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,                                        -- 실패 시 에러 메시지
  result JSONB,                                      -- 완료 시 결과 데이터
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,                            -- 실행 시작 시각
  completed_at TIMESTAMPTZ,                          -- 완료/실패 시각
  timeout_seconds INTEGER NOT NULL DEFAULT 300       -- 태스크 타임아웃 (기본 5분)
);

-- 큐에서 우선순위+FIFO 순으로 꺼내기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_task_queue_dequeue
  ON task_queue (concurrency_group, status, priority DESC, created_at ASC)
  WHERE status IN ('pending', 'queued');

-- 실행 중인 태스크 카운트 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_task_queue_running
  ON task_queue (concurrency_group, status)
  WHERE status = 'running';

-- 에이전트별 태스크 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_task_queue_agent
  ON task_queue (assigned_agent, status);

-- 전체 상태 조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_task_queue_status
  ON task_queue (status, created_at DESC);

-- 타임아웃된 태스크 감지용 인덱스
CREATE INDEX IF NOT EXISTS idx_task_queue_timeout
  ON task_queue (status, started_at)
  WHERE status = 'running';

-- Concurrency 제한 설정 테이블
CREATE TABLE IF NOT EXISTS concurrency_config (
  concurrency_group TEXT PRIMARY KEY,
  max_concurrent INTEGER NOT NULL DEFAULT 3,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 기본 그룹 설정
INSERT INTO concurrency_config (concurrency_group, max_concurrent)
VALUES ('default', 3)
ON CONFLICT (concurrency_group) DO NOTHING;
