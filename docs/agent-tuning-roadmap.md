# 에이전트 튜닝 종합 로드맵

> **작성일**: 2026-03-01
> **작성자**: PM Agent
> **입력 소스**: Analyst (KPI/OKR 분석), Learner (OMC 채용 검토), DevOps (게이트웨이 검증 + 개선 이력)
> **상태**: 실행 가능한 액션 플랜

---

## 완료된 작업 (Completed — 2026-03-01)

다음 항목들이 2026-03-01 executor 세션에서 완료되었습니다.

### 즉시 항목 (A-1 ~ A-4)
- **A-1**: `sql/020_metrics_improvements.sql` 로컬 DB에 적용 완료 (functions, triggers, materialized view)
- **A-2**: `sql/026_agent_intelligence.sql` 로컬 DB에 적용 완료 (`agent_task_results`, `agent_model_promotions` 테이블 생성)
- **A-3**: `agents.json` — qa 에이전트 systemPrompt 완료 프로토콜 추가
- **A-4**: `agents.json` — growth 에이전트 systemPrompt 외부 접근 제한 추가

### 단기 항목 (B-1, B-3, B-4)
- **B-1**: Agent Performance 대시보드 UI 구현 (`/api/agent-stats`, KPI Dashboard 컴포넌트)
- **B-3**: Gateway Long-Polling API 구현 (`/api/relay/poll?timeout=30000`)
- **B-4**: `agents.json` — analyst/researcher 역할 경계 명확화 (description 업데이트)

### 중기 항목 (C-1, C-3, C-4, C-5)
- **C-1**: Ecomode Orchestration — `orchestrator.ts` `modelTier` 필드 추가
- **C-3**: Redis 캐싱 레이어 — `/api/projects/metrics`, `/api/okr/objectives` TTL 캐싱
- **C-4**: SSE 실시간 업데이트 완전 전환 — Dashboard 폴링 → SSE 이벤트 전환
- **C-5**: Concurrency 동적 조정 — `auto_adjust_concurrency()` 함수 및 cron 등록

### agents.json 변경
- **qa**: 완료 프로토콜 systemPrompt 추가
- **growth**: 외부 URL 접근 금지, 승인 요청 금지 명시
- **learner**: 기본 모델 opus → sonnet 변경
- **analyst**: 정량 분석 전담 역할 경계 명시
- **researcher**: 정성 조사 전담 역할 경계 명시

### 인프라
- `scripts/run-migrations.sh` 생성 (bash 마이그레이션 실행 스크립트)
- Docker entrypoint 기존 유지 (이미 마이그레이션 자동 실행 설정됨)

---

## 1. 현재 상태 요약 (2026-03-01 기준)

### 시스템 전체 건강 지표

| 지표 | 기준점 (2/24~25) | Phase 1-2 적용 후 예상 | 달성 여부 |
|------|-----------------|----------------------|---------|
| 전체 성공률 | 83.1% (49/59) | >90% | ⏳ 측정 중 |
| QA 성공률 | 40% (hung 60%) | >80% | ⏳ 측정 중 |
| Hung Timeout 비율 | 8.5% | <5% | ⏳ 측정 중 |
| 토큰 비용 | 기준선 | -44% (Phase 1+2) | ⏳ 측정 중 |
| 고착 에이전트 | 2개 (growth, reviewer) | 0개 | ✅ 알림 도입 |

### 이미 완료된 개선사항 (Phase 1–2)

```
✅ Smart Model Routing      — 복잡도 기반 haiku/sonnet/opus 자동 선택
✅ Delegation Categories    — 5개 카테고리별 모델/timeout 매핑
✅ Context Persistence      — 이전 단계 결과를 다음 단계에 자동 주입
✅ QA Timeout 강화          — 10분 → 15분 (retry 2회 → 3회)
✅ Stuck Agent 자동 알림    — 2일 이상 error 상태 시 PM 자동 알림
✅ Gateway Connector 검증   — launchd, 자동 복구, 로그, 헬스 모두 정상
✅ DB 패치 SQL 작성         — sql/020_metrics_improvements.sql 준비 완료
✅ agent-intelligence.ts   — Phase 3 코드 완성 (패키지 설치 대기)
```

---

