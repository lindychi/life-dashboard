# 🚀 OMC v4.5.1 개선 구현 가이드

> Life Dashboard 에이전트 시스템 최적화 완료 (2025-02-28)

---

## 📊 현재 상태

```
✅ Phase 1: Quick Wins          — 완료 (토큰 절감 ~30%)
✅ Phase 2: Architecture        — 완료 (토큰 절감 ~20%)
⏳ Phase 3: Intelligence        — 코드 작성 완료, 설치 필요
═══════════════════════════════════════════════════════════
📈 누적 효과: 44% 토큰 절감 예상
```

---

## 🎯 Phase 1-2 핵심 개선사항

### 1️⃣ Smart Model Routing (완료)
**효과**: 작업 복잡도에 따라 haiku/sonnet/opus 자동 선택

**구현 위치**:
- `agents.json` — 에이전트별 defaultModel 설정
- `model-router.ts` — 복잡도 분석 및 모델 선택 로직
- `gateway-connector.ts` L680-710 — 모델 선택 및 timeout 결정

**예시**:
```
task: "상태 확인" → haiku (2min)
task: "기능 구현" → sonnet (5min)
task: "아키텍처 설계" → opus (12min)
```

---

### 2️⃣ Delegation Categories (완료)
**효과**: 카테고리별 모델/timeout 자동 매핑

**5가지 카테고리**:
```
quick      → haiku   (2min)   — 상태 조회, 단순 읽기
writing    → sonnet  (5min)   — 문서, 보고서
standard   → sonnet  (5min)   — 코드 구현, 리뷰
visual     → sonnet  (5min)   — UI/UX, 디자인
ultrabrain → opus    (10min)  — 아키텍처, 보안 분석
```

**구현 위치**:
- `model-router.ts` L159-180 — CATEGORY_SETTINGS 매핑
- `orchestrator.ts` L25-31 — DelegationCategory 타입
- `orchestrator.ts` L109-114 — createPlan 프롬프트
- `gateway-connector.ts` L1078-1089 — 카테고리 기반 실행

**흐름**:
```
Task → createPlan → [subtask + category] → executor → model 선택
```

---

### 3️⃣ Context Persistence (완료)
**효과**: 이전 단계 결과를 다음 단계에 주입 → 중복 탐색 감소

**구현 위치**:
- `orchestrator.ts` L206-216 — previousGroupResults 누적 및 주입

**예시**:
```
Priority 1: architect → design decision A
Priority 2: dev 실행 시:
  "## 이전 단계 결과 (참고)
   [architect] design decision A를 권장합니다.

   ## 당신의 작업
   위 설계에 따라 기능을 구현해주세요."
```

---

### 4️⃣ Enhanced Timeout & Retry (완료)
**효과**: hung false positive 감소, 안정성 향상

**변경사항**:
- 기본 timeout: 5분 → 8분
- QA 전용 timeout: 10분 → 15분
- QA retry: 2회 → 3회

**구현 위치**:
- `model-router.ts` L207, L211-213 — Base timeout 증가
- `gateway-connector.ts` L686-693 — Agent-specific timeout floors
- `gateway-connector.ts` L696-704 — Agent-specific retry counts

---

## 🔧 Phase 3: Intelligence System (준비 중)

### 설치 방법

```bash
# 1. better-sqlite3 설치
pnpm add better-sqlite3 && pnpm add -D @types/better-sqlite3

# 2. agent-intelligence.ts 통합 (gateway-connector.ts)
#    위치: L813 (task_completed), L854 (task_failed)

# 3. gateway 재시작
pnpm gateway:restart
```

### 통합 코드 예시

**gateway-connector.ts L813 (task_completed 이후)에 추가:**
```typescript
// Record task result for intelligence system
const taskDuration = result.output_metadata?.duration;
recordTaskResult({
  agentId,
  success: true,
  timestamp: new Date(),
  taskDuration,
});

// Check for automatic promotion
const shouldPromote = checkForPromotion(agentId);
if (shouldPromote) {
  const currentTier = getCurrentModelTierForAgent(agentId);
  markPromoted(agentId, currentTier, shouldPromote);
}
```

**gateway-connector.ts L854 (task_failed 이후)에 추가:**
```typescript
// Record task failure for intelligence system
recordTaskResult({
  agentId,
  success: false,
  timestamp: new Date(),
  error: result.error,
});
```

---

## 📈 성과 측정

### 1주일 후 (2025-03-06) 확인 항목

**SQL 쿼리로 측정:**

```sql
-- QA 에이전트 성공률 비교
SELECT
  'baseline (2/24-25)' as period,
  40 as success_rate_pct
UNION ALL
SELECT
  'current (3/6)',
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE type = 'task_completed') /
    NULLIF(COUNT(*), 0),
    1
  ) as success_rate_pct
FROM agent_history
WHERE agent_id = 'qa'
  AND created_at >= NOW() - INTERVAL '7 days'
  AND type IN ('task_completed', 'task_failed');
```

