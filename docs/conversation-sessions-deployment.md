# 대화 세션 시스템 배포 및 모니터링 가이드

## 개요

대화 세션(Conversation Sessions) 시스템은 PostgreSQL 기반의 컨텍스트 관리 및 메시지 히스토리 저장 시스템입니다. 이 문서는 배포, 백업 정책, 메트릭 수집을 다룹니다.

---

## 1. DB 마이그레이션 배포 프로세스

### 1.1 마이그레이션 파일 구성

**파일**: `sql/022_conversation_sessions.sql`

**포함 내용**:
- `conversations` 테이블 (세션 메타데이터)
- `conversation_messages` 테이블 (메시지 히스토리)
- `conversation_read_status` 테이블 (읽음 상태 추적)
- 인덱스 3개 + 뷰 1개
- 트리거 함수 2개 (자동 업데이트)

### 1.2 배포 체크리스트

```bash
# 1. 마이그레이션 파일 검증
psql $DATABASE_URL -f sql/022_conversation_sessions.sql --dry-run

# 2. 스냅샷 생성 (배포 전)
pg_dump $DATABASE_URL > backups/pre-migration-$(date +%Y%m%d-%H%M%S).sql

# 3. 마이그레이션 실행
psql $DATABASE_URL -f sql/022_conversation_sessions.sql

# 4. 배포 후 검증
psql $DATABASE_URL -c "
  SELECT tablename FROM pg_tables
  WHERE tablename IN ('conversations', 'conversation_messages', 'conversation_read_status')
  AND schemaname = 'public';"

# 5. 인덱스 확인
psql $DATABASE_URL -c "\di *conversation*"

# 6. 뷰 확인
psql $DATABASE_URL -c "\dv conversation*"
```

### 1.3 배포 스크립트 (npm 통합)

마이그레이션 스크립트 추가 (`scripts/migrate.ts`에 이미 포함됨):

```typescript
// 기존 migrate.ts에 다음 추가
async function migrateConversationSessions() {
  const migrationFile = path.join(__dirname, '../sql/022_conversation_sessions.sql');
  const sql = fs.readFileSync(migrationFile, 'utf-8');

  try {
    await pool.query(sql);
    console.log('✓ Conversation sessions migration applied successfully');
  } catch (error) {
    console.error('✗ Migration failed:', error);
    throw error;
  }
}
```

**배포 명령어**:
```bash
# 드라이 런 (변경 없음)
pnpm migrate:dry-run

# 실제 배포
pnpm migrate

# 리셋 (개발 환경만)
pnpm migrate:reset
```

### 1.4 Railway 배포 파이프라인

**railway.toml** 환경 변수:
```toml
[env]
DATABASE_URL = "postgresql://..."
```

**배포 전 체크**:
1. `npm run predeploy` 실행 (빌드 + 테스트 + 마이그레이션 검증)
2. GitHub Actions CI/CD 통과 확인
3. Railway 환경 변수 설정 확인

---

## 2. 세션 데이터 백업 정책

### 2.1 백업 전략

| 백업 유형 | 빈도 | 보관 기간 | 용도 |
|---------|------|---------|------|
| **스냅샷** | 일 1회 (UTC 02:00) | 30일 | 긴급 복구, 감사 |
| **증분** | 일 4회 (6시간마다) | 7일 | 최근 변경사항 |
| **트랜잭션 로그** | 연속 아카이빙 | 14일 | PITR (Point-In-Time Recovery) |
| **해외 레플리카** | 실시간 동기화 | 무제한 | DR (Disaster Recovery) |

### 2.2 PostgreSQL 백업 설정

**방법 1: pg_dump (논리 백업)**

