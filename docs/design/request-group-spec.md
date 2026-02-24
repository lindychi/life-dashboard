# Request Group 시스템 설계 명세서

> **작성일**: 2026-02-25
> **상태**: Draft - 리뷰 대기
> **범위**: 데이터 모델, API, 프론트엔드 표시 구조

---

## 1. 개요 (Executive Summary)

### 1.1 문제 정의

현재 Life Dashboard의 에이전트 시스템은 개별 history entry 단위로만 작업을 추적합니다. 사용자가 하나의 지시(instruction)를 내리면, 그 지시에 의해 여러 에이전트가 여러 태스크를 수행하지만, 이들을 **하나의 논리적 단위**로 묶어 추적할 방법이 부족합니다.

### 1.2 목표

- 사용자의 각 지시(instruction)마다 고유한 **Request Group**을 생성
- Request Group 내 참여 에이전트들의 상태를 실시간으로 추적
- 대시보드 모니터 영역에 진행 중인 Request Group을 표시

### 1.3 현재 상태 분석

#### 이미 존재하는 것들

| 요소 | 위치 | 설명 |
|------|------|------|
| `request_group_id` 컬럼 | `agent_history` 테이블 (007 migration) | UUID, nullable, 인덱스 존재 |
| `request_title` 컬럼 | `agent_history` 테이블 (007 migration) | VARCHAR(200), nullable |
| `getGroupedHistory()` | `src/lib/history.ts` | CTE 기반 그룹별 집계 쿼리 |
| `GroupedHistoryEntry` 인터페이스 | `src/lib/history.ts` | 그룹 요약 + entries 구조 |
| `GET /api/history/grouped` | `src/app/api/history/grouped/route.ts` | 세션 인증, 그룹 조회 |
| `dashboard_add_history` MCP 도구 | `scripts/mcp-server.ts` | requestGroupId, requestTitle 파라미터 지원 |
| Timeline 필터 | `getFilteredHistory()` | requestGroupId 필터링 지원 |

#### 부족한 것들

| 항목 | 설명 |
|------|------|
| Request Group 전용 테이블 | 현재는 history 집계로만 상태 유추 (정확하지 않음) |
| 명시적 상태 관리 | pending/in_progress/completed 상태 추적 없음 |
| Agent 참여 목록 | 어떤 에이전트가 해당 그룹에서 활동 중인지 명시적 기록 없음 |
| 실시간 모니터 구조 | 현재 agent_statuses와 Request Group의 연결 부재 |
| 자동 생성 메커니즘 | orchestrate 명령 시 자동 Request Group 생성 없음 |
| 전용 API | CRUD 엔드포인트 없음 |

---

## 2. Request Group 개념 정의

### 2.1 정의

> **Request Group**은 사용자가 보낸 하나의 지시(instruction)에 의해 시작된 모든 작업을 논리적으로 묶는 단위입니다.

```
사용자 지시: "MumMum 앱의 온보딩 플로우 개선"
  └── Request Group (id: abc-123, title: "MumMum 온보딩 플로우 개선")
        ├── pm agent: 요구사항 분석 → task_started → task_completed
        ├── dev agent: 코드 구현 → task_started → output → task_completed
        └── qa agent: 테스트 → task_started → task_failed → task_started → task_completed
```

### 2.2 생명주기 (Lifecycle)

```
  ┌──────────┐     ┌──────────────┐     ┌───────────┐
  │ pending  │────▶│ in_progress  │────▶│ completed │
  └──────────┘     └──────────────┘     └───────────┘
       │                  │                    │
       │                  │                    │
       ▼                  ▼                    ▼
  ┌──────────┐     ┌──────────────┐     ┌───────────┐
  │ 생성됨   │     │ 1+ agent     │     │ 모든 agent │
  │ 아직     │     │ 작업 중       │     │ 작업 완료  │
  │ 시작 안됨 │     │              │     │           │
  └──────────┘     └──────────────┘     └───────────┘
                          │
                          ▼
                   ┌──────────────┐
                   │   failed     │
                   └──────────────┘
                   │ 모든 agent   │
                   │ 실패/타임아웃 │
                   └──────────────┘
```

**상태 전환 규칙:**

