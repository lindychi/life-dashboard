# 히스토리 데이터 패턴 분석 - 구현 완료 요약

## 📋 개요

Life Dashboard의 에이전트 히스토리 데이터를 분석하여 다음과 같은 인사이트를 도출하는 시스템을 구축했습니다:

1. **에이전트별 성과**: 완료율, 실패율, 평균 소요 시간
2. **태스크 유형별 분석**: 성공률, 평균 실행 시간, 주 담당 에이전트
3. **시간대별 패턴**: 시간/요일별 태스크 발생 빈도 및 완료율
4. **실패 패턴**: 에러 키워드 추출, 빈도 분석, 영향받은 에이전트
5. **자동 권장사항**: 데이터 기반 휴리스틱으로 개선 제안 생성

---

## 🗂️ 구현된 파일

### 1. 핵심 분석 라이브러리
**`src/lib/analytics.ts`** (545줄)
- `analyzeAgentPerformance()`: 에이전트별 완료율, 실패율, 평균/중앙값 소요 시간
- `analyzeTaskTypes()`: task_queue의 type 필드 기반 태스크 유형별 성공률
- `analyzeTimePatterns()`: 시간대(hour)/요일(day_of_week)별 패턴
- `analyzeFailurePatterns()`: retry_errors에서 에러 키워드 추출 및 빈도 분석
- `generateAnalyticsSummary()`: 전체 분석 + 자동 권장사항 생성

### 2. API 엔드포인트
**`src/app/api/analytics/route.ts`**
- `GET /api/analytics?days=30`: 분석 결과 JSON 반환
- 인증 필수 (`auth-token` 쿠키)
- 쿼리 파라미터: `days` (1-365, 기본값 30)

### 3. CLI 테스트 스크립트
**`scripts/test-analytics.ts`**
- 실행: `pnpm analyze:history [days]`
- 터미널에서 읽기 쉬운 포맷으로 분석 결과 출력
- 에이전트별 성과, 태스크 유형 분석, 시간대 패턴, 실패 패턴, 권장사항 모두 표시

### 4. 문서
**`docs/analytics-guide.md`**
- 전체 시스템 가이드
- 분석 항목 상세 설명
- 사용 방법 (CLI, API, 향후 UI 통합)
- 분석 로직 및 확장 가능성

---

## 🔍 주요 분석 인사이트 예시

### 에이전트별 성과
```
developer-agent
  총 태스크: 45 | 완료: 42 | 실패: 3
  완료율: 93% | 실패율: 7%
  평균 소요: 22분 | 중앙값: 18분
  성능: ★★★★☆
```

### 태스크 유형별 분석
```
code_review
  총: 28 | 완료: 24 | 실패: 4
  성공률: 86%
  평균 소요: 15분 | 중앙값: 12분
  주 담당 에이전트: reviewer-agent
```

### 실패 패턴
```
"timeout" (12회)
  영향받은 에이전트: developer-agent, analyst-agent
  첫 발생: 2025-01-15 14:23
  마지막 발생: 2025-02-10 09:45
  샘플 에러:
    1) Task timed out after 300 seconds
    2) Claude API request timed out
```

### 자동 권장사항
```
⚠️ 완료율 50% 미만 에이전트: test-agent.
   태스크 할당 전략을 재검토하거나 에이전트 설정을 최적화하세요.

🔍 가장 빈번한 에러: "timeout" (12회).
   영향받은 에이전트: developer-agent, analyst-agent.
   우선 해결이 필요합니다.

⏱️ 평균 소요 시간 30분 초과 태스크 유형: deep_analysis.
   타임아웃 설정 증가 또는 태스크 분할을 고려하세요.
```

---

## 📊 데이터 소스

### 1. agent_history 테이블
- `type IN ('task_started', 'task_completed', 'task_failed')`
- `request_group_id` 기준으로 태스크 그룹화
- 시작 시각(`task_started`) ~ 완료 시각(`task_completed`) 계산

### 2. task_queue 테이블
- `type`: 태스크 유형 (code_review, deep_analysis, etc.)
- `status`: 'completed', 'failed', 'dead_letter', 'pending', 'queued', 'running'
- `retry_errors`: JSONB 배열 (에러 메시지, 타임스탬프, attempt)
- `started_at`, `completed_at`: 실행 시간 계산
- `assigned_agent`: 에이전트 ID

---

## 🚀 사용 방법

### 1. CLI 실행
```bash
# 최근 30일 데이터 분석
pnpm analyze:history

# 최근 7일
pnpm analyze:history 7

# 최근 90일
pnpm analyze:history 90
```

### 2. API 호출
```bash
curl -X GET "http://localhost:3000/api/analytics?days=30" \
  -H "Cookie: auth-token=YOUR_TOKEN"
```

