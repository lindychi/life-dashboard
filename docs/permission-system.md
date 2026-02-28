# Permission Approval System

Life Dashboard의 권한 승인 시스템 문서입니다. 민감한 파일 및 디렉토리 작업 시 사용자 승인을 요청하는 보안 메커니즘을 제공합니다.

## 개요

권한 승인 시스템은 AI 에이전트가 민감한 파일이나 디렉토리에 접근할 때 자동으로 사용자 승인을 요청합니다. `.git/` 디렉토리, 환경 변수 파일, 암호화 키, 데이터베이스 파일 등에 대한 무단 변경을 방지합니다.

## 주요 기능

### 1. **계층적 권한 규칙**
- 우선순위 기반 규칙 매칭 (높은 우선순위가 우선 적용)
- Glob 패턴 지원 (`*`, `**`, `?`)
- 작업 유형별 세분화된 제어 (read, write, delete, execute)

### 2. **3단계 권한 레벨**
- `allow`: 자동 허용
- `deny`: 완전 차단
- `require_approval`: 사용자 승인 필요

### 3. **실시간 승인 워크플로우**
- Gateway Connector가 승인 요청 생성
- Dashboard에서 실시간 승인/거부
- 타임아웃 자동 만료 (기본 5분)

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                     Gateway Connector                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. Tool Call Interceptor                           │   │
│  │     - Extract file paths from tool calls            │   │
│  │     - Check permission rules                        │   │
│  │                                                      │   │
│  │  2. Permission Checker                              │   │
│  │     - Match against DEFAULT_PERMISSION_RULES        │   │
│  │     - Determine: allow / deny / require_approval    │   │
│  │                                                      │   │
│  │  3. Approval Request Handler                        │   │
│  │     - Create approval request via API               │   │
│  │     - Poll for approval decision                    │   │
│  │     - Resume or abort operation                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP API
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Life Dashboard (Server)                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  API Endpoints                                      │   │
│  │  - POST /api/permissions/approvals                  │   │
│  │  - GET  /api/permissions/approvals                  │   │
│  │  - GET  /api/permissions/approvals/:id              │   │
│  │  - PATCH /api/permissions/approvals/:id             │   │
│  │                                                      │   │
│  │  Database (PostgreSQL)                              │   │
│  │  - permission_approvals table                       │   │
│  │  - permission_rules table (optional custom rules)   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket / SSE (future)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Dashboard Frontend                        │
│  - Pending approvals UI                                     │
│  - Approve / Deny buttons                                   │
│  - Approval history view                                    │
└─────────────────────────────────────────────────────────────┘
```

## 디렉토리 구조

```
src/lib/
├── permissions.ts              # 핵심 권한 로직 (규칙, 패턴 매칭, 타입)
├── permission-approvals.ts     # DB 액세스 레이어 (CRUD)
└── __tests__/
    └── permissions.test.ts     # 단위 테스트

src/app/api/permissions/
├── approvals/
│   ├── route.ts               # GET/POST 승인 목록/생성
│   └── [id]/
│       └── route.ts           # GET/PATCH 개별 승인 조회/응답

scripts/
└── permission-checker.ts       # Gateway Connector 통합 헬퍼

sql/
└── 024_permission_approvals.sql  # DB 스키마
```

## 기본 권한 규칙

### 완전 차단 (Deny)
- `**/*.pem` - 암호화 키
- `**/*.key` - 개인 키
- `**/credentials.json` - 인증 정보
- `.git/HEAD` - Git HEAD 참조
- `node_modules/**/*` - 의존성 패키지 (write/delete)
- `/etc/**/*` - 시스템 설정 디렉토리

### 승인 필요 (Require Approval)
- `.git/**/*` - Git 저장소 파일 (write/delete)
- `.git/config` - Git 설정 (read/write/delete 모두)
- `.env*` - 환경 변수 파일
- `**/*.db` - 데이터베이스 파일
- `sql/**/*` - 마이그레이션 스크립트
- `package.json`, `package-lock.json` - 의존성 설정
- `Dockerfile`, `railway.toml` - 배포 설정
- `/var/**/*` - 시스템 데이터 디렉토리

### 기본 허용 (Allow)
- 위에 해당하지 않는 모든 파일

## 사용 방법

### 1. DB 마이그레이션 실행

```bash
psql life_dashboard < sql/024_permission_approvals.sql
```

### 2. Gateway Connector 통합 (예정)

```typescript
import { checkAndRequestPermission, waitForApprovalDecision } from "./permission-checker";

// Tool call 실행 전 권한 체크
const permResult = await checkAndRequestPermission(
  filePath,
  "write",
  { agentId, gatewayId, commandId, relayUrl, relayApiKey }
);

if (!permResult.allowed && !permResult.requiresApproval) {
  // 작업 차단
  console.error(`작업 거부: ${permResult.reason}`);
  return;
}

if (permResult.requiresApproval && permResult.approvalId) {
  // 승인 대기
  const decision = await waitForApprovalDecision(permResult.approvalId, {
    relayUrl,
    relayApiKey,
  });

  if (!decision.approved) {
    console.error(`승인 거부됨: ${decision.status}`);
    return;
  }
}

// 작업 실행
await executeToolCall(toolName, input);
```

### 3. Dashboard에서 승인 처리

```typescript
// 대기 중인 승인 목록 조회
const response = await fetch("/api/permissions/approvals?mode=pending");
const { approvals } = await response.json();