| 현재 상태 | 전환 조건 | 다음 상태 |
|-----------|-----------|-----------|
| `pending` | 첫 번째 agent가 task_started 기록 | `in_progress` |
| `in_progress` | 모든 참여 agent가 completed/failed | `completed` 또는 `failed` |
| `in_progress` | 수동 취소 | `cancelled` |
| `completed` | — (최종 상태) | — |
| `failed` | 재시도 시 | `in_progress` |

### 2.3 자동 생성 시나리오

Request Group은 다음 상황에서 **자동 생성**되어야 합니다:

| 트리거 | 위치 | 설명 |
|--------|------|------|
| `orchestrate` 커맨드 수신 | `gateway-connector.ts` | orchestrate는 자연스러운 "하나의 지시" 단위 |
| `spawn` 커맨드 + 없는 group | `gateway-connector.ts` | 개별 spawn도 group으로 래핑 가능 |
| `dashboard_send_command` MCP 호출 | `scripts/mcp-server.ts` | MCP에서 orchestrate 시 |
| 수동 생성 | `POST /api/request-groups` | 대시보드 UI에서 직접 생성 |

---

## 3. 데이터 모델 설계

### 3.1 신규 테이블: `request_groups`

```sql
-- 013_request_groups_table.sql
-- Request Group 전용 테이블

CREATE TABLE IF NOT EXISTS request_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 기본 정보
  title VARCHAR(200) NOT NULL,
  description TEXT,                       -- 원본 지시 내용 (전문)
  status VARCHAR(20) NOT NULL DEFAULT 'pending',

  -- 출처 추적
  source_type VARCHAR(30) NOT NULL DEFAULT 'manual',  -- 'orchestrate' | 'spawn' | 'manual' | 'mcp'
  source_command_id UUID,                -- relay_commands.id FK (nullable)
  gateway_id TEXT,                       -- 어떤 gateway에서 실행 중인지

  -- 타임스탬프
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,               -- 첫 agent가 시작한 시점
  completed_at TIMESTAMPTZ,             -- 모든 작업 완료 시점
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 제약조건
  CONSTRAINT chk_request_groups_status
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled'))
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_request_groups_status
  ON request_groups(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_groups_created
  ON request_groups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_groups_gateway
  ON request_groups(gateway_id, status);
```

### 3.2 신규 테이블: `request_group_agents`

```sql
-- Request Group 내 참여 에이전트 추적

CREATE TABLE IF NOT EXISTS request_group_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_group_id UUID NOT NULL REFERENCES request_groups(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,

  -- 에이전트별 상태
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending' | 'running' | 'completed' | 'failed'
  current_task TEXT,                                -- 현재 수행 중인 작업 설명

  -- 결과
  result_summary TEXT,                             -- 완료 시 요약
  error_message TEXT,                              -- 실패 시 에러 메시지

  -- 타임스탬프
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- 유니크 제약: 하나의 Request Group에 같은 agent는 한 번만
  CONSTRAINT uq_request_group_agent UNIQUE (request_group_id, agent_id),

  CONSTRAINT chk_rga_status
    CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_rga_group_id
  ON request_group_agents(request_group_id);
CREATE INDEX IF NOT EXISTS idx_rga_agent_status
  ON request_group_agents(agent_id, status);
```

### 3.3 기존 테이블 연동

기존 `agent_history.request_group_id`는 **그대로 유지**하되, 새 `request_groups` 테이블과 FK 관계를 추가합니다:

```sql
-- 기존 agent_history.request_group_id에 FK 추가 (nullable이므로 안전)
-- 주의: 기존 데이터에 orphan request_group_id가 있을 수 있으므로
-- NOT VALID로 추가 후 별도 VALIDATE

ALTER TABLE agent_history
  ADD CONSTRAINT fk_history_request_group
  FOREIGN KEY (request_group_id) REFERENCES request_groups(id)
  ON DELETE SET NULL
  NOT VALID;

-- 기존 데이터 정합성 확인 후 수동 실행
-- ALTER TABLE agent_history VALIDATE CONSTRAINT fk_history_request_group;
```

### 3.4 ER 다이어그램 (텍스트)

```
request_groups (1) ──── (N) request_group_agents
       │                          │
       │ 1:N                      │ agent_id = agent_statuses.id
       │                          │
       ▼                          ▼
agent_history              agent_statuses
(request_group_id FK)      (실시간 상태, 메모리 캐시)
```

