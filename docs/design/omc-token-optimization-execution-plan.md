# OMC 토큰 최적화 통합 — 최종 실행 계획

**Version**: 1.0
**Date**: 2026-02-25
**Status**: Approved — Ready for Execution
**Author**: PM Agent

---

## Executive Summary

### 현재 상태 분석 (As-Is)

| 구성요소 | 상태 | 설명 |
|----------|------|------|
| **설계 문서** | ✅ 완료 | `docs/design/omc-token-optimization.md` (1023줄) |
| **OMC 채용 검토** | ✅ 완료 | `docs/omc-adoption-review.md` — 6개 채용, 4개 보류 |
| **OMC 종합 분석** | ✅ 완료 | `docs/omc-analysis.md` — 35개 스킬, 32개 에이전트, 8개 최적화 메커니즘 |
| **측정 계획** | ✅ 완료 | `docs/design/token-optimization-measurement-plan.md` |
| **model-router.ts** | ✅ 작성됨 | 복잡도 분석 + 모델 선택 로직 (184줄) |
| **delegation-category.ts** | ✅ 작성됨 | 5개 카테고리 + 자동 탐지 (157줄) |
| **ecomode.ts** | ✅ 작성됨 | 모델 캡 + 에스컬레이션 + 프롬프트 최적화 (152줄) |
| **model-config.ts** | ✅ 작성됨 | 에이전트/글로벌 설정 로드 (187줄) |
| **token-tracker.ts** | ✅ 작성됨 | PostgreSQL 기록 + 조회 함수 (440줄) |
| **016_token_usage.sql** | ✅ 작성됨 | DB 스키마 + 집계 함수 (154줄) |
| **API route** | ✅ 작성됨 | `src/app/api/token-usage/route.ts` |
| **claude-executor.ts** | ✅ `--model` 지원 | `model?: string` 옵션 + CLI 플래그 전달 구현됨 |
| **agents.json** | ❌ 미확장 | `defaultModel`, `maxModel`, `slimPrompt` 미추가 |
| **gateway-connector.ts** | ❌ 미통합 | 신규 모듈 import/사용 없음 — **핵심 병목** |
| **orchestrator.ts** | ❌ 미통합 | ecomode/model 파라미터 미지원 |
| **MCP server** | ❌ 미확장 | model/category/ecomode 파라미터 미추가 |

### 핵심 갭 (Gap Analysis)

> **모든 모듈이 작성되었으나, 실행 경로(gateway-connector → executor)에 통합되지 않은 상태.**
> 현재 모든 에이전트 태스크는 여전히 기본 모델(sonnet)로만 실행됩니다.

---

## Phase 1: 즉시 통합 (Week 1) — Smart Model Routing 활성화

**목표**: 작성된 모듈을 gateway-connector에 연결하여 에이전트별 자동 모델 선택 활성화

**예상 토큰 절감**: 30-40%

### Task 1.1: agents.json 확장

`agents.json`에 `defaultModel`, `maxModel`, `slimPrompt` 필드 추가

| Agent | defaultModel | maxModel | 근거 |
|-------|-------------|----------|------|
| pm | sonnet | opus | 작업 분해/분석에 sonnet 적절 |
| dev | sonnet | opus | 코드 구현 주력 |
| designer | sonnet | opus | UI/UX 판단에 sonnet 필요 |
| qa | sonnet | opus | 코드 리뷰에 sonnet, 보안 심층은 opus |
| devops | haiku | sonnet | 상태 확인/설정 위주 |
| growth | haiku | sonnet | 콘텐츠 작성에 haiku 충분 |
| finance | haiku | sonnet | 수치 정리, 정형 보고서 |
| researcher | sonnet | opus | 조사 분석에 sonnet 적절 |
| analyst | sonnet | opus | 데이터 분석에 sonnet |
| assistant | haiku | sonnet | 브리핑/요약은 haiku로 충분 |
| learner | sonnet | opus | 패턴 분석에 sonnet |

