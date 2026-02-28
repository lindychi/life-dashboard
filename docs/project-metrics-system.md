# 프로젝트 실시간 KPI 연동 시스템

프로젝트의 진행 상황을 태스크 실행 데이터와 자동으로 연동하여 실시간으로 메트릭을 계산하고 추적하는 시스템입니다.

## 개요

Life Dashboard의 프로젝트 시스템에 실시간 KPI 추적 기능을 추가하여, 태스크 실행 상태(task_executions, task_queue)를 기반으로 프로젝트의 완료율, 성공률, 실행 시간 등을 자동 계산합니다.

## 주요 기능

### 1. 자동 메트릭 계산
- **완료율(completion_rate)**: 전체 태스크 중 완료된 태스크 비율
- **성공률(success_rate)**: 완료/실패한 태스크 중 성공한 비율
- **평균 실행 시간(avg_task_duration_seconds)**: 완료된 태스크의 평균 실행 시간
- **총 실행 시간(total_execution_time_seconds)**: 모든 완료된 태스크의 총 실행 시간
- **태스크 카운트**: 전체/완료/실패/실행중 태스크 수

### 2. 시계열 메트릭 스냅샷
- 메트릭 변경 이력을 `project_metrics` 테이블에 저장
- 프로젝트별 메트릭 추이 분석 가능
- 30일 이상 된 스냅샷 자동 정리

### 3. 자동 트리거 기반 업데이트
- `task_executions.status` 변경 시 자동으로 메트릭 스냅샷 생성
- `projects.progress` 필드 자동 업데이트 (completion_rate 기반)
- `project_tasks` 생성 시 메트릭 스냅샷 자동 생성

### 4. MCP 서버 통합
- Claude Code 에이전트에서 직접 메트릭 조회 가능
- 태스크를 프로젝트에 연결하여 자동 추적
- 5가지 MCP 도구 제공

## 데이터베이스 스키마

### project_metrics (메트릭 스냅샷)
```sql
CREATE TABLE project_metrics (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  total_tasks INTEGER,
  completed_tasks INTEGER,
  failed_tasks INTEGER,
  running_tasks INTEGER,
  completion_rate NUMERIC(5,2),
  success_rate NUMERIC(5,2),
  avg_task_duration_seconds NUMERIC(10,2),
  total_execution_time_seconds BIGINT,
  last_task_completed_at TIMESTAMPTZ,
  last_task_failed_at TIMESTAMPTZ,
  snapshot_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
);
```

### project_tasks (프로젝트-태스크 연결)
```sql
CREATE TABLE project_tasks (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  task_execution_id UUID REFERENCES task_executions(id),
  task_queue_id UUID REFERENCES task_queue(id),
  task_title TEXT,
  task_status TEXT,
  task_type TEXT,
  created_at TIMESTAMPTZ
);
```

## API 엔드포인트

### 1. 전체 프로젝트 메트릭 조회
```bash
GET /api/projects/metrics
```

**응답:**
```json
{
  "success": true,
  "data": [
    {
      "project_id": "uuid",
      "project_name": "LifeDashboard",
      "metrics": {
        "total_tasks": 45,
        "completed_tasks": 38,
        "failed_tasks": 3,
        "running_tasks": 4,
        "completion_rate": 84.44,
        "success_rate": 92.68,
        "avg_task_duration_seconds": 125.34,
        "total_execution_time_seconds": 4763,
        "last_task_completed_at": "2025-02-28T10:30:00Z",
        "snapshot_at": "2025-02-28T10:30:05Z",
        "project_status": "active",
        "project_progress": 84
      }
    }
  ],
  "count": 1
}
```

### 2. 특정 프로젝트 메트릭 조회
```bash
GET /api/projects/{projectId}/metrics
```

**응답:**
```json
{
  "success": true,
  "data": {
    "project_id": "uuid",
    "metrics": {
      "total_tasks": 45,
      "completed_tasks": 38,
      ...
    },
    "latest_snapshot": {
      "snapshot_at": "2025-02-28T10:30:05Z",
      "completion_rate": 84.44,
      ...
    }
  }
}
```

### 3. 메트릭 스냅샷 생성
```bash
POST /api/projects/{projectId}/metrics
```

**응답:**
```json
{
  "success": true,
  "data": {
    "snapshot_id": "uuid",
    "project_id": "uuid"
  }
}
```

### 4. 메트릭 히스토리 조회
```bash
GET /api/projects/{projectId}/metrics/history?limit=100
```

**응답:**
```json
{
  "success": true,
  "data": [
    {
      "snapshot_id": "uuid",
      "total_tasks": 45,
      "completed_tasks": 38,
      "completion_rate": 84.44,
      "snapshot_at": "2025-02-28T10:30:05Z"
    },
    ...
  ],
  "count": 100
}
```

### 5. 프로젝트 태스크 목록 조회
```bash
GET /api/projects/{projectId}/tasks?limit=50
```

### 6. 태스크를 프로젝트에 연결
```bash
POST /api/projects/{projectId}/tasks
Content-Type: application/json

{
  "task_execution_id": "uuid",  // OR task_queue_id
  "metadata": {
    "task_title": "Build frontend",
    "task_status": "running",
    "task_type": "build"
  }
}
```