### 3.5 TypeScript 타입 정의

```typescript
// src/lib/types.ts에 추가

/** Request Group 상태 */
export type RequestGroupStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Request Group 출처 유형 */
export type RequestGroupSourceType =
  | 'orchestrate'
  | 'spawn'
  | 'manual'
  | 'mcp';

/** Request Group 기본 정보 */
export interface RequestGroup {
  id: string;
  title: string;
  description?: string;
  status: RequestGroupStatus;
  sourceType: RequestGroupSourceType;
  sourceCommandId?: string;
  gatewayId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

/** Request Group 내 참여 에이전트 */
export interface RequestGroupAgent {
  id: string;
  requestGroupId: string;
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentTask?: string;
  resultSummary?: string;
  errorMessage?: string;
  assignedAt: string;
  startedAt?: string;
  completedAt?: string;
}

/** Request Group 상세 (에이전트 목록 포함) */
export interface RequestGroupDetail extends RequestGroup {
  agents: RequestGroupAgent[];
  historyCount: number;
}

/** Request Group 요약 (목록용) */
export interface RequestGroupSummary extends RequestGroup {
  agentCount: number;
  completedAgentCount: number;
  failedAgentCount: number;
  runningAgentCount: number;
}

/** 실시간 모니터용 Request Group 정보 */
export interface RequestGroupMonitorEntry {
  id: string;
  title: string;
  status: RequestGroupStatus;
  agents: Array<{
    agentId: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    currentTask?: string;
    /** agent_statuses에서 가져온 실시간 liveOutput (running 상태일 때만) */
    liveOutput?: {
      lastChunk: string;
      totalChars: number;
      lastActivityAt: string;
      chunksReceived: number;
      recentEvents?: Array<{
        type: 'tool_use' | 'text' | 'health' | 'warning' | 'stderr';
        timestamp: string;
        tool?: string;
        target?: string;
        content?: string;
      }>;
    };
  }>;
  createdAt: string;
  updatedAt: string;
}
```

---

## 4. Request Group ↔ Agent 관계 모델

### 4.1 관계 흐름

```
                     Dashboard / MCP
                         │
                    ┌────▼────┐
                    │ Command │  (orchestrate / spawn)
                    │ Route   │
                    └────┬────┘
                         │
                    ┌────▼────────────────────┐
                    │ 1. Request Group 생성     │
                    │    - title 자동 생성       │
                    │    - status = 'pending'   │
                    │    - source_type 기록     │
                    └────┬────────────────────┘
                         │
                    ┌────▼────────────────────┐
                    │ 2. Agent 배정             │
                    │    - orchestrator plan    │
                    │      → N개 agent 배정     │
                    │    - 또는 spawn            │
                    │      → 1개 agent 배정     │
                    └────┬────────────────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         Agent A    Agent B    Agent C
         (running)  (pending)  (pending)
              │
              ▼
    ┌─────────────────────┐
    │ 3. History 기록       │
    │   task_started       │
    │   → rga.status =    │
    │     'running'        │
    │   → rg.status =     │
    │     'in_progress'    │
    └─────────────────────┘
              │
              ▼
    ┌─────────────────────┐
    │ 4. 완료/실패 기록     │
    │   task_completed     │
    │   → rga.status =    │
    │     'completed'      │
    │   → 모든 agent 완료?  │
    │     → rg.status =   │
    │       'completed'    │
    └─────────────────────┘
```

### 4.2 상태 동기화 전략

Request Group의 상태는 **두 가지 소스**에서 동기화됩니다:

#### Source 1: History Entry 기반 (DB 영속)

`addHistoryEntry()` 호출 시 `request_group_id`가 있으면:

1. `request_group_agents.status` 업데이트
2. 모든 agent 상태 체크 → `request_groups.status` 업데이트