**에이전트별 `slimPrompt` 예시** (각 ~80토큰):
- pm: `"프로젝트 매니저. 작업 분해, 우선순위, OKR 추적. 코드→dev, 리뷰→qa, UI→designer 위임."`
- dev: `"풀스택 개발자. TypeScript/Next.js/React/PostgreSQL. 구현/버그 수정/리팩토링. 리뷰→qa, UI→designer, 배포→devops 위임."`
- assistant: `"개인 비서. 브리핑, 일정, 웰니스 체크. 간결하게 핵심만."`

**작업 시간**: 2시간
**담당**: dev

### Task 1.2: gateway-connector.ts 통합 (핵심)

`gateway-connector.ts`의 spawn 핸들러에서 신규 모듈 연결:

```
Import 추가:
  - model-router: selectModel, getModelFlag, getModelStaleTimeout
  - model-config: loadAgentModelConfigs, loadGlobalConfig, enforceModelCap, resolveEcomode
  - delegation-category: detectCategory, getCategoryStaleTimeout
  - ecomode: applyEcomodeCap, buildOptimizedSystemPrompt, selectToolNotice

Spawn 핸들러 변경:
  1. 시작 시 loadAgentModelConfigs() + loadGlobalConfig() 호출 (캐시)
  2. spawn payload에서 model, delegationCategory, ecomode 추출
  3. selectModel() → enforceModelCap() → getModelFlag() 체인
  4. detectCategory() → getCategoryStaleTimeout() 체인
  5. buildOptimizedSystemPrompt() + selectToolNotice() 로 프롬프트 최적화
  6. executeLlmTaskWithRetry()에 최종 model, staleTimeout 전달
```

**작업 시간**: 4시간
**담당**: dev

### Task 1.3: orchestrator.ts 연동

```
변경사항:
  1. createPlan()에 ecomode 파라미터 추가 → haiku 모델 사용
  2. summarizeResults()에 ecomode 파라미터 추가 → haiku 모델 사용
  3. disableTools=true 태스크의 staleTimeout을 120초로 단축
  4. SubTask 인터페이스에 category?, model? 필드 추가
```

**작업 시간**: 3시간
**담당**: dev

### Task 1.4: MCP 스키마 확장

`scripts/mcp-server.ts`의 `dashboard_send_command` 스키마에 추가:

```
spawn payload 확장:
  - model?: "haiku" | "sonnet" | "opus"
  - delegationCategory?: "quick" | "writing" | "visual-engineering" | "ultrabrain" | "artistry"
  - ecomode?: boolean
```

**작업 시간**: 2시간
**담당**: dev

### Task 1.5: DB 마이그레이션 실행

```bash
psql life_dashboard < sql/016_token_usage.sql
```

**작업 시간**: 30분
**담당**: devops

### Task 1.6: 토큰 사용량 기록 연동

gateway-connector에서 태스크 완료 후 `recordTokenUsage()` 호출:

```
태스크 완료 시점에:
  1. ExecutionResult에서 totalCostUsd, numTurns, durationApiMs 추출
  2. 모델 라우팅 결정 정보 (model, modelSource, complexityScore, category, ecomode) 기록
  3. 실행 메트릭 (elapsedMs, toolCallsCount, success, exitCode, isHung) 기록
  4. recordTokenUsage() 비동기 호출 (실패해도 메인 플로우 차단 없음)
```

**작업 시간**: 2시간
**담당**: dev

### Task 1.7: 테스트 작성

```
필수 테스트:
  - model-router.test.ts: analyzeComplexity(), selectModel() 각 경로
  - delegation-category.test.ts: detectCategory() 각 패턴
  - ecomode.test.ts: applyEcomodeCap(), shouldEscalate(), escalateModel()
  - model-config.test.ts: loadAgentModelConfigs(), enforceModelCap()
```

**작업 시간**: 4시간
**담당**: qa

### Phase 1 완료 기준 (DoD)

