# Permission System Implementation Summary

## 완료된 작업

권한 승인 시스템의 핵심 인프라를 성공적으로 구현했습니다. 다음은 구현된 컴포넌트 목록입니다:

### ✅ 1. 핵심 권한 로직 (`src/lib/permissions.ts`)
- **권한 규칙 시스템**: 우선순위 기반 규칙 매칭
- **패턴 매칭**: Glob 패턴 지원 (`*`, `**`, `?`)
- **3단계 권한 레벨**: allow, deny, require_approval
- **기본 규칙 세트**:
  - .git/ 디렉토리 보호 (승인 필요)
  - 환경 변수 파일 보호 (.env*)
  - 암호화 키 완전 차단 (*.pem, *.key)
  - 데이터베이스 파일 승인 필요
  - 빌드/배포 설정 보호 (package.json, Dockerfile 등)
  - 시스템 디렉토리 차단 (/etc, /var)

### ✅ 2. 데이터베이스 스키마 (`sql/024_permission_approvals.sql`)
- **permission_approvals 테이블**: 승인 요청 저장
  - 상태 추적: pending, approved, denied, expired
  - 자동 타임스탬프 업데이트
  - 인덱스 최적화 (status, agent_id, gateway_id, expires_at)
- **permission_rules 테이블**: 커스텀 규칙 저장 (선택사항)
- **자동 만료 함수**: `expire_pending_approvals()` - 만료된 승인 자동 정리
- **감사 로그 뷰**: `permission_approval_history` - 응답 시간 추적

### ✅ 3. 데이터 액세스 레이어 (`src/lib/permission-approvals.ts`)
- `createApprovalRequest()`: 승인 요청 생성
- `getApprovalRequest()`: 개별 승인 조회
- `respondToApproval()`: 승인/거부 처리
- `getPendingApprovals()`: 대기 중인 승인 목록
- `getApprovalHistory()`: 승인 히스토리 조회
- `waitForApproval()`: 폴링 기반 승인 대기 (2초 간격)
- `expirePendingApprovals()`: 만료 처리

### ✅ 4. API 엔드포인트
#### `src/app/api/permissions/approvals/route.ts`
- **GET**: 승인 목록 조회 (pending/history 모드)
- **POST**: 승인 요청 생성 (Gateway Connector 전용)

#### `src/app/api/permissions/approvals/[id]/route.ts`
- **GET**: 개별 승인 상세 조회
- **PATCH**: 승인 응답 (approve/deny)

### ✅ 5. Gateway Connector 통합 (`scripts/permission-checker.ts`)
- `checkAndRequestPermission()`: 권한 체크 및 승인 요청
- `waitForApprovalDecision()`: 승인 결과 대기 (폴링)
- `extractPathsFromToolCall()`: Tool call에서 파일 경로 추출
- API 헬퍼 함수: HTTP 통신 유틸리티

### ✅ 6. 단위 테스트 (`src/lib/__tests__/permissions.test.ts`)
- 패턴 매칭 테스트 (exact, *, **, .git, .env 등)
- 규칙 우선순위 테스트
- 권한 체크 로직 테스트 (allow, deny, require_approval)
- 배치 권한 체크 테스트
- 승인 만료 테스트

### ✅ 7. 문서화
- **종합 문서**: `docs/permission-system.md`
  - 개요 및 아키텍처
  - 기본 규칙 설명
  - 사용 방법 및 예제
  - API 레퍼런스
  - 문제 해결 가이드
- **구현 요약**: 현재 파일

## 아직 구현되지 않은 부분

다음 작업들은 전체 시스템을 완성하기 위해 필요합니다:

### 🔲 1. Gateway Connector 실제 통합
**현재 상태**: `permission-checker.ts` 헬퍼 함수만 작성됨

**필요한 작업**:
- `scripts/gateway-connector.ts` 수정:
  - Tool call 실행 전 권한 체크 로직 추가
  - `executeCommand()` 함수의 spawn 케이스에 통합
  - 승인 대기 중 에이전트 상태 업데이트