```typescript
// src/lib/request-groups.ts

async function syncGroupStatusFromHistory(
  requestGroupId: string,
  agentId: string,
  historyType: 'task_started' | 'task_completed' | 'task_failed'
): Promise<void> {
  // 1. Agent 상태 업데이트
  const agentStatus = historyType === 'task_started' ? 'running'
    : historyType === 'task_completed' ? 'completed'
    : 'failed';

  await query(`
    UPDATE request_group_agents
    SET status = $1,
        started_at = CASE WHEN $1 = 'running' THEN NOW() ELSE started_at END,
        completed_at = CASE WHEN $1 IN ('completed', 'failed') THEN NOW() ELSE completed_at END
    WHERE request_group_id = $2 AND agent_id = $3
  `, [agentStatus, requestGroupId, agentId]);

  // 2. Group 상태 자동 계산
  await recalculateGroupStatus(requestGroupId);
}

async function recalculateGroupStatus(requestGroupId: string): Promise<void> {
  await query(`
    UPDATE request_groups rg SET
      status = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM request_group_agents
          WHERE request_group_id = rg.id AND status NOT IN ('completed', 'failed')
        ) AND EXISTS (
          SELECT 1 FROM request_group_agents WHERE request_group_id = rg.id
        ) THEN
          CASE
            WHEN EXISTS (
              SELECT 1 FROM request_group_agents
              WHERE request_group_id = rg.id AND status = 'completed'
            ) THEN 'completed'
            ELSE 'failed'
          END
        WHEN EXISTS (
          SELECT 1 FROM request_group_agents
          WHERE request_group_id = rg.id AND status = 'running'
        ) THEN 'in_progress'
        ELSE rg.status
      END,
      started_at = COALESCE(rg.started_at, (
        SELECT MIN(started_at) FROM request_group_agents
        WHERE request_group_id = rg.id AND started_at IS NOT NULL
      )),
      completed_at = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM request_group_agents
          WHERE request_group_id = rg.id AND status NOT IN ('completed', 'failed')
        ) THEN NOW()
        ELSE NULL
      END,
      updated_at = NOW()
    WHERE rg.id = $1
  `, [requestGroupId]);
}
```

#### Source 2: Agent Status 실시간 (메모리 캐시)

`agent_statuses` 테이블 + `liveOutputCache` (in-memory)에서 **실시간 데이터**를 병합:

```typescript
// GET /api/request-groups/active 에서 사용
async function enrichWithLiveStatus(
  groups: RequestGroupSummary[]
): Promise<RequestGroupMonitorEntry[]> {
  const allAgentStatuses = await getAllAgentStatuses();

  return groups.map(group => ({
    id: group.id,
    title: group.title,
    status: group.status,
    agents: group.agents.map(rga => {
      // agent_statuses에서 실시간 정보 병합
      const liveAgent = Object.values(allAgentStatuses)
        .flat()
        .find(a => a.id === rga.agentId);

      return {
        agentId: rga.agentId,
        status: rga.status,
        currentTask: liveAgent?.currentTask || rga.currentTask,
        liveOutput: liveAgent?.status === 'running' ? liveAgent.liveOutput : undefined,
      };
    }),
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  }));
}
```

---

## 5. API 스펙 정의

### 5.1 `GET /api/request-groups` — 목록 조회

**용도**: 미완료(active) Request Group 목록, 또는 필터링된 목록

**인증**: 세션 또는 `x-relay-key`

**Query Parameters:**

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| `status` | string | `active` | `active` (pending+in_progress), `completed`, `failed`, `all` |
| `limit` | number | `20` | 최대 반환 수 |
| `cursor` | string | — | 커서 기반 페이지네이션 (ISO timestamp) |
| `gatewayId` | string | — | 특정 gateway의 그룹만 |

**Response (200):**

```json
{
  "groups": [
    {
      "id": "uuid-1",
      "title": "MumMum 온보딩 플로우 개선",
      "status": "in_progress",
      "sourceType": "orchestrate",
      "gatewayId": "hanchi-macbook",
      "createdAt": "2026-02-25T10:00:00Z",
      "startedAt": "2026-02-25T10:00:05Z",
      "updatedAt": "2026-02-25T10:05:30Z",
      "agentCount": 3,
      "completedAgentCount": 1,
      "failedAgentCount": 0,
      "runningAgentCount": 2
    }
  ],
  "nextCursor": "2026-02-25T09:00:00Z|uuid-prev",
  "hasMore": true
}
```

### 5.2 `GET /api/request-groups/[id]` — 상세 조회

**용도**: 특정 Request Group의 상세 정보 + 소속 에이전트 목록 + 관련 history

**인증**: 세션 또는 `x-relay-key`

**Response (200):**

