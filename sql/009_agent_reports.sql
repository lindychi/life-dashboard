-- Agent 개선 리포트: 주기적 에이전트 분석 결과 저장
-- agent별 성과 메트릭, 이슈 패턴, 개선 권장사항 추적

-- ─── 1. agent_improvement_reports 테이블 ─────────────────────
CREATE TABLE IF NOT EXISTS agent_improvement_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,                        -- 에이전트 식별자 (agent_history.agent_id와 동일)
  report_date DATE NOT NULL,                     -- 리포트 대상 날짜
  metrics JSONB NOT NULL DEFAULT '{}',           -- 성과 메트릭: { taskCompleted, taskFailed, failureRate, avgExecutionMinutes, totalTasks }
  issues JSONB NOT NULL DEFAULT '[]',            -- 발견된 이슈 배열: [{ type, pattern, count, severity, examples }]
  recommendations JSONB NOT NULL DEFAULT '[]',   -- 개선 권장사항: [{ title, description, priority, actionType }]
  status TEXT NOT NULL DEFAULT 'pending',        -- 상태: 'pending', 'acknowledged', 'approved', 'rejected', 'applied'
  approved_at TIMESTAMPTZ,                       -- 사용자 승인 시각
  task_id UUID,                                  -- task_queue 참조 (개선 작업 생성시)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. 인덱스 ─────────────────────────────────────────────────
-- agent별 최신 리포트 조회용
CREATE INDEX IF NOT EXISTS idx_agent_reports_agent_date
  ON agent_improvement_reports (agent_id, report_date DESC);

-- 활성 상태 리포트 필터링용
CREATE INDEX IF NOT EXISTS idx_agent_reports_status
  ON agent_improvement_reports (status)
  WHERE status IN ('pending', 'approved');

-- 최신 리포트 목록 조회용
CREATE INDEX IF NOT EXISTS idx_agent_reports_date
  ON agent_improvement_reports (report_date DESC);

-- ─── 3. 제약조건 ───────────────────────────────────────────────
-- agent당 하루 한 개의 리포트만 허용
ALTER TABLE agent_improvement_reports
  ADD CONSTRAINT uq_agent_report_per_day UNIQUE (agent_id, report_date);
