# 대화 세션 시스템 배포 빠른 시작 가이드

## 개요

이 문서는 대화 세션(Conversation Sessions) 시스템을 프로덕션에 배포하기 위한 빠른 시작 가이드입니다.

---

## 1. 사전 확인사항

```bash
# 1. Node.js와 pnpm 설치 확인
node --version  # v20 이상
pnpm --version  # 9.0 이상

# 2. PostgreSQL 연결 확인
psql $DATABASE_URL -c "SELECT version();"

# 3. 프로젝트 의존성 설치
pnpm install

# 4. 환경 변수 설정
# .env.local에 다음 추가:
# DATABASE_URL=postgresql://user:password@host:5432/life_dashboard
```

---

## 2. 배포 단계별 가이드

### 단계 1: 데이터베이스 마이그레이션

```bash
# 1a. 마이그레이션 파일 확인
ls -la sql/022_conversation_sessions.sql
ls -la sql/023_conversation_metrics.sql

# 1b. 개발 환경에서 테스트
export DATABASE_URL="postgresql://localhost:5432/life_dashboard_dev"
pnpm migrate:dry-run  # 변경사항 미리보기

# 1c. 실제 적용 (개발)
pnpm migrate

# 1d. 프로덕션 적용 (Railway)
# railway variables를 통해 DATABASE_URL 설정
# 그리고 다음 실행:
railway run pnpm migrate
```

**예상 시간**: 30초
**변경 사항**: 3개 테이블, 4개 인덱스, 2개 뷰 생성

### 단계 2: 메트릭 수집 시스템 시작

```bash
# 2a. 메트릭 수집 스크립트 테스트 (한 번만 실행)
npx tsx scripts/collect-conversation-metrics.ts --once

# 2b. 스케줄러 시작 (백그라운드)
# package.json에 다음 스크립트 추가 또는 systemd/launchd 설정
node scripts/collect-conversation-metrics.ts &

# 2c. 로그 확인
tail -f logs/metrics-collection.log
```

**예상 시간**: 5-10초 (초기 수집)
**주기**: 5분마다 자동 수집

### 단계 3: API 엔드포인트 검증

```bash
# 3a. 최신 메트릭 조회
curl http://localhost:3000/api/metrics/conversations

# 3b. Prometheus 형식 확인
curl http://localhost:3000/api/metrics/conversations?format=prometheus

# 3c. 수동 메트릭 수집 (관리자용)
curl -X POST http://localhost:3000/api/metrics/conversations/collect \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**응답 예**:
```json
{
  "timestamp": "2025-02-28T12:00:00.000Z",
  "sessions": {
    "total": 42,
    "active": 12,
    "archived": 25,
    "completed": 5,
    "completionRate": 11.9,
    "avgDurationHours": 5.5
  },
  "messages": {
    "total": 234,
    "perSession": 5.57,
    "unreadCount": 45,
    "unreadRate": 19.23,
    "insertionRatePerHour": 12,
    "avgLength": 156
  },
  "health": {
    "isHealthy": true,
    "warnings": [],
    "criticalIssues": []
  }
}
```

### 단계 4: 모니터링 설정 (선택사항)

```bash
# 4a. Prometheus 설정 파일 작성
# prometheus.yml 에 다음 추가:
cat >> prometheus.yml <<EOF
scrape_configs:
  - job_name: 'conversation-sessions'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/api/metrics/conversations'
    params:
      format: ['prometheus']
    scrape_interval: 5m
EOF

# 4b. Prometheus 재시작
systemctl restart prometheus

# 4c. Grafana 대시보드 import
# Grafana > Dashboards > Import > JSON 모드
# docs/grafana-dashboard.json 파일 선택
```

### 단계 5: 백업 설정

```bash
# 5a. 백업 스크립트 생성
mkdir -p backups/conversations
chmod +x scripts/backup-conversations.sh

# 5b. Cron 작업 추가 (일일 자정 백업)
echo "0 0 * * * $HOME/scripts/backup-conversations.sh" | crontab -