- [ ] agents.json에 11개 에이전트의 defaultModel/maxModel/slimPrompt 추가됨
- [ ] gateway-connector가 모든 spawn에서 자동 모델 라우팅 수행
- [ ] 콘솔 로그에 `🧠 Model: {tier} ({source})` 출력
- [ ] orchestrator의 planner/summarizer가 haiku 사용
- [ ] token_usage 테이블에 데이터 기록 시작
- [ ] `DISABLE_MODEL_ROUTING=true`로 즉시 롤백 가능
- [ ] 모든 테스트 통과
- [ ] 빌드 성공

---

## Phase 2: Delegation Category + 프롬프트 최적화 (Week 2)

**목표**: 카테고리 기반 staleTimeout 최적화 + 프롬프트 슬리밍 적용

**예상 추가 절감**: 15-25%

### Task 2.1: 카테고리 기반 staleTimeout 연동

gateway-connector에서 카테고리별 타임아웃 적용:

| 카테고리 | staleTimeout 배수 | 결과 (base 5분) |
|---------|-------------------|-----------------|
| quick | 0.5x | 2.5분 |
| writing | 1.0x | 5분 |
| visual-engineering | 1.5x | 7.5분 |
| ultrabrain | 2.0x | 10분 |
| artistry | 1.0x | 5분 |

**작업 시간**: 2시간

### Task 2.2: 프롬프트 최적화 적용

- haiku/ecomode 시 slimPrompt + slimToolNotice 사용
- 카테고리별 suffix 자동 추가 (quick→"간결하게", ultrabrain→"깊이 분석")
- disableTools 프롬프트 최적화

**예상 input 토큰 절감**:
```
현재: ~900 tokens/call (systemPrompt 600 + toolNotice 100 + task 200)
최적화: ~310 tokens/call (slimPrompt 80 + slimNotice 30 + task 200)
절감: ~65% input token 감소 (haiku 모드 시)
```

**작업 시간**: 3시간

### Task 2.3: Context Persistence (오케스트레이션 컨텍스트 전달)

executePlan에서 이전 priority 그룹 결과를 다음 그룹의 task 프롬프트에 주입:

```
for each priority group:
  if previousResults exist:
    contextSummary = previous successful results (last 1000 chars each)
    inject as "## 이전 단계 결과 (참고)\n{context}\n\n## 당신의 작업\n{task}"
```

**예상 효과**: 중복 탐색 15-25% 감소
**작업 시간**: 3시간

### Task 2.4: Verification-Before-Completion 프로토콜

dev, qa, devops 에이전트 시스템 프롬프트에 완료 검증 프로토콜 추가:

```
## 완료 프로토콜 (필수)
1. 변경사항의 증거를 구체적으로 제시 (파일 경로, 핵심 변경)
2. "should", "probably" 대신 확인된 사실만 기술
3. 실패/미완료 부분은 정직하게 보고
4. 다음 단계 필요 시 구체적으로 명시
```

**작업 시간**: 1시간

### Phase 2 완료 기준 (DoD)

- [ ] 카테고리별 staleTimeout 분화 적용
- [ ] haiku/ecomode 시 slimPrompt + slimToolNotice 자동 전환
- [ ] orchestrator context persistence 동작 확인
- [ ] 1주간 baseline 데이터 수집 완료 (Phase 0 of measurement plan)

---

## Phase 3: 토큰 모니터링 + Ecomode 활성화 (Week 3)

**목표**: 모니터링 대시보드 확인 + ecomode 비교 실험

**예상 추가 절감**: 20-30% (ecomode 활성 시)

### Task 3.1: 토큰 사용량 대시보드 확인

`/api/token-usage` 엔드포인트 동작 확인:

| 뷰 | 경로 | 용도 |
|----|------|------|
| overview | `?view=overview&days=7` | 총 비용, 모델 분포, 성공률 |
| daily | `?view=daily&days=7` | 일별 비용 차트 |
| agents | `?view=agents&days=30` | 에이전트별 비용 테이블 |
| models | `?view=models&days=7` | 모델 분포 파이 차트 |
| ecomode | `?view=ecomode&days=30` | ecomode vs normal 비교 |
| recent | `?view=recent&agentId=dev&limit=20` | 최근 태스크 로그 |