## 2. 에이전트별 현황 및 개선 우선순위

### 2.1 에이전트 현황 매트릭스

| 에이전트 | 역할 | 기본 모델 | 알려진 문제 | 우선순위 |
|---------|------|---------|-----------|--------|
| **qa** | 코드 리뷰/테스트 | sonnet | 성공률 40% (hung timeout 60%) → 개선 중 | 🔴 즉시 |
| **growth** | 마케팅/콘텐츠 | sonnet | 2일 이상 error 고착 이력 | 🔴 즉시 |
| **dev** | 풀스택 개발 | sonnet | 정상 운영 중 | 🟢 유지 |
| **devops** | CI/CD/인프라 | sonnet | 정상 (검증 완료) | 🟢 유지 |
| **analyst** | 데이터 분석 | sonnet | 정상 (KPI/OKR 분석 완료) | 🟡 단기 개선 |
| **learner** | 시스템 학습/최적화 | **opus** | 정상 (복잡 추론 필요) | 🟡 단기 개선 |
| **researcher** | 시장/기술 조사 | sonnet | analyst와 역할 중복 가능성 | 🟡 단기 검토 |
| **pm** | 프로젝트 관리 | sonnet | 정상 | 🟢 유지 |
| **designer** | UI/UX | sonnet | 정상 | 🟢 유지 |
| **assistant** | 개인 비서 | **haiku** | 정상 (단순 정리 업무) | 🟢 유지 |
| **finance** | 재무 관리 | **haiku** | 정상 (수치 정리) | 🟢 유지 |

---

## 3. 우선순위별 개선 액션 플랜

---

### 🔴 즉시 (1~3일) — 운영 안정성 확보

#### A-1. sql/020_metrics_improvements.sql 적용

**담당**: DevOps
**근거**: Analyst 분석 결과 NULL 안전성 버그, denormalized 데이터 비동기화 위험 확인됨

```bash
psql life_dashboard < sql/020_metrics_improvements.sql
pnpm test tests/metrics-validation.test.ts
psql life_dashboard -c "SELECT snapshot_all_project_metrics();"
```

**포함 내용**:
- `calculate_key_result_progress` NULL 체크 추가 (NULL/100 → 0%)
- `sync_project_task_status` 트리거 (denormalized 동기화)
- `snapshot_project_metrics_batch` 배치 함수 (100 queries → ~10 queries)
- `project_metrics_summary` Materialized View 생성
- Partial 인덱스 최적화

**예상 효과**: DB 부하 90% 감소, 데이터 정합성 보장

---

#### A-2. Phase 3 Intelligence 시스템 완성

**담당**: Dev
**근거**: `agent-intelligence.ts` 코드 완성 상태. better-sqlite3 설치만 남음

```bash
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3
```

`scripts/gateway-connector.ts` 수정:
- L813 (`task_completed` 직후): `intelligence.recordTaskResult(agentId, 'success')`
- L854 (`task_failed` 직후): `intelligence.recordTaskResult(agentId, 'failure')`

**동작**: 에이전트 실패율 30% 초과 시 haiku → sonnet → opus 자동 승격
**예상 효과**: ~15% 추가 토큰 절감, QA/growth 재발 방지

---

#### A-3. QA 에이전트 시스템 프롬프트 강화

**담당**: PM
**근거**: QA 실패의 주원인은 hung timeout. 프롬프트 수준에서 "완료 프로토콜" 명시 필요

`agents.json`의 qa 에이전트 `systemPrompt`에 추가:

```
## 완료 프로토콜 (필수 준수)
작업 완료를 선언하기 전 반드시:
1. 테스트 명령어 실행 결과를 직접 인용할 것 (exit code, 통과/실패 수)
2. "should pass", "should work" 등 가정형 표현 금지 — 확인된 사실만 기술
3. 빌드/린트/테스트 중 하나라도 실패 시 반드시 명시
4. 타임아웃 임박 시 지금까지 완료된 항목과 미완료 항목을 명시적으로 분리하여 보고
```

---

#### A-4. growth 에이전트 고착 원인 조사 및 프롬프트 수정

**담당**: PM + Dev
**근거**: 2/24~25 운영 데이터에서 growth 에이전트가 2일 이상 error 상태 고착