```bash
#!/bin/bash
# scripts/backup-conversations.sh

BACKUP_DIR="backups/conversations"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DB_NAME="life_dashboard"

mkdir -p "$BACKUP_DIR"

# 스냅샷 백업
pg_dump "$DATABASE_URL" \
  --table=conversations \
  --table=conversation_messages \
  --table=conversation_read_status \
  --data-only \
  > "$BACKUP_DIR/snapshot-$TIMESTAMP.sql"

# 압축
gzip "$BACKUP_DIR/snapshot-$TIMESTAMP.sql"

# 30일 이상된 백업 삭제
find "$BACKUP_DIR" -name "snapshot-*.sql.gz" -mtime +30 -delete

echo "✓ Backup created: $BACKUP_DIR/snapshot-$TIMESTAMP.sql.gz"
```

**방법 2: WAL 아카이빙 (Railway PostgreSQL)**

Railway가 자동 백업을 제공하므로 추가 설정 필요 없음:
- 일일 자동 백업
- 7일 보관
- 복구 시간 RTO ≤ 1시간

**Railway 백업 조회**:
```bash
railway link   # Railway 프로젝트 연결
railway data backup list
railway data backup restore <backup-id>
```

### 2.3 보관 정책

```bash
# cron job 설정 (scripts/backup-cron.ts)
import { CronJob } from 'croner';

// 매일 02:00 UTC
new CronJob('0 2 * * *', async () => {
  await backupConversationSessions();
  console.log('Daily conversation backup completed');
});

// 매주 일요일 00:00 UTC (전체 스냅샷)
new CronJob('0 0 ? * SUN', async () => {
  await fullDatabaseBackup();
  console.log('Weekly full backup completed');
});
```

### 2.4 복구 절차

**시나리오 1: 특정 메시지 복구**

```bash
# 백업 파일로부터 특정 테이블만 복구
psql $DATABASE_URL < backups/conversations/snapshot-20250228-020000.sql

# 또는 특정 시점 복구 (PITR)
pg_restore --data-only --table=conversation_messages \
  backups/conversations/snapshot-20250228-020000.sql | psql $DATABASE_URL
```

**시나리오 2: 전체 데이터베이스 복구**

```bash
# Railway 대시보드에서 backup restore 트리거
railway data backup restore <backup-id>
```

**시나리오 3: 로컬 개발 환경 테스트**

```bash
# 프로덕션 스냅샷으로 로컬 DB 초기화
psql life_dashboard_dev < backups/conversations/snapshot-latest.sql
```

---

## 3. 세션 사용 메트릭 수집

### 3.1 메트릭 정의

#### 3.1.1 세션 메트릭

| 메트릭 | 설명 | 단위 | 경보 임계값 |
|--------|------|------|-----------|
| `conversations.total` | 총 세션 수 | count | - |
| `conversations.active` | 활성 세션 수 | count | - |
| `conversations.archived` | 보관 세션 수 | count | - |
| `conversations.completion_rate` | 완료율 | % | < 10% (경고) |
| `conversations.avg_duration` | 평균 지속 시간 | hours | > 168h (경고) |

#### 3.1.2 메시지 메트릭

| 메트릭 | 설명 | 단위 | 경보 임계값 |
|--------|------|------|-----------|
| `messages.total` | 총 메시지 수 | count | - |
| `messages.per_session` | 세션당 평균 메시지 | count | < 1 (경고) |
| `messages.unread_rate` | 읽지 않은 메시지 비율 | % | > 50% (경고) |
| `messages.insertion_rate` | 초당 메시지 삽입 | msg/sec | > 100 (경고) |

#### 3.1.3 성능 메트릭

| 메트릭 | 설명 | 단위 | 경보 임계값 |
|--------|------|------|-----------|
| `db.query_time.p95` | 쿼리 P95 지연 | ms | > 500ms |
| `db.table_size.conversations` | conversations 테이블 크기 | MB | > 1000 MB |
| `db.index_size` | 인덱스 총 크기 | MB | > 500 MB |
| `db.dead_tuples` | 데드 튜플 수 | count | > 100K |

### 3.2 메트릭 수집 구현

**파일**: `src/lib/conversation-metrics.ts`

