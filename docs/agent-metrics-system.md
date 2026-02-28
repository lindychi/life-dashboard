# Agent Metrics System

## 📊 개요

에이전트 시스템의 실행 메트릭을 자동으로 수집하고 분석하여, 성능 개선 및 모델 최적화를 위한 데이터 기반 의사결정을 지원합니다.

## 🚀 설치

### 1. SQL 마이그레이션 실행

```bash
psql life_dashboard < sql/005_task_metrics.sql
```

이 마이그레이션은:
- `task_metrics` 테이블 생성 (태스크별 실행 메트릭 저장)
- 집계 뷰 생성 (`daily_agent_metrics`, `model_tier_effectiveness`, `timeout_analysis`)
- 자동 메트릭 기록 트리거 설정 (task_queue 완료 시 자동 복사)
- 데이터 정리 함수 (`cleanup_old_task_metrics` — 90일 보관)

### 2. 게이트웨이 재시작

메트릭 수집을 활성화하려면 gateway-connector를 재시작하세요:

```bash
pnpm gateway:restart
```

## 📈 메트릭 항목

### Task Metrics 테이블

| 필드 | 타입 | 설명 |
|------|------|------|
| `task_id` | UUID | 태스크 ID (task_queue FK) |
| `agent_id` | TEXT | 에이전트 ID |
| `started_at` | TIMESTAMPTZ | 시작 시각 |
| `completed_at` | TIMESTAMPTZ | 완료 시각 |
| `duration_ms` | INTEGER | 실행 시간 (ms) |
| `model_tier` | TEXT | 모델 tier (haiku/sonnet/opus) |
| `model_source` | TEXT | 모델 선택 소스 (explicit/agent_config/analysis/ecomode_cap) |
| `complexity_score` | INTEGER | 복잡도 점수 (0-100) |
| `status` | TEXT | 실행 결과 (completed/failed/timeout/hung) |
| `exit_code` | INTEGER | 종료 코드 (-2: hung, -1: timeout, 0: success) |
| `retry_count` | INTEGER | 재시도 횟수 |
| `provider` | TEXT | LLM 제공자 (claude/codex) |
| `fallback_used` | BOOLEAN | Codex fallback 사용 여부 |
| `num_turns` | INTEGER | LLM API 턴 수 |
| `total_cost_usd` | NUMERIC | 총 비용 (USD) |
| `tool_calls_count` | INTEGER | 도구 호출 횟수 |
| `tool_calls` | JSONB | 도구 호출 상세 내역 |
| `output_length` | INTEGER | 출력 길이 |
| `truncated` | BOOLEAN | 출력 잘림 여부 |

## 🔍 조회 방법

### 1. API 엔드포인트

#### GET /api/metrics

다양한 뷰로 메트릭 조회:

```bash
# Daily agent summary (최근 7일)
curl "http://localhost:3000/api/metrics?view=daily_agent&days=7"

# Model tier effectiveness
curl "http://localhost:3000/api/metrics?view=model_effectiveness"

# Timeout analysis
curl "http://localhost:3000/api/metrics?view=timeout_analysis"

# Raw metrics (특정 agent만)
curl "http://localhost:3000/api/metrics?view=raw&agent_id=qa&days=7"

# Raw metrics (특정 model tier)
curl "http://localhost:3000/api/metrics?view=raw&model_tier=opus&status=completed"
```

#### GET /api/metrics/summary

High-level 대시보드 요약:

```bash
curl "http://localhost:3000/api/metrics/summary?days=7"
```

반환 데이터:
- `overall`: 전체 통계 (총 태스크, 성공률, 평균 실행시간, 총 비용)
- `by_agent`: 에이전트별 breakdown
- `by_model`: 모델 tier별 breakdown
- `trend`: 일별 태스크 수 추이 (최근 7일)
- `top_failures`: 실패율 높은 에이전트 Top 10

### 2. SQL 직접 조회

```sql
-- 최근 7일 에이전트별 성능
SELECT * FROM daily_agent_metrics
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY date DESC, agent_id;

-- QA 에이전트 timeout 원인 분석
SELECT
  model_tier,
  COUNT(*) AS timeout_count,
  ROUND(AVG(duration_ms) / 1000.0, 1) AS avg_duration_sec,
  ROUND(AVG(complexity_score), 1) AS avg_complexity_score
FROM task_metrics
WHERE agent_id = 'qa' AND status IN ('timeout', 'hung')
  AND completed_at >= NOW() - INTERVAL '7 days'
GROUP BY model_tier;

-- 비용 효율성 분석 (성공 1건당 비용)
SELECT
  agent_id,
  model_tier,
  COUNT(*) AS total_tasks,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
  SUM(total_cost_usd) AS total_cost,
  ROUND(SUM(total_cost_usd) / NULLIF(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0), 4) AS cost_per_success
FROM task_metrics
WHERE completed_at >= NOW() - INTERVAL '7 days'
GROUP BY agent_id, model_tier
ORDER BY cost_per_success DESC NULLS LAST;
```