**작업 시간**: 2시간 (확인/수정)

### Task 3.2: Baseline 데이터 분석

Phase 1 이후 1주간 수집된 데이터 분석:

```sql
-- 기본 요약
SELECT COUNT(*), AVG(total_cost_usd), AVG(elapsed_ms),
       AVG(CASE WHEN success THEN 1 ELSE 0 END) * 100 as success_pct
FROM token_usage WHERE created_at >= NOW() - INTERVAL '7 days';

-- 모델별 분포
SELECT model, COUNT(*), AVG(total_cost_usd), AVG(elapsed_ms)
FROM token_usage WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY model;
```

**작업 시간**: analyst 1시간

### Task 3.3: Ecomode A/B 실험

실험 설계:
- **2주간** 교대 실행: 짝수일=normal, 홀수일=ecomode
- 또는 특정 명령에만 `ecomode: true` 지정

성공 기준:
- ecomode가 normal 대비 20-30% 비용 절감
- 에스컬레이션 비율 < 15%
- 성공률 ≥ 90%

**작업 시간**: 2주 자동 실행 + analyst 분석 2시간

### Task 3.4: Ecomode 에스컬레이션 로직 검증

haiku 실패 → sonnet 자동 에스컬레이션 동작 확인:
- 실패 시 (exitCode ≠ -2) 에스컬레이션
- 출력 50자 미만 시 에스컬레이션
- hung 태스크 (exitCode -2)는 에스컬레이션 아닌 재시도

**작업 시간**: qa 2시간

---

## Phase 4: 효과 측정 및 튜닝 (Week 4)

**목표**: 수집된 데이터 기반 최적화 파라미터 조정

### Task 4.1: 전체 효과 측정

비교 쿼리:

```sql
-- Phase 1 시작 전 vs 후 비교
WITH baseline AS (
  SELECT SUM(total_cost_usd) as cost, COUNT(*) as tasks
  FROM token_usage
  WHERE created_at BETWEEN '{phase1_start - 7days}' AND '{phase1_start}'
),
optimized AS (
  SELECT SUM(total_cost_usd) as cost, COUNT(*) as tasks
  FROM token_usage
  WHERE created_at >= '{phase1_start}'
)
SELECT
  baseline.cost as baseline_cost,
  optimized.cost as optimized_cost,
  ROUND(((baseline.cost - optimized.cost) / NULLIF(baseline.cost, 0) * 100), 1) as savings_pct
FROM baseline, optimized;
```

### Task 4.2: 복잡도 스코어링 튜닝

실제 데이터에서 오분류 패턴 분석:
- 복잡도 점수 < 15인데 실패한 태스크 → threshold 조정 필요
- 복잡도 점수 ≥ 50인데 haiku로 충분했던 태스크 → weight 조정

### Task 4.3: 에이전트별 defaultModel 재조정

실제 성공률/비용 데이터 기반으로 에이전트별 최적 모델 재설정:

```sql
-- 에이전트별 최적 모델 찾기
SELECT agent_id, model,
  COUNT(*) as tasks,
  AVG(CASE WHEN success THEN 1 ELSE 0 END) * 100 as success_pct,
  AVG(total_cost_usd) as avg_cost
FROM token_usage
GROUP BY agent_id, model
ORDER BY agent_id, success_pct DESC;
```

---

## KPI 체계

### Primary KPIs (핵심 지표)

| KPI | Baseline 예상 | Phase 1 목표 | Phase 3 목표 | 측정 방법 |
|-----|-------------|-------------|-------------|-----------|
| **작업당 평균 토큰 비용** | ~$0.009 (all sonnet) | $0.006 (-30%) | $0.004 (-55%) | `AVG(total_cost_usd)` from token_usage |
| **주간 총 API 비용** | ~$4.50 (500 tasks) | ~$3.15 (-30%) | ~$2.00 (-55%) | `SUM(total_cost_usd)` weekly |
| **작업 성공률** | ~92% | ≥ 92% (유지) | ≥ 90% | `AVG(success) * 100` |
| **모델 티어 분포** | 100% sonnet | 30:60:10 (h:s:o) | 40:50:10 (h:s:o) | `COUNT(*) GROUP BY model` |