```typescript
import { query, queryOne } from "./db";

export interface ConversationMetrics {
  sessions: {
    total: number;
    active: number;
    archived: number;
    completionRate: number;
    avgDuration: number;
  };
  messages: {
    total: number;
    perSession: number;
    unreadRate: number;
    insertionRate: number;
  };
  performance: {
    avgQueryTime: number;
    tableSize: number;
    indexSize: number;
    deadTuples: number;
  };
  timestamp: string;
}

/**
 * 세션 메트릭 수집
 */
export async function collectConversationMetrics(): Promise<ConversationMetrics> {
  // 1. 세션 메트릭
  const sessionStats = await queryOne<{
    total: number;
    active: number;
    archived: number;
    completed: number;
    avg_duration_hours: number;
  }>(
    `SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'active') as active,
      COUNT(*) FILTER (WHERE status = 'archived') as archived,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      EXTRACT(EPOCH FROM AVG(COALESCE(archived_at, NOW()) - created_at)) / 3600 as avg_duration_hours
    FROM conversations`
  );

  const completionRate = sessionStats
    ? ((sessionStats.completed / sessionStats.total) * 100).toFixed(2)
    : 0;

  // 2. 메시지 메트릭
  const messageStats = await queryOne<{
    total: number;
    avg_per_session: number;
    unread_count: number;
    insertion_rate: number;
  }>(
    `SELECT
      COUNT(*) as total,
      COUNT(*) / NULLIF(
        (SELECT COUNT(*) FROM conversations WHERE status = 'active'), 0
      ) as avg_per_session,
      SUM(unread_count) as unread_count,
      -- 지난 1시간 메시지 삽입율
      (SELECT COUNT(*) FROM conversation_messages
       WHERE created_at > NOW() - INTERVAL '1 hour') as insertion_rate
    FROM conversation_messages`
  );

  const unreadRate = messageStats && messageStats.total > 0
    ? ((messageStats.unread_count / messageStats.total) * 100).toFixed(2)
    : 0;

  // 3. 성능 메트릭
  const perfStats = await queryOne<{
    table_size_mb: number;
    index_size_mb: number;
    dead_tuples: number;
  }>(
    `SELECT
      pg_total_relation_size('conversations') / 1024 / 1024 as table_size_mb,
      pg_total_relation_size('conversation_messages') / 1024 / 1024 as total_msg_size_mb,
      (SELECT SUM(n_dead_tup) FROM pg_stat_user_tables
       WHERE relname IN ('conversations', 'conversation_messages')) as dead_tuples
    FROM (SELECT 1) t`
  );

  return {
    sessions: {
      total: sessionStats?.total || 0,
      active: sessionStats?.active || 0,
      archived: sessionStats?.archived || 0,
      completionRate: Number(completionRate),
      avgDuration: sessionStats?.avg_duration_hours || 0,
    },
    messages: {
      total: messageStats?.total || 0,
      perSession: messageStats?.avg_per_session || 0,
      unreadRate: Number(unreadRate),
      insertionRate: messageStats?.insertion_rate || 0,
    },
    performance: {
      avgQueryTime: 0, // 별도 계산
      tableSize: perfStats?.table_size_mb || 0,
      indexSize: perfStats?.index_size_mb || 0,
      deadTuples: perfStats?.dead_tuples || 0,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * 메트릭 저장 (별도 테이블)
 */
export async function saveMetricsSnapshot(
  metrics: ConversationMetrics
): Promise<void> {
  await query(
    `INSERT INTO conversation_metrics_history
     (sessions_json, messages_json, performance_json, collected_at)
    VALUES ($1, $2, $3, $4)`,
    [
      JSON.stringify(metrics.sessions),
      JSON.stringify(metrics.messages),
      JSON.stringify(metrics.performance),
      metrics.timestamp,
    ]
  );
}
```

### 3.3 메트릭 저장 테이블

**파일**: `sql/023_conversation_metrics.sql`

