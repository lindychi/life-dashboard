# Gateway 재시작 ↔ 태스크 유실 방지 개선사항

**작성일**: 2025-02-27
**목적**: Gateway 재시작 시 태스크 유실을 방지하고 복구 프로세스를 투명하게 추적

---

## 문제점 요약

1. **재시작 이벤트 미기록**: `gracefulRestart()`가 콘솔 로그만 남기고 DB에 기록하지 않음
2. **게이트웨이 미연결 시 디스패치**: 오케스트레이터가 게이트웨이 연결 상태를 체크하지 않고 태스크를 디스패치
3. **복구 프로세스 불투명**: 복구 시작/완료 시점이 명확하지 않음
4. **수동 재시도 불가**: 유실된 작업을 발견해도 수동으로 재시도할 방법 없음

---

## 구현된 개선사항

### 1. 재시작 이벤트 히스토리 로깅

**DB 마이그레이션**: `sql/005_gateway_restart_history.sql`

```sql
CREATE TABLE gateway_restart_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway_id UUID NOT NULL,  -- FK to gateway_connections.id
  restart_reason TEXT NOT NULL,
  restarted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pending_tasks_count INTEGER NOT NULL DEFAULT 0,
  pending_task_ids UUID[] NOT NULL DEFAULT '{}',
  recovery_completed_at TIMESTAMPTZ,  -- NULL = 복구 진행 중
  FOREIGN KEY (gateway_id) REFERENCES gateway_connections(id) ON DELETE CASCADE
);
```

**적용 방법**:
```bash
psql life_dashboard < sql/005_gateway_restart_history.sql
```

**변경 코드**:
- `scripts/gateway-connector.ts` → `gracefulRestart()` 함수
  - 재시작 전 pending 태스크 ID 수집
  - `/api/relay/restart-event` 호출하여 DB 기록
  - 태스크 상태를 'interrupted'로 변경

- `src/app/api/relay/restart-event/route.ts` (신규)
  - POST 엔드포인트: 재시작 이벤트 + pending 태스크 목록 저장

---

### 2. Orchestrator 게이트웨이 연결 상태 확인

**변경 파일**: `src/lib/task-queue.ts`

**로직**:
```typescript
export async function dispatchTasks(): Promise<Task[]> {
  // 0. 게이트웨이 연결 상태 확인
  const connectedGateways = await getConnectedGateways();
  if (connectedGateways.length === 0) {
    return []; // 게이트웨이 없으면 디스패치 스킵
  }

  // ... 기존 디스패치 로직
}
```

**효과**: 게이트웨이가 재시작 중일 때 오케스트레이터가 태스크를 디스패치하지 않음 → 중복 디스패치 방지

---

### 3. 복구 프로세스 투명성 강화

**변경 파일**: `scripts/gateway-connector.ts`

**추가 로직**:
- 복구 완료 시 `/api/relay/restart-recovery` 호출
- `gateway_restart_history.recovery_completed_at` 필드 업데이트

**신규 API**: `src/app/api/relay/restart-recovery/route.ts`

**효과**:
- 복구 시작/완료 시각을 DB에서 추적 가능
- PM 에이전트가 복구 진행 상황을 모니터링 가능

---

### 4. 강제 재시도 API + MCP 도구

**신규 API**: `src/app/api/task-executions/force-retry/route.ts`

**엔드포인트**: `POST /api/task-executions/force-retry`

**파라미터**:
```json
{
  "taskId": "uuid",
  "reason": "Optional reason for retry"
}
```

**로직**:
1. 태스크 상태 검증 (interrupted/failed만 재시도 가능)
2. 최대 시도 횟수 확인
3. 새 릴레이 커맨드로 재시도 요청

**MCP 도구**: `scripts/mcp-server.ts` → `dashboard_force_retry_task`

**사용 예시** (PM 에이전트):
```
dashboard_force_retry_task({
  taskId: "중단된 태스크 UUID",
  reason: "Gateway 재시작으로 유실된 작업 복구"
})
```

---

## 설치 가이드

### 1. DB 마이그레이션 적용

```bash
cd /Users/hanchi/work/life-dashboard
psql life_dashboard < sql/005_gateway_restart_history.sql
```

### 2. 코드 배포

변경된 파일들이 이미 수정되었으므로, 프로젝트를 빌드하고 재시작하면 됩니다:

```bash
pnpm build
pnpm gateway:restart  # Gateway 재시작
```

Railway 배포 시:
```bash
git add .
git commit -m "feat: gateway restart recovery tracking"
git push origin main
# Railway가 자동 배포
```

### 3. MCP 서버 재시작

