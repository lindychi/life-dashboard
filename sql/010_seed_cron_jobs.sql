-- 기본 Cron Job 시드 데이터
-- cleanup-old-runs, daily-assistant, agent-improvement-scanner 기본 작업 등록

-- 1. 데이터 정리 작업 (매일 새벽 3시 KST)
INSERT INTO cron_jobs (name, description, schedule, handler_type, handler_config, enabled)
VALUES (
  'cleanup-old-runs',
  '오래된 cron_job_runs, queue_metrics, agent_history 데이터 정리 (retention policy)',
  '0 3 * * *',
  'cleanup-old-runs',
  '{"retentionDays": 30, "tables": {"cronJobRuns": 30, "queueMetrics": 7, "agentHistory": 90}}',
  TRUE
)
ON CONFLICT (name) DO NOTHING;

-- 2. 일일 브리핑 (매일 오전 9시 KST)
INSERT INTO cron_jobs (name, description, schedule, handler_type, handler_config, enabled)
VALUES (
  'daily-briefing',
  '어제 에이전트 활동 분석 및 일일 브리핑 메시지 발송',
  '0 9 * * *',
  'daily-assistant',
  '{"recentDays": 7, "sendBriefing": true}',
  TRUE
)
ON CONFLICT (name) DO NOTHING;

-- 3. 에이전트 개선 스캔 (매주 월요일 오전 10시 KST)
INSERT INTO cron_jobs (name, description, schedule, handler_type, handler_config, enabled)
VALUES (
  'weekly-agent-scan',
  '에이전트 성과 분석 및 개선 권장사항 생성',
  '0 10 * * 1',
  'agent-improvement-scanner',
  '{"days": 7}',
  TRUE
)
ON CONFLICT (name) DO NOTHING;

-- next_run_at 초기값 설정 (각 job의 다음 실행 시각 계산은 서버 측에서 처리)
-- 서버 시작 시 enabled=TRUE인 job들의 next_run_at이 NULL이면 스케줄러가 자동 갱신