```json
{
  "group": {
    "id": "uuid-1",
    "title": "MumMum 온보딩 플로우 개선",
    "description": "MumMum 앱의 온보딩 플로우를 개선해주세요. 현재 사용자 이탈률이 높습니다.",
    "status": "in_progress",
    "sourceType": "orchestrate",
    "sourceCommandId": "cmd-uuid",
    "gatewayId": "hanchi-macbook",
    "createdAt": "2026-02-25T10:00:00Z",
    "startedAt": "2026-02-25T10:00:05Z",
    "completedAt": null,
    "updatedAt": "2026-02-25T10:05:30Z",
    "agents": [
      {
        "id": "rga-uuid-1",
        "requestGroupId": "uuid-1",
        "agentId": "pm",
        "status": "completed",
        "currentTask": null,
        "resultSummary": "요구사항 분석 완료: 3가지 개선점 도출",
        "assignedAt": "2026-02-25T10:00:00Z",
        "startedAt": "2026-02-25T10:00:05Z",
        "completedAt": "2026-02-25T10:02:30Z"
      },
      {
        "id": "rga-uuid-2",
        "requestGroupId": "uuid-1",
        "agentId": "dev",
        "status": "running",
        "currentTask": "온보딩 UI 컴포넌트 구현 중",
        "assignedAt": "2026-02-25T10:02:30Z",
        "startedAt": "2026-02-25T10:02:35Z"
      },
      {
        "id": "rga-uuid-3",
        "requestGroupId": "uuid-1",
        "agentId": "qa",
        "status": "pending",
        "currentTask": null,
        "assignedAt": "2026-02-25T10:00:00Z"
      }
    ],
    "historyCount": 12
  }
}
```

**Response (404):**

```json
{ "error": "Request group not found" }
```

### 5.3 `POST /api/request-groups` — 생성

**용도**: 새 Request Group 생성 (수동 또는 시스템)

**인증**: 세션 또는 `x-relay-key`

**Request Body:**