MCP 서버를 사용하는 에이전트가 있다면 재시작:
```bash
# .mcp.json 설정에서 MCP 서버 재시작
# (Claude Code가 자동으로 다시 로드)
```

---

## 검증 방법

### 1. 재시작 이벤트 기록 확인

```sql
SELECT
  grh.id,
  grh.restart_reason,
  grh.restarted_at,
  grh.pending_tasks_count,
  grh.recovery_completed_at,
  grh.recovery_completed_at - grh.restarted_at AS recovery_duration
FROM gateway_restart_history grh
JOIN gateway_connections gc ON grh.gateway_id = gc.id
WHERE gc.gateway_id = 'macbook'  -- 실제 gateway ID로 변경
ORDER BY grh.restarted_at DESC
LIMIT 10;
```

### 2. 복구된 태스크 확인

```sql
SELECT
  te.id,
  te.agent_id,
  te.status,
  te.attempt_number,
  te.recovered_from_id,
  te.recovery_reason
FROM task_executions te
WHERE te.recovery_reason IS NOT NULL
ORDER BY te.started_at DESC
LIMIT 10;
```

### 3. 강제 재시도 테스트

1. 태스크 중단 시뮬레이션:
   ```sql
   UPDATE task_executions
   SET status = 'interrupted', recovery_reason = 'test'
   WHERE id = '중단할_태스크_UUID';
   ```

2. MCP 도구로 재시도:
   ```
   dashboard_force_retry_task({
     taskId: "중단할_태스크_UUID",
     reason: "Manual test"
   })
   ```

3. 태스크 큐 확인:
   ```sql
   SELECT * FROM relay_commands
   WHERE status = 'pending'
   ORDER BY created_at DESC LIMIT 5;
   ```

---

## PM 에이전트 활용 가이드

PM 에이전트는 다음 MCP 도구들을 조합하여 재시작 이슈를 추적/복구할 수 있습니다:

### 1. 재시작 이벤트 감지

```javascript
// 최근 1시간 이내 gateway_restart 이벤트 확인
dashboard_get_timeline({
  startTime: "2025-02-27T10:00:00Z",
  endTime: "2025-02-27T11:00:00Z",
  eventTypes: ["gateway_restart"]
})
```

### 2. 중단된 태스크 조회

```javascript
// 히스토리에서 중단된 작업 검색
dashboard_search_history({
  query: "중단된 태스크",
  type: "output",
  limit: 50
})
```

### 3. 수동 복구

```javascript
// 발견된 태스크 재시도
dashboard_force_retry_task({
  taskId: "발견된_태스크_UUID",
  reason: "Timeline analysis revealed missing work"
})
```

### 4. 복구 진행 모니터링

```sql
-- DB 쿼리 (dashboard_execute_query 도구 사용 시)
SELECT
  COUNT(*) FILTER (WHERE recovery_completed_at IS NULL) AS pending_recovery,
  COUNT(*) FILTER (WHERE recovery_completed_at IS NOT NULL) AS completed_recovery
FROM gateway_restart_history
WHERE restarted_at > NOW() - INTERVAL '1 hour';
```

---

## 롤백 가이드 (필요 시)

만약 문제가 발생하면 다음 순서로 롤백:

### 1. 테이블 삭제 (데이터 유실 주의!)

```sql
DROP TABLE IF EXISTS gateway_restart_history CASCADE;
```

### 2. 코드 되돌리기

```bash
git revert <commit-hash>
git push origin main
```

### 3. MCP 도구 제거

`scripts/mcp-server.ts`에서 `dashboard_force_retry_task` 관련 코드 제거

---

## 향후 개선 방향

1. **자동 복구 우선순위 조정**
   - 현재: `pm`, `orchestrator`, `analyst` 우선
   - 개선: 태스크 중요도(priority)와 의존성(depends_on)을 고려한 동적 우선순위

2. **복구 성공률 메트릭**
   - `gateway_restart_history`에 `recovered_task_count`, `failed_recovery_count` 필드 추가
   - 대시보드에 복구 성공률 차트 표시

3. **재시작 원인 분석**
   - `restart_reason`별 빈도 집계
   - 반복되는 원인에 대한 알림 시스템

4. **부분 복구 지원**
   - 오케스트레이션 태스크의 경우 완료된 서브태스크는 건너뛰고 미완료 부분만 재시도

---

## 참고 자료

- 이전 분석 리포트: `docs/gateway-restart-analysis.md` (없음)
- 태스크 큐 설계: `sql/002_task_queue.sql`
- 복구 프로세스: `scripts/task-state-manager.ts`