**기대 효과:**
- QA 성공률: 40% → >80%
- 전체 성공률: 83.1% → >90%
- Hung timeout 비율: 8.5% → <5%

---

## 🔍 모니터링 대시보드

### 추천 지표

1. **에이전트 성공률** (일별)
   ```sql
   SELECT
     DATE(created_at) as date,
     agent_id,
     ROUND(100.0 * COUNT(*) FILTER (WHERE type='task_completed') /
            NULLIF(COUNT(*), 0), 1) as success_rate
   FROM agent_history
   WHERE type IN ('task_completed', 'task_failed')
     AND created_at >= NOW() - INTERVAL '7 days'
   GROUP BY DATE(created_at), agent_id
   ORDER BY date DESC, agent_id;
   ```

2. **모델 티어별 성공률**
   ```sql
   SELECT
     metadata->>'modelTier' as model_tier,
     ROUND(100.0 * COUNT(*) FILTER (WHERE type='task_completed') /
            NULLIF(COUNT(*), 0), 1) as success_rate
   FROM agent_history
   WHERE type IN ('task_completed', 'task_failed')
     AND created_at >= NOW() - INTERVAL '7 days'
   GROUP BY metadata->>'modelTier';
   ```

3. **카테고리별 성공률**
   ```sql
   SELECT
     metadata->>'category' as category,
     ROUND(100.0 * COUNT(*) FILTER (WHERE type='task_completed') /
            NULLIF(COUNT(*), 0), 1) as success_rate
   FROM agent_history
   WHERE type IN ('task_completed', 'task_failed')
     AND metadata->>'category' IS NOT NULL
     AND created_at >= NOW() - INTERVAL '7 days'
   GROUP BY metadata->>'category';
   ```

---

## 🎓 핵심 개념 이해

### Complexity Score
작업 설명과 에이전트 ID 기반 자동 계산 (0-100)
```
score >= 60 → opus
20 <= score < 60 → sonnet
score < 20 → haiku
```

### Stale Timeout
모델별 기본 timeout + complexity 보너스 + agent-specific floor
```
timeout = baseTimeout × tier_multiplier × complexity_multiplier
         max(result, agent_floor)

tier_multiplier: haiku=0.6, sonnet=1.0, opus=1.5
complexity_multiplier: <30=1.0, 30-50=1.2, 50-60=1.5, >=60=1.8
```

### Priority-based Execution
priority 순서로 그룹화 후, 같은 priority 내 병렬 실행
```
Priority 1 (병렬) → Priority 2 (병렬) → Priority 3 (병렬)
    ↓ context 주입
    ↓
  완료
```

---

## 🚨 트러블슈팅

### 문제: "모델이 자꾸 haiku로 선택된다"
**원인**: Complexity score가 20 미만
**해결**: task 설명에 복잡도 지시어 추가
```
❌ "코드 작성"
✅ "복잡한 인증 시스템 구현 및 보안 검토"
```

### 문제: "Hung timeout이 여전히 발생한다"
**원인**: agent-specific floor가 너무 낮음
**해결**: gateway-connector.ts L1093의 ORCH_AGENT_STALE_FLOORS 조정

### 문제: "Category가 적용되지 않는다"
**원인**: createPlan 응답에 category가 없음
**해결**: orchestrator.ts L109-114 프롬프트 확인

---

## 📚 참고 문서

| 문서 | 설명 |
|------|------|
| `docs/omc-adoption-review.md` | OMC 채용 기능 전체 분석 |
| `docs/improvement-summary-2025-02-27.md` | Phase 1-2 구현 현황 |
| `docs/PHASE2-COMPLETION-REPORT.md` | Phase 1-2 완료 보고서 |
| `scripts/model-router.ts` | 모델 라우팅 로직 |
| `scripts/orchestrator.ts` | 오케스트레이션 로직 |
| `scripts/agent-intelligence.ts` | Intelligence system (Phase 3) |

---

## 🗓️ 타임라인

| 날짜 | 마일스톤 | 상태 |
|------|---------|------|
| 2025-02-24 | Phase 1 분석 완료 | ✅ |
| 2025-02-27 | Phase 1 구현 완료 | ✅ |
| 2025-02-28 | Phase 2 구현 완료 | ✅ |
| 2025-03-06 | 1주일 효과 측정 | ⏳ |
| 2025-03-10 | Phase 3 설치 완료 | ⏳ |
| 2025-03-17 | Phase 4 계획 수립 | ⏳ |

---

**작성일**: 2025-02-28
**마지막 업데이트**: 2025-02-28
**상태**: Phase 1-2 완료, Phase 3 준비 중
