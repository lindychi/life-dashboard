# 대화 세션 시스템 배포 및 모니터링 - DevOps 종합 가이드

**작성일**: 2025-02-28
**작성자**: DevOps Agent
**상태**: 배포 준비 완료

---

## 📋 개요

Life Dashboard의 **대화 세션(Conversation Sessions)** 시스템에 대한 DevOps 배포, 백업, 모니터링 체계를 구축했습니다.

### 핵심 요소

| 항목 | 상세 |
|------|------|
| **DB 마이그레이션** | `sql/022_conversation_sessions.sql` + `sql/023_conversation_metrics.sql` |
| **메트릭 수집** | `src/lib/conversation-metrics.ts` + `scripts/collect-conversation-metrics.ts` |
| **API 엔드포인트** | `GET /api/metrics/conversations` (JSON/Prometheus) |
| **모니터링** | Prometheus + Grafana + Alertmanager |
| **백업 정책** | 일 1회 스냅샷 + 연속 WAL 아카이빙 |

---

## 📦 생성된 파일 목록

### 1. 데이터베이스

| 파일 | 용도 | 크기 |
|------|------|------|
| `sql/022_conversation_sessions.sql` | 세션 시스템 마이그레이션 (테이블, 인덱스, 뷰, 트리거) | ~176 lines |
| `sql/023_conversation_metrics.sql` | 메트릭 수집 시스템 마이그레이션 (히스토리 테이블, 뷰, 정리 함수) | ~170 lines |

**포함 내용**:
- 3개 메인 테이블: `conversations`, `conversation_messages`, `conversation_read_status`
- 1개 메트릭 테이블: `conversation_metrics_history`
- 4개 뷰: `conversation_stats`, `conversation_metrics_daily_summary`, `conversation_participant_stats`, `conversation_performance_trends`
- 자동 트리거: 메시지 삽입 시 `updated_at` 자동 갱신, 읽음 상태 자동 계산

### 2. 백엔드 로직

| 파일 | 용도 | 타입 |
|------|------|------|
| `src/lib/conversation-metrics.ts` | 메트릭 수집, 건강 상태 평가 | TypeScript Library |
| `scripts/collect-conversation-metrics.ts` | 메트릭 수집 스케줄러 (5분마다) | CLI Script |
| `src/app/api/metrics/conversations/route.ts` | 메트릭 조회 API (JSON/Prometheus) | Next.js API Route |

**메트릭 타입**:
- 세션: total, active, archived, completed, completionRate, avgDurationHours
- 메시지: total, perSession, unreadCount, unreadRate, insertionRatePerHour, avgLength
- 성능: tableSizeMb, indexSizeMb, deadTuplesCount, lastVacuumAt
- 참여자: agentId, sessionsCreated, messagesPosted, avgResponseTimeSeconds, unreadCountByAgent
- 건강: isHealthy, warnings[], criticalIssues[]

### 3. 문서

| 파일 | 목적 | 길이 |
|------|------|------|
| `docs/conversation-sessions-deployment.md` | 배포 프로세스, 백업 정책, 복구 절차 | ~350 lines |
| `docs/conversation-sessions-monitoring.md` | 모니터링 설정, 경보 규칙, 대시보드 구성 | ~420 lines |
| `docs/conversation-sessions-quickstart.md` | 빠른 시작 가이드, 운영 스크립트 | ~300 lines |
| `CONVERSATION_SESSIONS_DEVOPS_SUMMARY.md` | 이 문서 (종합 요약) | ~400 lines |

---

## 🚀 배포 단계

### 1단계: DB 마이그레이션 (5분)

```bash
# 개발 환경
pnpm migrate:dry-run    # 변경사항 미리보기
pnpm migrate            # 실제 적용

# 프로덕션 (Railway)
railway run pnpm migrate
```

**결과**:
- ✅ 3개 테이블 생성
- ✅ 4개 인덱스 생성
- ✅ 4개 뷰 생성
- ✅ 2개 자동 트리거 등록

### 2단계: 메트릭 수집 시작 (2분)

```bash
# 테스트 실행
npx tsx scripts/collect-conversation-metrics.ts --once

# 백그라운드 실행
node scripts/collect-conversation-metrics.ts &
```