```json
{
  "title": "MumMum 온보딩 플로우 개선",
  "description": "MumMum 앱의 온보딩 플로우를 개선해주세요.",
  "sourceType": "orchestrate",
  "sourceCommandId": "cmd-uuid",
  "gatewayId": "hanchi-macbook",
  "agents": ["pm", "dev", "qa"]
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `title` | string | ✅ | 200자 이내 요약 제목 |
| `description` | string | ❌ | 원본 지시 전문 |
| `sourceType` | enum | ❌ | 기본값 `'manual'` |
| `sourceCommandId` | UUID | ❌ | 트리거한 relay command ID |
| `gatewayId` | string | ❌ | 실행 대상 gateway |
| `agents` | string[] | ❌ | 초기 참여 에이전트 ID 목록 |

**Response (201):**

```json
{
  "success": true,
  "group": {
    "id": "uuid-new",
    "title": "MumMum 온보딩 플로우 개선",
    "status": "pending",
    "sourceType": "orchestrate",
    "gatewayId": "hanchi-macbook",
    "createdAt": "2026-02-25T10:00:00Z",
    "updatedAt": "2026-02-25T10:00:00Z"
  },
  "agents": [
    { "agentId": "pm", "status": "pending" },
    { "agentId": "dev", "status": "pending" },
    { "agentId": "qa", "status": "pending" }
  ]
}
```

### 5.4 `PATCH /api/request-groups/[id]` — 상태 업데이트

**용도**: Request Group 상태 변경 (취소 등)

**Request Body:**

```json
{
  "status": "cancelled"
}
```

**Response (200):**

```json
{
  "success": true,
  "group": { "id": "uuid-1", "status": "cancelled", "updatedAt": "..." }
}
```

### 5.5 `POST /api/request-groups/[id]/agents` — 에이전트 추가

**용도**: 실행 중 새 에이전트를 Request Group에 추가

**Request Body:**

```json
{
  "agentId": "security",
  "currentTask": "보안 리뷰"
}
```

**Response (201):**

```json
{
  "success": true,
  "agent": {
    "id": "rga-uuid-new",
    "requestGroupId": "uuid-1",
    "agentId": "security",
    "status": "pending",
    "currentTask": "보안 리뷰",
    "assignedAt": "2026-02-25T10:10:00Z"
  }
}
```

### 5.6 `PATCH /api/request-groups/[id]/agents/[agentId]` — 에이전트 상태 업데이트

**용도**: 에이전트의 상태 변경 (+ 자동으로 그룹 상태 재계산)

**Request Body:**

```json
{
  "status": "completed",
  "resultSummary": "코드 구현 완료. 3개 파일 수정.",
  "currentTask": null
}
```

### 5.7 `GET /api/request-groups/active` — 실시간 모니터용

**용도**: 현재 활성 상태인 Request Group + 실시간 agent 상태 병합

**인증**: 세션 또는 `x-relay-key`

**특이사항**: `agent_statuses` + `liveOutputCache`와 병합된 데이터 반환

**Response (200):**

```json
{
  "activeGroups": [
    {
      "id": "uuid-1",
      "title": "MumMum 온보딩 플로우 개선",
      "status": "in_progress",
      "agents": [
        {
          "agentId": "pm",
          "status": "completed",
          "currentTask": null
        },
        {
          "agentId": "dev",
          "status": "running",
          "currentTask": "온보딩 UI 컴포넌트 구현 중",
          "liveOutput": {
            "lastChunk": "Writing src/components/OnboardingFlow.tsx...",
            "totalChars": 15420,
            "lastActivityAt": "2026-02-25T10:05:28Z",
            "chunksReceived": 45,
            "recentEvents": [
              {
                "type": "tool_use",
                "timestamp": "2026-02-25T10:05:28Z",
                "tool": "Write",
                "target": "src/components/OnboardingFlow.tsx"
              }
            ]
          }
        },
        {
          "agentId": "qa",
          "status": "pending",
          "currentTask": null
        }
      ],
      "createdAt": "2026-02-25T10:00:00Z",
      "updatedAt": "2026-02-25T10:05:30Z"
    }
  ],
  "timestamp": "2026-02-25T10:05:35Z"
}
```

---

## 6. MCP 도구 확장

### 6.1 기존 도구 수정

#### `dashboard_add_history`

history entry 추가 시 `requestGroupId`가 있으면 **자동으로 그룹 상태를 동기화**합니다.

```
변경 없음 (파라미터 호환)
내부 로직에 syncGroupStatusFromHistory() 호출 추가
```

#### `dashboard_send_command`

`orchestrate` 타입 커맨드 시 **자동으로 Request Group 생성** 옵션 추가:

```typescript
// 기존 payload에 추가 가능한 필드
{
  type: "orchestrate",
  payload: {
    task: "...",
    createRequestGroup: true,    // 신규 옵션
    requestGroupTitle: "...",    // 신규 옵션 (자동 생성 가능)
  }
}
```

### 6.2 신규 MCP 도구 (향후)

| 도구명 | 설명 |
|--------|------|
| `dashboard_get_request_groups` | 활성 Request Group 목록 조회 |
| `dashboard_create_request_group` | Request Group 생성 |
| `dashboard_update_agent_status` | 에이전트 상태 업데이트 |

---

## 7. 실시간 모니터 표시 구조

### 7.1 프론트엔드 데이터 구조

```typescript
// src/lib/frontend-types.ts에 추가

interface MonitorRequestGroup {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  agents: MonitorAgentEntry[];
  progress: number;           // 0-100 (completedAgents / totalAgents * 100)
  createdAt: string;
  updatedAt: string;
  elapsedTime: number;        // ms since createdAt (프론트에서 계산)
}