```sql
-- 고착 원인 분석 쿼리
SELECT content, metadata, created_at
FROM agent_history
WHERE agent_id = 'growth'
  AND type = 'task_failed'
ORDER BY created_at DESC
LIMIT 10;
```

**예상 원인**: 콘텐츠 생성 태스크에서 외부 URL 접근 시도 또는 승인 대기 루프
**대응**: systemPrompt에 "외부 URL 접근 금지, 승인 요청 금지" 명시

---

### 🟡 단기 (1~2주) — 가시성 및 Intelligence 강화

#### B-1. Agent Performance 대시보드 UI 추가

**담당**: Dev + Designer
**근거**: Phase 3 Intelligence 시스템이 작동하려면 데이터 가시화가 필수

구현 범위:
- `GET /api/agent-stats` 엔드포인트 신설
- Dashboard에 "Agent Performance" 탭 추가
- 에이전트별: 성공률, 현재 모델 티어, 자동 승격 이력, 평균 소요시간 시각화
- 비용 분석: Haiku/Sonnet/Opus 분포 파이 차트 (Mermaid)

```typescript
// /api/agent-stats 응답 예시
{
  "agents": [
    {
      "id": "qa",
      "successRate": 82,
      "currentModelTier": "sonnet",
      "promotionHistory": ["haiku→sonnet (2026-02-27)"],
      "avgDurationMs": 420000,
      "todayCostUsd": 0.034
    }
  ],
  "systemSummary": {
    "totalTasksToday": 42,
    "overallSuccessRate": 91.2,
    "totalCostUsd": 0.87,
    "opusUsagePct": 18
  }
}
```

---

#### B-2. 1주일 효과 측정 (2026-03-08 목표)

**담당**: Analyst
**근거**: Phase 1-2 적용 후 효과 검증 시점 도래

```bash
pnpm analyze:agents
pnpm analyze:report
```

측정 지표:
| 지표 | 목표 | 측정 방법 |
|------|------|---------|
| QA 성공률 | >80% | `agent_history` WHERE agent_id='qa' |
| 전체 성공률 | >90% | 전체 task_completed / total |
| Hung timeout 비율 | <5% | metadata->>'isHung'='true' |
| Opus 사용 비율 | <20% | token_usage WHERE model='claude-opus-*' |
| 토큰 비용 변화 | -44% | token_usage total_cost_usd 합산 |

---

#### B-3. Gateway Polling → Long-Polling 전환

**담당**: DevOps + Dev
**근거**: Parallelization Analysis 결과 — 현재 3초 고정 polling은 N×gateway 호출 증가 야기

```typescript
// 현재: 3초 fixed polling
setInterval(async () => { ... }, 3000);

// 개선: Long-polling (30초 타임아웃, 명령 즉시 반환)
// GET /api/relay/poll?timeout=30000
// → 명령 없으면 30초 대기 후 empty 반환
// → 명령 있으면 즉시 반환
```

**예상 효과**: API 호출 90% 감소 (3초→30초 간격), 지연 시간 동일 수준 유지

---

#### B-4. analyst/researcher 역할 경계 재정의

**담당**: PM
**근거**: 두 에이전트의 역할이 실제 운영에서 중복될 가능성 높음

**현재 정의**:
- `analyst`: 데이터 분석 (business 카테고리)
- `researcher`: 시장/기술 조사 (business 카테고리)

**재정의 방향**:

| 에이전트 | 재정의 역할 | 태스크 유형 |
|---------|-----------|-----------|
| `analyst` | **정량 분석 전담** | KPI 분석, 성능 지표, SQL 쿼리, 메트릭 보고서 |
| `researcher` | **정성 조사 전담** | 시장 조사, 기술 트렌드, 경쟁사 분석, 외부 문서 수집 |

`agents.json`의 description 필드와 systemPrompt 경계를 명확히 업데이트.

---

### 🔵 중기 (2~4주) — 시스템 최적화 및 확장성

#### C-1. Ecomode Orchestration 도입

**담당**: Dev
**근거**: Learner 분석 — Phase 3 완료 후 다음 단계 (~15% 추가 절감)

`orchestrator.ts`의 `SubTask` 인터페이스에 `modelTier` 추가:

```typescript
interface SubTask {
  agentId: string;
  task: string;
  priority: number;
  category?: "quick" | "writing" | "standard" | "visual" | "ultrabrain";
  modelTier?: "low" | "medium" | "high";  // 신규
}
```

`createPlan` 프롬프트에 추가:
```
각 서브태스크에 modelTier를 지정하세요:
- low (haiku, 2분): 상태 조회, 요약, 단순 읽기
- medium (sonnet, 5-8분): 코드 구현, 리뷰, 문서 작성
- high (opus, 10-15분): 아키텍처 설계, 복잡 디버깅, 보안 분석
```

**예상 효과**: 누적 절감율 ~52% (Phase 1+2+3+Ecomode)

---

#### C-2. Gateway 로드 분산 최적화

**담당**: DevOps + Dev
**근거**: Parallelization Analysis — 현재 sequential assignment, 여러 gateway 간 부하 불균형

```typescript
// scripts/gateway-connector.ts에 affinity matrix 추가
const AGENT_GATEWAY_AFFINITY: Record<string, string[]> = {
  'dev': ['*'],      // 어느 gateway든
  'qa': ['*'],
  'designer': ['*'],
  'analyst': ['mac-primary'],  // 특정 머신 선호
};

// capacity-aware selection
async function selectOptimalGateway(agentId: string): Promise<string> {
  const gateways = await getConnectedGateways();
  const loads = await Promise.all(
    gateways.map(async gw => ({
      id: gw.id,
      runningCount: await getRunningCount(gw.id)
    }))
  );
  return loads.sort((a, b) => a.runningCount - b.runningCount)[0].id;
}
```

---

#### C-3. Redis 캐싱 레이어 도입

**담당**: Dev
**근거**: Analyst 분석 — 메트릭 API 응답 ~500ms, 폴링 720회/시간

**우선 대상**:
- `/api/projects/metrics` — 5초 TTL
- `/api/okr/objectives` — 10초 TTL
- `/api/agent-stats` — 30초 TTL

**예상 효과**: 응답시간 500ms → 50ms, DB 부하 80% 감소

---

#### C-4. SSE 실시간 업데이트 완전 전환

**담당**: Dev
**근거**: Analyst 분석 — 프론트엔드 5초 폴링으로 720쿼리/시간 발생 (99% 불필요)
**현황**: SSE 인프라는 이미 구축됨 (`sse-broadcaster.ts`, `useProjectSSE`, `useOKRSSE`)

미완성 항목:
- `project_metrics` 변경 시 SSE 이벤트 자동 발행
- Dashboard "Agents" 탭의 상태 폴링 → SSE 전환
- `/api/relay/status` 5초 폴링 → `relay:status` SSE 이벤트 전환

**예상 효과**: 쿼리 수 720/시간 → ~10/시간 (98% 감소)

---

#### C-5. Concurrency 동적 조정

**담당**: DevOps + Dev
**근거**: Parallelization Analysis — concurrency_config가 정적 설정, 실시간 부하 반영 불가

```sql
-- 자동 조정 함수 (피크 시간대 탐지)
CREATE OR REPLACE FUNCTION auto_adjust_concurrency()
RETURNS void AS $$
DECLARE
  hour_of_day INT := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Asia/Seoul');
  peak_hours INT[] := ARRAY[12, 13, 14, 20, 21, 22];  -- 피크 시간대
BEGIN
  IF hour_of_day = ANY(peak_hours) THEN
    -- 피크: concurrency 증가
    UPDATE concurrency_config SET max_concurrent = 5 WHERE concurrency_group = 'default';
  ELSE
    -- 비피크: 기본값 복원
    UPDATE concurrency_config SET max_concurrent = 3 WHERE concurrency_group = 'default';
  END IF;
END;
$$ LANGUAGE plpgsql;
```

**참고**: DevOps 분석에서 이중 피크 확인 (오후 12~14시, 저녁 20~22시)

---

## 4. 역할 재배치 및 신규 에이전트 검토

### 4.1 역할 재배치 권고

#### reviewer 에이전트 → qa 통합