### 3. 프론트엔드 통합 (향후)
Dashboard UI에 "Analytics" 탭 추가 예정:
- 에이전트별 성과 차트
- 태스크 유형별 성공률 파이 차트
- 시간대별 패턴 히트맵
- 실패 패턴 Top 10 테이블
- 권장사항 알림 배지

---

## 💡 핵심 기능

### 1. 통계적 신뢰성
- **최소 태스크 수**: 3개 이상 (기본값, 변경 가능)
- **이상치 제거**: 평균값 + 중앙값 병행 제공
- **샘플 크기 경고**: 태스크 수 < 10일 때 "통계적 신뢰도 낮음" 경고

### 2. 자동 권장사항 휴리스틱
| 조건 | 권장사항 |
|------|----------|
| 완료율 < 50% | 태스크 할당 전략 재검토 |
| 실패율 > 30% | 에러 로그 분석 |
| 성공률 < 60% (태스크 유형) | 실행 로직 점검 |
| 평균 소요 > 30분 | 타임아웃 증가 또는 태스크 분할 |
| 미완료 방치 > 24시간 | 모니터링 강화 |
| 전체 실패율 > 20% | 시스템 전반 안정성 점검 |
| 완료율 > 85% | 현재 운영 방식 유지 (긍정) |

### 3. 에러 패턴 추출
정규식 기반 키워드 추출:
```regex
([A-Z][a-zA-Z]+Error|[A-Z][a-zA-Z]+Exception|timeout|failed|abort|crash)
```

샘플 에러 메시지 3개까지 표시하여 근본 원인 파악 용이.

---

## 🔧 확장 가능성

### 단기 (v2)
1. **프론트엔드 대시보드**: React 차트 라이브러리로 시각화
2. **주간 자동 리포트**: Cron job으로 매주 월요일 이메일 발송
3. **CSV/JSON 내보내기**: 분석 결과 다운로드 기능

### 중기 (v3)
1. **의존성 체인 분석**: `depends_on` 필드 활용, 병목 구간 식별
2. **에이전트 간 협업 패턴**: 메시지 교환 빈도, 협업 성공률
3. **비용 분석**: 모델 호출 비용 추정 (Haiku/Sonnet/Opus 사용 비율)

### 장기 (v4)
1. **예측 모델**: 태스크 완료 시간 예측 ML 모델
2. **이상 탐지**: 실시간으로 비정상 패턴 감지 및 알림
3. **A/B 테스트**: 에이전트 설정 변경 전후 성과 비교

---

## 📈 기대 효과

1. **에이전트 최적화**: 저성능 에이전트 조기 발견 및 개선
2. **태스크 할당 효율화**: 에이전트별 강점/약점 파악 후 최적 매칭
3. **안정성 향상**: 빈번한 에러 패턴 우선 해결로 전체 실패율 감소
4. **리소스 최적화**: 시간대별 패턴 분석으로 피크 타임 대비
5. **데이터 기반 의사결정**: 주관적 판단 대신 객관적 지표 활용

---

## 🧪 테스트 방법

1. **로컬 데이터베이스 준비**:
   ```bash
   psql life_dashboard < sql/001_init.sql
   psql life_dashboard < sql/002_task_queue.sql
   ```

2. **샘플 데이터 삽입** (필요 시):
   - 몇 개의 테스트 히스토리 엔트리 추가
   - task_queue에 샘플 태스크 추가

3. **CLI 실행**:
   ```bash
   pnpm analyze:history 7
   ```

4. **API 테스트**:
   ```bash
   curl -X GET "http://localhost:3000/api/analytics?days=7" \
     -H "Cookie: auth-token=$(cat .dev-token)"
   ```

---

## 📝 참고 파일

- **분석 로직**: `src/lib/analytics.ts`
- **API 엔드포인트**: `src/app/api/analytics/route.ts`
- **CLI 스크립트**: `scripts/test-analytics.ts`
- **가이드 문서**: `docs/analytics-guide.md`
- **히스토리 관리**: `src/lib/history.ts`
- **태스크 큐 관리**: `src/lib/task-queue.ts`

---

## 🎯 다음 단계

1. **프론트엔드 UI 구현**:
   - Dashboard의 새로운 "Analytics" 탭 추가
   - Chart.js 또는 Recharts로 시각화

2. **자동 리포트 시스템**:
   - 주간/월간 리포트 자동 생성
   - Resend를 통한 이메일 발송

3. **실시간 모니터링**:
   - WebSocket으로 실시간 완료율 업데이트
   - 임계값 초과 시 알림 (완료율 < 50%, 실패율 > 30%)

4. **고급 분석**:
   - 의존성 체인 분석
   - 에이전트 협업 패턴
   - 비용 추정 모델