interface MonitorAgentEntry {
  agentId: string;
  agentName: string;          // agents.json에서 매핑
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentTask?: string;
  liveOutput?: {
    lastChunk: string;
    lastActivityAt: string;
    recentEvents: Array<{
      type: string;
      timestamp: string;
      tool?: string;
      target?: string;
      content?: string;
    }>;
  };
}
```

### 7.2 폴링 전략

현재 프론트엔드는 `/api/relay/status`를 5초마다 폴링합니다. 새 엔드포인트를 추가합니다:

| 엔드포인트 | 폴링 주기 | 용도 |
|-----------|----------|------|
| `GET /api/request-groups/active` | 5초 | 활성 그룹 + 실시간 agent 상태 |
| 기존 `GET /api/relay/status` | 5초 | gateway, agent 실시간 상태 (유지) |

**최적화**: `/api/relay/status` 응답에 `activeRequestGroups` 필드를 추가하는 방식도 고려 가능 (추가 폴링 불필요).

### 7.3 UI 레이아웃 제안

```
┌──────────────────────────────────────────────────────┐
│ 🔄 Active Requests                                    │
├──────────────────────────────────────────────────────┤
│                                                       │
│  📋 MumMum 온보딩 플로우 개선        ⏱️ 5m 30s       │
│  ├─ ✅ pm: 요구사항 분석 완료                          │
│  ├─ 🔄 dev: 온보딩 UI 컴포넌트 구현 중                │
│  │       └─ 🔧 Write → OnboardingFlow.tsx (3s ago)   │
│  └─ ⏳ qa: 대기 중                                    │
│  [████████████░░░░░░░░░░] 33%                         │
│                                                       │
│  📋 보안 취약점 스캔                   ⏱️ 2m 15s       │
│  ├─ 🔄 security: 코드 분석 중                         │
│  │       └─ 🔧 Read → src/lib/auth.ts (1s ago)       │
│  └─ ⏳ dev: 대기 중                                    │
│  [████████░░░░░░░░░░░░░░] 0%                          │
│                                                       │
└──────────────────────────────────────────────────────┘
```

---

## 8. Gateway Connector 통합

### 8.1 Orchestrate 시 자동 Request Group 생성

`scripts/gateway-connector.ts`의 orchestrate 핸들러에서:

```typescript
case "orchestrate": {
  const { task } = command.payload;

  // 1. Request Group 자동 생성 (API 호출)
  const groupResult = await apiCall("/api/request-groups", "POST", {
    title: task.slice(0, 200),  // 첫 200자를 title로
    description: task,
    sourceType: "orchestrate",
    sourceCommandId: command.id,
    gatewayId: GATEWAY_ID,
  });
  const requestGroupId = groupResult.group.id;

  // 2. Orchestration plan 생성 후 agent 배정
  const plan = await createPlan(task, agents);
  for (const subtask of plan.subtasks) {
    await apiCall(`/api/request-groups/${requestGroupId}/agents`, "POST", {
      agentId: subtask.agentId,
      currentTask: subtask.task,
    });
  }

  // 3. History entry에 requestGroupId 포함
  // (executor의 onProgress에서 자동 전파)
}
```

### 8.2 Spawn 시 Request Group 래핑

개별 `spawn` 커맨드도 Request Group으로 래핑할 수 있습니다:

```typescript
case "spawn": {
  const { agentId, task, requestGroupId } = command.payload;

  // requestGroupId가 없으면 자동 생성
  let groupId = requestGroupId as string | undefined;
  if (!groupId) {
    const groupResult = await apiCall("/api/request-groups", "POST", {
      title: (task as string).slice(0, 200),
      description: task,
      sourceType: "spawn",
      sourceCommandId: command.id,
      gatewayId: GATEWAY_ID,
      agents: [agentId],
    });
    groupId = groupResult.group.id;
  }

  // history entry에 requestGroupId 포함하여 기록
}
```

---

## 9. 마이그레이션 계획

### 9.1 SQL 마이그레이션 순서

```
sql/013_request_groups_table.sql     — request_groups + request_group_agents 테이블 생성
```

### 9.2 코드 변경 순서

| 순서 | 파일 | 변경 내용 |
|------|------|----------|
| 1 | `sql/013_request_groups_table.sql` | 신규 테이블 생성 |
| 2 | `src/lib/types.ts` | 타입 정의 추가 |
| 3 | `src/lib/request-groups.ts` | 핵심 라이브러리 (신규) |
| 4 | `src/app/api/request-groups/route.ts` | GET (목록), POST (생성) |
| 5 | `src/app/api/request-groups/[id]/route.ts` | GET (상세), PATCH (업데이트) |
| 6 | `src/app/api/request-groups/[id]/agents/route.ts` | POST (에이전트 추가) |
| 7 | `src/app/api/request-groups/[id]/agents/[agentId]/route.ts` | PATCH (에이전트 상태) |
| 8 | `src/app/api/request-groups/active/route.ts` | GET (실시간 모니터용) |
| 9 | `src/lib/history.ts` | `addHistoryEntry()` 후 syncGroupStatus 호출 |
| 10 | `scripts/gateway-connector.ts` | orchestrate/spawn 시 자동 그룹 생성 |
| 11 | `scripts/mcp-server.ts` | 신규 MCP 도구 추가 |
| 12 | `src/app/page.tsx` / 컴포넌트 | 모니터 UI 추가 |

### 9.3 기존 데이터 호환성

- `agent_history.request_group_id`에 이미 값이 있는 기존 데이터는 `request_groups` 테이블에 대응되지 않습니다
- FK 제약을 `NOT VALID`로 추가하여 기존 데이터에 영향 없이 새 데이터만 검증
- 선택적으로 기존 orphan group_id들을 마이그레이션하는 스크립트 제공 가능

---

## 10. 리스크 및 트레이드오프

| 항목 | 리스크 | 대안 |
|------|--------|------|
| N+1 쿼리 | 그룹 목록 + 각 그룹의 에이전트 조회 | JOIN으로 한 번에 조회 (설계에 반영됨) |
| 상태 불일치 | agent_statuses (실시간) vs request_group_agents (DB) 차이 | enrichWithLiveStatus()로 병합 |
| 폴링 부하 | 5초마다 active groups 폴링 | status API에 통합하여 추가 폴링 제거 |
| orphan groups | 생성 후 실행되지 않은 그룹 | TTL 기반 자동 정리 (1시간 pending → cancelled) |
| 동시성 | 여러 agent가 동시에 상태 업데이트 | PostgreSQL 트랜잭션 + `updated_at` 기반 낙관적 잠금 |

---

## 부록 A: 전체 SQL 마이그레이션

```sql
-- 013_request_groups_table.sql
-- Request Group 시스템 테이블