**현황**: 운영 로그에서 "reviewer" 에이전트가 고착 이력 있으나, `agents.json`에 독립 에이전트로 정의되어 있지 않음 (qa의 내부 역할로 처리되고 있을 가능성)
**권고**: qa 에이전트의 systemPrompt 내에 코드 리뷰 역할을 명시적으로 포함. 별도 reviewer 에이전트 불필요.

#### learner 에이전트 모델 재검토

**현황**: 기본 모델 opus (복잡 추론 필요하다는 판단)
**재검토 결과**: 일상적 패턴 분석(주간 회고, 시스템 요약)은 sonnet으로 충분. opus는 심층 최적화 전략 수립 시에만 필요.
**권고**: learner 기본 모델을 **sonnet**으로 하향, 복잡도 높은 태스크에서만 자동으로 opus 승격 (Smart Model Routing이 이를 처리)
**예상 절감**: learner 태스크당 ~60% 비용 감소

---

### 4.2 신규 에이전트 필요성 검토

#### 4.2.1 🟡 monitor 에이전트 (단기 도입 검토)

**필요성 이유**:
- 현재 devops가 인프라 운영 + 시스템 모니터링을 겸임
- Agent Performance 대시보드 도입 후 모니터링 태스크 증가 예상
- stuck agent 알림, 성능 지표 수집, 헬스체크 전담 에이전트 필요

**제안 역할**:

```json
{
  "id": "monitor",
  "name": "System Monitor",
  "category": "ops",
  "defaultModel": "haiku",
  "description": "에이전트 성능 지표 수집, 헬스체크, 이상 탐지 전담. 주기적 분석 보고서를 pm에게 전달.",
  "systemPrompt": "당신은 시스템 모니터링 전문가입니다..."
}
```

**판단**: devops 에이전트 부하가 실제로 증가하는 시점(중기)에 분리 도입.
**현재 결론**: 즉시 도입 불필요. devops + stuck agent 알림으로 단기는 충분.

---

#### 4.2.2 🔵 orchestrator 에이전트 (중기 도입 검토)

**필요성 이유**:
- 현재 `gateway-connector.ts` 내부의 `createPlan` 로직이 실질적 오케스트레이터 역할 수행
- Ecomode, Context Persistence 기능이 추가될수록 오케스트레이션 복잡도 증가
- 전담 에이전트로 분리하면 로직 테스트, 프롬프트 튜닝, 버전 관리 용이

**판단**: 현재 아키텍처에서 코드 분리 비용이 크므로, Ecomode 도입(C-1) 완료 후 재검토.

---

#### 4.2.3 ✅ 현재 11개 에이전트 구성 유지 권고

추가 에이전트 도입 전 조건:
1. Phase 3 Intelligence 완성 후 실제 성능 데이터 수집
2. 2026-03-08 1주일 측정 결과 검토
3. 특정 에이전트에 과부하(pending queue depth > 10 지속)가 측정될 때

---

## 5. 종합 타임라인

```
2026-03-01 ~ 03-03  (즉시)
├── A-1: sql/020 패치 적용
├── A-2: better-sqlite3 설치 + intelligence 통합
├── A-3: QA 시스템 프롬프트 강화
└── A-4: growth 고착 원인 조사 + 프롬프트 수정

2026-03-04 ~ 03-10  (단기 1주차)
├── B-1: Agent Performance 대시보드 UI
├── B-2: 2026-03-08 1주일 효과 측정 ← 핵심 체크포인트
├── B-3: Gateway Long-Polling 전환
└── B-4: analyst/researcher 역할 경계 재정의

2026-03-11 ~ 03-24  (단기 2~3주차)
├── 측정 결과 기반 우선순위 재조정
├── C-1: Ecomode Orchestration 도입
└── C-2: Gateway 로드 분산 최적화

2026-03-25 ~ 04-15  (중기)
├── C-3: Redis 캐싱 레이어
├── C-4: SSE 실시간 업데이트 완전 전환
├── C-5: Concurrency 동적 조정
└── monitor 에이전트 도입 여부 재검토
```

---

## 6. 성공 지표 정의

### 6.1 2026-03-08 체크포인트 (1주일 후)

