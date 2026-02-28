# UI Components 사용 가이드

Life Dashboard의 프로젝트 관리 UI 컴포넌트 통합 가이드

## 개요

이 가이드는 다음 컴포넌트들의 사용법을 설명합니다:

1. **ProjectModal** - 프로젝트 생성/수정 모달
2. **KPIDashboard** - KPI 지표 대시보드
3. **OKRView** - OKR(목표 및 핵심 결과) 뷰
4. **ProjectsTab** - 통합 프로젝트 탭 (위 컴포넌트 모두 포함)

---

## 빠른 시작

### 1. ProjectsTab 통합 (권장)

가장 간단한 방법은 `ProjectsTab` 컴포넌트를 사용하는 것입니다. 이미 모든 하위 컴포넌트가 통합되어 있습니다.

```tsx
// src/app/page.tsx
import ProjectsTab from "@/components/ProjectsTab";
import { useProjects } from "@/hooks/useDashboardData";

export default function Home() {
  const { projects, isLoading, refetch } = useProjects();

  return (
    <main>
      {activeTab === "projects" && (
        <ProjectsTab
          projects={projects}
          isLoading={isLoading}
          onRefresh={refetch}
        />
      )}
    </main>
  );
}
```

**특징:**
- 그리드/KPI/OKR 뷰 전환 기능
- 프로젝트 생성/수정/삭제 기능
- 자동 API 호출 및 새로고침

---

## 개별 컴포넌트 사용법

### ProjectModal

프로젝트 생성 및 수정을 위한 모달 다이얼로그

#### Props

```typescript
interface ProjectModalProps {
  isOpen: boolean;              // 모달 열림/닫힘 상태
  onClose: () => void;          // 닫기 핸들러
  onSubmit: (data: ProjectFormData) => Promise<void>;  // 제출 핸들러
  project?: Project | null;     // 수정할 프로젝트 (null = 생성 모드)
}

interface ProjectFormData {
  name: string;                 // 프로젝트 이름 (필수)
  description: string;          // 설명
  status: string;               // 상태 (active/paused/completed/archived)
  progress: number;             // 진행률 (0-100)
  url: string;                  // 프로젝트 URL
  kpis: Array<{                 // KPI 지표 목록
    label: string;
    value: string;
  }>;
}
```

#### 사용 예시

```tsx
import { useState } from "react";
import ProjectModal, { type ProjectFormData } from "@/components/ProjectModal";

function MyComponent() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const handleCreate = async (data: ProjectFormData) => {
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!response.ok) throw new Error("생성 실패");

    // Refresh projects list
    refetchProjects();
  };

  const handleUpdate = async (data: ProjectFormData) => {
    const response = await fetch(`/api/projects/${editingProject.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!response.ok) throw new Error("수정 실패");

    refetchProjects();
  };

  return (
    <>
      <button onClick={() => setIsModalOpen(true)}>
        프로젝트 생성
      </button>

      <ProjectModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingProject(null);
        }}
        onSubmit={editingProject ? handleUpdate : handleCreate}
        project={editingProject}
      />
    </>
  );
}
```

#### 주요 기능

- **자동 폼 초기화**: `project` prop이 변경되면 자동으로 폼 데이터 업데이트
- **KPI 동적 추가/제거**: "+ 지표 추가" 버튼으로 여러 KPI 관리 가능
- **진행률 슬라이더**: 0-100% 범위의 인터랙티브 슬라이더
- **유효성 검사**: 프로젝트 이름 필수 입력 검사
- **로딩 상태**: 제출 중 버튼 비활성화 및 "처리 중..." 표시
- **접근성**: ESC 키로 닫기, 포커스 트랩, ARIA 레이블

---

### KPIDashboard

KPI 지표를 시각화하는 대시보드 컴포넌트

#### Props

```typescript
interface KPIDashboardProps {
  metrics: KPIMetric[];         // 표시할 KPI 지표 목록
  layout?: "grid" | "compact";  // 레이아웃 모드 (기본: grid)
  columns?: 2 | 3 | 4;          // 그리드 컬럼 수 (기본: 3)
}