```sql
-- 메트릭 히스토리 테이블
CREATE TABLE IF NOT EXISTS conversation_metrics_history (
  id SERIAL PRIMARY KEY,
  sessions_json JSONB NOT NULL,
  messages_json JSONB NOT NULL,
  performance_json JSONB NOT NULL,
  collected_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_metrics_collected_at ON conversation_metrics_history(collected_at DESC);

-- 7일 이상 오래된 메트릭 자동 정리 (옵션)
CREATE OR REPLACE FUNCTION cleanup_old_metrics()
RETURNS void AS $$
BEGIN
  DELETE FROM conversation_metrics_history
  WHERE collected_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;
```

### 3.4 메트릭 수집 스케줄

**파일**: `scripts/collect-conversation-metrics.ts`

```typescript
import { CronJob } from 'croner';
import {
  collectConversationMetrics,
  saveMetricsSnapshot
} from '@/lib/conversation-metrics';

// 매 5분마다 메트릭 수집
new CronJob('*/5 * * * *', async () => {
  try {
    const metrics = await collectConversationMetrics();
    await saveMetricsSnapshot(metrics);
    console.log('✓ Metrics collected:', metrics);
  } catch (error) {
    console.error('✗ Metrics collection failed:', error);
  }
});

// 매일 00:00 UTC 리포트 생성
new CronJob('0 0 * * *', async () => {
  try {
    const report = await generateDailyReport();
    console.log('✓ Daily report generated:', report);
  } catch (error) {
    console.error('✗ Report generation failed:', error);
  }
});
```

### 3.5 모니터링 대시보드 (옵션)

**prometheus 메트릭 엔드포인트** (`/api/metrics/conversations`)

```typescript
// src/app/api/metrics/conversations/route.ts
import { collectConversationMetrics } from '@/lib/conversation-metrics';

export async function GET() {
  const metrics = await collectConversationMetrics();

  const prometheusFormat = `
# HELP conversations_total Total number of conversations
# TYPE conversations_total gauge
conversations_total ${metrics.sessions.total}

# HELP conversations_active Active conversations
# TYPE conversations_active gauge
conversations_active ${metrics.sessions.active}

# HELP conversation_messages_total Total messages
# TYPE conversation_messages_total gauge
conversation_messages_total ${metrics.messages.total}

# HELP conversation_unread_rate Unread message rate
# TYPE conversation_unread_rate gauge
conversation_unread_rate ${metrics.messages.unreadRate}

# HELP conversation_db_table_size_bytes Table size in bytes
# TYPE conversation_db_table_size_bytes gauge
conversation_db_table_size_bytes ${metrics.performance.tableSize * 1024 * 1024}
  `.trim();

  return new Response(prometheusFormat, {
    headers: { 'Content-Type': 'text/plain' },
  });
}
```

---

## 4. 모니터링 및 경보

### 4.1 경보 규칙

```yaml
# prometheus 경보 규칙 (prometheus.yml)
groups:
  - name: conversation_sessions
    rules:
      - alert: HighUnreadMessageRate
        expr: conversation_unread_rate > 50
        for: 5m
        annotations:
          summary: "High unread message rate ({{ $value }}%)"

      - alert: LowCompletionRate
        expr: conversations_completion_rate < 10
        for: 1h
        annotations:
          summary: "Low session completion rate ({{ $value }}%)"

      - alert: DatabaseSizeWarning
        expr: conversation_db_table_size_bytes > 1073741824  # 1GB
        annotations:
          summary: "Conversation table size exceeds 1GB"

      - alert: HighMessageInsertionRate
        expr: rate(conversation_messages_total[5m]) > 100
        annotations:
          summary: "High message insertion rate ({{ $value }} msg/sec)"
```

### 4.2 경보 채널

- **Slack 알림**: 중요 경보는 `#ops-alerts` 채널로 전송
- **Email**: 심각한 장애 (P1)는 on-call 엔지니어에게 메일 발송
- **PagerDuty**: 데이터 손실 위험 상황

---

## 5. 배포 및 운영 체크리스트

### 배포 전