### Secondary KPIs (보조 지표)

| KPI | 목표 | 측정 방법 |
|-----|------|-----------|
| **단순 작업 응답 시간** | -50% (haiku 효과) | `AVG(elapsed_ms) WHERE complexity_score < 15` |
| **Hung 태스크 비율** | -30% (카테고리 타임아웃) | `AVG(is_hung) * 100` |
| **오케스트레이션 총 시간** | -30% (haiku planner) | orchestrate 타입 elapsed_ms |
| **에스컬레이션 비율** | < 15% | `AVG(was_escalated) * 100` |
| **Ecomode 절감률** | 20-30% vs normal | ecomode A/B 비교 |
| **input 토큰 절감** | -65% (haiku+slim) | 프롬프트 글자수 비교 |

### Quality Guard KPIs (품질 보호)

| KPI | 경고 임계값 | 위험 임계값 | 조치 |
|-----|-----------|-----------|------|
| 작업 성공률 | < 90% | < 85% | haiku threshold 상향 |
| 에스컬레이션 비율 | > 15% | > 25% | 기본 모델 상향 |
| Hung 태스크 비율 | > 10% | > 20% | staleTimeout 조정 |
| 재시도 평균 | > 1.0 | > 1.5 | 모델 라우팅 재조정 |

---

## 리스크 관리

### Risk 1: Haiku 품질 저하 (Likelihood: Medium, Impact: Medium)

**시나리오**: haiku로 라우팅된 작업이 기대 품질을 못 미침
**지표**: 성공률 < 90%, 에스컬레이션 > 15%

**완화 전략**:
1. **즉시**: `GLOBAL_MODEL_CAP=sonnet` → haiku 사용 차단
2. **중기**: 에이전트별 `maxModel: "sonnet"` 설정으로 granular 제어
3. **장기**: 복잡도 threshold 상향 (sonnet threshold를 15→10으로)

**에스컬레이션 로직** (자동):
```
haiku 실패 → sonnet 자동 에스컬레이션 → 성공 시 token_usage에 was_escalated=true 기록
```

### Risk 2: 모델 라우팅 오분류 (Likelihood: Medium, Impact: Low)

**시나리오**: 복잡한 작업이 haiku로 잘못 라우팅됨
**지표**: 에스컬레이션 비율 > 25%

**완화 전략**:
1. `model` 파라미터로 수동 오버라이드 항상 가능 (explicit > auto)
2. 오분류 태스크 로그 분석 → COMPLEXITY_RULES 가중치 조정
3. 에이전트별 `defaultModel` 로 최소 모델 보장

### Risk 3: Ecomode 재작업 비용 증가 (Likelihood: Low, Impact: Medium)

**시나리오**: ecomode의 haiku 사용이 재시도를 유발하여 오히려 비용 증가
**지표**: ecomode avg_retries > 1.5

**완화 전략**:
1. A/B 실험으로 사전 검증 (2주)
2. 재시도율 > 30% 시 자동 ecomode 비활성화 로직
3. `DEFAULT_ECOMODE=false` 유지, 필요 시만 명시적 활성화

### Risk 4: CLI 호환성 (Likelihood: Low, Impact: High)

**시나리오**: Claude CLI 버전에서 `--model` 플래그 미지원
**지표**: executor에서 model 관련 에러

**완화 전략**:
1. `DISABLE_MODEL_ROUTING=true` 즉시 롤백
2. 모델 라우팅은 별도 모듈에 격리 → 코드 롤백 간단
3. 첫 실행 시 `claude --help` 로 `--model` 지원 확인

### Risk 5: DB 스키마 마이그레이션 실패 (Likelihood: Low, Impact: Low)

**시나리오**: Railway PostgreSQL에서 016_token_usage.sql 실행 실패