- `scripts/claude-executor.ts` 수정 (선택사항):
  - Tool call hook에서 권한 체크
  - 거부된 작업 에러 처리

**예상 코드 위치**:
```typescript
// gateway-connector.ts의 executeCommand() 함수 내
case "spawn": {
  // ... 기존 코드 ...

  // Tool call 실행 전 권한 체크 추가
  executeLlmTaskWithRetry({
    // ...
    onToolCall: async (tc: ToolCall) => {
      taskToolCalls.push(tc);

      // 권한 체크 로직
      const paths = extractPathsFromToolCall(tc.name, tc.input || {});
      for (const { path, action } of paths) {
        const permResult = await checkAndRequestPermission(path, action, {
          agentId, gatewayId, commandId: command.id, relayUrl: RELAY_URL, relayApiKey: RELAY_API_KEY
        });

        if (!permResult.allowed && permResult.requiresApproval && permResult.approvalId) {
          // 승인 대기
          const decision = await waitForApprovalDecision(permResult.approvalId, {
            relayUrl: RELAY_URL, relayApiKey: RELAY_API_KEY
          });

          if (!decision.approved) {
            // 작업 중단
            throw new Error(`작업 거부됨: ${permResult.reason}`);
          }
        } else if (!permResult.allowed) {
          // 완전 차단
          throw new Error(`작업 차단됨: ${permResult.reason}`);
        }
      }
    },
    // ...
  });
}
```

### 🔲 2. Frontend UI 컴포넌트
**필요한 작업**:
- 승인 대기 목록 UI (`src/app/components/ApprovalQueue.tsx`)
- 승인/거부 버튼 및 액션
- 실시간 알림 배지 (대기 중인 승인 개수)
- 승인 히스토리 뷰
- Dashboard 메인 페이지에 통합

**UI 설계 제안**:
```
┌─────────────────────────────────────────────────┐
│ 📋 Pending Approvals (3)                  [🔔]│
├─────────────────────────────────────────────────┤
│ 🤖 dev-agent wants to:                          │
│ ✏️ Write to .git/config                         │
│ 📄 Reason: Git 설정 파일 변경                     │
│ ⏰ Expires in 4:32                               │
│                                                  │
│ [✅ Approve]  [❌ Deny]                          │
├─────────────────────────────────────────────────┤
│ 🤖 qa-agent wants to:                           │
│ 🗑️ Delete sql/001_init.sql                     │
│ 📄 Reason: 마이그레이션 스크립트 변경             │
│ ⏰ Expires in 2:15                               │
│                                                  │
│ [✅ Approve]  [❌ Deny]                          │
└─────────────────────────────────────────────────┘
```

### 🔲 3. 실시간 알림 시스템
**현재 상태**: 폴링 기반 (2초 간격)

**개선 방안**:
- WebSocket 또는 SSE (Server-Sent Events) 통합
- 새 승인 요청 시 Dashboard에 즉시 푸시
- 승인/거부 결과를 Gateway Connector에 즉시 전달

**기존 SSE 인프라 활용**:
- `src/lib/sse-broadcaster.ts` 확장
- 새 이벤트 타입 추가: `approval:created`, `approval:responded`

### 🔲 4. 마이그레이션 스크립트에 추가
**필요한 작업**:
- `scripts/migrate.ts` 수정: `024_permission_approvals.sql` 포함
- 마이그레이션 순서 확인

### 🔲 5. 자동 만료 Cron Job
**필요한 작업**:
- `src/lib/cron-handlers.ts`에 승인 만료 핸들러 추가
- `sql/010_seed_cron_jobs.sql`에 cron job 등록 (5분마다 실행)

```sql
INSERT INTO cron_jobs (name, schedule, handler, enabled)
VALUES ('expire_pending_approvals', '*/5 * * * *', 'expireApprovals', true);
```

```typescript
// src/lib/cron-handlers.ts
export async function handleExpireApprovals() {
  const expiredCount = await expirePendingApprovals();
  if (expiredCount > 0) {
    console.log(`[cron] Expired ${expiredCount} pending approval(s)`);
  }
}
```