interface KPIMetric {
  id: string;                   // 고유 ID
  label: string;                // 지표 이름
  value: string | number;       // 현재 값
  change?: number;              // 변화율 (%)
  trend?: "up" | "down" | "neutral";  // 트렌드 방향
  icon?: string;                // 이모지 아이콘
  format?: "number" | "percentage" | "currency" | "text";  // 포맷
  target?: number;              // 목표 값 (프로그레스 바 표시)
}
```

#### 사용 예시

```tsx
import KPIDashboard, { type KPIMetric } from "@/components/KPIDashboard";

function DashboardPage() {
  const metrics: KPIMetric[] = [
    {
      id: "completion-rate",
      label: "완료율",
      value: 87,
      change: 5,
      trend: "up",
      icon: "📊",
      format: "percentage",
      target: 90,
    },
    {
      id: "active-tasks",
      label: "활성 작업",
      value: 12,
      change: -2,
      trend: "down",
      icon: "📝",
      format: "number",
    },
    {
      id: "revenue",
      label: "월 수익",
      value: 3200000,
      change: 15,
      trend: "up",
      icon: "💰",
      format: "currency",
      target: 5000000,
    },
  ];

  return (
    <div>
      {/* 그리드 레이아웃 (3열) */}
      <KPIDashboard metrics={metrics} columns={3} />

      {/* 컴팩트 레이아웃 */}
      <KPIDashboard metrics={metrics} layout="compact" />
    </div>
  );
}
```

#### 레이아웃 모드

**Grid Layout** (기본)
- 카드 형태로 지표 표시
- 큰 숫자와 아이콘 강조
- 변화율과 프로그레스 바 포함
- 반응형 그리드 (1/2/3/4 컬럼)

**Compact Layout**
- 리스트 형태로 지표 표시
- 공간 효율적
- 사이드바나 좁은 영역에 적합

#### 포맷 옵션

```typescript
// Number (천 단위 구분)
{ value: 1234, format: "number" }  // → "1,234"

// Percentage
{ value: 87, format: "percentage" }  // → "87%"

// Currency (KRW)
{ value: 3200000, format: "currency" }  // → "₩3,200,000"

// Text (그대로 표시)
{ value: "Excellent", format: "text" }  // → "Excellent"
```

#### 트렌드 색상

- `trend: "up"` + `change > 0` → 초록색 (긍정)
- `trend: "down"` + `change < 0` → 빨간색 (부정)
- `trend: "neutral"` → 회색 (중립)
- 트렌드 미지정 시 `change` 부호로 자동 판단

#### 샘플 데이터 생성

```tsx
import { generateSampleKPIs } from "@/components/KPIDashboard";

const sampleMetrics = generateSampleKPIs();
// 6개의 샘플 KPI 반환 (완료율, 활성 작업, 총 시간 등)
```

---

### OKRView

OKR(Objectives and Key Results)을 시각화하는 컴포넌트

#### Props

```typescript
interface OKRViewProps {
  objectives: Objective[];      // 목표 목록
  onObjectiveClick?: (objective: Objective) => void;  // 목표 클릭 핸들러
  onKeyResultUpdate?: (
    objectiveId: string,
    keyResultId: string,
    newValue: number
  ) => void;  // 핵심 결과 값 업데이트 핸들러
}

interface Objective {
  id: string;
  title: string;                // 목표 제목
  description?: string;         // 목표 설명
  periodType: "quarterly" | "annual" | "custom";  // 기간 유형
  startDate: string;            // 시작일 (ISO 8601)
  endDate: string;              // 종료일 (ISO 8601)
  status: "active" | "completed" | "cancelled" | "archived";
  owner?: string;               // 담당자
  tags?: string[];              // 태그
  keyResults: KeyResult[];      // 핵심 결과 목록
  overallProgress: number;      // 전체 진행률 (0-100)
}

