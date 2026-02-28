# 미완료 작업 조회 가이드 (Incomplete Tasks Guide)

Life Dashboard에서 미완료 상태의 에이전트 작업들을 식별하고 모니터링하는 방법을 설명합니다.

## 개요 (Overview)

미완료 작업이란 다음 조건을 만족하는 작업입니다:
- `task_started` 이벤트가 기록되었으나
- 해당하는 `task_completed` 또는 `task_failed` 이벤트가 없는 상태

**우선순위:**
- 최근 7일 내 시작된 작업을 우선적으로 표시
- 24시간 이상 활동이 없는 작업은 `abandoned` 상태로 표시

## 사용 방법

### 1️⃣ API를 통한 조회

#### 기본 요청
```bash
curl -H "Cookie: auth-token=YOUR_TOKEN" \
  http://localhost:3000/api/history/incomplete
```

#### 응답 예시
```json
{
  "totalCount": 5,
  "recentCount": 3,
  "abandonedCount": 2,
  "byAgent": {
    "executor": 2,
    "architect": 1,
    "designer": 2
  },
  "tasks": [
    {
      "requestGroupId": "req-123",
      "requestTitle": "Implement authentication",
      "agentId": "executor",
      "startedAt": "2025-02-24T10:30:00Z",
      "lastActivityAt": "2025-02-24T10:45:00Z",
      "startedCount": 1,
      "completedCount": 0,
      "failedCount": 0,
      "durationMinutes": 15,
      "durationHours": 0,
      "status": "in_progress"
    }
  ],
  "generatedAt": "2025-02-27T15:00:00Z"
}
```

#### 쿼리 파라미터

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| `days` | number | 7 | 지난 N일 내에 시작된 작업만 조회 |
| `agentId` | string | - | 특정 에이전트의 미완료 작업만 조회 |
| `status` | string | - | 상태 필터: `in_progress`, `abandoned` |
| `limit` | number | 50 | 반환할 최대 작업 수 |

#### 사용 예시

```bash
# 최근 30일 내 미완료 작업 조회
curl -H "Cookie: auth-token=YOUR_TOKEN" \
  "http://localhost:3000/api/history/incomplete?days=30"

# executor 에이전트의 미완료 작업만 조회
curl -H "Cookie: auth-token=YOUR_TOKEN" \
  "http://localhost:3000/api/history/incomplete?agentId=executor"

# 24시간 이상 활동이 없는 작업 조회 (abandoned)
curl -H "Cookie: auth-token=YOUR_TOKEN" \
  "http://localhost:3000/api/history/incomplete?status=abandoned"

# 모든 필터 조합
curl -H "Cookie: auth-token=YOUR_TOKEN" \
  "http://localhost:3000/api/history/incomplete?days=14&agentId=executor&status=abandoned&limit=100"
```

### 2️⃣ TypeScript 스크립트를 통한 조회

#### 설치
```bash
# 스크립트는 이미 생성되어 있습니다
# scripts/find-incomplete-tasks.ts
```

#### 실행 방법
```bash
# 기본 실행 (최근 7일)
npx ts-node scripts/find-incomplete-tasks.ts

# 특정 에이전트만 조회
npx ts-node scripts/find-incomplete-tasks.ts --agent executor

# 최근 30일 조회
npx ts-node scripts/find-incomplete-tasks.ts --days 30

# JSON 형식 출력
npx ts-node scripts/find-incomplete-tasks.ts --output json

# 모든 옵션 조합
npx ts-node scripts/find-incomplete-tasks.ts --days 14 --agent executor --output json
```

#### 출력 예시 (Table 형식)
```
================================================================================
📊 INCOMPLETE TASKS SUMMARY
================================================================================

📈 Statistics:
   Total Incomplete:     5
   Recent (≤7 days):     3
   Abandoned (24+ hrs):  2
   Affected Agents:      3

👥 By Agent:
   executor                       2 incomplete task(s)
   designer                       2 incomplete task(s)
   architect                      1 incomplete task(s)

📋 Details:

1. ⏸️  [executor] Implement authentication
   Duration: 2d | Status: abandoned
   Started:  2/24/2025, 10:30:00 AM
   Last Activity: 2/24/2025, 10:45:00 AM
   Group ID: req-123

   Recent Events:
     • [task_started] Starting authentication implementation...
     • [output] Processing authentication flow...
     • [message_received] Waiting for user input...

================================================================================
```

### 3️⃣ 라이브러리 함수를 통한 조회 (개발자용)

#### TypeScript 코드에서 직접 사용
```typescript
import { getIncompleteTasks } from '@/lib/history';

// 기본 조회
const summary = await getIncompleteTasks();

// 필터링된 조회
const filtered = await getIncompleteTasks({
  days: 30,
  agentId: 'executor',
  status: 'abandoned',
  limit: 100
});

console.log(`
총 미완료 작업: ${summary.totalCount}
최근 작업 (7일 이내): ${summary.recentCount}
포기된 작업 (24시간 이상): ${summary.abandonedCount}
에이전트별: ${JSON.stringify(summary.byAgent)}
`);

// 각 작업의 상세 정보
summary.tasks.forEach(task => {
  console.log(`