## 🎯 활용 사례

### 1. Phase 1 개선 효과 검증

QW-1~QW-4 개선사항 적용 전후 비교:

```sql
-- 개선 전 (2/24-25) vs 개선 후 (최근 2일) 비교
WITH before AS (
  SELECT
    agent_id,
    COUNT(*) AS total_tasks,
    ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate,
    ROUND(AVG(duration_ms) / 1000.0, 1) AS avg_duration_sec
  FROM task_metrics
  WHERE completed_at BETWEEN '2025-02-24' AND '2025-02-25 23:59:59'
  GROUP BY agent_id
),
after AS (
  SELECT
    agent_id,
    COUNT(*) AS total_tasks,
    ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate,
    ROUND(AVG(duration_ms) / 1000.0, 1) AS avg_duration_sec
  FROM task_metrics
  WHERE completed_at >= NOW() - INTERVAL '2 days'
  GROUP BY agent_id
)
SELECT
  COALESCE(before.agent_id, after.agent_id) AS agent_id,
  before.total_tasks AS before_tasks,
  after.total_tasks AS after_tasks,
  before.success_rate AS before_success_rate,
  after.success_rate AS after_success_rate,
  ROUND(after.success_rate - before.success_rate, 2) AS improvement
FROM before
FULL OUTER JOIN after USING (agent_id)
ORDER BY improvement DESC NULLS LAST;
```

### 2. Model Router 정확도 검증

Complexity score vs 실제 실행 시간 상관관계 분석:

```sql
SELECT
  CASE
    WHEN complexity_score < 20 THEN 'Low (< 20)'
    WHEN complexity_score < 60 THEN 'Medium (20-60)'
    ELSE 'High (>= 60)'
  END AS complexity_bucket,
  model_tier,
  COUNT(*) AS task_count,
  ROUND(AVG(duration_ms) / 1000.0, 1) AS avg_duration_sec,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) / 1000.0, 1) AS p95_duration_sec,
  ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 2) AS success_rate
FROM task_metrics
WHERE completed_at >= NOW() - INTERVAL '7 days'
GROUP BY complexity_bucket, model_tier
ORDER BY complexity_bucket, model_tier;
```

### 3. Timeout False Positive 감지

실제로 실행 중이었는데 hung으로 오판된 케이스 찾기:

```sql
-- 매우 긴 실행시간(>10분)을 가진 성공 태스크 (timeout threshold 검토 필요)
SELECT
  agent_id,
  model_tier,
  complexity_score,
  ROUND(duration_ms / 1000.0, 1) AS duration_sec,
  ROUND(duration_ms / 60000.0, 1) AS duration_min,
  provider,
  num_turns,
  started_at
FROM task_metrics
WHERE status = 'completed'
  AND duration_ms > 600000  -- 10분 초과
  AND completed_at >= NOW() - INTERVAL '7 days'
ORDER BY duration_ms DESC
LIMIT 20;
```

## 🧹 유지보수

### 데이터 정리

90일 이상 된 메트릭 자동 삭제:

```sql
SELECT cleanup_old_task_metrics();
```

### 디스크 사용량 모니터링

```sql
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename IN ('task_metrics', 'queue_metrics')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## 📊 대시보드 (Coming Soon)

LifeDashboard의 "Metrics" 탭에서 시각화 예정:

- 📈 **Trend Charts**: 일별 태스크 수, 성공률 추이
- 🎯 **Agent Performance**: 에이전트별 성공률, 평균 실행시간, 비용
- 🧠 **Model Effectiveness**: Tier별 정확도, 비용 효율성
- ⏰ **Timeout Analysis**: Timeout/hung 발생 빈도, 원인 분석
- 💰 **Cost Tracking**: 일별/에이전트별 비용 추이

## 🔧 트러블슈팅

### 메트릭이 수집되지 않는 경우

1. **트리거 확인**:
   ```sql
   SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trigger_auto_record_metrics';
   ```

2. **task_queue.metadata 확인**:
   ```sql
   SELECT id, agent_id, status, metadata
   FROM task_queue
   WHERE status IN ('completed', 'failed')
   ORDER BY created_at DESC
   LIMIT 5;
   ```

3. **수동 메트릭 기록**:
   ```sql
   -- 누락된 메트릭 수동 백필
   INSERT INTO task_metrics (...)
   SELECT ... FROM task_queue WHERE ...;
   ```

### 성능 이슈

인덱스가 제대로 생성되었는지 확인:

```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'task_metrics';
```

## 📚 참고

- [Model Router 설계](./omc-adoption-review.md#smart-model-routing)
- [Task Queue 시스템](../sql/002_task_queue.sql)
- [Queue Monitoring](../sql/003_queue_monitoring.sql)