interface KeyResult {
  id: string;
  title: string;                // KR 제목
  description?: string;         // KR 설명
  currentValue: number;         // 현재 값
  targetValue: number;          // 목표 값
  unit: string;                 // 단위 (명, %, 원 등)
  metricType: "percentage" | "number" | "boolean" | "currency";
  progress: number;             // 진행률 (자동 계산)
  status: "active" | "completed" | "at_risk" | "off_track";
  weight?: number;              // 가중치 (0-100, 합계 100)
}
```

#### 사용 예시

```tsx
import OKRView, { type Objective } from "@/components/OKRView";

function OKRPage() {
  const [objectives, setObjectives] = useState<Objective[]>([]);

  // API에서 OKR 데이터 로드
  useEffect(() => {
    fetch("/api/okr/objectives")
      .then(res => res.json())
      .then(data => setObjectives(data.objectives));
  }, []);

  const handleKeyResultUpdate = async (
    objId: string,
    krId: string,
    newValue: number
  ) => {
    // 서버에 업데이트 요청
    await fetch(`/api/okr/key-results/${krId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentValue: newValue }),
    });

    // 로컬 상태 업데이트
    setObjectives(prev => prev.map(obj => {
      if (obj.id !== objId) return obj;

      return {
        ...obj,
        keyResults: obj.keyResults.map(kr => {
          if (kr.id !== krId) return kr;

          const progress = (newValue / kr.targetValue) * 100;
          return { ...kr, currentValue: newValue, progress };
        }),
      };
    }));
  };

  return (
    <OKRView
      objectives={objectives}
      onObjectiveClick={(obj) => console.log("Clicked:", obj)}
      onKeyResultUpdate={handleKeyResultUpdate}
    />
  );
}
```

#### 주요 기능

**요약 카드**
- 활성 목표 수
- 전체 평균 진행률
- 위험 상태 KR 수

**목표 카드**
- 확장/축소 가능한 아코디언 UI
- 상태 배지 (진행 중/완료/취소됨/보관됨)
- 기간 타입 및 남은 일수 표시
- 태그 시스템
- 전체 진행률 바

**핵심 결과 편집**
- 인라인 편집: 현재 값 클릭 → 숫자 입력 → 저장
- 실시간 프로그레스 바 업데이트
- 상태별 색상 구분 (활성/완료/위험/이탈)

#### 진행률 계산

```typescript
// 핵심 결과 진행률
progress = (currentValue / targetValue) * 100

// 목표 전체 진행률 (가중 평균)
overallProgress = Σ(kr.progress * kr.weight) / 100
```

#### 샘플 데이터

```tsx
import { generateSampleOKRs } from "@/components/OKRView";

const sampleObjectives = generateSampleOKRs();
// 2개의 샘플 OKR 반환 (Life Dashboard 런칭, 수익화 모델 검증)
```

---

## 스타일 커스터마이징

모든 컴포넌트는 Tailwind CSS로 스타일링되어 있어 쉽게 커스터마이징할 수 있습니다.

### 색상 테마 변경

```tsx
// 기존: 파란색 Primary
bg-blue-600 hover:bg-blue-700

// 커스터마이징: 보라색 Primary
bg-purple-600 hover:bg-purple-700
```

### 크기 조정

```tsx
// 모달 크기 변경
<div className="w-full max-w-2xl">  // 기존
<div className="w-full max-w-4xl">  // 더 넓게
```

### 간격 조정

```tsx
// 카드 패딩 변경
p-5 lg:p-3.5  // 기존
p-6 lg:p-4    // 더 넓게
```

---

## 접근성 (Accessibility)

모든 컴포넌트는 다음 접근성 기준을 준수합니다:

### 키보드 내비게이션
- **Tab**: 다음 요소로 이동
- **Shift+Tab**: 이전 요소로 이동
- **Enter/Space**: 버튼 활성화
- **Escape**: 모달 닫기

### 포커스 인디케이터
- 모든 인터랙티브 요소에 `focus-visible:ring-2` 스타일 적용
- 명확한 시각적 피드백

### ARIA 레이블
```tsx
<button aria-label="닫기">×</button>
<div role="progressbar" aria-valuenow={75}>
<button role="tab" aria-selected={true}>
```

### 색상 대비
- 모든 텍스트는 WCAG AA 기준 (4.5:1) 준수
- 흰색 텍스트 on 어두운 배경

### 터치 타겟
- 모바일에서 최소 44x44px 터치 영역 확보
- `min-h-[44px] lg:min-h-0` 패턴 사용

---

## 성능 최적화

### 메모이제이션

```tsx
import { useMemo } from "react";

// 계산 비용이 높은 값 캐싱
const formattedValue = useMemo(() => {
  return new Intl.NumberFormat("ko-KR").format(value);
}, [value]);
```

### 조건부 렌더링

```tsx
// ✅ Good: Early return
if (projects.length === 0) {
  return <EmptyState />;
}

// ❌ Bad: Nested ternaries
{projects.length === 0 ? <EmptyState /> : <ProjectList />}
```

### 이미지 최적화

```tsx
// Next.js Image component 사용
import Image from "next/image";

<Image
  src="/project-icon.png"
  width={48}
  height={48}
  alt="Project Icon"
  loading="lazy"
/>
```

---

## 테스트

### 단위 테스트 예시

```tsx
// ProjectModal.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import ProjectModal from "@/components/ProjectModal";

test("renders modal when open", () => {
  render(
    <ProjectModal
      isOpen={true}
      onClose={() => {}}
      onSubmit={async () => {}}
    />
  );

  expect(screen.getByText("새 프로젝트 생성")).toBeInTheDocument();
});

test("calls onSubmit with form data", async () => {
  const onSubmit = vi.fn();

  render(
    <ProjectModal isOpen={true} onClose={() => {}} onSubmit={onSubmit} />
  );

  fireEvent.change(screen.getByLabelText("프로젝트 이름"), {
    target: { value: "Test Project" },
  });

  fireEvent.click(screen.getByText("생성하기"));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Test Project" })
  );
});
```

---

## 트러블슈팅

### Q: 모달이 열리지 않아요

```tsx
// ✅ Solution: isOpen prop이 true인지 확인
<ProjectModal isOpen={true} ... />

// State 업데이트 확인
const [isOpen, setIsOpen] = useState(false);
<button onClick={() => setIsOpen(true)}>Open</button>
```

### Q: KPI 값이 제대로 포맷되지 않아요

```tsx
// ✅ Solution: format과 metricType 확인
{
  value: 1234,
  format: "number",  // "percentage", "currency", "text"
  metricType: "number"
}
```

### Q: OKR 진행률이 자동 업데이트되지 않아요

```tsx
// ✅ Solution: progress를 수동으로 계산하여 전달
const progress = (currentValue / targetValue) * 100;

// 또는 서버에서 계산된 값을 사용
const kr = await fetch(`/api/okr/key-results/${id}`).then(r => r.json());
```

---

## 다음 단계

1. **API 통합**: 실제 백엔드 API와 연결
2. **실시간 동기화**: SSE로 다른 사용자 변경사항 반영
3. **차트 라이브러리**: Recharts 또는 Chart.js 통합
4. **드래그 앤 드롭**: 프로젝트/KR 순서 변경
5. **검색 및 필터**: 프로젝트/OKR 검색 기능

---

## 관련 문서

- [디자인 시스템 가이드](./design-system.md)
- [Tailwind 스타일 가이드](./tailwind-style-guide.md)
- [API 문서](./api-documentation.md)
- [프로젝트 메트릭스 시스템](./project-metrics-system.md)
- [OKR 시스템](./okr-system.md)

---

질문이나 문제가 있으면 프로젝트 이슈 트래커에 등록해주세요!