- ${task.requestTitle}
  Agent: ${task.agentId}
  Duration: ${task.durationHours}h ${task.durationMinutes % 60}m
  Status: ${task.status}
  Started: ${new Date(task.startedAt).toLocaleString()}
  Last Activity: ${new Date(task.lastActivityAt).toLocaleString()}
  `);
});
```

### 4️⃣ SQL을 통한 직접 조회

```bash
# PostgreSQL에서 직접 실행
psql life_dashboard < scripts/find-incomplete-tasks.sql

# 또는 psql 인터랙티브 모드
psql life_dashboard
life_dashboard=# \i scripts/find-incomplete-tasks.sql
```

SQL 파일(`scripts/find-incomplete-tasks.sql`)은 두 개의 쿼리를 포함합니다:
1. **상세 조회**: 미완료 작업의 상세 정보 (최대 7일)
2. **통계**: 미완료 작업의 요약 통계

## 상태 정의

### in_progress (⏳ 진행 중)
- 작업이 시작되었으나 아직 완료되지 않음
- 마지막 활동이 24시간 이내

### abandoned (⏸️ 포기됨)
- 작업이 시작되었으나 24시간 이상 활동이 없음
- 수동 개입이 필요할 수 있음

## 미완료 작업 처리 방법

### 1. 상태 확인
```bash
# 특정 에이전트의 미완료 작업 확인
curl -H "Cookie: auth-token=YOUR_TOKEN" \
  "http://localhost:3000/api/history/incomplete?agentId=executor"
```

### 2. 상세 로그 확인
```bash
# /api/history/timeline을 통해 상세 로그 확인
curl -H "Cookie: auth-token=YOUR_TOKEN" \
  "http://localhost:3000/api/history/timeline?requestGroupId=req-123"
```

### 3. 작업 재개 또는 재시작
```bash
# 게이트웨이 커넥터를 통해 작업 재시작
pnpm gateway:restart
```

### 4. 작업 강제 완료 (필요한 경우)
```bash
# PostgreSQL에서 직접 task_completed 이벤트 추가
psql life_dashboard

life_dashboard=# INSERT INTO agent_history (
  agent_id, type, content, metadata, request_group_id, request_title, created_at
) VALUES (
  'executor',
  'task_completed',
  'Task manually completed',
  '{"reason": "manual_intervention"}',
  'req-123',
  'Implement authentication',
  NOW()
);
```

## 대시보드 UI 통합 (향후)

향후 대시보드 프론트엔드에서 다음과 같은 기능이 추가될 예정입니다:
- 📊 미완료 작업 요약 위젯
- 📋 미완료 작업 목록 탭
- 🔔 자동 알림 (abandoned 작업)
- 🔄 빠른 재시작 버튼

## 모니터링 및 자동화

### Cron Job 설정 (자동 체크)
```bash
# .env에 추가
CRON_SCHEDULER_INTERVAL_MS=300000  # 5분마다 체크

# 미완료 작업이 많은 경우 알림
CRON_FAILURE_ALERT_THRESHOLD=3
CRON_ALERT_EMAIL=your-email@example.com
```

### 로그 모니터링
```bash
# 게이트웨이 로그에서 미완료 작업 추적
pnpm gateway:logs | grep "task_started"
```

## 문제 해결

### Q: API가 401 Unauthorized를 반환합니다.
**A:** 인증 토큰을 확인하세요.
```bash
# 로그인하여 토큰 획득
# /login → 이메일 로그인 → 토큰 복사
export AUTH_TOKEN=your-token
```

### Q: 미완료 작업이 너무 많습니다.
**A:** 다음을 확인하세요:
1. 게이트웨이 커넥터가 실행 중인가? (`pnpm gateway:status`)
2. Claude CLI가 정상 작동하는가? (`claude status`)
3. 네트워크 연결이 정상인가?

### Q: 스크립트 실행 시 에러가 발생합니다.
**A:**
```bash
# 의존성 설치
pnpm install

# TypeScript 빌드 확인
pnpm build

# 스크립트 실행 (상세 로그)
DEBUG=* npx ts-node scripts/find-incomplete-tasks.ts
```

## 참고 자료

- **데이터베이스 스키마**: `sql/001_init.sql`
- **히스토리 라이브러리**: `src/lib/history.ts`
- **API 라우트**: `src/app/api/history/incomplete/route.ts`
- **SQL 쿼리**: `scripts/find-incomplete-tasks.sql`
- **TypeScript 스크립트**: `scripts/find-incomplete-tasks.ts`

## 업데이트 로그

| 버전 | 날짜 | 변경사항 |
|------|------|---------|
| 1.0.0 | 2025-02-27 | 초기 출시 - API, 스크립트, 라이브러리 함수 포함 |

## 지원

문제가 발생하면 다음을 확인하세요:
1. 데이터베이스 연결 상태
2. 게이트웨이 커넥터 로그
3. agent_history 테이블의 데이터 샘플

```bash
# 데이터 샘플 확인
psql life_dashboard -c "SELECT * FROM agent_history LIMIT 10;"
```
