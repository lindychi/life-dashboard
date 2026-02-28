# 🎯 에이전트 시스템 개선사항 적용 완료 (2025-02-27)

## 📊 기준 데이터 (2/24-25 운영 분석)
- **전체 태스크**: 59 시작 / 49 완료 / 8 실패 (성공률 83.1%)
- **최대 병목**: QA 에이전트 60% 실패율 (전부 5분 hung timeout)
- **고착 에이전트**: growth, reviewer — error 상태 2일 이상 방치
- **사용 패턴**: 이중 피크 (오후 12~14시 정밀작업, 저녁 20~22시 대규모 개발)

---

## ✅ 적용 완료 항목

### 🟢 Phase 1: Quick Wins (설정 변경)

#### QW-1: Complex task regex 확장
- **파일**: `scripts/model-router.ts` L42-46
- **변경내용**: 복잡도 감지 패턴에 QA/테스트, 배포, 계획, 성능 추가
- **기대효과**: QA 태스크가 더 정확하게 opus/sonnet으로 라우팅됨

#### QW-2: Complexity threshold 상향
- **파일**: `scripts/model-router.ts` L67-70
- **변경내용**: opus 임계값 50→60, sonnet 15→20으로 상향
- **기대효과**: 불필요한 opus 프로모션 감소, 비용 절감

#### QW-3: Base stale timeout 증가
- **파일**: `scripts/model-router.ts` L176, L179-186
- **변경내용**: 기본 timeout 5분→8분 (haiku 2.5→4.8분, opus 7.5→12분)
- **기대효과**: QA 실패율 60%→<20% 예상

#### QW-4: QA 에이전트 timeout 강화
- **파일**: `scripts/gateway-connector.ts` L686, L1077
- **변경내용**: QA 전용 floor 10분→15분 (test + analysis)
- **기대효과**: QA hung 오탐지 대폭 감소

#### QW-5: Stuck agent 자동 알림
- **파일**: `scripts/gateway-connector.ts` L1224-1287
- **변경내용**: 2일 이상 error 상태 시 PM에게 자동 메시지 전송
- **기대효과**: growth/reviewer같은 고착 에이전트 조기 발견

---

### 🟡 Phase 2: Architecture (코드 변경)

#### AR-1: 에이전트별 retry 횟수 차등화
- **파일**: `scripts/gateway-connector.ts` L695-704, L1083
- **변경내용**: QA 에이전트만 3회 retry (others 2회)
- **기대효과**: test infrastructure 일시 장애 대응력 향상

---

### 🔵 Phase 3: Intelligence (보류 - 패키지 필요)

#### IN-1: 에이전트별 성공률 추적 및 자동 모델 승격
- **상태**: 코드 작성 완료, better-sqlite3 패키지 필요
- **파일**: `scripts/agent-intelligence.ts` (신규 작성 완료)
- **로직**: 실패율 30% 초과 시 haiku→sonnet→opus 자동 승격
- **필요 작업**: `pnpm add better-sqlite3 && pnpm add -D @types/better-sqlite3`
- **통합 지점**: gateway-connector의 task_completed/task_failed 핸들러

---

## 📈 기대 효과 및 측정 지표

### 1. QA 에이전트 성공률 향상
| 지표 | 현재 (2/24-25) | 목표 (1주 후) |
|------|----------------|---------------|
| QA 성공률 | 40% | >80% |
| QA hung timeout | 60% (5건/8건) | <20% (1건/5건) |
| 평균 QA 소요시간 | ~5분 (timeout) | 5~10분 (정상 완료) |

### 2. 전체 시스템 안정성
| 지표 | 현재 (2/24-25) | 목표 (1주 후) |
|------|----------------|---------------|
| 전체 성공률 | 83.1% (49/59) | >90% (>90/100) |
| hung timeout 비율 | 8.5% (5/59) | <5% (<5/100) |
| 고착 에이전트 | 2개 (growth, reviewer) | 0개 |

### 3. 비용 최적화
| 지표 | 현재 추정 | 목표 (1주 후) |
|------|-----------|---------------|
| opus 사용 비율 | ~30% | <20% (threshold 상향 효과) |
| 불필요한 retry | 알 수 없음 | 측정 가능 (retry 차등화) |

---

## 🔍 측정 방법

### 자동 분석 스크립트 실행
```bash
# 1주일 후 (3/6) 데이터 수집
pnpm analyze:agents

# 비교 리포트 생성
pnpm analyze:report --since 2025-02-27 --compare 2025-02-24
```

### 수동 SQL 쿼리 (PostgreSQL)
```sql
-- QA 에이전트 성공률 (최근 7일)
SELECT
  COUNT(*) FILTER (WHERE type = 'task_completed') AS completed,
  COUNT(*) FILTER (WHERE type = 'task_failed') AS failed,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE type = 'task_completed') /
    NULLIF(COUNT(*), 0),
    1
  ) AS success_rate_pct
FROM agent_history
WHERE agent_id = 'qa'
  AND created_at >= NOW() - INTERVAL '7 days'
  AND type IN ('task_completed', 'task_failed');

-- Hung timeout 비율 (전체 에이전트, 최근 7일)
SELECT
  agent_id,
  COUNT(*) FILTER (WHERE metadata->>'isHung' = 'true') AS hung_count,
  COUNT(*) AS total_failures,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE metadata->>'isHung' = 'true') /
    NULLIF(COUNT(*), 0),
    1
  ) AS hung_pct
FROM agent_history
WHERE type = 'task_failed'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY agent_id
ORDER BY hung_pct DESC;

-- 모델 티어별 사용 분포 (최근 7일)
SELECT
  metadata->>'modelTier' AS model_tier,
  COUNT(*) AS task_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS usage_pct
FROM agent_history
WHERE type IN ('task_completed', 'task_failed')
  AND metadata->>'modelTier' IS NOT NULL
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY metadata->>'modelTier'
ORDER BY task_count DESC;

-- 고착 에이전트 감지 (error 상태 > 1시간)
SELECT
  agent_id,
  type,
  content,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS hours_stuck
FROM agent_history
WHERE type = 'status_change'
  AND content LIKE '%error%'
  AND created_at >= NOW() - INTERVAL '1 day'
ORDER BY created_at DESC;
```

---

## 🚀 다음 단계 (Phase 3 완료 후)

### 1. better-sqlite3 설치 후 IN-1 통합
```bash
pnpm add better-sqlite3 && pnpm add -D @types/better-sqlite3

# gateway-connector.ts에 recordTaskResult() 호출 추가:
# - L813 (task_completed 직후)
# - L854 (task_failed 직후)
```

### 2. Intelligence 대시보드 UI 추가
- `/api/agent-stats` 엔드포인트 생성
- Dashboard에 "Agent Performance" 탭 추가
- 에이전트별 성공률, 프로모션 이력 시각화

### 3. 추가 Intelligence 기능 (Phase 4)
- **IN-2**: 실패 패턴 분석 (특정 task 유형에서 반복 실패)
- **IN-3**: 시간대별 성능 분석 (피크 시간대 timeout 조정)
- **IN-4**: 에이전트 간 협업 최적화 (orchestrator → 서브태스크 매핑)

---

## 📝 배포 체크리스트

- [x] Phase 1 Quick Wins 적용
- [x] Phase 2 Architecture 변경
- [ ] Phase 3 Intelligence (패키지 설치 필요)
- [ ] gateway 재시작 (launchd가 자동 재시작하므로 코드만 반영하면 됨)
- [ ] 1주일 후 지표 확인 (3/6)
- [ ] 개선효과 검증 및 Phase 4 계획
