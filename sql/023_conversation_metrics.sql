-- 대화 세션 메트릭 히스토리 시스템
-- 세션 사용 현황, 성능 메트릭 시계열 저장

CREATE TABLE IF NOT EXISTS conversation_metrics_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sessions_json JSONB NOT NULL,      -- 세션 메트릭 (total, active, archived, completed, completionRate, avgDurationHours)
  messages_json JSONB NOT NULL,      -- 메시지 메트릭 (total, perSession, unreadCount, unreadRate, insertionRatePerHour, avgLength)
  performance_json JSONB NOT NULL,   -- 성능 메트릭 (tableSizeMb, indexSizeMb, deadTuplesCount, lastVacuumAt)
  participants_json JSONB DEFAULT '[]'::jsonb, -- 참여자별 메트릭 배열
  health_json JSONB DEFAULT '{}'::jsonb,       -- 건강 상태 (isHealthy, warnings[], criticalIssues[])
  collected_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 (시간 기반 조회 최적화)
CREATE INDEX IF NOT EXISTS idx_metrics_history_collected_at
  ON conversation_metrics_history(collected_at DESC);

CREATE INDEX IF NOT EXISTS idx_metrics_history_sessions
  ON conversation_metrics_history USING GIN(sessions_json);

-- 코멘트
COMMENT ON TABLE conversation_metrics_history IS '대화 세션 메트릭 히스토리 - 시계열 성능 데이터 저장';
COMMENT ON COLUMN conversation_metrics_history.sessions_json IS 'JSON 형식의 세션 메트릭';
COMMENT ON COLUMN conversation_metrics_history.messages_json IS 'JSON 형식의 메시지 메트릭';
COMMENT ON COLUMN conversation_metrics_history.performance_json IS 'JSON 형식의 성능 메트릭';
COMMENT ON COLUMN conversation_metrics_history.health_json IS 'JSON 형식의 건강 상태 평가';

-- 오래된 메트릭 자동 정리 함수 (90일 이상)
CREATE OR REPLACE FUNCTION cleanup_old_conversation_metrics()
RETURNS void AS $$
BEGIN
  DELETE FROM conversation_metrics_history
  WHERE collected_at < NOW() - INTERVAL '90 days';

  RAISE NOTICE 'Cleaned up old conversation metrics';
END;
$$ LANGUAGE plpgsql;

-- 메트릭 요약 뷰 (최근 24시간)
CREATE OR REPLACE VIEW conversation_metrics_daily_summary AS
SELECT
  DATE_TRUNC('day', collected_at)::date as date,
  COUNT(*) as samples,

  -- 세션 메트릭 평균
  ROUND(AVG((sessions_json->>'total')::numeric), 2) as avg_total_sessions,
  ROUND(AVG((sessions_json->>'active')::numeric), 2) as avg_active_sessions,
  ROUND(AVG((sessions_json->>'completionRate')::numeric), 2) as avg_completion_rate,

  -- 메시지 메트릭 평균
  ROUND(AVG((messages_json->>'total')::numeric), 2) as avg_total_messages,
  ROUND(AVG((messages_json->>'insertionRatePerHour')::numeric), 2) as avg_insertion_rate_per_hour,
  ROUND(AVG((messages_json->>'unreadRate')::numeric), 2) as avg_unread_rate,

  -- 성능 메트릭 최대값
  ROUND(MAX((performance_json->>'tableSizeMb')::numeric), 2) as max_table_size_mb,
  ROUND(MAX((performance_json->>'deadTuplesCount')::numeric), 0) as max_dead_tuples,

  -- 건강 상태
  COUNT(*) FILTER (WHERE (health_json->>'isHealthy')::boolean = false) as unhealthy_samples
FROM conversation_metrics_history
WHERE collected_at > NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('day', collected_at)::date
ORDER BY date DESC;