## MCP 도구 사용법

Claude Code 에이전트에서 다음 도구를 사용할 수 있습니다:

### 1. dashboard_get_project_metrics
모든 프로젝트 또는 특정 프로젝트의 실시간 메트릭 조회

```typescript
// 모든 프로젝트 메트릭 조회
dashboard_get_project_metrics()

// 특정 프로젝트 메트릭 조회
dashboard_get_project_metrics({
  projectId: "project-uuid"
})
```

### 2. dashboard_get_project_metrics_history
프로젝트의 메트릭 히스토리 조회 (시계열 데이터)

```typescript
dashboard_get_project_metrics_history({
  projectId: "project-uuid",
  limit: 100
})
```

### 3. dashboard_snapshot_project_metrics
현재 시점의 메트릭 스냅샷 생성

```typescript
dashboard_snapshot_project_metrics({
  projectId: "project-uuid"
})
```

### 4. dashboard_link_task_to_project
태스크를 프로젝트에 연결하여 자동 메트릭 추적

```typescript
dashboard_link_task_to_project({
  projectId: "project-uuid",
  taskExecutionId: "task-uuid",
  metadata: {
    task_title: "Build frontend component",
    task_status: "running",
    task_type: "build"
  }
})
```

### 5. dashboard_get_project_tasks
프로젝트에 연결된 태스크 목록 조회

```typescript
dashboard_get_project_tasks({
  projectId: "project-uuid",
  limit: 50
})
```

## TypeScript 라이브러리 사용법

서버 코드에서 직접 사용:

```typescript
import {
  calculateProjectMetrics,
  snapshotProjectMetrics,
  linkTaskToProject,
  getProjectKPISummary,
  getAllProjectsKPISummary,
} from "@/lib/project-metrics";

// 실시간 메트릭 계산
const metrics = await calculateProjectMetrics(projectId);

// 스냅샷 생성
const snapshotId = await snapshotProjectMetrics(projectId);

// 태스크 연결
await linkTaskToProject(
  projectId,
  taskExecutionId,
  undefined,
  {
    task_title: "Build API",
    task_status: "running",
    task_type: "build"
  }
);

// 프로젝트 KPI 요약
const summary = await getProjectKPISummary(projectId);

// 전체 프로젝트 KPI 요약
const allSummary = await getAllProjectsKPISummary();
```

## 자동화 시나리오

### 시나리오 1: 태스크 실행 시 자동 연결
```typescript
// gateway-connector.ts에서 태스크 실행 후
const executionId = await executeTask(task);

// 프로젝트에 자동 연결 (프로젝트 ID가 태스크 메타데이터에 포함되어 있는 경우)
if (task.projectId) {
  await linkTaskToProject(
    task.projectId,
    executionId,
    undefined,
    {
      task_title: task.title,
      task_status: 'running',
      task_type: task.type
    }
  );
}
```

### 시나리오 2: 주기적 스냅샷 생성 (Cron Job)
```sql
-- 매 시간 모든 프로젝트의 메트릭 스냅샷 생성
SELECT snapshot_all_project_metrics();
```

### 시나리오 3: 대시보드에서 실시간 KPI 표시
```typescript
// 프론트엔드 컴포넌트
const { data: metrics } = useSWR('/api/projects/metrics', {
  refreshInterval: 5000 // 5초마다 갱신
});

// 메트릭 표시
metrics?.data.map(project => (
  <ProjectCard
    name={project.project_name}
    progress={project.metrics.completion_rate}
    successRate={project.metrics.success_rate}
    taskCount={project.metrics.total_tasks}
  />
));
```

## 설치 및 마이그레이션

### 1. DB 마이그레이션 실행
```bash
psql life_dashboard < sql/018_project_metrics.sql
```

### 2. MCP 서버 재시작
```bash
pnpm gateway:restart
```

### 3. 기존 프로젝트에 메트릭 스냅샷 생성 (선택)
```sql
SELECT snapshot_all_project_metrics();
```

## 성능 고려사항

### 1. 인덱스
- `project_id + snapshot_at DESC`: 최신 메트릭 조회 최적화
- `task_execution_id`, `task_queue_id`: 태스크-프로젝트 역조회 최적화

### 2. 트리거 최적화
- 트리거는 `status` 변경 시에만 실행 (`WHEN (OLD.status IS DISTINCT FROM NEW.status)`)
- 비동기 스냅샷 생성 (`PERFORM` 사용)

### 3. 스냅샷 정리
- 30일 이상 된 스냅샷 자동 정리 함수 제공
- Cron job으로 주기적 실행 권장

```sql
-- 매주 일요일 정리
SELECT cleanup_old_metrics_snapshots();
```

## 향후 개선 방향

1. **알림 시스템**: 메트릭 임계값 도달 시 알림
2. **예측 분석**: 히스토리 데이터 기반 완료 시점 예측
3. **비교 분석**: 프로젝트 간 메트릭 비교 대시보드
4. **커스텀 메트릭**: 프로젝트별 커스텀 KPI 정의
5. **웹훅 통합**: 메트릭 변경 시 외부 시스템 알림 (Slack, Discord 등)
