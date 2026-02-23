# 태스크 큐잉 및 오케스트레이션 시스템 — PRD / 기술 사양서

> **문서 버전**: 1.0
> **작성일**: 2026-02-23
> **프로젝트**: LifeDashboard
> **상태**: Approved (Architect Review Passed)

---

## 목차

1. [개요 (Overview)](#1-개요-overview)
2. [현행 시스템 분석 (Current System Analysis)](#2-현행-시스템-분석-current-system-analysis)
3. [시스템 설계 (System Design)](#3-시스템-설계-system-design)
4. [데이터 모델 (Data Model)](#4-데이터-모델-data-model)
5. [태스크 생명주기 (Task Lifecycle)](#5-태스크-생명주기-task-lifecycle)
6. [핵심 알고리즘 (Core Algorithms)](#6-핵심-알고리즘-core-algorithms)
7. [동시성 관리 (Concurrency Management)](#7-동시성-관리-concurrency-management)
8. [의존성 그래프 관리 (Dependency Graph Management)](#8-의존성-그래프-관리-dependency-graph-management)
9. [충돌 방지 (Conflict Prevention)](#9-충돌-방지-conflict-prevention)
10. [시퀀스 다이어그램 (Sequence Diagrams)](#10-시퀀스-다이어그램-sequence-diagrams)
11. [통합 지점 (Integration Points)](#11-통합-지점-integration-points)
12. [마이그레이션 전략 (Migration Strategy)](#12-마이그레이션-전략-migration-strategy)
13. [리스크 분석 (Risk Analysis)](#13-리스크-분석-risk-analysis)
14. [비기능 요구사항 (Non-Functional Requirements)](#14-비기능-요구사항-non-functional-requirements)
15. [구현 일정 (Implementation Timeline)](#15-구현-일정-implementation-timeline)
16. [부록 (Appendix)](#16-부록-appendix)

---

## 1. 개요 (Overview)

### 1.1 문서 목적

이 문서는 LifeDashboard 프로젝트에 **태스크 큐잉 및 오케스트레이션 시스템**을 도입하기 위한 완전한 기술 사양서이다. 설계 의도, 데이터 모델, 핵심 알고리즘, 마이그레이션 전략을 포함하며, 이 문서만으로 구현이 가능한 수준의 상세도를 목표로 한다.

### 1.2 프로젝트 배경

**LifeDashboard**는 사이드 프로젝트, AI 에이전트, 재무를 추적하는 개인용 대시보드이다. Next.js 16 (App Router), Tailwind CSS 4, PostgreSQL 14 기반이며, Railway에서 Docker로 배포된다.

**현재 아키텍처 요약:**

- **Relay 시스템**: Dashboard UI에서 REST API(`/api/relay/command`)를 통해 명령을 PostgreSQL `relay_commands` 테이블에 삽입하고, Gateway Connector가 `/api/relay/poll`을 3초 간격으로 폴링하여 pending 명령을 가져와 Claude CLI로 실행한다.
- **Orchestrator** (`scripts/orchestrator.ts`): Claude에게 고수준 태스크를 분해시키고, priority 기반으로 그룹화하여 같은 priority의 서브태스크를 `Promise.allSettled`로 병렬 실행한다.
- **MCP Server** (`scripts/mcp-server.ts`): 8개 도구(history, agents, status, messages, command, search)를 Claude Code 에이전트에 노출한다.
- **8개 에이전트**: PM, Developer, Reviewer, Growth, Finance, DevOps, Researcher, Content (`agents.json`).

**현재 relay 기반 명령 실행 방식의 한계점:**

| 항목 | 현행 | 한계 |
|------|------|------|
| Task Stack | React 클라이언트 상태 (`useState`) | 브라우저 새로고침 시 유실 |
| Priority | 없음 (FIFO만 존재) | 긴급 태스크 우선 실행 불가 |
| Retry | 없음 | 실패 시 수동 재시도 필요 |
| Concurrency 제어 | 없음 | 에이전트 과부하, 리소스 경합 |
| Dependencies | 없음 | 태스크 간 순서 보장 불가 |
| File Conflicts | 방지 없음 | 병렬 에이전트 간 동일 파일 편집 시 충돌 |
| Persistence | `relay_commands`만 DB 저장 | 상위 오케스트레이션 상태 비영속 |
| Observability | `agent_history`만 | 태스크 단위 감사 로그 없음 |

### 1.3 목표 및 범위

**Primary Goals:**

1. **Persistent Queue** — 모든 태스크를 PostgreSQL에 영속 저장, 서버 재시작/브라우저 새로고침에도 유실 없음
2. **Priority-based FIFO** — 낮은 숫자 = 높은 우선순위, 동일 우선순위 내 FIFO
3. **Concurrency Control** — Global(시스템 전체), Per-Agent(에이전트별), Per-Gateway(게이트웨이별) 3단계 동시성 제한
4. **Dependency Management** — DAG 기반 태스크 의존성, 자동 차단/해제
5. **Conflict Prevention** — 파일 경로 기반 배타적 잠금으로 병렬 에이전트 간 충돌 방지
6. **Retry with Backoff** — 지수 백오프 재시도, Dead Letter Queue
7. **Batch Submission** — 오케스트레이션 결과를 원자적 배치로 제출

**Out of Scope:**

- Redis, RabbitMQ 등 외부 큐 시스템 도입
- 3개 게이트웨이 초과 수평 확장
- 실시간 WebSocket push (기존 폴링 유지, 향후 선택적 추가)
- Multi-tenant 지원

---

## 2. 현행 시스템 분석 (Current System Analysis)

### 2.1 아키텍처 현황

```
Dashboard UI (Next.js Client Component)
    |
    | POST /api/relay/command
    ↓
Next.js API Route (src/app/api/relay/command/route.ts)
    |
    | queueCommand() → INSERT INTO relay_commands
    ↓
PostgreSQL (relay_commands table)
    ↑
    | getAndClearCommands() → UPDATE SET status='processing' RETURNING
    |
Gateway Connector (scripts/gateway-connector.ts)
    | 3초 간격 polling via POST /api/relay/poll
    |
    | executeCommand() → type별 분기
    ↓
Claude CLI (scripts/claude-executor.ts)
    |
    | 실행 결과
    ↓
updateCommandResult() → UPDATE relay_commands SET status, result
```

**현행 5개 테이블 (`sql/001_init.sql`):**

| 테이블 | 용도 |
|--------|------|
| `agent_history` | 에이전트 작업 이력 |
| `messages` | 에이전트 간 메시지 |
| `gateway_connections` | 게이트웨이 연결 상태 |
| `relay_commands` | 명령 큐 (pending → processing → completed/failed) |
| `agent_statuses` | 에이전트 실시간 상태 |

**현행 8개 에이전트:**

| ID | 이름 | 역할 | 카테고리 |
|----|------|------|----------|
| `pm` | PM | 프로젝트 관리, 작업 분해, OKR 추적 | business |
| `dev` | Developer | 코드 작성, 버그 수정, 리팩토링 | dev |
| `reviewer` | Reviewer | 코드 리뷰, 품질 검증, 보안 점검 | dev |
| `growth` | Growth | 유저 획득, 마케팅, SEO | business |
| `finance` | Finance | 매출 추적, 비용 관리, FIRE | business |
| `devops` | DevOps | CI/CD, 모니터링, 인프라 | ops |
| `researcher` | Researcher | 시장 조사, 경쟁사 분석 | business |
| `content` | Content | 블로그, 문서화, 소셜 미디어 | business |

### 2.2 핵심 컴포넌트

**`src/lib/relay.ts` — 명령 큐잉 및 게이트웨이 연결 관리**

- `registerGateway(gatewayId)`: INSERT/UPSERT into `gateway_connections`
- `updateHeartbeat(gatewayId)`: heartbeat 갱신
- `getConnectedGateways()`: 30초 이내 heartbeat인 게이트웨이 조회
- `queueCommand(gatewayId, command)`: `relay_commands`에 INSERT (DB 장애 시 in-memory fallback)
- `getAndClearCommands(gatewayId)`: pending 명령을 processing으로 전환하며 반환
- `updateCommandResult(gatewayId, commandId, status, result)`: 명령 결과 업데이트
- `updateAgentStatuses(gatewayId, agents)`: 에이전트 상태 UPSERT
- `getAllAgentStatuses()`: 전체 에이전트 상태 조회

**`scripts/gateway-connector.ts` — 폴링 기반 명령 수신 및 실행**

- 3초 간격 `POST /api/relay/poll` 호출
- 명령 타입별 분기: `spawn` (Claude CLI 실행), `send` (세션 메시지), `status`, `message`, `orchestrate`
- `orchestrate` 명령 시 `scripts/orchestrator.ts`의 `orchestrate()` 호출
- 실행 중 에이전트 상태를 `agentStatusMap`에 추적
- `pendingHistoryEntries` 배열에 히스토리 버퍼링, poll 시 전송

**`scripts/orchestrator.ts` — Claude 기반 태스크 분해 및 우선순위별 병렬 실행**

- `createPlan(task, agents)`: Claude CLI로 태스크를 서브태스크 JSON으로 분해
- `executePlan(plan, executor, onProgress)`: priority 기반 그룹화, 동일 priority 내 `Promise.allSettled` 병렬 실행
- `summarizeResults(task, results)`: Claude CLI로 결과 요약
- `orchestrate(task, agents, executor, onProgress)`: 전체 파이프라인 (계획 → 실행 → 요약)

**`scripts/mcp-server.ts` — 8개 MCP 도구 노출**

- `dashboard_get_history`, `dashboard_get_agents`, `dashboard_get_status`
- `dashboard_get_messages`, `dashboard_add_history`, `dashboard_send_message`
- `dashboard_send_command`, `dashboard_search_history`

### 2.3 현행 시스템의 한계

| 항목 | 현행 방식 | 문제점 | 영향도 |
|------|-----------|--------|--------|
| Task Stack | React `useState` (`page.tsx`의 `TaskStack` interface) | 브라우저 새로고침 시 전체 유실 | High |
| Priority | `relay_commands`에 없음 | FIFO만 가능, 긴급 태스크 개입 불가 | High |
| Retry | 없음 | Claude CLI 일시적 오류 시 수동 재시도 | Medium |
| Concurrency | Gateway Connector에 제어 없음 | 다수 spawn 명령 동시 도착 시 리소스 과부하 | High |
| Dependencies | `orchestrator.ts`의 priority 그룹만 | DAG 불가, priority가 같으면 의존 관계 표현 불가 | Medium |
| File Conflicts | 방지 없음 | dev와 reviewer가 동시에 같은 파일 수정 가능 | High |
| Heartbeat | 게이트웨이만, 태스크 단위 없음 | 태스크가 hang되어도 감지 불가 | Medium |
| Dead Letter | 없음 | 반복 실패 태스크 영구 재시도 | Low |

---

## 3. 시스템 설계 (System Design)

### 3.1 설계 원칙

1. **PostgreSQL 단일 저장소** — Redis, Kafka 등 외부 의존성 없이 PostgreSQL만 사용. `FOR UPDATE SKIP LOCKED`로 경합 처리.
2. **Pull 기반 호환** — 기존 Gateway Connector의 3초 폴링 방식을 유지하되, 태스크 큐에서 직접 claim하도록 확장.
3. **하위 호환성** — 기존 `relay_commands` 테이블과 API를 그대로 유지. 새 시스템은 상위 레이어로 동작.
4. **점진적 마이그레이션** — 5단계 마이그레이션으로 무중단 전환.
5. **원자적 연산** — 모든 상태 전이는 PostgreSQL 트랜잭션 내에서 원자적으로 수행.
6. **관찰 가능성** — 모든 상태 전이를 `task_events`에 감사 로그로 기록.

### 3.2 전체 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Dashboard UI / MCP Tool                      │
│                                                                     │
│  [Task Submit Form]  [Batch Submit]  [Queue Status Bar]             │
│  [Task Queue Panel]                                                 │
└───────────────┬─────────────────────────────────────────────────────┘
                |
                | POST /api/queue/submit   POST /api/queue/batch
                | POST /api/relay/command (legacy, queue:true option)
                ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     Next.js API Layer                                │
│                                                                     │
│  /api/queue/submit    → submitTask()                                │
│  /api/queue/batch     → submitBatch()                               │
│  /api/queue/claim     → claimTask()                                 │
│  /api/queue/complete  → completeTask()                              │
│  /api/queue/fail      → failTask()                                  │
│  /api/queue/heartbeat → heartbeat()                                 │
│  /api/queue/cancel    → cancelTask()                                │
│  /api/queue/status    → getQueueStatus()                            │
│  /api/queue/task/[id] → getTask()                                   │
│  /api/queue/stats     → getQueueStats()                             │
└───────────────┬─────────────────────────────────────────────────────┘
                |
                ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    Task Queue Library                                │
│                    (src/lib/task-queue.ts)                           │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐      │
│  │ submitTask() │  │ submitBatch()│  │ schedulerLoop()      │      │
│  │              │  │ (DAG 검증)   │  │ - releaseStale()     │      │
│  │ - 의존성 검증 │  │ - 순환 탐지   │  │ - retryReady()       │      │
│  │ - 초기 상태   │  │ - 원자적 삽입 │  │ - 5초 간격            │      │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────┘      │
│         |                 |                                         │
│         ↓                 ↓                                         │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │              PostgreSQL (task_queue table)                │      │
│  │              Priority FIFO + FOR UPDATE SKIP LOCKED      │      │
│  └──────────────────────────┬───────────────────────────────┘      │
│                             |                                       │
│  ┌──────────────────────────┴───────────────────────────────┐      │
│  │                    claimTask()                            │      │
│  │  1. Global concurrency check                             │      │
│  │  2. Per-agent concurrency check                          │      │
│  │  3. Per-gateway concurrency check                        │      │
│  │  4. Locked file paths collection                         │      │
│  │  5. FOR UPDATE SKIP LOCKED (path conflict exclusion)     │      │
│  │  6. Status → claimed, file locks, concurrency increment  │      │
│  └──────────────────────────────────────────────────────────┘      │
└───────────────┬─────────────────────────────────────────────────────┘
                |
        ┌───────┴───────┐
        ↓               ↓
┌──────────────┐ ┌──────────────┐
│  Gateway A   │ │  Gateway B   │
│  (claimTask) │ │  (claimTask) │
│      |       │ │      |       │
│  Claude CLI  │ │  Claude CLI  │
│      |       │ │      |       │
│ completeTask │ │ completeTask │
│ / failTask   │ │ / failTask   │
└──────┬───────┘ └──────┬───────┘
       |                |
       ↓                ↓
  Dependency Unblocking → blocked 태스크를 pending으로 전환
```

---

## 4. 데이터 모델 (Data Model)

### 4.1 PostgreSQL 스키마

#### 4.1.1 `task_queue` — 핵심 태스크 큐 테이블

```sql
CREATE TABLE IF NOT EXISTS task_queue (
  -- Identity
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        UUID,                                          -- 배치 그룹 ID (NULL이면 단독 태스크)
  parent_task_id  UUID REFERENCES task_queue(id) ON DELETE SET NULL, -- 부모 태스크 (계층 구조용)

  -- Task definition
  agent_id        TEXT NOT NULL,                                 -- 실행할 에이전트 ID (예: 'dev', 'reviewer')
  task_type       TEXT NOT NULL DEFAULT 'spawn',                 -- 'spawn' | 'orchestrate' | 'send' | 'message'
  title           TEXT NOT NULL,                                 -- 태스크 제목 (사람이 읽을 수 있는)
  payload         JSONB NOT NULL DEFAULT '{}',                   -- 실행 파라미터 (기존 RelayCommand.payload 호환)

  -- Scheduling
  priority        INTEGER NOT NULL DEFAULT 100,                  -- 우선순위 (낮을수록 높음, 1=최고)
  scheduled_after TIMESTAMPTZ DEFAULT NOW(),                     -- 이 시각 이후 실행 가능 (지연 실행용)

  -- State machine
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN (
                    'pending',      -- 실행 대기 (모든 의존성 충족)
                    'blocked',      -- 의존성 미충족으로 대기
                    'claimed',      -- 게이트웨이가 청구함 (아직 실행 시작 전)
                    'running',      -- 실행 중
                    'completed',    -- 성공 완료
                    'failed',       -- 실패 (재시도 가능)
                    'cancelled',    -- 취소됨
                    'dead_letter'   -- 최대 재시도 초과, 수동 처리 필요
                  )),

  -- Claim info
  claimed_by      TEXT,                                          -- 청구한 게이트웨이 ID
  claimed_at      TIMESTAMPTZ,                                   -- 청구 시각
  started_at      TIMESTAMPTZ,                                   -- 실행 시작 시각
  completed_at    TIMESTAMPTZ,                                   -- 완료 시각

  -- Heartbeat
  heartbeat_at    TIMESTAMPTZ,                                   -- 마지막 하트비트 시각

  -- Result
  result          JSONB,                                         -- 실행 결과 (성공 시)
  error           TEXT,                                          -- 에러 메시지 (실패 시)
  error_detail    JSONB,                                         -- 상세 에러 정보 (스택 트레이스 등)

  -- Retry
  attempt         INTEGER NOT NULL DEFAULT 0,                    -- 현재 시도 횟수
  max_retries     INTEGER NOT NULL DEFAULT 3,                    -- 최대 재시도 횟수
  next_retry_at   TIMESTAMPTZ,                                   -- 다음 재시도 시각

  -- Conflict prevention
  affected_paths  TEXT[] DEFAULT '{}',                            -- 이 태스크가 수정할 파일 경로들

  -- Metadata
  created_by      TEXT DEFAULT 'dashboard',                      -- 생성자 ('dashboard', 'mcp', 'orchestrator')
  metadata        JSONB DEFAULT '{}',                            -- 추가 메타데이터

  -- Timestamps
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 스케줄 가능한 태스크 조회 (hot path: claimTask)
CREATE INDEX idx_tq_schedulable ON task_queue (priority ASC, created_at ASC)
  WHERE status = 'pending' AND scheduled_after <= NOW();

-- 차단된 태스크 조회 (의존성 해제 시)
CREATE INDEX idx_tq_blocked ON task_queue (id)
  WHERE status = 'blocked';

-- 실행 중 태스크 조회 (하트비트 검사, 동시성 카운트)
CREATE INDEX idx_tq_running ON task_queue (claimed_by, status)
  WHERE status IN ('claimed', 'running');

-- 배치별 조회
CREATE INDEX idx_tq_batch ON task_queue (batch_id)
  WHERE batch_id IS NOT NULL;

-- 에이전트별 조회
CREATE INDEX idx_tq_agent ON task_queue (agent_id, status);

-- 재시도 대기 조회
CREATE INDEX idx_tq_retry ON task_queue (next_retry_at ASC)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL AND attempt < max_retries;

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_task_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_task_queue_updated_at
  BEFORE UPDATE ON task_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_task_queue_updated_at();
```

#### 4.1.2 `task_dependencies` — DAG 의존성 간선

```sql
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id     UUID NOT NULL REFERENCES task_queue(id) ON DELETE CASCADE,
  depends_on  UUID NOT NULL REFERENCES task_queue(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on),
  -- 자기 참조 방지
  CHECK (task_id <> depends_on)
);

CREATE INDEX idx_td_task ON task_dependencies (task_id);
CREATE INDEX idx_td_depends ON task_dependencies (depends_on);
```

#### 4.1.3 `concurrency_slots` — 세마포어 기반 동시성 슬롯

```sql
CREATE TABLE IF NOT EXISTS concurrency_slots (
  scope       TEXT NOT NULL,       -- 'global', 'agent:<id>', 'gateway:<id>'
  max_slots   INTEGER NOT NULL,    -- 최대 동시 실행 수
  used_slots  INTEGER NOT NULL DEFAULT 0,  -- 현재 사용 중인 슬롯
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (scope),
  CHECK (used_slots >= 0),
  CHECK (used_slots <= max_slots)
);

-- 초기 데이터: 전역 슬롯 및 에이전트별 슬롯
INSERT INTO concurrency_slots (scope, max_slots) VALUES
  ('global', 3),
  ('agent:pm', 1),
  ('agent:dev', 1),
  ('agent:reviewer', 1),
  ('agent:growth', 1),
  ('agent:finance', 1),
  ('agent:devops', 1),
  ('agent:researcher', 1),
  ('agent:content', 1)
ON CONFLICT (scope) DO NOTHING;
```

> **⚠️ CHECK 제약조건과 경합 조건 (Race Condition)**
>
> `CHECK (used_slots <= max_slots)` 제약조건은 UPSERT 시 안전망 역할을 한다. `claimTask()`의 Step 2-3에서 `used_slots >= max_slots`를 확인하지만, TOCTOU(Time-of-Check-Time-of-Use) 경합이 발생할 수 있다.
>
> **완화 전략**: 게이트웨이 슬롯 UPSERT 시 반드시 `WHERE concurrency_slots.used_slots < concurrency_slots.max_slots` 조건을 추가한다. CHECK 제약 위반 시 트랜잭션이 롤백되므로, 이를 catch하여 "용량 부족"으로 처리한다.
>
> ```sql
> -- 안전한 UPSERT 패턴
> INSERT INTO concurrency_slots (scope, max_slots, used_slots)
>   VALUES ('gateway:' || $gateway_id, 5, 1)
>   ON CONFLICT (scope) DO UPDATE
>     SET used_slots = concurrency_slots.used_slots + 1
>     WHERE concurrency_slots.used_slots < concurrency_slots.max_slots;
> -- affected rows = 0이면 용량 부족 → 트랜잭션 롤백
> ```

#### 4.1.4 `file_locks` — 파일 수준 배타적 잠금

```sql
CREATE TABLE IF NOT EXISTS file_locks (
  file_path   TEXT NOT NULL,
  task_id     UUID NOT NULL REFERENCES task_queue(id) ON DELETE CASCADE,
  locked_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (file_path, task_id)
);

CREATE INDEX idx_fl_task ON file_locks (task_id);
CREATE INDEX idx_fl_path ON file_locks (file_path);
```

#### 4.1.5 `task_events` — 감사 로그 (Audit Log)

```sql
CREATE TABLE IF NOT EXISTS task_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES task_queue(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,           -- 'created', 'claimed', 'started', 'heartbeat',
                                       -- 'completed', 'failed', 'retrying', 'dead_letter',
                                       -- 'cancelled', 'unblocked', 'stale_released'
  from_status TEXT,                    -- 이전 상태
  to_status   TEXT,                    -- 새 상태
  actor       TEXT,                    -- 실행 주체 (gateway ID, 'scheduler', 'dashboard')
  detail      JSONB DEFAULT '{}',      -- 추가 상세 정보
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_te_task ON task_events (task_id, created_at DESC);
CREATE INDEX idx_te_type ON task_events (event_type, created_at DESC);

-- 30일 이상 된 이벤트 자동 정리용 (선택적)
CREATE INDEX idx_te_cleanup ON task_events (created_at)
  WHERE created_at < NOW() - INTERVAL '30 days';
```

### 4.2 TypeScript 인터페이스

```typescript
// ===== Core Types =====

export type TaskStatus =
  | 'pending'
  | 'blocked'
  | 'claimed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'dead_letter';

export type TaskType = 'spawn' | 'orchestrate' | 'send' | 'message';

export type TaskEventType =
  | 'created'
  | 'claimed'
  | 'started'
  | 'heartbeat'
  | 'completed'
  | 'failed'
  | 'retrying'
  | 'dead_letter'
  | 'cancelled'
  | 'unblocked'
  | 'stale_released';

export type ConcurrencyScope = 'global' | `agent:${string}` | `gateway:${string}`;

// ===== Task =====

export interface Task {
  id: string;                          // UUID
  batchId: string | null;              // 배치 그룹 ID
  parentTaskId: string | null;         // 부모 태스크 ID

  agentId: string;                     // 실행 에이전트 ID
  taskType: TaskType;                  // 태스크 유형
  title: string;                       // 태스크 제목
  payload: Record<string, unknown>;    // 실행 파라미터

  priority: number;                    // 우선순위 (낮을수록 높음)
  scheduledAfter: string;              // ISO 8601 timestamp

  status: TaskStatus;                  // 현재 상태

  claimedBy: string | null;            // 청구한 게이트웨이 ID
  claimedAt: string | null;            // 청구 시각
  startedAt: string | null;            // 실행 시작 시각
  completedAt: string | null;          // 완료 시각

  heartbeatAt: string | null;          // 마지막 하트비트

  result: Record<string, unknown> | null;  // 실행 결과
  error: string | null;                    // 에러 메시지
  errorDetail: Record<string, unknown> | null; // 상세 에러

  attempt: number;                     // 현재 시도 횟수
  maxRetries: number;                  // 최대 재시도 횟수
  nextRetryAt: string | null;          // 다음 재시도 시각

  affectedPaths: string[];             // 영향 파일 경로

  createdBy: string;                   // 생성자
  metadata: Record<string, unknown>;   // 추가 메타데이터

  createdAt: string;                   // 생성 시각
  updatedAt: string;                   // 갱신 시각
}

// ===== Task Submission =====

export interface TaskSubmission {
  agentId: string;                     // 필수: 실행 에이전트 ID
  taskType?: TaskType;                 // 기본값: 'spawn'
  title: string;                       // 필수: 태스크 제목
  payload: Record<string, unknown>;    // 필수: 실행 파라미터

  priority?: number;                   // 기본값: 100
  scheduledAfter?: string;             // 기본값: NOW()

  dependsOn?: string[];                // 의존하는 태스크 ID 배열
  affectedPaths?: string[];            // 영향 파일 경로
  maxRetries?: number;                 // 기본값: 3
  metadata?: Record<string, unknown>;  // 추가 메타데이터
  createdBy?: string;                  // 기본값: 'dashboard'
}

// ===== Batch Submission =====

export interface BatchTaskSubmission {
  agentId: string;
  taskType?: TaskType;
  title: string;
  payload: Record<string, unknown>;
  priority?: number;
  dependsOn?: string[];                // 배치 내 상대 참조: ["batch:0", "batch:2"]
  affectedPaths?: string[];
  maxRetries?: number;
  metadata?: Record<string, unknown>;
}

export interface BatchSubmission {
  tasks: BatchTaskSubmission[];
  createdBy?: string;                  // 기본값: 'orchestrator'
  metadata?: Record<string, unknown>;  // 배치 수준 메타데이터
}

// ===== Claim =====

export interface TaskClaimResult {
  task: Task | null;                   // 청구된 태스크 (null이면 이용 가능한 태스크 없음)
  reason?: string;                     // null일 때 이유 ('no_capacity', 'no_tasks', 'all_locked')
}

// ===== Scheduler State =====

export interface SchedulerState {
  isRunning: boolean;
  lastRun: string | null;              // ISO 8601
  staleCleaned: number;                // 이번 사이클에서 해제한 부실 청구 수
  retriesQueued: number;               // 이번 사이클에서 재시도 큐에 넣은 수
}

// ===== Events =====

export interface TaskEvent {
  id: string;
  taskId: string;
  eventType: TaskEventType;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus | null;
  actor: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

// ===== Concurrency =====

export interface ConcurrencySlot {
  scope: ConcurrencyScope;
  maxSlots: number;
  usedSlots: number;
  updatedAt: string;
}

// ===== Queue Statistics =====

export interface QueueStats {
  total: number;
  byStatus: Record<TaskStatus, number>;
  byAgent: Record<string, { pending: number; running: number; completed: number; failed: number }>;
  concurrency: ConcurrencySlot[];
  recentEvents: TaskEvent[];
}
```

---

## 5. 태스크 생명주기 (Task Lifecycle)

### 5.1 상태 머신 다이어그램

```
                    ┌─────────────────────────────────────┐
                    │            (new task)                │
                    └──────────┬──────────────────────────┘
                               |
                  ┌────────────┴────────────┐
                  ↓                         ↓
           ┌──────────┐             ┌───────────┐
           │ pending   │             │  blocked   │
           │           │             │            │
           │ 모든 의존성 │             │ 의존성      │
           │ 충족됨     │             │ 미충족      │
           └─────┬─────┘             └─────┬──────┘
                 |                         |
                 | claimTask()             | 의존성 완료 시
                 |                         | unblockDependents()
                 |                    ┌────┘
                 |                    ↓
                 |              (pending으로 전이)
                 |                    |
                 ↓                    |
           ┌──────────┐              |
           │ claimed   │◄─────────────┘
           │           │
           │ 게이트웨이  │
           │ 청구 완료   │
           └─────┬─────┘
                 |
                 | startTask() (게이트웨이가 실행 시작 보고)
                 ↓
           ┌──────────┐
           │ running   │◄─── heartbeat() (60초마다)
           │           │
           │ Claude CLI│──── 하트비트 타임아웃 시 →──┐
           │ 실행 중    │                            |
           └─────┬─────┘                            |
                 |                                   |
        ┌────────┴────────┐                         |
        ↓                 ↓                         ↓
  ┌──────────┐     ┌──────────┐              (stale released)
  │completed │     │  failed   │              → pending으로 복귀
  │          │     │           │                (attempt 증가)
  │ 성공     │     │ 실패      │
  └──────────┘     └─────┬─────┘
                         |
                ┌────────┴────────┐
                ↓                 ↓
         (attempt < max)   (attempt >= max)
                |                 |
                ↓                 ↓
          ┌──────────┐     ┌─────────────┐
          │ pending   │     │ dead_letter  │
          │ (재시도)  │     │              │
          │ next_retry│     │ 수동 처리 필요│
          └──────────┘     └─────────────┘

  ※ 어느 상태에서든 → cancelled 전이 가능 (pending, blocked, claimed 한정)
```

### 5.2 상태 전이 규칙

| From | To | Trigger | 조건 | Actor |
|------|----|---------|------|-------|
| (new) | `pending` | `submitTask()` | 의존성 없음 또는 모든 의존성 completed | dashboard, mcp, orchestrator |
| (new) | `blocked` | `submitTask()` | 하나 이상의 의존성 미완료 | dashboard, mcp, orchestrator |
| `blocked` | `pending` | `unblockDependents()` | 모든 의존 태스크 completed | scheduler |
| `pending` | `claimed` | `claimTask()` | 동시성 슬롯 가용, 파일 충돌 없음, `scheduled_after <= NOW()` | gateway |
| `claimed` | `running` | `startTask()` | 게이트웨이가 실행 시작 보고 | gateway |
| `claimed` | `pending` | `releaseStaleClaimsLoop()` | `claimed_at`으로부터 60초 초과, 하트비트 없음 | scheduler |
| `running` | `completed` | `completeTask()` | 정상 완료 | gateway |
| `running` | `failed` | `failTask()` | 실행 실패 | gateway |
| `running` | `pending` | `releaseStaleClaimsLoop()` | `heartbeat_at`으로부터 60초 초과 | scheduler |
| `failed` | `pending` | `retryReadyTasks()` | `attempt < max_retries` AND `next_retry_at <= NOW()` | scheduler |
| `failed` | `dead_letter` | `failTask()` | `attempt >= max_retries` | scheduler |
| `pending` | `cancelled` | `cancelTask()` | 사용자 요청 | dashboard, mcp |
| `blocked` | `cancelled` | `cancelTask()` | 사용자 요청 | dashboard, mcp |
| `claimed` | `cancelled` | `cancelTask()` | 사용자 요청 (실행 전 취소) | dashboard, mcp |

**불가능한 전이:**

- `running` → `cancelled`: 실행 중인 태스크는 직접 취소 불가 (failTask로 처리)
- `completed` → 어떤 상태로든: 완료된 태스크는 변경 불가
- `dead_letter` → 어떤 상태로든: 수동 처리 후 새 태스크로 재제출
- `cancelled` → 어떤 상태로든: 취소된 태스크는 변경 불가

---

## 6. 핵심 알고리즘 (Core Algorithms)

### 6.1 태스크 제출 (`submitTask`)

```
function submitTask(submission: TaskSubmission): Task
  BEGIN TRANSACTION

    -- 1. 의존성 유효성 검증
    IF submission.dependsOn is not empty THEN
      FOR EACH depId IN submission.dependsOn DO
        dep = SELECT status FROM task_queue WHERE id = depId
        IF dep IS NULL THEN
          RAISE 'Dependency not found: ' || depId
        END IF
        IF dep.status IN ('cancelled', 'dead_letter') THEN
          RAISE 'Dependency is terminated: ' || depId
        END IF
      END FOR
    END IF

    -- 2. 초기 상태 결정
    IF submission.dependsOn is empty THEN
      initialStatus = 'pending'
    ELSE
      allCompleted = SELECT COUNT(*) = 0
        FROM task_queue
        WHERE id = ANY(submission.dependsOn)
        AND status <> 'completed'
      IF allCompleted THEN
        initialStatus = 'pending'
      ELSE
        initialStatus = 'blocked'
      END IF
    END IF

    -- 3. 태스크 삽입
    task = INSERT INTO task_queue (
      agent_id, task_type, title, payload,
      priority, scheduled_after, status,
      affected_paths, max_retries, created_by, metadata
    ) VALUES (
      submission.agentId,
      submission.taskType ?? 'spawn',
      submission.title,
      submission.payload,
      submission.priority ?? 100,
      submission.scheduledAfter ?? NOW(),
      initialStatus,
      submission.affectedPaths ?? '{}',
      submission.maxRetries ?? 3,
      submission.createdBy ?? 'dashboard',
      submission.metadata ?? '{}'
    ) RETURNING *

    -- 4. 의존성 간선 삽입
    IF submission.dependsOn is not empty THEN
      FOR EACH depId IN submission.dependsOn DO
        INSERT INTO task_dependencies (task_id, depends_on)
        VALUES (task.id, depId)
      END FOR
    END IF

    -- 5. 이벤트 로깅
    INSERT INTO task_events (task_id, event_type, to_status, actor, detail)
    VALUES (task.id, 'created', initialStatus, submission.createdBy, submission.metadata)

  COMMIT
  RETURN task
```

### 6.2 배치 제출 (`submitBatch`)

```
function submitBatch(batch: BatchSubmission): Task[]
  BEGIN TRANSACTION

    -- 1. 순환 의존성 탐지 (위상 정렬)
    adjacency = buildAdjacencyFromBatchRefs(batch.tasks)
    -- adjacency[i] = [j, k, ...] 는 task[i]가 task[j], task[k]에 의존함을 의미
    IF hasCycle(adjacency) THEN
      RAISE 'Circular dependency detected in batch'
    END IF

    batchId = gen_random_uuid()
    createdTasks = []

    -- 2. 순서대로 삽입 (배치 내 상대 참조 해결용)
    FOR i = 0 TO batch.tasks.length - 1 DO
      task = batch.tasks[i]

      -- 배치 내 상대 참조를 실제 UUID로 변환
      resolvedDeps = []
      FOR EACH depRef IN (task.dependsOn ?? []) DO
        IF depRef starts with 'batch:' THEN
          idx = parseInt(depRef.replace('batch:', ''))
          IF idx >= createdTasks.length THEN
            RAISE 'Invalid batch reference: ' || depRef
          END IF
          resolvedDeps.push(createdTasks[idx].id)
        ELSE
          -- 외부 태스크 ID (기존 태스크에 대한 의존)
          resolvedDeps.push(depRef)
        END IF
      END FOR

      -- submitTask 로직과 동일하지만 batchId 포함
      initialStatus = determineInitialStatus(resolvedDeps)

      inserted = INSERT INTO task_queue (
        batch_id, agent_id, task_type, title, payload,
        priority, status, affected_paths, max_retries,
        created_by, metadata
      ) VALUES (
        batchId, task.agentId, task.taskType ?? 'spawn',
        task.title, task.payload,
        task.priority ?? 100, initialStatus,
        task.affectedPaths ?? '{}', task.maxRetries ?? 3,
        batch.createdBy ?? 'orchestrator',
        task.metadata ?? '{}'
      ) RETURNING *

      -- 의존성 간선 삽입
      FOR EACH depId IN resolvedDeps DO
        INSERT INTO task_dependencies (task_id, depends_on)
        VALUES (inserted.id, depId)
      END FOR

      -- 이벤트 로깅
      INSERT INTO task_events (task_id, event_type, to_status, actor)
      VALUES (inserted.id, 'created', initialStatus, batch.createdBy)

      createdTasks.push(inserted)
    END FOR

  COMMIT
  RETURN createdTasks
```

**순환 의존성 탐지 (위상 정렬):**

```
function hasCycle(adjacency: Map<number, number[]>): boolean
  inDegree = new Map()
  FOR EACH [node, deps] IN adjacency DO
    IF NOT inDegree.has(node) THEN inDegree.set(node, 0)
    FOR EACH dep IN deps DO
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1)
    END FOR
  END FOR

  queue = [nodes where inDegree == 0]
  visited = 0

  WHILE queue is not empty DO
    node = queue.dequeue()
    visited++
    FOR EACH dependent where node is in their deps DO
      inDegree[dependent]--
      IF inDegree[dependent] == 0 THEN
        queue.enqueue(dependent)
      END IF
    END FOR
  END WHILE

  RETURN visited < totalNodes  -- true이면 순환 존재
```

### 6.3 태스크 청구 — 핫 패스 (`claimTask`)

이 알고리즘은 게이트웨이의 매 폴링 사이클에서 실행되는 **핫 패스**이다. 성능이 매우 중요하다.

```
function claimTask(gatewayId: string, agentId?: string): TaskClaimResult
  BEGIN TRANSACTION

    -- Step 1: Global concurrency 확인
    globalSlot = SELECT used_slots, max_slots
      FROM concurrency_slots
      WHERE scope = 'global'
      FOR UPDATE
    IF globalSlot.used_slots >= globalSlot.max_slots THEN
      RETURN { task: null, reason: 'no_capacity' }
    END IF

    -- Step 2: Per-gateway concurrency 확인
    gwScope = 'gateway:' || gatewayId
    gwSlot = SELECT used_slots, max_slots
      FROM concurrency_slots
      WHERE scope = gwScope
    IF gwSlot IS NOT NULL AND gwSlot.used_slots >= gwSlot.max_slots THEN
      RETURN { task: null, reason: 'no_capacity' }
    END IF

    -- Step 3: (선택) agentId가 지정된 경우 per-agent concurrency 확인
    IF agentId IS NOT NULL THEN
      agentScope = 'agent:' || agentId
      agentSlot = SELECT used_slots, max_slots
        FROM concurrency_slots
        WHERE scope = agentScope
        FOR UPDATE
      IF agentSlot IS NOT NULL AND agentSlot.used_slots >= agentSlot.max_slots THEN
        RETURN { task: null, reason: 'no_capacity' }
      END IF
    END IF

    -- Step 4: 현재 잠긴 파일 경로 수집
    lockedPaths = SELECT ARRAY_AGG(DISTINCT file_path)
      FROM file_locks

    -- Step 5: FOR UPDATE SKIP LOCKED로 최고 우선순위 태스크 선택
    --         경로 충돌 제외, per-agent 동시성 체크 포함
    --
    -- ⚠️ 참고: per-agent 동시성 체크가 correlated subquery로 구현되어 있으며,
    --    concurrency_slots 행에 FOR UPDATE를 걸지 않는다. agentId가 NULL인 경우
    --    (유휴 용량 탐지 경로) 두 게이트웨이가 동시에 같은 에이전트 유형의 태스크를
    --    청구할 수 있는 좁은 경합 창이 존재한다. 현재 규모(1-3 게이트웨이, 3초 폴링)
    --    에서는 실질적으로 무해하며, Step 8의 슬롯 증가 시 CHECK 제약이 안전망 역할.
    candidate = SELECT tq.*
      FROM task_queue tq
      WHERE tq.status = 'pending'
        AND tq.scheduled_after <= NOW()
        -- agentId 필터 (선택)
        AND (agentId IS NULL OR tq.agent_id = agentId)
        -- 파일 경로 충돌 제외
        AND NOT (tq.affected_paths && lockedPaths)
        -- per-agent 동시성 체크 (subquery)
        AND (
          SELECT COALESCE(cs.used_slots, 0) < COALESCE(cs.max_slots, 1)
          FROM concurrency_slots cs
          WHERE cs.scope = 'agent:' || tq.agent_id
        )
      ORDER BY tq.priority ASC, tq.created_at ASC
      LIMIT 1
      FOR UPDATE OF tq SKIP LOCKED

    IF candidate IS NULL THEN
      RETURN { task: null, reason: 'no_tasks' }
    END IF

    -- Step 6: 상태 업데이트 (claimed)
    UPDATE task_queue
    SET status = 'claimed',
        claimed_by = gatewayId,
        claimed_at = NOW(),
        heartbeat_at = NOW()
    WHERE id = candidate.id

    -- Step 7: 파일 잠금 획득
    IF candidate.affected_paths IS NOT NULL AND array_length(candidate.affected_paths, 1) > 0 THEN
      FOR EACH path IN candidate.affected_paths DO
        INSERT INTO file_locks (file_path, task_id)
        VALUES (path, candidate.id)
      END FOR
    END IF

    -- Step 8: 동시성 카운터 증가
    UPDATE concurrency_slots
    SET used_slots = used_slots + 1, updated_at = NOW()
    WHERE scope = 'global'

    UPDATE concurrency_slots
    SET used_slots = used_slots + 1, updated_at = NOW()
    WHERE scope = 'agent:' || candidate.agent_id

    -- gateway 슬롯이 없으면 생성
    INSERT INTO concurrency_slots (scope, max_slots, used_slots)
    VALUES (gwScope, 5, 1)
    ON CONFLICT (scope) DO UPDATE
    SET used_slots = concurrency_slots.used_slots + 1, updated_at = NOW()

    -- Step 9: 이벤트 로깅
    INSERT INTO task_events (task_id, event_type, from_status, to_status, actor)
    VALUES (candidate.id, 'claimed', 'pending', 'claimed', gatewayId)

  COMMIT
  RETURN { task: updatedCandidate }
```

**핵심 SQL (Step 5의 실제 쿼리):**

```sql
SELECT tq.*
FROM task_queue tq
WHERE tq.status = 'pending'
  AND tq.scheduled_after <= NOW()
  AND ($1::TEXT IS NULL OR tq.agent_id = $1)
  AND NOT (tq.affected_paths && (
    SELECT COALESCE(ARRAY_AGG(DISTINCT fl.file_path), '{}')
    FROM file_locks fl
  ))
  AND (
    SELECT COALESCE(cs.used_slots, 0) < COALESCE(cs.max_slots, 1)
    FROM concurrency_slots cs
    WHERE cs.scope = 'agent:' || tq.agent_id
  )
ORDER BY tq.priority ASC, tq.created_at ASC
LIMIT 1
FOR UPDATE OF tq SKIP LOCKED;
```

### 6.4 하트비트 및 부실 청구 감지 (Heartbeat & Stale Detection)

**`heartbeat(taskId, gatewayId)`:**

```
function heartbeat(taskId: string, gatewayId: string): boolean
  result = UPDATE task_queue
    SET heartbeat_at = NOW()
    WHERE id = taskId
      AND claimed_by = gatewayId
      AND status IN ('claimed', 'running')
    RETURNING id

  IF result IS NOT NULL THEN
    INSERT INTO task_events (task_id, event_type, actor)
    VALUES (taskId, 'heartbeat', gatewayId)
  END IF

  RETURN result IS NOT NULL
```

**`releaseStaleClaimsLoop()`:**

```
function releaseStaleClaimsLoop(): number
  STALE_THRESHOLD = 60 seconds

  staleTasks = SELECT id, agent_id, claimed_by, attempt, max_retries
    FROM task_queue
    WHERE status IN ('claimed', 'running')
      AND (
        (heartbeat_at IS NOT NULL AND heartbeat_at < NOW() - STALE_THRESHOLD)
        OR
        (heartbeat_at IS NULL AND claimed_at < NOW() - STALE_THRESHOLD)
      )
    FOR UPDATE SKIP LOCKED

  released = 0

  FOR EACH stale IN staleTasks DO
    BEGIN TRANSACTION

      newAttempt = stale.attempt + 1

      IF newAttempt >= stale.max_retries THEN
        -- Dead letter
        UPDATE task_queue
        SET status = 'dead_letter',
            claimed_by = NULL, claimed_at = NULL,
            heartbeat_at = NULL, attempt = newAttempt,
            error = 'Stale claim: heartbeat timeout after ' || STALE_THRESHOLD || 's'
        WHERE id = stale.id

        INSERT INTO task_events (task_id, event_type, from_status, to_status, actor, detail)
        VALUES (stale.id, 'dead_letter', 'running', 'dead_letter', 'scheduler',
                '{"reason": "stale_timeout", "attempt": ' || newAttempt || '}')

        -- 연쇄 취소
        cascadeCancelDependents(stale.id)
      ELSE
        -- 지수 백오프 재시도
        backoffSeconds = 5 * power(2, newAttempt - 1)  -- 5s, 10s, 20s, 40s...
        retryAt = NOW() + (backoffSeconds || ' seconds')::INTERVAL

        UPDATE task_queue
        SET status = 'failed',
            claimed_by = NULL, claimed_at = NULL,
            heartbeat_at = NULL, attempt = newAttempt,
            next_retry_at = retryAt,
            error = 'Stale claim: heartbeat timeout'
        WHERE id = stale.id

        INSERT INTO task_events (task_id, event_type, from_status, to_status, actor, detail)
        VALUES (stale.id, 'stale_released', 'running', 'failed', 'scheduler',
                '{"attempt": ' || newAttempt || ', "next_retry_at": "' || retryAt || '"}')
      END IF

      -- 동시성 슬롯 해제
      UPDATE concurrency_slots SET used_slots = GREATEST(used_slots - 1, 0) WHERE scope = 'global'
      UPDATE concurrency_slots SET used_slots = GREATEST(used_slots - 1, 0) WHERE scope = 'agent:' || stale.agent_id
      UPDATE concurrency_slots SET used_slots = GREATEST(used_slots - 1, 0) WHERE scope = 'gateway:' || stale.claimed_by

      -- 파일 잠금 해제
      DELETE FROM file_locks WHERE task_id = stale.id

      released++

    COMMIT
  END FOR

  RETURN released
```

### 6.5 태스크 완료 및 의존성 해제 (`completeTask`)

```
function completeTask(taskId: string, gatewayId: string, result: object): Task
  BEGIN TRANSACTION

    task = SELECT * FROM task_queue
      WHERE id = taskId AND claimed_by = gatewayId AND status IN ('claimed', 'running')
      FOR UPDATE

    IF task IS NULL THEN
      RAISE 'Task not found or not owned by this gateway'
    END IF

    -- 1. 상태 업데이트
    UPDATE task_queue
    SET status = 'completed',
        result = result,
        completed_at = NOW()
    WHERE id = taskId

    -- 2. 동시성 슬롯 해제
    UPDATE concurrency_slots SET used_slots = GREATEST(used_slots - 1, 0), updated_at = NOW()
      WHERE scope = 'global'
    UPDATE concurrency_slots SET used_slots = GREATEST(used_slots - 1, 0), updated_at = NOW()
      WHERE scope = 'agent:' || task.agent_id
    UPDATE concurrency_slots SET used_slots = GREATEST(used_slots - 1, 0), updated_at = NOW()
      WHERE scope = 'gateway:' || gatewayId

    -- 3. 파일 잠금 해제
    DELETE FROM file_locks WHERE task_id = taskId

    -- 4. 이벤트 로깅
    INSERT INTO task_events (task_id, event_type, from_status, to_status, actor)
    VALUES (taskId, 'completed', task.status, 'completed', gatewayId)

    -- 5. 종속 태스크 차단 해제
    unblockDependents(taskId)

  COMMIT
  RETURN updatedTask
```

**`unblockDependents(completedTaskId)`:**

```
function unblockDependents(completedTaskId: string): void
  -- completedTaskId에 의존하는 태스크 중 blocked 상태인 것들 조회
  dependentTaskIds = SELECT td.task_id
    FROM task_dependencies td
    JOIN task_queue tq ON tq.id = td.task_id
    WHERE td.depends_on = completedTaskId
      AND tq.status = 'blocked'

  FOR EACH depTaskId IN dependentTaskIds DO
    -- 이 태스크의 모든 의존성이 completed인지 확인
    allDepsCompleted = SELECT COUNT(*) = 0
      FROM task_dependencies td2
      JOIN task_queue tq2 ON tq2.id = td2.depends_on
      WHERE td2.task_id = depTaskId
        AND tq2.status <> 'completed'

    IF allDepsCompleted THEN
      UPDATE task_queue SET status = 'pending' WHERE id = depTaskId

      INSERT INTO task_events (task_id, event_type, from_status, to_status, actor)
      VALUES (depTaskId, 'unblocked', 'blocked', 'pending', 'scheduler')
    END IF
  END FOR
```

### 6.6 태스크 실패 및 재시도 (`failTask`)

```
function failTask(taskId: string, gatewayId: string, error: string, errorDetail?: object): Task
  BEGIN TRANSACTION

    task = SELECT * FROM task_queue
      WHERE id = taskId AND claimed_by = gatewayId AND status IN ('claimed', 'running')
      FOR UPDATE

    IF task IS NULL THEN
      RAISE 'Task not found or not owned by this gateway'
    END IF

    newAttempt = task.attempt + 1

    -- 1. 동시성 슬롯 해제
    UPDATE concurrency_slots SET used_slots = GREATEST(used_slots - 1, 0), updated_at = NOW()
      WHERE scope = 'global'
    UPDATE concurrency_slots SET used_slots = GREATEST(used_slots - 1, 0), updated_at = NOW()
      WHERE scope = 'agent:' || task.agent_id
    UPDATE concurrency_slots SET used_slots = GREATEST(used_slots - 1, 0), updated_at = NOW()
      WHERE scope = 'gateway:' || gatewayId

    -- 2. 파일 잠금 해제
    DELETE FROM file_locks WHERE task_id = taskId

    IF newAttempt >= task.max_retries THEN
      -- Dead letter
      UPDATE task_queue
      SET status = 'dead_letter',
          error = error,
          error_detail = errorDetail,
          attempt = newAttempt,
          claimed_by = NULL, claimed_at = NULL, heartbeat_at = NULL
      WHERE id = taskId

      INSERT INTO task_events (task_id, event_type, from_status, to_status, actor, detail)
      VALUES (taskId, 'dead_letter', task.status, 'dead_letter', gatewayId,
              jsonb_build_object('error', error, 'attempt', newAttempt))

      -- 연쇄 취소: 이 태스크에 의존하는 모든 전이적 종속 태스크 취소
      cascadeCancelDependents(taskId)
    ELSE
      -- 지수 백오프로 재시도 스케줄
      backoffSeconds = 5 * power(2, newAttempt - 1)  -- 5s, 10s, 20s, 40s...
      retryAt = NOW() + (backoffSeconds || ' seconds')::INTERVAL

      UPDATE task_queue
      SET status = 'failed',
          error = error,
          error_detail = errorDetail,
          attempt = newAttempt,
          next_retry_at = retryAt,
          claimed_by = NULL, claimed_at = NULL, heartbeat_at = NULL
      WHERE id = taskId

      INSERT INTO task_events (task_id, event_type, from_status, to_status, actor, detail)
      VALUES (taskId, 'retrying', task.status, 'failed', gatewayId,
              jsonb_build_object('error', error, 'attempt', newAttempt,
                                 'next_retry_at', retryAt, 'backoff_seconds', backoffSeconds))
    END IF

  COMMIT
  RETURN updatedTask
```

**`cascadeCancelDependents(failedTaskId)` — 재귀 CTE로 전이적 종속 태스크 취소:**

```sql
WITH RECURSIVE dependent_tree AS (
  -- 직접 종속 태스크
  SELECT td.task_id
  FROM task_dependencies td
  WHERE td.depends_on = $1  -- failedTaskId

  UNION

  -- 전이적 종속 태스크
  SELECT td2.task_id
  FROM task_dependencies td2
  JOIN dependent_tree dt ON dt.task_id = td2.depends_on
)
UPDATE task_queue
SET status = 'cancelled',
    error = 'Cancelled due to dependency failure: ' || $1
WHERE id IN (SELECT task_id FROM dependent_tree)
  AND status IN ('pending', 'blocked');
```

### 6.7 스케줄러 루프 (`schedulerLoop`)

> **⚠️ 배치 위치 결정 (Scheduler Placement)**
>
> 스케줄러 루프는 **단일 인스턴스**에서만 실행되어야 한다. Railway에서 Next.js가 수평 확장될 경우 여러 인스턴스에서 중복 실행될 수 있다.
>
> **권장 배치**: `scripts/scheduler.ts` — 독립 프로세스로 실행 (gateway-connector.ts와 동일한 방식)
>
> **대안**: gateway-connector.ts 내에서 실행 (단, 게이트웨이가 1개일 때만 적합)
>
> **멱등성 보장**: 부실 청구 해제와 재시도 큐 처리는 모두 `WHERE` 조건으로 필터링하므로 여러 인스턴스에서 실행되더라도 안전하다(멱등). 단, 불필요한 DB 부하를 피하기 위해 단일 인스턴스 권장.
>
> **구현 방식**: `scripts/scheduler.ts`에서 `setInterval`로 실행하고, `Dockerfile`에서 별도 프로세스로 시작하거나, Railway의 cron job으로 5초 간격 실행.

```
function schedulerLoop(): void
  INTERVAL = 5 seconds

  setInterval(async () => {
    try {
      -- 1. 부실 청구 해제
      staleCount = releaseStaleClaimsLoop()
      IF staleCount > 0 THEN
        log('Released ' || staleCount || ' stale claims')
      END IF

      -- 2. 재시도 큐 처리: failed 태스크 중 next_retry_at 도래한 것을 pending으로 전환
      retryCount = retryReadyTasks()
      IF retryCount > 0 THEN
        log('Retried ' || retryCount || ' tasks')
      END IF

      -- 3. (게이트웨이가 직접 claimTask()를 호출하므로 여기서 dispatch하지 않음)

    } catch (error) {
      log('Scheduler error: ' || error.message)
    }
  }, INTERVAL)
```

**`retryReadyTasks()`:**

```
function retryReadyTasks(): number
  result = UPDATE task_queue
    SET status = 'pending',
        next_retry_at = NULL,
        error = NULL,
        error_detail = NULL
    WHERE status = 'failed'
      AND next_retry_at IS NOT NULL
      AND next_retry_at <= NOW()
      AND attempt < max_retries
    RETURNING id

  FOR EACH task IN result DO
    INSERT INTO task_events (task_id, event_type, from_status, to_status, actor)
    VALUES (task.id, 'retrying', 'failed', 'pending', 'scheduler')
  END FOR

  RETURN result.length
```

---

## 7. 동시성 관리 (Concurrency Management)

### 7.1 3-레벨 동시성 제어

| 레벨 | Scope | 기본 max_slots | 설명 |
|------|-------|---------------|------|
| Global | `global` | 3 | 전체 시스템에서 동시 실행 가능한 최대 태스크 수 |
| Per-Agent | `agent:<id>` | 1 | 같은 에이전트 유형의 동시 실행 제한 (예: dev 에이전트는 1개만) |
| Per-Gateway | `gateway:<id>` | 5 | 단일 게이트웨이에서 동시 실행 가능한 최대 수 |

**왜 3-레벨인가?**

- **Global**: Claude API rate limit과 시스템 리소스 보호. 맥북 1대 기준 3개 정도가 적정.
- **Per-Agent**: 같은 에이전트가 동시에 여러 태스크를 실행하면 컨텍스트 충돌 가능. 기본 1로 직렬화.
- **Per-Gateway**: 한 게이트웨이가 모든 슬롯을 독점하지 못하도록. 다중 게이트웨이 환경 대비.

### 7.2 세마포어 메커니즘

`concurrency_slots` 테이블이 분산 세마포어 역할을 한다.

**획득 (`claimTask` 내):**

```sql
-- Global 슬롯 획득 시도
UPDATE concurrency_slots
SET used_slots = used_slots + 1, updated_at = NOW()
WHERE scope = 'global'
  AND used_slots < max_slots;
-- affected_rows == 0이면 슬롯 부족

-- Agent 슬롯 획득
UPDATE concurrency_slots
SET used_slots = used_slots + 1, updated_at = NOW()
WHERE scope = 'agent:' || $1
  AND used_slots < max_slots;

-- Gateway 슬롯 획득 (없으면 생성)
INSERT INTO concurrency_slots (scope, max_slots, used_slots)
VALUES ('gateway:' || $1, 5, 1)
ON CONFLICT (scope) DO UPDATE
SET used_slots = concurrency_slots.used_slots + 1, updated_at = NOW()
WHERE concurrency_slots.used_slots < concurrency_slots.max_slots;
```

**해제 (`completeTask`, `failTask`, `releaseStaleClaimsLoop` 내):**

```sql
UPDATE concurrency_slots
SET used_slots = GREATEST(used_slots - 1, 0), updated_at = NOW()
WHERE scope = $1;
```

**일일 정합성 검사 (Reconciliation):**

드리프트 방지를 위해 실제 running 태스크 수와 슬롯을 비교하여 보정한다.

```sql
-- Global 정합성
UPDATE concurrency_slots
SET used_slots = (
  SELECT COUNT(*) FROM task_queue WHERE status IN ('claimed', 'running')
)
WHERE scope = 'global';

-- Per-agent 정합성
UPDATE concurrency_slots cs
SET used_slots = COALESCE(sub.cnt, 0)
FROM (
  SELECT 'agent:' || agent_id AS scope, COUNT(*) AS cnt
  FROM task_queue
  WHERE status IN ('claimed', 'running')
  GROUP BY agent_id
) sub
WHERE cs.scope = sub.scope;
```

### 7.3 유휴 용량 감지 (Idle Capacity Detection)

게이트웨이 poll 시 `claimTask()`를 반복 호출하여 가용 태스크를 모두 가져간다.

```
-- Gateway Connector의 enhanced poll loop (의사코드)

MAX_LOCAL_CONCURRENT = 5
localRunningCount = countLocallyRunningTasks()

availableCapacity = MAX_LOCAL_CONCURRENT - localRunningCount

WHILE availableCapacity > 0 DO
  result = POST /api/queue/claim { gatewayId, agentId: null }
  IF result.task IS NULL THEN
    BREAK  -- 더 이상 가용 태스크 없음
  END IF

  startLocalExecution(result.task)
  availableCapacity--
END WHILE
```

---

## 8. 의존성 그래프 관리 (Dependency Graph Management)

### 8.1 DAG 구조

`task_dependencies` 테이블이 DAG(Directed Acyclic Graph)의 간선(edge)을 저장한다.

```
task_dependencies:
  task_id    → 이 태스크가
  depends_on → 이 태스크에 의존함
```

예시: "코드 작성 → 코드 리뷰 → 배포"

```
task A (dev: 코드 작성)      -- 의존성 없음, pending
task B (reviewer: 코드 리뷰)  -- depends_on: [A], blocked
task C (devops: 배포)         -- depends_on: [B], blocked

DAG:  A → B → C
```

**배치 내 상대 참조:**

배치 제출 시 아직 생성되지 않은 태스크를 참조하기 위해 `"batch:N"` 형식 사용.

```json
{
  "tasks": [
    { "title": "코드 작성", "agentId": "dev", "dependsOn": [] },
    { "title": "코드 리뷰", "agentId": "reviewer", "dependsOn": ["batch:0"] },
    { "title": "배포", "agentId": "devops", "dependsOn": ["batch:1"] }
  ]
}
```

`"batch:0"`은 배치 내 첫 번째(인덱스 0) 태스크의 실제 UUID로 해석된다.

### 8.2 순환 의존성 탐지

**배치 제출 시:**

배치 내 태스크 간 의존성을 인접 리스트로 구성하고, Kahn의 알고리즘(위상 정렬)으로 순환을 탐지한다.

```typescript
function detectCycle(tasks: BatchTaskSubmission[]): boolean {
  const n = tasks.length;
  const inDegree = new Array(n).fill(0);
  const adj: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (const dep of tasks[i].dependsOn ?? []) {
      if (dep.startsWith('batch:')) {
        const j = parseInt(dep.replace('batch:', ''), 10);
        adj[j].push(i);  // j → i (i가 j에 의존)
        inDegree[i]++;
      }
    }
  }

  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adj[node]) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) queue.push(neighbor);
    }
  }

  return visited < n;  // true이면 순환 존재
}
```

**개별 제출 시:**

개별 태스크 제출은 이미 존재하는 태스크 ID에 대한 의존성만 선언할 수 있다. 새로 생성되는 태스크는 아직 다른 태스크의 의존 대상이 아니므로, 순환이 구조적으로 불가능하다.

### 8.3 의존성 해제 로직

태스크가 completed 상태가 되면 `unblockDependents()`가 호출된다 (6.5절 참조).

**해제 절차:**

1. `task_dependencies`에서 `depends_on = completedTaskId`인 행 조회
2. 각 종속 태스크에 대해 "모든 의존성이 completed인지" 확인
3. 모두 completed이면 `blocked → pending` 전이
4. 이벤트 로깅

### 8.4 연쇄 실패 정책

의존 태스크가 `dead_letter`가 되면, 해당 태스크에 **전이적으로** 의존하는 모든 태스크를 `cancelled`로 만든다.

**재귀 CTE 쿼리** (6.6절의 `cascadeCancelDependents` 참조):

이 정책은 "실패한 태스크의 결과 없이는 후속 태스크 실행이 무의미하다"는 가정에 기반한다.

---

## 9. 충돌 방지 (Conflict Prevention)

### 9.1 3-레이어 충돌 방지 전략

```
Layer 1: 경로 선언 (Submit Time)
  └─ 태스크 제출 시 affected_paths 배열 선언
     예: ["src/components/Dashboard.tsx", "src/lib/relay.ts"]

Layer 2: 중복 검사 (Claim Time)
  └─ claimTask()에서 PostgreSQL 배열 겹침 연산자 && 사용
     현재 잠긴 경로와 후보 태스크의 affected_paths 비교

Layer 3: 배타적 파일 잠금 (Runtime)
  └─ file_locks 테이블에 (file_path, task_id) 삽입
     태스크 완료/실패 시 삭제
```

### 9.2 오케스트레이터의 `affected_paths` 추론

오케스트레이터가 Claude에게 태스크 분해를 요청할 때, 각 서브태스크의 `affected_paths`도 함께 예측하도록 한다.

**확장된 프롬프트:**

```
Break down the following task into subtasks...

Return a JSON object with this structure:
{
  "subtasks": [
    {
      "agentId": "dev",
      "task": "description",
      "priority": 1,
      "affectedPaths": ["src/lib/task-queue.ts", "src/lib/db.ts"]
    }
  ]
}
```

**탐색적 태스크의 경우:**

리서치, 분석 등 파일을 수정하지 않는 태스크는 `affectedPaths: []` (빈 배열)로 설정한다. 이는 **낙관적(optimistic)** 접근으로, 파일 잠금 없이 실행된다.

### 9.3 Merge Conflict 해결

`affected_paths`는 **예측 기반**이므로 100% 정확하지 않다. 실제 merge conflict가 발생할 수 있다.

**사후 검증:**

1. 태스크 완료 후 `git status`로 conflict 여부 확인 (게이트웨이에서)
2. Conflict 발견 시 `failTask()`로 실패 처리
3. 지수 백오프 후 재시도 (이때 충돌 원인 태스크가 완료되어 잠금 해제된 상태)

---

## 10. 시퀀스 다이어그램 (Sequence Diagrams)

### 10.1 태스크 제출 → 실행 → 완료 흐름

```
Dashboard UI          API Server          PostgreSQL          Gateway Connector
     |                    |                    |                     |
     |  POST /queue/submit|                    |                     |
     |------------------->|                    |                     |
     |                    |  BEGIN TX          |                     |
     |                    |------------------->|                     |
     |                    |  validate deps     |                     |
     |                    |------------------->|                     |
     |                    |  INSERT task_queue  |                     |
     |                    |------------------->|                     |
     |                    |  INSERT task_deps   |                     |
     |                    |------------------->|                     |
     |                    |  INSERT task_events |                     |
     |                    |------------------->|                     |
     |                    |  COMMIT            |                     |
     |                    |------------------->|                     |
     |   { task }         |                    |                     |
     |<-------------------|                    |                     |
     |                    |                    |                     |
     |                    |                    |   POST /queue/claim |
     |                    |                    |<--------------------|
     |                    |  BEGIN TX          |                     |
     |                    |------------------->|                     |
     |                    |  check concurrency |                     |
     |                    |------------------->|                     |
     |                    |  SELECT...FOR UPDATE SKIP LOCKED         |
     |                    |------------------->|                     |
     |                    |  UPDATE status=claimed                   |
     |                    |------------------->|                     |
     |                    |  INSERT file_locks  |                     |
     |                    |------------------->|                     |
     |                    |  UPDATE concurrency |                     |
     |                    |------------------->|                     |
     |                    |  COMMIT            |                     |
     |                    |------------------->|                     |
     |                    |                    |   { task }          |
     |                    |                    |------------------->  |
     |                    |                    |                     |
     |                    |                    |   (execute Claude CLI)
     |                    |                    |                     |
     |                    |                    |   POST /queue/heartbeat
     |                    |                    |<--------------------|
     |                    |                    |   (every 15s)       |
     |                    |                    |                     |
     |                    |                    |   POST /queue/complete
     |                    |                    |<--------------------|
     |                    |  BEGIN TX          |                     |
     |                    |------------------->|                     |
     |                    |  UPDATE status=completed                 |
     |                    |------------------->|                     |
     |                    |  release slots     |                     |
     |                    |------------------->|                     |
     |                    |  DELETE file_locks  |                     |
     |                    |------------------->|                     |
     |                    |  unblockDependents |                     |
     |                    |------------------->|                     |
     |                    |  COMMIT            |                     |
     |                    |------------------->|                     |
     |                    |                    |   { success }       |
     |                    |                    |------------------->  |
```

### 10.2 오케스트레이션 (배치 분해 → 큐 → 병렬 실행)

```
Dashboard UI          Orchestrator         API Server          PostgreSQL
     |                    |                    |                    |
     |  "사이트 리뉴얼"   |                    |                    |
     |----"orchestrate"-->|                    |                    |
     |                    |                    |                    |
     |                    |  Claude: 태스크 분해 |                    |
     |                    |  (3 subtasks)      |                    |
     |                    |                    |                    |
     |                    | POST /queue/batch   |                    |
     |                    |------------------->|                    |
     |                    |                    | BEGIN TX           |
     |                    |                    |                    |
     |                    |                    | detect cycles      |
     |                    |                    | (topological sort) |
     |                    |                    |                    |
     |                    |                    | INSERT task[0] (dev, priority:1, pending)
     |                    |                    | INSERT task[1] (reviewer, priority:2, blocked, depends_on:[0])
     |                    |                    | INSERT task[2] (devops, priority:3, blocked, depends_on:[1])
     |                    |                    |                    |
     |                    |                    | INSERT deps edges  |
     |                    |                    | INSERT events      |
     |                    |                    |                    |
     |                    |                    | COMMIT             |
     |                    | [task0, task1, task2]                   |
     |                    |<-------------------|                    |
     |                    |                    |                    |

Gateway A                                  PostgreSQL
     |                                        |
     | claim → task[0] (dev, pending)         |
     |--------------------------------------->|
     | (execute)                              |
     | complete task[0]                       |
     |--------------------------------------->|
     |                                        | unblockDependents → task[1] pending
     |                                        |
     | claim → task[1] (reviewer, pending)    |
     |--------------------------------------->|
     | (execute)                              |
     | complete task[1]                       |
     |--------------------------------------->|
     |                                        | unblockDependents → task[2] pending
     |                                        |
     | claim → task[2] (devops, pending)      |
     |--------------------------------------->|
     | (execute)                              |
     | complete task[2]                       |
     |--------------------------------------->|
     |                                        | batch complete!
```

### 10.3 부실 청구 복구

```
Gateway A          Scheduler           PostgreSQL          Gateway B
     |                 |                    |                   |
     | claim task X    |                    |                   |
     |--------------------------------->   |                   |
     |                 |                    |                   |
     | (network failure / crash)            |                   |
     | X               |                    |                   |
     |                 |                    |                   |
     |                 | check stale claims |                   |
     |                 | (every 5 seconds)  |                   |
     |                 |------------------->|                   |
     |                 |                    |                   |
     |                 | task X: heartbeat_at > 60s ago         |
     |                 |                    |                   |
     |                 | release stale:     |                   |
     |                 | status → failed    |                   |
     |                 | attempt++          |                   |
     |                 | next_retry_at =    |                   |
     |                 |   NOW() + backoff  |                   |
     |                 | release slots      |                   |
     |                 | release file_locks |                   |
     |                 |------------------->|                   |
     |                 |                    |                   |
     |                 | (5초 후, next_retry_at 도래)            |
     |                 |                    |                   |
     |                 | retryReadyTasks:   |                   |
     |                 | status → pending   |                   |
     |                 |------------------->|                   |
     |                 |                    |                   |
     |                 |                    | claim task X      |
     |                 |                    |<------------------|
     |                 |                    | (Gateway B 실행)  |
     |                 |                    |                   |
```

---

## 11. 통합 지점 (Integration Points)

### 11.1 기존 `relay_commands`와의 호환

기존 `relay_commands` 테이블과 `/api/relay/*` API는 **그대로 유지**한다. `task_queue`는 상위 레이어로 동작하며, 두 시스템이 공존한다.

**공존 방식:**

- 기존 `POST /api/relay/command`는 그대로 동작 (직접 `relay_commands`에 삽입)
- 새로운 `queue: true` 옵션 추가 시 `task_queue`에도 동시 삽입
- 게이트웨이는 기존 `/api/relay/poll`과 새로운 `/api/queue/claim`을 병행 호출

### 11.2 신규 API 라우트

| Route | Method | Purpose | 인증 |
|-------|--------|---------|------|
| `/api/queue/submit` | POST | 단일 태스크 제출 | User session 또는 relay key |
| `/api/queue/batch` | POST | 배치 태스크 제출 | User session 또는 relay key |
| `/api/queue/claim` | POST | 태스크 청구 (게이트웨이용) | Relay key (route handler 내 검증) |
| `/api/queue/complete` | POST | 태스크 완료 보고 | Relay key (route handler 내 검증) |
| `/api/queue/fail` | POST | 태스크 실패 보고 | Relay key (route handler 내 검증) |
| `/api/queue/heartbeat` | POST | 하트비트 갱신 | Relay key (route handler 내 검증) |
| `/api/queue/cancel` | POST | 태스크 취소 | User session 또는 relay key |
| `/api/queue/status` | GET | 큐 상태 조회 | User session |
| `/api/queue/task/[id]` | GET | 개별 태스크 상세 | User session 또는 relay key |
| `/api/queue/stats` | GET | 큐 통계 (실시간) | User session |

> **⚠️ Middleware 인증 처리**
>
> 현재 `src/middleware.ts`의 `publicPaths`에는 `/api/relay/`만 포함되어 있다. `/api/queue/*` 라우트는 `publicPaths`에 추가하지 **않는다** (보안 강화).
>
> 대신, 게이트웨이 전용 라우트 (`/api/queue/claim`, `/api/queue/complete`, `/api/queue/fail`, `/api/queue/heartbeat`)는 **route handler 내부에서** `x-relay-key` 헤더를 직접 검증한다. 이는 기존 `/api/relay/poll/route.ts`와 동일한 패턴이다.
>
> Dashboard 전용 라우트 (`/api/queue/status`, `/api/queue/stats`)는 middleware의 세션 쿠키 검증을 그대로 활용한다.
>
> 이중 인증 라우트 (`/api/queue/submit`, `/api/queue/batch`, `/api/queue/cancel`, `/api/queue/task/[id]`)는 route handler에서 세션 쿠키 **또는** relay key 중 하나를 확인한다.

### 11.3 신규 MCP 도구

| Tool | Purpose | Parameters |
|------|---------|------------|
| `dashboard_queue_submit` | 태스크 큐에 단일 태스크 제출 | `agentId`, `title`, `payload`, `priority?`, `dependsOn?`, `affectedPaths?` |
| `dashboard_queue_batch` | 배치 태스크 제출 | `tasks[]`, `createdBy?` |
| `dashboard_queue_status` | 큐 상태 조회 | `batchId?`, `status?` |
| `dashboard_queue_cancel` | 태스크 취소 | `taskId` |
| `dashboard_queue_stats` | 큐 통계 조회 | - |
| `dashboard_queue_task` | 개별 태스크 상세 조회 | `taskId` |

### 11.4 게이트웨이 커넥터 변경

**Enhanced Poll Loop:**

```typescript
// gateway-connector.ts 변경 사항 (의사코드)

const SUPPORTS_QUEUE = true;
const MAX_LOCAL_CONCURRENT = 5;
const HEARTBEAT_INTERVAL = 15_000;  // 15초

// 실행 중인 태스크 추적
const runningTasks = new Map<string, { taskId: string; agentId: string }>();

// 하트비트 루프
setInterval(async () => {
  for (const [taskId] of runningTasks) {
    await apiCall('/api/queue/heartbeat', 'POST', {
      taskId,
      gatewayId: GATEWAY_ID,
    });
  }
}, HEARTBEAT_INTERVAL);

async function enhancedPollLoop() {
  // 1. 기존 relay_commands 폴링 (하위 호환)
  await legacyPollLoop();

  // 2. 큐 태스크 청구
  const availableCapacity = MAX_LOCAL_CONCURRENT - runningTasks.size;

  for (let i = 0; i < availableCapacity; i++) {
    const result = await apiCall('/api/queue/claim', 'POST', {
      gatewayId: GATEWAY_ID,
    });

    if (!result.task) break;  // 더 이상 가용 태스크 없음

    // 비동기 실행
    executeQueueTask(result.task);
  }
}

async function executeQueueTask(task: Task) {
  runningTasks.set(task.id, { taskId: task.id, agentId: task.agentId });

  try {
    const result = await executeClaudeTask({
      agentId: task.agentId,
      task: task.payload.task as string,
      systemPrompt: task.payload.systemPrompt as string,
      mcpConfig: MCP_CONFIG_PATH,
    });

    if (result.success) {
      await apiCall('/api/queue/complete', 'POST', {
        taskId: task.id,
        gatewayId: GATEWAY_ID,
        result: { output: result.output },
      });
    } else {
      await apiCall('/api/queue/fail', 'POST', {
        taskId: task.id,
        gatewayId: GATEWAY_ID,
        error: result.error,
      });
    }
  } catch (error) {
    await apiCall('/api/queue/fail', 'POST', {
      taskId: task.id,
      gatewayId: GATEWAY_ID,
      error: String(error),
    });
  } finally {
    runningTasks.delete(task.id);
  }
}
```

**`supports_queue: true` 플래그:**

게이트웨이 등록 시 큐 지원 여부를 선언한다.

```typescript
// 등록 시
await apiCall('/register', 'POST', {
  gatewayId: GATEWAY_ID,
  supports_queue: true,
});
```

### 11.5 프론트엔드 변경

**1. TaskStack을 서버 상태로 전환:**

기존 React `useState` 기반 `TaskStack`을 제거하고, `/api/queue/status`를 폴링하여 서버 상태를 표시한다.

**2. Queue Status Bar:**

```
┌──────────────────────────────────────────────────┐
│ Queue: 3 pending | 2 running | 15 completed | 1 failed │
│ Concurrency: 2/3 global | dev:1/1 | reviewer:0/1        │
└──────────────────────────────────────────────────┘
```

**3. Task Queue Panel (새 탭 또는 기존 탭 확장):**

- 태스크 목록 (상태별 필터링)
- 배치 뷰 (DAG 시각화)
- 태스크 상세 (이벤트 로그 타임라인)
- 취소 버튼, 재시도 버튼

**4. Batch Submit Form:**

오케스트레이션 결과를 사전에 미리보기하고 확인 후 제출하는 UI.

---

## 12. 마이그레이션 전략 (Migration Strategy)

### Phase 1: 스키마 추가 (제로 리스크)

| 항목 | 내용 |
|------|------|
| **작업** | `sql/002_task_queue.sql` 실행: 5개 신규 테이블 + 인덱스 + 초기 데이터 |
| **영향** | 기존 테이블/기능에 변경 없음 |
| **리스크** | 없음 (additive change) |
| **롤백** | `DROP TABLE` 5개 |
| **검증** | `\dt` 명령으로 테이블 확인, `SELECT * FROM concurrency_slots` |

### Phase 2: 이중 기록 API

| 항목 | 내용 |
|------|------|
| **작업** | 1. `src/lib/task-queue.ts` 라이브러리 구현<br>2. `/api/queue/*` 10개 라우트 구현<br>3. MCP 서버에 6개 도구 추가<br>4. 스케줄러 루프 시작 (`schedulerLoop`) |
| **영향** | 기존 `/api/relay/*` 변경 없음, 새 API 추가만 |
| **리스크** | Low (신규 경로만, 기존 기능 터치 안 함) |
| **롤백** | 신규 API 라우트 디렉토리 삭제 |
| **검증** | POST `/api/queue/submit` 테스트, POST `/api/queue/claim` 테스트 |

### Phase 3: 게이트웨이 개선

| 항목 | 내용 |
|------|------|
| **작업** | 1. `gateway-connector.ts`에 `enhancedPollLoop` 추가<br>2. 하트비트 루프 추가<br>3. `supports_queue: true` 플래그 |
| **영향** | 게이트웨이가 기존 + 새 시스템 병행 사용 |
| **리스크** | Medium (게이트웨이 변경은 에이전트 실행에 직접 영향) |
| **롤백** | `SUPPORTS_QUEUE = false`로 플래그만 꺼서 즉시 롤백 |
| **검증** | 게이트웨이 재시작 후 `/api/queue/claim` 호출 확인, 하트비트 로그 확인 |

### Phase 4: 완전 전환

| 항목 | 내용 |
|------|------|
| **작업** | 1. 프론트엔드 TaskStack을 큐 상태로 전환<br>2. 오케스트레이터의 `executePlan()`을 `submitBatch()`로 교체<br>3. `/api/relay/command`에 `queue: true` 기본값 설정 |
| **영향** | 모든 태스크가 큐를 통해 흐름 |
| **리스크** | Medium-High (전체 흐름 변경) |
| **롤백** | `queue: true` 기본값 제거, 프론트엔드 TaskStack 복원 |
| **검증** | E2E: Dashboard → Submit → Claim → Execute → Complete 전체 흐름 |

### Phase 5: 정리 (선택)

| 항목 | 내용 |
|------|------|
| **작업** | 1. 기존 `relay_commands` 폴링 로직 제거 (선택)<br>2. `relay_commands` 테이블을 archive 전용으로 전환<br>3. 불필요한 in-memory fallback 코드 제거 |
| **영향** | 코드 간소화 |
| **리스크** | Low (선택적, 역방향 호환 불필요 시만) |
| **롤백** | git revert |
| **검증** | 전체 테스트 스위트 통과 |

---

## 13. 리스크 분석 (Risk Analysis)

| # | 리스크 | 영향도 | 확률 | 완화 전략 |
|---|--------|--------|------|-----------|
| 1 | **PostgreSQL as job queue** — 높은 처리량에서 성능 저하 | Medium | Low | 일 100건 미만 규모이므로 문제 없음. `FOR UPDATE SKIP LOCKED`는 pg-boss, graphile-worker 등 검증된 패턴. Partial index로 hot path 최적화. 성장 시 pg_partman으로 파티셔닝 고려. |
| 2 | **Concurrency slot accounting drift** — 슬롯 카운터가 실제와 불일치 | High | Medium | 일일 정합성 검사(reconciliation) 자동 실행. 슬롯 해제 시 `GREATEST(used_slots - 1, 0)`으로 음수 방지. `task_events` 감사 로그로 드리프트 원인 추적. |
| 3 | **Dependency cycle in batch** — 순환 의존성으로 교착 상태 | High | Low | 배치 제출 시 위상 정렬로 사전 탐지. 개별 제출은 구조적으로 순환 불가. 탐지 실패 시 60초 부실 청구로 자동 해제. |
| 4 | **Stale heartbeat false positives** — 네트워크 지연으로 살아있는 태스크를 부실 판정 | Medium | Medium | 60초 타임아웃은 보수적. 게이트웨이 하트비트 15초 간격 (4회 실패 허용). 부실 해제 시 즉시 dead_letter가 아닌 failed로 전환하여 재시도 기회 제공. |
| 5 | **File lock granularity** — 너무 넓거나 좁은 경로 잠금 | Low | Medium | 디렉토리 수준 잠금 지원 (예: `src/components/`). 오케스트레이터가 `affected_paths`를 합리적으로 예측하도록 프롬프트 최적화. 잠금 실패 시 비관적이 아닌 낙관적으로 실행 후 충돌 시 재시도. |
| 6 | **Migration disruption** — 마이그레이션 과정에서 서비스 중단 | High | Low | 5단계 점진적 마이그레이션. Phase 1-2는 제로 리스크. Phase 3의 `SUPPORTS_QUEUE` 플래그로 즉시 롤백. Phase 4에서도 기존 `relay_commands` 경로 유지. |

---

## 14. 비기능 요구사항 (Non-Functional Requirements)

### 14.1 성능

| 메트릭 | 목표 | 근거 |
|--------|------|------|
| 태스크 청구 지연 | < 50ms (p99) | `FOR UPDATE SKIP LOCKED` + partial index. PostgreSQL의 row-level locking은 테이블 스캔 없이 후보를 선택. |
| 태스크 제출 지연 | < 30ms | 단순 INSERT + 의존성 검증 |
| 스케줄러 사이클 | < 100ms | 부실 청구 + 재시도 처리. Partial index로 대상 최소화. |
| 일일 처리량 | 100 tasks/day | 현재 사용 패턴 기준. 1000 tasks/day까지 PostgreSQL 단독 처리 가능. |

**인덱스 전략:**

- `idx_tq_schedulable`: pending 태스크 조회 (claimTask hot path)
- `idx_tq_running`: 실행 중 태스크 (하트비트, 동시성 카운트)
- `idx_tq_retry`: 재시도 대기 태스크 (schedulerLoop)
- 모두 **partial index**로 해당 조건의 행만 포함하여 크기 최소화

### 14.2 가용성

- **인메모리 폴백**: DB 장애 시 기존 `relay.ts`의 in-memory fallback 패턴을 큐에도 적용. 긴급 태스크는 메모리에서 처리 후 DB 복구 시 동기화.
- **부실 청구 자동 복구**: 게이트웨이 크래시 시 60초 내 부실 청구 해제 → 재시도.
- **Graceful degradation**: 큐 시스템 장애 시 기존 `relay_commands` 경로로 자동 폴백.

### 14.3 관찰 가능성

- **`task_events` 감사 로그**: 모든 상태 전이를 시간순으로 기록. 태스크별 이벤트 조회.
- **`/api/queue/stats` 실시간 통계**: 상태별 카운트, 에이전트별 통계, 동시성 슬롯 현황, 최근 이벤트.
- **Gateway Connector 로그**: 청구/완료/실패/하트비트 로그를 콘솔 + `agent_history`에 기록.

---

## 15. 구현 일정 (Implementation Timeline)

| Phase | 기간 | 설명 | 산출물 |
|-------|------|------|--------|
| Phase 1 | 1일 | 스키마 마이그레이션 | `sql/002_task_queue.sql`, 테이블 5개 + 인덱스 + 트리거 |
| Phase 2 | 3일 | 핵심 라이브러리 + API + MCP | `src/lib/task-queue.ts`, `/api/queue/*` 10개 라우트, MCP 도구 6개, 스케줄러 루프 |
| Phase 3 | 2일 | 게이트웨이 커넥터 개선 | `scripts/gateway-connector.ts` 수정, 하트비트 루프, 큐 태스크 실행 |
| Phase 4 | 2일 | 프론트엔드 + 오케스트레이터 통합 | Queue Status Bar, Task Queue Panel, 오케스트레이터 `submitBatch` 연동 |
| Phase 5 | 1일 | 정리 및 문서화 | 레거시 코드 제거, README 업데이트, 운영 가이드 |
| **총계** | **~9일** | | |

---

## 16. 부록 (Appendix)

### A. 완전한 SQL 마이그레이션 스크립트 (`002_task_queue.sql`)

```sql
-- =============================================================================
-- 002_task_queue.sql
-- Task Queuing and Orchestration System
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. task_queue: 핵심 태스크 큐 테이블
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        UUID,
  parent_task_id  UUID REFERENCES task_queue(id) ON DELETE SET NULL,

  agent_id        TEXT NOT NULL,
  task_type       TEXT NOT NULL DEFAULT 'spawn',
  title           TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',

  priority        INTEGER NOT NULL DEFAULT 100,
  scheduled_after TIMESTAMPTZ DEFAULT NOW(),

  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN (
                    'pending', 'blocked', 'claimed', 'running',
                    'completed', 'failed', 'cancelled', 'dead_letter'
                  )),

  claimed_by      TEXT,
  claimed_at      TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,

  heartbeat_at    TIMESTAMPTZ,

  result          JSONB,
  error           TEXT,
  error_detail    JSONB,

  attempt         INTEGER NOT NULL DEFAULT 0,
  max_retries     INTEGER NOT NULL DEFAULT 3,
  next_retry_at   TIMESTAMPTZ,

  affected_paths  TEXT[] DEFAULT '{}',

  created_by      TEXT DEFAULT 'dashboard',
  metadata        JSONB DEFAULT '{}',

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tq_schedulable ON task_queue (priority ASC, created_at ASC)
  WHERE status = 'pending' AND scheduled_after <= NOW();

CREATE INDEX IF NOT EXISTS idx_tq_blocked ON task_queue (id)
  WHERE status = 'blocked';

CREATE INDEX IF NOT EXISTS idx_tq_running ON task_queue (claimed_by, status)
  WHERE status IN ('claimed', 'running');

CREATE INDEX IF NOT EXISTS idx_tq_batch ON task_queue (batch_id)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tq_agent ON task_queue (agent_id, status);

CREATE INDEX IF NOT EXISTS idx_tq_retry ON task_queue (next_retry_at ASC)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL AND attempt < max_retries;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_task_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_queue_updated_at ON task_queue;
CREATE TRIGGER trg_task_queue_updated_at
  BEFORE UPDATE ON task_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_task_queue_updated_at();

-- ---------------------------------------------------------------------------
-- 2. task_dependencies: DAG 의존성 간선
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id     UUID NOT NULL REFERENCES task_queue(id) ON DELETE CASCADE,
  depends_on  UUID NOT NULL REFERENCES task_queue(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on),
  CHECK (task_id <> depends_on)
);

CREATE INDEX IF NOT EXISTS idx_td_task ON task_dependencies (task_id);
CREATE INDEX IF NOT EXISTS idx_td_depends ON task_dependencies (depends_on);

-- ---------------------------------------------------------------------------
-- 3. concurrency_slots: 세마포어 기반 동시성 슬롯
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS concurrency_slots (
  scope       TEXT NOT NULL PRIMARY KEY,
  max_slots   INTEGER NOT NULL,
  used_slots  INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CHECK (used_slots >= 0),
  CHECK (used_slots <= max_slots)
);

-- 초기 데이터
INSERT INTO concurrency_slots (scope, max_slots) VALUES
  ('global', 3),
  ('agent:pm', 1),
  ('agent:dev', 1),
  ('agent:reviewer', 1),
  ('agent:growth', 1),
  ('agent:finance', 1),
  ('agent:devops', 1),
  ('agent:researcher', 1),
  ('agent:content', 1)
ON CONFLICT (scope) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. file_locks: 파일 수준 배타적 잠금
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS file_locks (
  file_path   TEXT NOT NULL,
  task_id     UUID NOT NULL REFERENCES task_queue(id) ON DELETE CASCADE,
  locked_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (file_path, task_id)
);

CREATE INDEX IF NOT EXISTS idx_fl_task ON file_locks (task_id);
CREATE INDEX IF NOT EXISTS idx_fl_path ON file_locks (file_path);

-- ---------------------------------------------------------------------------
-- 5. task_events: 감사 로그 (Audit Log)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES task_queue(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  actor       TEXT,
  detail      JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_te_task ON task_events (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_te_type ON task_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_te_cleanup ON task_events (created_at)
  WHERE created_at < NOW() - INTERVAL '30 days';

COMMIT;
```

### B. 참고 자료

- **PostgreSQL `FOR UPDATE SKIP LOCKED`**: https://www.postgresql.org/docs/14/sql-select.html#SQL-FOR-UPDATE-SHARE — Row-level locking으로 경합 없이 다음 가용 행을 선택하는 패턴. `SKIP LOCKED`는 이미 잠긴 행을 건너뛴다.
- **pg-boss**: https://github.com/timgit/pg-boss — PostgreSQL 기반 job queue. `FOR UPDATE SKIP LOCKED` 패턴의 참조 구현.
- **graphile-worker**: https://github.com/graphile/worker — PostgreSQL 기반 작업 큐. `SKIP LOCKED` 패턴과 세마포어 기반 동시성 제어의 참조 구현.
- **Temporal.io Workflow Concepts**: https://docs.temporal.io/workflows — 워크플로우 오케스트레이션의 상태 머신, 재시도, 의존성 관리 개념 참고.
- **PostgreSQL Advisory Locks**: https://www.postgresql.org/docs/14/explicit-locking.html#ADVISORY-LOCKS — 파일 잠금의 대안적 구현 방식 (이 설계에서는 테이블 기반 잠금 채택).
- **Kahn's Algorithm (위상 정렬)**: https://en.wikipedia.org/wiki/Topological_sorting#Kahn's_algorithm — 순환 의존성 탐지에 사용.