# 5c. 백업 확인
ls -lh backups/conversations/
```

---

## 3. 배포 후 검증 체크리스트

### 데이터베이스 확인

```bash
# 테이블 존재 확인
psql $DATABASE_URL -c "
  SELECT tablename FROM pg_tables
  WHERE tablename IN ('conversations', 'conversation_messages', 'conversation_read_status', 'conversation_metrics_history')
  AND schemaname = 'public';"

# 인덱스 확인
psql $DATABASE_URL -c "SELECT indexname FROM pg_indexes WHERE tablename LIKE 'conversation%';"

# 뷰 확인
psql $DATABASE_URL -c "SELECT viewname FROM pg_views WHERE viewname LIKE 'conversation%';"
```

### API 기능 확인

```bash
# MCP 도구 테스트 (claude 사용 중이면)
# src/app/api/conversations/route.ts 테스트

# 기본 CRUD 작동 확인
curl -X POST http://localhost:3000/api/conversations \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Conversation",
    "participants": ["user", "dev-agent"],
    "createdBy": "user"
  }'
```

### 메트릭 수집 확인

```bash
# 메트릭 히스토리 조회
psql $DATABASE_URL -c "
  SELECT COUNT(*) as metrics_count, MAX(collected_at) as last_collected
  FROM conversation_metrics_history;"

# 최근 메트릭 샘플
psql $DATABASE_URL -c "
  SELECT collected_at, sessions_json->>'total' as total_sessions
  FROM conversation_metrics_history
  ORDER BY collected_at DESC
  LIMIT 5;"
```

---

## 4. 운영 스크립트

### 일일 점검

```bash
#!/bin/bash
# scripts/daily-health-check.sh

echo "=== Conversation Sessions Daily Health Check ==="

# 1. 메트릭 상태 확인
echo "Collecting latest metrics..."
curl -s http://localhost:3000/api/metrics/conversations | jq '.health'

# 2. DB 상태 확인
echo -e "\nDatabase Statistics:"
psql $DATABASE_URL -c "
  SELECT
    'conversations' as table_name,
    COUNT(*) as row_count,
    pg_size_pretty(pg_total_relation_size('conversations')) as size
  FROM conversations
  UNION ALL
  SELECT
    'conversation_messages',
    COUNT(*),
    pg_size_pretty(pg_total_relation_size('conversation_messages'))
  FROM conversation_messages;"

# 3. 메트릭 수집 상태 확인
echo -e "\nMetrics Collection Status:"
psql $DATABASE_URL -c "
  SELECT
    COUNT(*) as total_metrics,
    MAX(collected_at) as last_collected,
    NOW() - MAX(collected_at) as age_from_now
  FROM conversation_metrics_history;"

echo -e "\n✓ Daily health check completed"
```

### 주간 유지보수

```bash
#!/bin/bash
# scripts/weekly-maintenance.sh

echo "=== Weekly Conversation Sessions Maintenance ==="

# 1. VACUUM 실행
echo "Running VACUUM..."
psql $DATABASE_URL -c "
  VACUUM ANALYZE conversations;
  VACUUM ANALYZE conversation_messages;
  VACUUM ANALYZE conversation_read_status;
  VACUUM ANALYZE conversation_metrics_history;"

# 2. 통계 갱신
echo "Updating statistics..."
psql $DATABASE_URL -c "ANALYZE;"

# 3. 인덱스 효율성 확인
echo -e "\nIndex Efficiency:"
psql $DATABASE_URL -c "
  SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan as scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
  FROM pg_stat_user_indexes
  WHERE tablename LIKE 'conversation%'
  ORDER BY idx_scan DESC;"

echo -e "\n✓ Weekly maintenance completed"
```

### 월간 리포트

```bash
#!/bin/bash
# scripts/monthly-report.sh

echo "=== Monthly Conversation Sessions Report ==="

# 1. 성장 메트릭
psql $DATABASE_URL -c "
  SELECT
    DATE_TRUNC('day', collected_at)::date as date,
    (sessions_json->>'total')::int as total_sessions,
    (messages_json->>'total')::int as total_messages,
    (sessions_json->>'completionRate')::numeric as completion_rate
  FROM conversation_metrics_history
  WHERE collected_at > NOW() - INTERVAL '30 days'
  ORDER BY collected_at DESC;"