-- 참여자별 활동 통계 뷰
CREATE OR REPLACE VIEW conversation_participant_stats AS
SELECT
  metrics_data->>'agentId' as agent_id,
  COUNT(*) as metric_samples,

  ROUND(AVG((metrics_data->>'sessionsCreated')::numeric), 2) as avg_sessions_created,
  ROUND(AVG((metrics_data->>'messagesPosted')::numeric), 2) as avg_messages_posted,
  ROUND(AVG((metrics_data->>'avgResponseTimeSeconds')::numeric), 2) as avg_response_time_seconds,
  ROUND(AVG((metrics_data->>'unreadCountByAgent')::numeric), 2) as avg_unread_count,

  MAX(cmh.collected_at) as last_updated_at
FROM conversation_metrics_history cmh,
     LATERAL jsonb_array_elements(cmh.participants_json) as metrics_data
WHERE cmh.collected_at > NOW() - INTERVAL '7 days'
GROUP BY metrics_data->>'agentId'
ORDER BY avg_messages_posted DESC;

-- 성능 트렌드 뷰 (시간별)
CREATE OR REPLACE VIEW conversation_performance_trends AS
SELECT
  DATE_TRUNC('hour', collected_at)::timestamp as hour,
  COUNT(*) as samples,

  -- 테이블 크기 트렌드
  ROUND(AVG((performance_json->>'tableSizeMb')::numeric), 2) as avg_table_size_mb,
  ROUND(MIN((performance_json->>'tableSizeMb')::numeric), 2) as min_table_size_mb,
  ROUND(MAX((performance_json->>'tableSizeMb')::numeric), 2) as max_table_size_mb,

  -- 인덱스 크기 트렌드
  ROUND(AVG((performance_json->>'indexSizeMb')::numeric), 2) as avg_index_size_mb,

  -- 데드 튜플 트렌드
  ROUND(AVG((performance_json->>'deadTuplesCount')::numeric), 0) as avg_dead_tuples,
  ROUND(MAX((performance_json->>'deadTuplesCount')::numeric), 0) as max_dead_tuples
FROM conversation_metrics_history
WHERE collected_at > NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('hour', collected_at)
ORDER BY hour DESC;

-- 경보 조건 뷰 (비정상 상황 감지)
CREATE OR REPLACE VIEW conversation_alerts AS
SELECT
  cmh.collected_at,
  cmh.id,
  CASE
    WHEN (cmh.health_json->'criticalIssues')::text != '[]' THEN 'CRITICAL'
    WHEN array_length(
      ARRAY(SELECT jsonb_array_elements_text(cmh.health_json->'warnings')), 1
    ) > 3 THEN 'WARNING'
    ELSE 'OK'
  END as alert_level,
  CASE
    WHEN (cmh.health_json->'criticalIssues')::text != '[]'
      THEN (cmh.health_json->'criticalIssues')::text
    ELSE COALESCE((cmh.health_json->'warnings')::text, '[]')
  END as alert_details,
  (cmh.sessions_json->>'total')::numeric as total_sessions,
  (cmh.messages_json->>'total')::numeric as total_messages
FROM conversation_metrics_history cmh
WHERE cmh.collected_at > NOW() - INTERVAL '7 days'
  AND (
    (cmh.health_json->'criticalIssues')::text != '[]'
    OR array_length(
      ARRAY(SELECT jsonb_array_elements_text(cmh.health_json->'warnings')), 1
    ) > 0
  )
ORDER BY cmh.collected_at DESC;

COMMENT ON VIEW conversation_metrics_daily_summary IS '일간 메트릭 요약 - 최근 24시간 평균/최대값';
COMMENT ON VIEW conversation_participant_stats IS '참여자별 활동 통계 - 지난 7일';
COMMENT ON VIEW conversation_performance_trends IS '성능 트렌드 - 시간별 분석';
COMMENT ON VIEW conversation_alerts IS '경보 조건 - 비정상 상황 감지';