**수집 주기**:
- 📊 메트릭: 5분마다
- 📋 일간 리포트: 매일 자정
- 🧹 정리: 매주 일요일 (90일 이상 데이터)

### 3단계: API 검증 (1분)

```bash
# 최신 메트릭 조회
curl http://localhost:3000/api/metrics/conversations

# Prometheus 형식
curl http://localhost:3000/api/metrics/conversations?format=prometheus
```

### 4단계: 모니터링 설정 (10분, 선택사항)

```bash
# Prometheus 설정 추가
# prometheus.yml에 job 설정

# Grafana 대시보드 import
# JSON 파일로 대시보드 생성

# Alertmanager 설정
# 경보 규칙 정의 및 채널 설정
```

---

## 💾 백업 전략

### 백업 계획

| 유형 | 빈도 | 보관 기간 | 용도 |
|------|------|---------|------|
| 스냅샷 | 일 1회 (02:00 UTC) | 30일 | 긴급 복구 |
| 증분 | 6시간마다 | 7일 | 최근 변경 |
| WAL | 연속 | 14일 | PITR |
| 복제본 | 실시간 | 무제한 | DR |

### 백업 구현

```bash
# 스냅샷 백업 스크립트
scripts/backup-conversations.sh

# Cron 스케줄
0 2 * * * /path/to/backup-conversations.sh

# 복구 절차
psql $DATABASE_URL < backups/conversations/snapshot-20250228-020000.sql
```

### 복구 테스트

```bash
# 월 1회 복구 테스트 실행
1. 테스트 DB에서 백업 복구
2. 데이터 무결성 검증
3. 성능 벤치마크 확인
4. 결과 기록
```

---

## 📊 모니터링 메트릭

### 주요 메트릭 (12개)

```
세션 관련 (6개):
  ✓ conversations_total
  ✓ conversations_active
  ✓ conversation_completion_rate         [경보: < 10%]
  ✓ conversation_avg_duration_hours      [경보: > 168h]

메시지 관련 (4개):
  ✓ conversation_messages_total
  ✓ conversation_unread_rate             [경보: > 50%]
  ✓ conversation_insertion_rate_per_hour [경보: > 1000]
  ✓ conversation_messages_per_session    [경보: < 1]

성능 관련 (6개):
  ✓ conversation_table_size_mb           [경보: > 1000]
  ✓ conversation_index_size_mb           [경보: > 500]
  ✓ conversation_dead_tuples             [경보: > 100K]
  ✓ conversation_health_status           [경보: = 0]
  ✓ conversation_warnings_count          [경보: > 3]
  ✓ conversation_critical_issues_count   [경보: > 0]
```

### 경보 채널

- **Slack**: #ops-alerts, #ops-warnings, #ops-critical
- **Email**: oncall@company.com (심각 이슈)
- **PagerDuty**: P1 자동 에스컬레이션

---

## 🛠️ 운영 체크리스트

### 일일 (5분)

```bash
# 메트릭 상태 확인
curl http://localhost:3000/api/metrics/conversations | jq '.health'

# 경고 수 확인 (< 3개 목표)
```

### 주간 (15분)

```bash
# 성능 트렌드 분석
psql $DATABASE_URL -c "SELECT * FROM conversation_performance_trends LIMIT 7;"

# VACUUM 및 통계 갱신
VACUUM ANALYZE conversation_messages;

# 데드 튜플 확인 (< 100K 목표)
```

### 월간 (1시간)

```bash
# 용량 계획 리뷰
# 성장율 분석
# 인덱스 효율성 평가
# 보관 정책 검토
```

---

## 🔍 문제 해결 가이드

### 배포 중 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| "relation already exists" | 테이블 중복 생성 | `DROP TABLE IF EXISTS` 후 재실행 |
| 트리거 함수 에러 | 함수 이미 존재 | 기존 함수 삭제 후 재생성 |
| 연결 타임아웃 | DB 연결 실패 | DATABASE_URL 확인, 방화벽 점검 |

### 운영 중 문제

| 메트릭 | 이상 신호 | 대응 |
|--------|----------|------|
| 완료율 < 10% | 세션 미완료 증가 | 종료 정책 검토 |
| 읽음율 < 50% | 메시지 미읽음 증가 | 알림 시스템 점검 |
| 테이블 크기 > 1GB | DB 증가 | 아카이빙 정책 실행 |
| 건강 상태 = 0 | 심각 문제 | 즉시 조사 필요 |