# 2. 참여자 분석
psql $DATABASE_URL -c "
  SELECT
    metrics_data->>'agentId' as agent_id,
    ROUND(AVG((metrics_data->>'messagesPosted')::numeric), 2) as avg_messages,
    ROUND(AVG((metrics_data->>'sessionsCreated')::numeric), 2) as avg_sessions
  FROM conversation_metrics_history,
       LATERAL jsonb_array_elements(participants_json) as metrics_data
  WHERE collected_at > NOW() - INTERVAL '30 days'
  GROUP BY agent_id
  ORDER BY avg_messages DESC;"

echo -e "\n✓ Monthly report generated"
```

---

## 5. 문제 해결

### 마이그레이션 실패

```bash
# 문제: "relation conversations already exists"
# 해결:
psql $DATABASE_URL -c "
  DROP TABLE IF EXISTS conversations CASCADE;
  DROP TABLE IF EXISTS conversation_messages CASCADE;
  DROP TABLE IF EXISTS conversation_read_status CASCADE;
  DROP TABLE IF EXISTS conversation_metrics_history CASCADE;
"
pnpm migrate

# 문제: 트리거 함수 에러
# 해결:
psql $DATABASE_URL -c "
  DROP TRIGGER IF EXISTS conversation_messages_update_conversation ON conversation_messages;
  DROP FUNCTION IF EXISTS update_conversation_updated_at;
"
pnpm migrate
```

### 메트릭 수집 안됨

```bash
# 1. 프로세스 확인
ps aux | grep collect-conversation-metrics

# 2. 데이터베이스 연결 확인
psql $DATABASE_URL -c "SELECT 1;"

# 3. 메트릭 테이블 확인
psql $DATABASE_URL -c "SELECT COUNT(*) FROM conversation_metrics_history;"

# 4. 수동 수집 시도
npx tsx scripts/collect-conversation-metrics.ts --once
```

### 높은 메트릭 쿼리 지연

```bash
# 1. 쿼리 분석
EXPLAIN ANALYZE
SELECT * FROM conversation_stats;

# 2. 인덱스 재구성
REINDEX INDEX CONCURRENTLY idx_conversation_messages_conversation;

# 3. 통계 갱신
ANALYZE conversation_messages;
```

---

## 6. 배포 전 최종 체크리스트

- [ ] `pnpm build` 성공
- [ ] `pnpm test` 모두 통과
- [ ] `pnpm lint` 오류 없음
- [ ] 마이그레이션 파일 검증 (`pnpm migrate:dry-run`)
- [ ] 환경 변수 설정 확인 (DATABASE_URL 등)
- [ ] 메트릭 수집 스크립트 테스트 (`--once` 플래그)
- [ ] API 엔드포인트 정상 응답 확인
- [ ] 백업 스크립트 설정 완료
- [ ] 모니터링 대시보드 설정 완료 (선택사항)
- [ ] 경보 규칙 설정 완료 (선택사항)

---

## 7. 배포 후 모니터링

### 첫 주

- 매일 메트릭 확인
- API 응답 시간 모니터링
- 데이터 무결성 검증
- 경고 및 에러 로그 확인

### 첫 달

- 성능 트렌드 분석
- 용량 계획 검토
- 백업 복구 테스트
- 모니터링 임계값 조정

---

## 8. 추가 리소스

- **상세 배포 가이드**: `docs/conversation-sessions-deployment.md`
- **모니터링 가이드**: `docs/conversation-sessions-monitoring.md`
- **API 문서**: `docs/conversation-sessions.md`
- **메트릭 구조**: `src/lib/conversation-metrics.ts`

---

## 지원 및 문제 보고

배포 중 문제가 발생하면:

1. 로그 확인: `logs/` 디렉토리
2. 관련 문서 검토
3. 데이터베이스 상태 점검
4. GitHub Issues 또는 팀 채널에 보고

---

**배포 완료!** 🎉

대화 세션 시스템이 이제 프로덕션 환경에서 실행되고 있습니다.