-- 1. Request Groups 메인 테이블
CREATE TABLE IF NOT EXISTS request_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  source_type VARCHAR(30) NOT NULL DEFAULT 'manual',
  source_command_id UUID,
  gateway_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_request_groups_status
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_request_groups_status
  ON request_groups(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_groups_created
  ON request_groups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_groups_gateway
  ON request_groups(gateway_id, status);

-- 2. Request Group Agents 테이블
CREATE TABLE IF NOT EXISTS request_group_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_group_id UUID NOT NULL REFERENCES request_groups(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  current_task TEXT,
  result_summary TEXT,
  error_message TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT uq_request_group_agent UNIQUE (request_group_id, agent_id),
  CONSTRAINT chk_rga_status
    CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_rga_group_id
  ON request_group_agents(request_group_id);
CREATE INDEX IF NOT EXISTS idx_rga_agent_status
  ON request_group_agents(agent_id, status);

-- 3. 기존 agent_history FK (NOT VALID로 안전하게)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_history_request_group'
  ) THEN
    ALTER TABLE agent_history
      ADD CONSTRAINT fk_history_request_group
      FOREIGN KEY (request_group_id) REFERENCES request_groups(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

-- 4. 상태 자동 재계산 함수
CREATE OR REPLACE FUNCTION recalculate_request_group_status(group_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE request_groups rg SET
    status = CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM request_group_agents
        WHERE request_group_id = group_id AND status NOT IN ('completed', 'failed')
      ) AND EXISTS (
        SELECT 1 FROM request_group_agents WHERE request_group_id = group_id
      ) THEN
        CASE
          WHEN EXISTS (
            SELECT 1 FROM request_group_agents
            WHERE request_group_id = group_id AND status = 'completed'
          ) THEN 'completed'
          ELSE 'failed'
        END
      WHEN EXISTS (
        SELECT 1 FROM request_group_agents
        WHERE request_group_id = group_id AND status = 'running'
      ) THEN 'in_progress'
      ELSE rg.status
    END,
    started_at = COALESCE(rg.started_at, (
      SELECT MIN(started_at) FROM request_group_agents
      WHERE request_group_id = group_id AND started_at IS NOT NULL
    )),
    completed_at = CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM request_group_agents
        WHERE request_group_id = group_id AND status NOT IN ('completed', 'failed')
      ) AND EXISTS (
        SELECT 1 FROM request_group_agents WHERE request_group_id = group_id
      ) THEN NOW()
      ELSE NULL
    END,
    updated_at = NOW()
  WHERE rg.id = group_id;
END;
$$ LANGUAGE plpgsql;
```