// 승인 응답
await fetch(`/api/permissions/approvals/${approvalId}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ status: "approved" }),
});
```

## API 레퍼런스

### POST /api/permissions/approvals
승인 요청 생성 (Gateway Connector 전용)

**Request:**
```json
{
  "agentId": "dev-agent",
  "gatewayId": "macbook-pro",
  "commandId": "uuid",
  "path": ".git/config",
  "action": "write",
  "reason": "Git 설정 파일 - 읽기/쓰기 모두 승인 필요",
  "timeoutMs": 300000
}
```

**Response:**
```json
{
  "approval": {
    "id": "uuid",
    "agentId": "dev-agent",
    "gatewayId": "macbook-pro",
    "commandId": "uuid",
    "path": ".git/config",
    "action": "write",
    "reason": "Git 설정 파일 - 읽기/쓰기 모두 승인 필요",
    "status": "pending",
    "requestedAt": "2024-01-15T10:30:00Z",
    "expiresAt": "2024-01-15T10:35:00Z"
  }
}
```

### GET /api/permissions/approvals
승인 목록 조회

**Query Parameters:**
- `mode`: `pending` (기본) 또는 `history`
- `gatewayId`: 게이트웨이 필터링
- `agentId`: 에이전트 필터링
- `status`: 상태 필터링 (history 모드)
- `limit`: 결과 개수 제한 (history 모드, 기본 100)

**Response:**
```json
{
  "approvals": [
    { "id": "...", "status": "pending", ... }
  ]
}
```

### GET /api/permissions/approvals/:id
개별 승인 조회

**Response:**
```json
{
  "approval": {
    "id": "uuid",
    "status": "pending",
    ...
  }
}
```

### PATCH /api/permissions/approvals/:id
승인 응답 (승인/거부)

**Request:**
```json
{
  "status": "approved",  // or "denied"
  "respondedBy": "user@example.com"
}
```

**Response:**
```json
{
  "approval": {
    "id": "uuid",
    "status": "approved",
    "respondedAt": "2024-01-15T10:31:00Z",
    "respondedBy": "user@example.com",
    ...
  }
}
```

## 커스텀 규칙 추가

### 코드로 추가
```typescript
import { DEFAULT_PERMISSION_RULES, type PermissionRule } from "@/lib/permissions";

const customRules: PermissionRule[] = [
  {
    pattern: "secrets/**/*",
    actions: ["read", "write", "delete"],
    level: "deny",
    reason: "비밀 정보 디렉토리 - 접근 금지",
    priority: 100,
  },
  ...DEFAULT_PERMISSION_RULES,
];

// checkPermission 호출 시 customRules 전달
const result = checkPermission(path, action, customRules);
```

### DB로 관리 (선택사항)
`permission_rules` 테이블에 규칙을 저장하고 런타임에 로드할 수 있습니다.

```sql
INSERT INTO permission_rules (pattern, actions, level, reason, priority, enabled)
VALUES ('secrets/**/*', ARRAY['read', 'write', 'delete'], 'deny', '비밀 정보', 100, true);
```

## 테스트

```bash
# 단위 테스트 실행
pnpm test src/lib/__tests__/permissions.test.ts

# 커버리지 확인
pnpm test:coverage src/lib/__tests__/permissions.test.ts
```

## 보안 고려사항

1. **승인 타임아웃**: 기본 5분 후 자동 만료. 악의적 요청의 장시간 대기 방지.
2. **인증**: Gateway Connector는 `x-relay-key` 헤더로 인증. Dashboard 사용자는 세션 인증.
3. **우선순위 기반 평가**: 높은 우선순위 규칙이 먼저 적용되어 보안 규칙이 기본 규칙을 덮어씀.
4. **감사 로그**: 모든 승인 요청과 응답이 DB에 기록되어 추적 가능.

## 향후 개선사항

- [ ] Frontend UI 컴포넌트 개발 (승인 대기 목록, 실시간 알림)
- [ ] WebSocket/SSE 실시간 푸시 알림
- [ ] 승인 히스토리 대시보드
- [ ] 규칙 관리 UI (DB 기반 커스텀 규칙)
- [ ] 승인 위임 기능 (특정 에이전트/작업 자동 승인)
- [ ] 승인 통계 및 분석 (가장 많이 요청된 경로, 에이전트별 승인율 등)

## 문제 해결

### 승인 요청이 생성되지 않음
- DB 마이그레이션이 실행되었는지 확인: `psql life_dashboard -c "\dt permission_approvals"`
- Gateway Connector의 `RELAY_API_KEY`가 올바른지 확인
- API 엔드포인트 로그 확인: Dashboard 서버 콘솔

### 승인이 만료됨
- 기본 타임아웃 5분. 더 긴 시간이 필요하면 `timeoutMs` 파라미터 조정
- 만료된 승인은 자동으로 `expired` 상태로 전환

### 권한 규칙이 예상대로 동작하지 않음
- 패턴 매칭 테스트: `matchPattern(pattern, path)` 함수로 직접 확인
- 규칙 우선순위 확인: 높은 우선순위 규칙이 낮은 우선순위를 덮어씀
- 테스트 실행: `pnpm test src/lib/__tests__/permissions.test.ts`

## 관련 파일

- `CLAUDE.md`: 시스템 제약 (도구 사용 제한) 설명
- `docs/omc-adoption-review.md`: OMC 시스템 통합 참고
- `sql/001_init.sql`: 초기 DB 스키마