- [ ] DB 마이그레이션 파일 검증 (`sql/022_conversation_sessions.sql`)
- [ ] 스냅샷 백업 생성
- [ ] 개발 환경에서 마이그레이션 테스트 완료
- [ ] npm test 및 타입 검사 통과
- [ ] API 엔드포인트 테스트 완료

### 배포 중

- [ ] `pnpm migrate` 실행 (프로덕션)
- [ ] Railway 배포 모니터링 (상태 확인)
- [ ] 에러 로그 감시 (5분)

### 배포 후

- [ ] 테이블 및 인덱스 생성 확인
- [ ] MCP 도구 테스트 (`dashboard_create_conversation` 등)
- [ ] API 엔드포인트 응답 확인
- [ ] 메트릭 수집 시작 확인

### 주간 운영

- [ ] 백업 상태 확인
- [ ] 메트릭 대시보드 검토
- [ ] 데드 튜플 정리 (`VACUUM`)
- [ ] 느린 쿼리 분석

### 월간 운영

- [ ] 성능 리뷰 (인덱스 효율성)
- [ ] 용량 계획 (테이블 크기 증가 추세)
- [ ] 보관 정책 검토 (오래된 세션 아카이빙)

---

## 6. 문제 해결

### 6.1 마이그레이션 실패

```bash
# 1. 오류 메시지 확인
psql $DATABASE_URL -f sql/022_conversation_sessions.sql

# 2. 기존 테이블 확인
psql $DATABASE_URL -c "\dt conversations*"

# 3. 롤백 (테이블 존재하면 DROP)
psql $DATABASE_URL -c "DROP TABLE IF EXISTS conversations CASCADE;"

# 4. 재시도
psql $DATABASE_URL -f sql/022_conversation_sessions.sql
```

### 6.2 높은 쿼리 지연

```bash
# 1. 느린 쿼리 식별
psql $DATABASE_URL -c "
  SELECT query, calls, total_time, mean_time
  FROM pg_stat_statements
  WHERE query LIKE '%conversation%'
  ORDER BY mean_time DESC LIMIT 10;"

# 2. EXPLAIN 분석
psql $DATABASE_URL -c "
  EXPLAIN ANALYZE
  SELECT * FROM conversation_messages
  WHERE conversation_id = '...'
  ORDER BY created_at DESC
  LIMIT 100;"

# 3. 인덱스 재구성 (필요시)
psql $DATABASE_URL -c "REINDEX TABLE conversation_messages;"
```

### 6.3 데이터 불일치

```bash
# 읽음 상태 재계산
psql $DATABASE_URL -c "
  SELECT update_conversation_unread_counts(id)
  FROM conversations;"

# 통계 정보 갱신
psql $DATABASE_URL -c "ANALYZE conversation_messages;"
```

---

## 부록: 스크립트 예시

### railway-migrate.sh

```bash
#!/bin/bash
set -e

echo "=== Conversation Sessions Migration ==="

# Railway 환경 확인
if [ -z "$RAILWAY_ENVIRONMENT_ID" ]; then
  echo "✗ Not running in Railway environment"
  exit 1
fi

# 백업 생성
echo "Creating pre-migration backup..."
railway run pg_dump "$DATABASE_URL" > /tmp/pre-migration.sql

# 마이그레이션 실행
echo "Running migration..."
railway run psql "$DATABASE_URL" -f sql/022_conversation_sessions.sql

# 검증
echo "Validating migration..."
railway run psql "$DATABASE_URL" -c "
  SELECT COUNT(*) as table_count
  FROM information_schema.tables
  WHERE table_name IN ('conversations', 'conversation_messages', 'conversation_read_status')
  AND table_schema = 'public';"

echo "✓ Migration completed successfully"
```

---

## 참고 자료

- [PostgreSQL Backup & Restore](https://www.postgresql.org/docs/current/backup.html)
- [Railway Data Management](https://docs.railway.app/databases)
- [Prometheus Monitoring](https://prometheus.io/docs/)