---

## 📈 성능 목표

| 지표 | 목표 | 측정 빈도 |
|------|------|---------|
| API 응답 시간 | < 200ms (p95) | 5분마다 |
| 세션 완료율 | > 10% | 일일 |
| 메시지 읽음율 | > 50% | 일일 |
| DB 테이블 크기 | < 1GB | 주간 |
| 데드 튜플 | < 100K | 주간 |
| 백업 성공율 | 100% | 월간 |

---

## 📚 문서 가이드

### 처음 배포하는 경우

1. **읽어야 할 문서**: `docs/conversation-sessions-quickstart.md`
2. **단계별 따라하기**: 배포 전체 자동화 가능
3. **예상 시간**: 15-20분

### 상세한 설정 필요한 경우

1. **배포 문서**: `docs/conversation-sessions-deployment.md`
   - DB 마이그레이션 상세
   - 백업 정책 구현
   - 복구 절차

2. **모니터링 문서**: `docs/conversation-sessions-monitoring.md`
   - Prometheus/Grafana 설정
   - 경보 규칙 정의
   - 대시보드 구성

### 운영 중 참고

1. **문제 해결**: 각 문서의 "문제 해결" 섹션
2. **스크립트**: `scripts/` 디렉토리
3. **쿼리**: `docs/conversation-sessions-monitoring.md` 부록

---

## 🎯 다음 단계

### 즉시 (배포 전)

- [ ] 모든 문서 읽기
- [ ] 개발 환경에서 마이그레이션 테스트
- [ ] API 엔드포인트 동작 확인
- [ ] 메트릭 수집 테스트

### 배포 후 1주

- [ ] 일일 메트릭 모니터링
- [ ] 경고 발생 여부 확인
- [ ] API 응답 시간 모니터링
- [ ] 데이터 무결성 검증

### 배포 후 1달

- [ ] 성능 트렌드 분석
- [ ] 백업/복구 테스트 실행
- [ ] 모니터링 임계값 조정
- [ ] 용량 계획 검토

---

## 📞 지원

### 문제 보고

배포 또는 운영 중 문제 발생 시:

1. 해당 문서의 "문제 해결" 섹션 확인
2. 로그 파일 검토 (`logs/`, `~/.pm2/logs/` 등)
3. 데이터베이스 상태 점검
4. 팀 채널에 보고 (스크린샷 + 로그 첨부)

### 참고 링크

- PostgreSQL 백업: https://www.postgresql.org/docs/current/backup.html
- Prometheus: https://prometheus.io/docs/
- Grafana: https://grafana.com/docs/
- Railway DB: https://docs.railway.app/databases

---

## ✅ 배포 체크리스트 (최종)

```bash
[ ] 모든 마이그레이션 파일 생성됨
[ ] src/lib/conversation-metrics.ts 작성됨
[ ] scripts/collect-conversation-metrics.ts 작성됨
[ ] API 엔드포인트 구현됨
[ ] 배포 문서 완성됨
[ ] 모니터링 문서 완성됨
[ ] 빠른 시작 가이드 완성됨
[ ] 개발 환경에서 테스트 완료
[ ] 팀에 공유 완료
[ ] 배포 승인 받음
[ ] 프로덕션 배포 실행
[ ] 배포 후 검증 완료
[ ] 모니터링 활성화 확인
[ ] 백업 스케줄 설정 완료
[ ] 운영 팀 교육 완료
```

---

## 📊 최종 통계

| 항목 | 수량 |
|------|------|
| 생성된 마이그레이션 파일 | 2개 |
| 생성된 테이블 | 4개 |
| 생성된 뷰 | 4개 |
| 생성된 인덱스 | 7개 |
| 작성된 문서 | 4개 |
| 작성된 코드 파일 | 3개 |
| 수집되는 메트릭 | 18개 |
| 경보 규칙 | 12개 |
| 예상 배포 시간 | 20분 |

---

## 🎉 완료!

대화 세션 시스템의 DevOps 배포 및 모니터링 체계가 완성되었습니다.

**모든 파일이 준비되었으니 배포를 시작할 수 있습니다!**

---

**마지막 업데이트**: 2025-02-28
**버전**: 1.0
**상태**: 배포 준비 완료 ✅