| 지표 | 기준점 | 목표 | 측정 방법 |
|------|--------|------|---------|
| QA 성공률 | 40% | **>80%** | `agent_history WHERE agent_id='qa'` |
| 전체 성공률 | 83.1% | **>90%** | 전체 task_completed / (completed + failed) |
| Hung timeout 비율 | 8.5% | **<5%** | metadata->>'isHung'='true' 비율 |
| Opus 사용 비율 | ~30% | **<20%** | token_usage model tier 분포 |
| 고착 에이전트 | 2개 | **0개** | error 상태 > 2일인 에이전트 수 |

### 6.2 2026-04-01 중기 목표

| 지표 | 기준점 | 목표 |
|------|--------|------|
| 토큰 비용 | 기준선 | **-52%** (Phase 1+2+3+Ecomode) |
| API 응답시간 (metrics) | ~500ms | **<50ms** (Redis 캐싱) |
| 폴링 쿼리 수 | 720/시간 | **<30/시간** (SSE + Long-polling) |
| DB 부하 | 기준선 | **-90%** (배치 처리 + 캐싱) |

---

## 7. 리스크 및 대응

| 리스크 | 가능성 | 영향 | 대응 |
|--------|--------|------|------|
| better-sqlite3 설치 후 gateway-connector 충돌 | 중 | 높음 | 별도 브랜치에서 테스트, gateway 재시작 후 로그 확인 |
| Long-Polling 전환 시 기존 gateway 호환성 | 중 | 중간 | 폴링/long-polling 파라미터를 optional로 구현, 점진적 전환 |
| Redis 도입 시 Railway 비용 증가 | 낮 | 낮음 | Railway Redis 플러그인 먼저 평가, 필요 없으면 in-process LRU 캐시로 대체 |
| Ecomode에서 haiku 품질 저하 | 중 | 중간 | Intelligence 자동 승격으로 자가 보정, 초기에는 quick 카테고리만 haiku 적용 |
| Concurrency 동적 조정 과도한 scale-up | 낮 | 중간 | 상한값 설정 (max_concurrent ≤ 8), 이상 감지 시 즉시 롤백 |

---

## 8. 실행 체크리스트

### 즉시 (이번 주)
- [x] `psql life_dashboard < sql/020_metrics_improvements.sql` 실행
- [ ] `pnpm test tests/metrics-validation.test.ts` 통과 확인
- [ ] `pnpm add better-sqlite3 && pnpm add -D @types/better-sqlite3`
- [x] `gateway-connector.ts` L813, L854에 `recordTaskResult()` 호출 추가
- [x] `agents.json` — qa 시스템 프롬프트 완료 프로토콜 추가
- [x] `agents.json` — learner 기본 모델 opus → sonnet 변경
- [x] `agents.json` — growth 에이전트 systemPrompt 외부 접근 제한 추가
- [x] `agents.json` — analyst/researcher description 역할 경계 명시

### 단기 (1~2주)
- [x] `/api/agent-stats` 엔드포인트 구현
- [x] Dashboard "Agent Performance" 탭 추가
- [ ] 2026-03-08 `pnpm analyze:report` 실행 및 결과 문서화
- [x] Gateway Long-Polling API 구현 (`/api/relay/poll?timeout=30000`)
- [ ] gateway-connector.ts Long-Polling 전환

### 중기 (2~4주)
- [x] `orchestrator.ts` — `modelTier` 필드 추가 (Ecomode)
- [ ] `createPlan` 프롬프트 — modelTier 태깅 지시 추가
- [ ] Gateway affinity matrix 구현
- [x] Redis 또는 in-process LRU 캐싱 레이어 구현
- [x] Dashboard 폴링 코드 → SSE 이벤트 전환
- [x] `concurrency_config` 자동 조정 함수 및 cron 등록

---

**다음 리뷰**: 2026-03-08 (1주일 후 측정 결과 기반 우선순위 재조정)
**담당 PM**: pm 에이전트
**연관 문서**:
- `docs/omc-adoption-review.md` — Learner 채용 검토 원문
- `docs/improvement-summary-2025-02-27.md` — DevOps 개선 이력
- `docs/ANALYSIS_SUMMARY.md` — Analyst KPI/OKR 분석
- `docs/PARALLELIZATION_ANALYSIS.md` — 병렬 처리 분석
- `docs/agent-analytics.md` — 분석 도구 사용 가이드