**완화 전략**:
1. 로컬에서 먼저 테스트
2. token_usage 테이블 없어도 메인 기능 영향 없음 (비동기 기록)
3. `ENABLE_TOKEN_TRACKING=false`로 기록 비활성화 가능

---

## 롤백 계획

| 수준 | 방법 | 영향 범위 |
|------|------|----------|
| **Level 1: 소프트** | `DISABLE_MODEL_ROUTING=true` | 모델 라우팅만 비활성화, 모든 태스크 기본 모델 |
| **Level 2: 모델 캡** | `GLOBAL_MODEL_CAP=sonnet` | haiku 차단, sonnet/opus만 허용 |
| **Level 3: 에이전트별** | agents.json에서 `maxModel: "sonnet"` | 특정 에이전트만 제한 |
| **Level 4: 풀 롤백** | gateway-connector import 제거 | 완전 원복 (모듈이 격리되어 있어 안전) |

모든 token_usage 데이터는 라우팅 설정과 무관하게 보존됩니다.

---

## 타임라인 요약

```
Week 1 (Phase 1): 핵심 통합
  ├── Day 1-2: agents.json 확장 + gateway-connector 통합
  ├── Day 3: orchestrator + MCP 확장
  ├── Day 4: DB 마이그레이션 + 토큰 기록 연동
  └── Day 5: 테스트 + 빌드 검증

Week 2 (Phase 2): 프롬프트 최적화
  ├── Day 1: 카테고리 staleTimeout + 프롬프트 슬리밍
  ├── Day 2: Context Persistence + Verification 프로토콜
  └── Day 3-5: Baseline 데이터 수집 시작

Week 3 (Phase 3): 모니터링 + Ecomode
  ├── Day 1: 대시보드 확인
  ├── Day 2-12: Ecomode A/B 실험 (2주)
  └── Day 13-14: 중간 분석

Week 4 (Phase 4): 튜닝
  ├── Day 1-2: 전체 효과 측정
  ├── Day 3-4: 파라미터 조정
  └── Day 5: 최종 보고서
```

---

## 예상 최종 효과

| 시나리오 | 현재 | 최적화 후 | 절감 |
|---------|------|----------|------|
| 단순 조회 (assistant) | ~1500 tok (sonnet) | ~400 tok (haiku+slim) | **73%** |
| 코드 구현 (dev) | ~3000 tok (sonnet) | ~2500 tok (sonnet+slim) | **17%** |
| 오케스트레이션 4 agents | ~12000 tok | ~7000 tok (mixed) | **42%** |
| Ecomode 오케스트레이션 | ~12000 tok | ~4500 tok (haiku-heavy) | **63%** |
| **가중 평균** | **$4.50/week** | **$2.00-2.50/week** | **44-55%** |

---

## 파일 변경 목록 (실행 필요)

| 파일 | 작업 | 우선순위 |
|------|------|---------|
| `agents.json` | MODIFY: defaultModel, maxModel, slimPrompt 추가 | P1 |
| `scripts/gateway-connector.ts` | MODIFY: 신규 모듈 import + spawn 핸들러 통합 | P1 (핵심) |
| `scripts/orchestrator.ts` | MODIFY: ecomode/model 파라미터, context persistence | P1 |
| `scripts/mcp-server.ts` | MODIFY: spawn payload 스키마 확장 | P1 |
| `sql/016_token_usage.sql` | EXEC: DB 마이그레이션 | P1 |
| `scripts/__tests__/model-router.test.ts` | NEW: 테스트 | P1 |
| `scripts/__tests__/delegation-category.test.ts` | NEW: 테스트 | P1 |
| `scripts/__tests__/ecomode.test.ts` | NEW: 테스트 | P1 |

**이미 완성된 모듈 (변경 불필요)**:
- `scripts/model-router.ts` ✅
- `scripts/delegation-category.ts` ✅
- `scripts/ecomode.ts` ✅
- `scripts/model-config.ts` ✅
- `src/lib/token-tracker.ts` ✅
- `src/app/api/token-usage/route.ts` ✅
- `scripts/claude-executor.ts` ✅ (--model 이미 지원)