## 테스트 가이드

### 단위 테스트 실행
```bash
cd /Users/hanchi/work/life-dashboard
pnpm test src/lib/__tests__/permissions.test.ts
```

### 통합 테스트 시나리오 (수동)

1. **DB 마이그레이션**:
   ```bash
   psql life_dashboard < sql/024_permission_approvals.sql
   ```

2. **승인 요청 생성 테스트**:
   ```bash
   curl -X POST http://localhost:3000/api/permissions/approvals \
     -H "Content-Type: application/json" \
     -H "x-relay-key: dev-relay-key" \
     -d '{
       "agentId": "test-agent",
       "gatewayId": "test-gateway",
       "commandId": "test-cmd-123",
       "path": ".git/config",
       "action": "write",
       "reason": "테스트 승인 요청"
     }'
   ```

3. **대기 중인 승인 조회**:
   ```bash
   curl http://localhost:3000/api/permissions/approvals?mode=pending
   ```

4. **승인 응답 테스트**:
   ```bash
   curl -X PATCH http://localhost:3000/api/permissions/approvals/{approval_id} \
     -H "Content-Type: application/json" \
     -H "Cookie: auth-token=YOUR_SESSION_TOKEN" \
     -d '{"status": "approved"}'
   ```

## 보안 체크리스트

- ✅ 민감한 경로 보호 (.git, .env, keys)
- ✅ 우선순위 기반 규칙 평가
- ✅ 타임아웃 자동 만료
- ✅ 인증 요구 (Gateway: relay key, User: session)
- ✅ DB 감사 로그
- 🔲 Frontend UI 인증 확인
- 🔲 Rate limiting (승인 요청 spam 방지)
- 🔲 승인 위임 정책 (특정 에이전트 자동 승인)

## 다음 단계

권한 시스템을 완전히 작동시키려면 다음 순서로 진행하세요:

1. **즉시 수행 가능**:
   - [ ] DB 마이그레이션 실행
   - [ ] 단위 테스트 실행 및 확인
   - [ ] API 엔드포인트 수동 테스트

2. **단기 (1-2일)**:
   - [ ] Gateway Connector 통합 (가장 중요)
   - [ ] Cron job 만료 핸들러 추가
   - [ ] 마이그레이션 스크립트 업데이트

3. **중기 (1주일)**:
   - [ ] Frontend UI 컴포넌트 개발
   - [ ] SSE 실시간 알림 통합
   - [ ] 통합 테스트 및 버그 수정

4. **장기 (향후)**:
   - [ ] 승인 히스토리 대시보드
   - [ ] 규칙 관리 UI
   - [ ] 승인 통계 및 분석
   - [ ] 승인 위임 기능

## 참고 자료

- **주요 파일**:
  - `src/lib/permissions.ts` - 핵심 로직
  - `src/lib/permission-approvals.ts` - DB 액세스
  - `scripts/permission-checker.ts` - Gateway 통합 헬퍼
  - `docs/permission-system.md` - 전체 문서

- **관련 시스템**:
  - `src/lib/relay.ts` - Gateway 통신
  - `scripts/gateway-connector.ts` - Gateway 메인 로직
  - `scripts/claude-executor.ts` - Tool 실행
  - `src/lib/sse-broadcaster.ts` - 실시간 이벤트

## 기여 가이드

권한 시스템 개선에 기여하려면:

1. 새 규칙 추가: `DEFAULT_PERMISSION_RULES` 배열 수정
2. 테스트 추가: `src/lib/__tests__/permissions.test.ts`
3. 문서 업데이트: `docs/permission-system.md`
4. PR 생성 전 모든 테스트 통과 확인: `pnpm test`

## 문의 및 지원

구현 중 문제가 발생하면:
- 테스트 실행: `pnpm test src/lib/__tests__/permissions.test.ts`
- 로그 확인: Dashboard 서버 콘솔 및 Gateway Connector 출력
- 문서 참조: `docs/permission-system.md`
