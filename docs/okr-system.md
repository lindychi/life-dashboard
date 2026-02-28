# OKR (Objectives and Key Results) System

Life Dashboard의 OKR 시스템은 분기별/연간 목표 관리와 측정 가능한 핵심 결과 추적을 지원합니다.

## 주요 기능

### 1. Objective (목표) 관리
- 분기별/연간/커스텀 기간 설정
- 상태 추적 (active, completed, cancelled, archived)
- 태그 및 소유자 지정
- 자동 진척률 계산 (Key Results 기반)

### 2. Key Result (핵심 결과) 관리
- 4가지 측정 타입:
  - `percentage`: 백분율 (0-100)
  - `number`: 숫자 (예: 사용자 수)
  - `boolean`: 예/아니오 (0 또는 100%)
  - `currency`: 금액
- 자동 진척률 계산: `current_value / target_value * 100`
- 가중치 기반 Objective 진척률 자동 업데이트
- 상태 추적 (active, completed, at_risk, off_track)

### 3. 프로젝트-OKR 연결
- 프로젝트와 Objective 링크
- 특정 Key Results 연결 (선택 사항)
- 프로젝트별 OKR 조회

## 데이터베이스 스키마

### objectives 테이블
```sql
CREATE TABLE objectives (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  period_type TEXT CHECK (period_type IN ('quarterly', 'annual', 'custom')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT DEFAULT 'active',
  overall_progress INTEGER DEFAULT 0,
  owner TEXT,
  tags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### key_results 테이블
```sql
CREATE TABLE key_results (
  id UUID PRIMARY KEY,
  objective_id UUID REFERENCES objectives(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  metric_type TEXT CHECK (metric_type IN ('percentage', 'number', 'boolean', 'currency')),
  target_value NUMERIC NOT NULL,
  current_value NUMERIC DEFAULT 0,
  unit TEXT,
  progress INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  weight INTEGER DEFAULT 25 CHECK (weight >= 0 AND weight <= 100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### project_objectives 테이블
```sql
CREATE TABLE project_objectives (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  objective_id UUID REFERENCES objectives(id) ON DELETE CASCADE,
  relevant_key_result_ids JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, objective_id)
);
```

## 자동 계산 트리거

### 1. Key Result 진척률 자동 계산
`current_value` 또는 `target_value` 변경 시 자동으로 `progress` 계산:

- **percentage, number, currency**: `(current_value / target_value) * 100`
- **boolean**: `current_value >= 1 ? 100 : 0`

### 2. Objective 진척률 자동 업데이트
Key Result의 생성/수정/삭제 시 자동으로 Objective의 `overall_progress` 업데이트:

```
overall_progress = SUM(key_result.progress * key_result.weight) / SUM(key_result.weight)
```

## API 엔드포인트

### Objectives

#### `GET /api/okr/objectives`
모든 Objective 조회

**쿼리 파라미터:**
- `status` (optional): 상태 필터 (active, completed, cancelled, archived)

**응답:**
```json
{
  "objectives": [
    {
      "id": "uuid",
      "title": "Q1 2025 Growth Objective",
      "description": "Grow user base and revenue",
      "period_type": "quarterly",
      "start_date": "2025-01-01",
      "end_date": "2025-03-31",
      "status": "active",
      "overall_progress": 65,
      "owner": "John Doe",
      "tags": ["growth", "revenue"],
      "created_at": "2025-01-01T00:00:00Z",
      "updated_at": "2025-02-01T00:00:00Z"
    }
  ]
}
```

#### `POST /api/okr/objectives`
새 Objective 생성

**요청 본문:**
```json
{
  "title": "Q1 2025 Growth Objective",
  "description": "Grow user base and revenue",
  "period_type": "quarterly",
  "start_date": "2025-01-01",
  "end_date": "2025-03-31",
  "status": "active",
  "owner": "John Doe",
  "tags": ["growth", "revenue"]
}
```

#### `GET /api/okr/objectives/:id`
Objective 상세 조회 (Key Results 포함)

**응답:**
```json
{
  "objective": {
    "id": "uuid",
    "title": "Q1 2025 Growth Objective",
    "overall_progress": 65,
    "key_results": [
      {
        "id": "uuid",
        "title": "Reach 10,000 users",
        "metric_type": "number",
        "target_value": 10000,
        "current_value": 6500,
        "unit": "users",
        "progress": 65,
        "status": "active",
        "weight": 50
      }
    ]
  }
}
```

#### `PATCH /api/okr/objectives/:id`
Objective 업데이트

**요청 본문:**
```json
{
  "status": "completed"
}
```

#### `DELETE /api/okr/objectives/:id`
Objective 삭제 (Key Results도 함께 삭제됨)

### Key Results

#### `POST /api/okr/key-results`
새 Key Result 생성

**요청 본문:**
```json
{
  "objective_id": "uuid",
  "title": "Reach 10,000 users",
  "description": "Active monthly users",
  "metric_type": "number",
  "target_value": 10000,
  "current_value": 0,
  "unit": "users",
  "status": "active",
  "weight": 50
}
```

#### `PATCH /api/okr/key-results/:id`
Key Result 업데이트

**요청 본문:**
```json
{
  "current_value": 6500,
  "status": "active"
}
```

**참고:** `current_value` 변경 시 `progress`가 자동 계산되고, Objective의 `overall_progress`도 자동 업데이트됩니다.

#### `DELETE /api/okr/key-results/:id`
Key Result 삭제

### Project-Objective 연결

#### `GET /api/okr/projects/:projectId/objectives`
프로젝트에 연결된 모든 Objective 조회

#### `POST /api/okr/projects/:projectId/objectives`
프로젝트에 Objective 연결

**요청 본문:**
```json
{
  "objective_id": "uuid",
  "relevant_key_result_ids": ["uuid1", "uuid2"]
}
```

#### `DELETE /api/okr/projects/:projectId/objectives/:objectiveId`
프로젝트-Objective 연결 해제

## MCP 도구 (Claude Code 에이전트용)

### `dashboard_get_objectives`
모든 Objective 조회

```typescript
{
  status?: "active" | "completed" | "cancelled" | "archived"
}
```

### `dashboard_get_objective`
Objective 상세 조회 (Key Results 포함)

```typescript
{
  objectiveId: string
}
```

### `dashboard_create_objective`
Objective 생성

```typescript
{
  title: string;
  description?: string;
  period_type: "quarterly" | "annual" | "custom";
  start_date: string; // YYYY-MM-DD
  end_date: string;
  status?: "active" | "completed" | "cancelled" | "archived";
  owner?: string;
  tags?: string[];
}
```

### `dashboard_update_objective`
Objective 업데이트

```typescript
{
  objectiveId: string;
  title?: string;
  status?: string;
  // ... other fields
}
```

### `dashboard_create_key_result`
Key Result 생성

```typescript
{
  objective_id: string;
  title: string;
  description?: string;
  metric_type: "percentage" | "number" | "boolean" | "currency";
  target_value: number;
  current_value?: number;
  unit?: string;
  status?: "active" | "completed" | "at_risk" | "off_track";
  weight?: number; // 0-100, default 25
}
```

### `dashboard_update_key_result`
Key Result 업데이트

```typescript
{
  keyResultId: string;
  current_value?: number;
  status?: string;
  // ... other fields
}
```

### `dashboard_link_project_objective`
프로젝트-Objective 연결

```typescript
{
  projectId: string;
  objectiveId: string;
  relevantKeyResultIds?: string[];
}
```

### `dashboard_get_project_objectives`
프로젝트의 Objective 조회

```typescript
{
  projectId: string;
}
```

## 사용 예시

### 1. 분기별 OKR 생성

```bash
# Objective 생성
POST /api/okr/objectives
{
  "title": "Q1 2025: Product-Market Fit",
  "period_type": "quarterly",
  "start_date": "2025-01-01",
  "end_date": "2025-03-31",
  "owner": "Product Team",
  "tags": ["pmf", "growth"]
}

# Key Results 추가
POST /api/okr/key-results
{
  "objective_id": "...",
  "title": "Reach 10,000 MAU",
  "metric_type": "number",
  "target_value": 10000,
  "unit": "users",
  "weight": 40
}

POST /api/okr/key-results
{
  "objective_id": "...",
  "title": "Achieve 30% retention rate",
  "metric_type": "percentage",
  "target_value": 30,
  "unit": "%",
  "weight": 30
}

POST /api/okr/key-results
{
  "objective_id": "...",
  "title": "Launch v2.0",
  "metric_type": "boolean",
  "target_value": 1,
  "weight": 30
}
```

### 2. 진척률 업데이트

```bash
# Key Result 업데이트 (progress가 자동 계산됨)
PATCH /api/okr/key-results/:id
{
  "current_value": 6500
}

# 응답:
{
  "keyResult": {
    "current_value": 6500,
    "target_value": 10000,
    "progress": 65,  // 자동 계산
    "objective": {
      "overall_progress": 52  // 자동 업데이트 (가중 평균)
    }
  }
}
```

### 3. 프로젝트에 OKR 연결

```bash
# 프로젝트에 Objective 연결
POST /api/okr/projects/:projectId/objectives
{
  "objective_id": "...",
  "relevant_key_result_ids": ["kr1", "kr2"]
}

# 프로젝트의 OKR 조회
GET /api/okr/projects/:projectId/objectives
```

## 데이터베이스 설정

```bash
# 스키마 적용
psql life_dashboard < sql/019_okr_system.sql
```

## 권장 사항

### Weight 배분
- 각 Objective의 Key Results 가중치 합계는 100으로 설정
- 중요도에 따라 25-50% 범위로 배분

### Metric Type 선택
- **percentage**: 비율 목표 (예: 전환율, 유지율)
- **number**: 절대값 목표 (예: 사용자 수, 매출액)
- **boolean**: 완료/미완료 목표 (예: 제품 출시)
- **currency**: 금액 목표 (예: MRR, ARR)

### Status 관리
- **active**: 현재 진행 중
- **completed**: 목표 달성
- **at_risk**: 위험 (진척률 낮음)
- **off_track**: 궤도 이탈 (달성 불가능)

### Period Type
- **quarterly**: 분기별 (3개월)
- **annual**: 연간 (12개월)
- **custom**: 커스텀 기간
