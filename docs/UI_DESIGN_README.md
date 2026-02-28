# Life Dashboard UI/UX Design System

프로젝트 관리, KPI 대시보드, OKR 시각화를 위한 완전한 UI/UX 디자인 시스템

---

## 📚 문서 목록

이 디렉토리에는 Life Dashboard의 디자인 시스템과 UI 컴포넌트에 대한 모든 문서가 포함되어 있습니다.

### 1. [디자인 시스템 가이드](./design-system.md) ⭐
**Life Dashboard의 전체 디자인 원칙과 컴포넌트 라이브러리**

- ✅ 디자인 원칙 (정보 밀도, 계층 구조, 일관성, 접근성)
- ✅ 컬러 시스템 (Primary, Semantic, Neutral colors)
- ✅ 타이포그래피 (폰트 사이즈, 가중치, 행간)
- ✅ 스페이싱 시스템 (4px 기반 스케일)
- ✅ 컴포넌트 라이브러리 (10가지 기본 컴포넌트)
  - Buttons (Primary, Secondary, Danger, Ghost, Icon)
  - Cards (Basic, Interactive, Elevated)
  - Form Inputs (Text, Textarea, Select, Checkbox)
  - Modals (Backdrop, Container, Header, Body, Footer)
  - Badges & Tags (Status, Success, Warning, Danger)
  - Progress Bars (Basic, Labeled, Segmented)
  - KPI Metric Cards (Simple, With Progress)
  - Tabs, Tooltips, Empty States
- ✅ 레이아웃 패턴 (Dashboard Grid, Section Layout)
- ✅ 애니메이션 가이드 (Durations, Easing, Common patterns)
- ✅ 반응형 디자인 (Breakpoints, Mobile-first, Touch targets)
- ✅ 접근성 가이드라인 (Focus states, ARIA labels, Color contrast)
- ✅ 성능 가이드라인 (CSS 최적화, 애니메이션 성능)

**언제 읽어야 하나요?**
- 새로운 컴포넌트를 디자인할 때
- 디자인 일관성을 확인하고 싶을 때
- 색상, 타이포그래피, 스페이싱 기준이 필요할 때

---

### 2. [Tailwind 스타일 가이드](./tailwind-style-guide.md) ⭐
**Tailwind CSS 사용 패턴과 베스트 프랙티스**

- ✅ 기본 원칙 (Utility-first, 일관성, 가독성)
- ✅ 클래스 순서 규칙 (Layout → Positioning → ... → State)
- ✅ 공통 패턴 라이브러리 (재사용 가능한 스타일 상수)
  - Buttons: `PRIMARY_BTN`, `SECONDARY_BTN`, `DANGER_BTN` 등
  - Cards: `CARD`, `INTERACTIVE_CARD`, `ELEVATED_CARD`
  - Forms: `TEXT_INPUT`, `TEXTAREA`, `SELECT`
  - Badges: `BADGE_SUCCESS`, `BADGE_WARNING`, `BADGE_DANGER`
  - Modals: `MODAL_BACKDROP`, `MODAL_CONTAINER` 등
- ✅ 반응형 패턴 (Mobile-first, 공통 반응형 템플릿)
- ✅ 다크 모드 가이드 (현재 다크 전용, 향후 라이트 모드 준비)
- ✅ 성능 최적화 (조건부 클래스, 애니메이션 성능, Purge 최적화)
- ✅ 피해야 할 패턴 (인라인 스타일, 중복 클래스, !important)
- ✅ TypeScript 통합 (스타일 상수 정의 및 재사용)
- ✅ 클래스 병합 유틸리티 (clsx, tailwind-merge)

**언제 읽어야 하나요?**
- Tailwind CSS 클래스를 작성할 때
- 스타일 코드 리뷰를 받기 전에
- 반응형 디자인을 구현할 때
- 성능 최적화가 필요할 때

---

### 3. [UI 컴포넌트 사용 가이드](./ui-components-guide.md) ⭐
**React 컴포넌트 API 문서 및 통합 가이드**

- ✅ 빠른 시작 (ProjectsTab 통합)
- ✅ 개별 컴포넌트 상세 문서
  - **ProjectModal**: 프로젝트 생성/수정 모달
    - Props 인터페이스
    - 사용 예시 (생성/수정 모드)
    - 주요 기능 (KPI 관리, 진행률 슬라이더, 유효성 검사)
  - **KPIDashboard**: KPI 지표 대시보드
    - Props 인터페이스 (`KPIMetric` 타입)
    - 레이아웃 모드 (Grid vs Compact)
    - 포맷 옵션 (Number, Percentage, Currency, Text)
    - 트렌드 색상 시스템
    - 샘플 데이터 생성
  - **OKRView**: OKR 시각화 컴포넌트
    - Props 인터페이스 (`Objective`, `KeyResult` 타입)
    - 주요 기능 (아코디언, 인라인 편집, 진행률 계산)
    - 샘플 데이터 생성
  - **ProjectsTab**: 통합 프로젝트 탭
    - 뷰 모드 전환 (그리드/KPI/OKR)
    - CRUD 기능 통합
- ✅ 스타일 커스터마이징 (색상, 크기, 간격)
- ✅ 접근성 (키보드, 포커스, ARIA, 색상 대비, 터치 타겟)
- ✅ 성능 최적화 (메모이제이션, 조건부 렌더링, 이미지)
- ✅ 테스트 예시 (단위 테스트)
- ✅ 트러블슈팅 (자주 묻는 질문)

**언제 읽어야 하나요?**
- 컴포넌트를 처음 사용할 때
- API 문서가 필요할 때
- 통합 방법을 찾을 때
- 버그를 디버깅할 때

---

## 🚀 빠른 시작

### 1단계: ProjectsTab 통합

가장 빠르게 시작하는 방법은 `ProjectsTab` 컴포넌트를 사용하는 것입니다.

```tsx
// src/app/page.tsx
import ProjectsTab from "@/components/ProjectsTab";
import { useProjects } from "@/hooks/useDashboardData";

export default function Home() {
  const { projects, isLoading, refetch } = useProjects();

  return (
    <main>
      <ProjectsTab
        projects={projects}
        isLoading={isLoading}
        onRefresh={refetch}
      />
    </main>
  );
}
```

**포함된 기능:**
- ✅ 프로젝트 그리드 뷰
- ✅ KPI 대시보드 뷰
- ✅ OKR 뷰
- ✅ 프로젝트 생성/수정/삭제
- ✅ 뷰 모드 전환

### 2단계: API 연결 확인

```bash
# 프로젝트 API 테스트
curl http://localhost:3000/api/projects

# 응답 예시
{
  "projects": [
    {
      "id": "uuid",
      "name": "Life Dashboard",
      "description": "Personal dashboard",
      "status": "active",
      "progress": 75,
      "url": "https://life-dashboard.app",
      "kpis": [
        { "label": "사용자", "value": "1,234명" }
      ]
    }
  ]
}
```

### 3단계: 스타일 확인

모든 컴포넌트는 Tailwind CSS로 스타일링되어 있으므로 추가 CSS 파일이 필요하지 않습니다.

```tsx
// tailwind.config.ts 확인
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        gray: {
          750: '#2d2d2d',
          850: '#1f1f1f',
        },
      },
    },
  },
}
```

---

## 📦 컴포넌트 개요

### ProjectModal
**프로젝트 생성 및 수정 모달**

```tsx
<ProjectModal
  isOpen={isModalOpen}
  onClose={() => setIsModalOpen(false)}
  onSubmit={handleCreateProject}
  project={null}  // null = 생성, Project = 수정
/>
```

**주요 기능:**
- 이름, 설명, 상태, 진행률 입력
- 동적 KPI 추가/제거
- URL 입력 (선택)
- 폼 유효성 검사
- 로딩 상태 관리

---

### KPIDashboard
**KPI 지표 시각화**

```tsx
<KPIDashboard
  metrics={[
    {
      id: "revenue",
      label: "월 수익",
      value: 3200000,
      change: 15,
      trend: "up",
      icon: "💰",
      format: "currency",
      target: 5000000,
    }
  ]}
  columns={3}
  layout="grid"
/>
```

**지원 포맷:**
- `number` - 천 단위 구분 (1,234)
- `percentage` - 백분율 (87%)
- `currency` - 통화 (₩3,200,000)
- `text` - 일반 텍스트

**레이아웃:**
- `grid` - 카드 그리드 (기본)
- `compact` - 리스트 형태

---

### OKRView
**OKR 관리 및 시각화**

```tsx
<OKRView
  objectives={[
    {
      id: "okr-1",
      title: "Life Dashboard 런칭",
      periodType: "quarterly",
      status: "active",
      overallProgress: 67,
      keyResults: [
        {
          id: "kr-1",
          title: "MVP 개발 완료",
          currentValue: 85,
          targetValue: 100,
          unit: "완료율",
          metricType: "percentage",
          progress: 85,
        }
      ]
    }
  ]}
  onKeyResultUpdate={(objId, krId, value) => {
    // KR 값 업데이트
  }}
/>
```

**주요 기능:**
- 요약 카드 (활성 목표, 평균 진행률, 위험 KR)
- 아코디언 목표 카드
- 인라인 KR 편집
- 자동 진행률 계산
- 상태별 색상 구분

---

## 🎨 디자인 토큰

### 색상

```tsx
// Primary (액션)
bg-blue-600      // Primary button
bg-blue-700      // Primary button hover
text-blue-400    // Links

// Semantic
bg-green-500     // Success
bg-yellow-500    // Warning
bg-red-500       // Danger

// Neutral (다크 모드)
bg-gray-900      // Main background
bg-gray-850      // Secondary background
bg-gray-800      // Card background
bg-gray-750      // Card hover
bg-gray-700      // Border
text-white       // Primary text
text-gray-400    // Secondary text
text-gray-500    // Tertiary text
```

### 타이포그래피

```tsx
text-3xl         // Page title (30px)
text-2xl         // Section title (24px)
text-xl          // Card title (20px)
text-base        // Body text (16px)
text-sm          // Small text (14px)
text-xs          // Caption (12px)

font-bold        // 700 - Headings
font-semibold    // 600 - Subheadings
font-medium      // 500 - Emphasis
font-normal      // 400 - Body
```

### 스페이싱

```tsx
p-5 lg:p-3.5     // Card padding (20px → 14px)
gap-4            // Grid gap (16px)
space-y-6        // Section spacing (24px)
px-4 sm:px-6     // Container padding (16px → 24px)
```

---

## ♿ 접근성 체크리스트

모든 컴포넌트는 다음을 준수합니다:

- ✅ **키보드 내비게이션**: Tab, Enter, Escape 키 지원
- ✅ **포커스 인디케이터**: `focus-visible:ring-2` 스타일
- ✅ **ARIA 레이블**: `aria-label`, `role`, `aria-selected`
- ✅ **색상 대비**: WCAG AA 기준 (4.5:1)
- ✅ **터치 타겟**: 모바일 최소 44x44px
- ✅ **시맨틱 HTML**: `<button>`, `<input>`, `<label>` 사용

---

## 📱 반응형 브레이크포인트

```tsx
sm:   // 640px  - Small tablets
md:   // 768px  - Tablets
lg:   // 1024px - Desktops (primary target)
xl:   // 1280px - Large desktops
2xl:  // 1536px - Extra large screens
```

**Mobile-First 전략:**
```tsx
// ✅ Good
className="text-base lg:text-sm"

// ❌ Bad
className="lg:text-sm text-base"
```

---

## 🧪 테스트

### 단위 테스트

```tsx
import { render, screen } from "@testing-library/react";
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
```

### 시각적 회귀 테스트 (향후)

```bash
# Storybook + Chromatic
npm run storybook
npm run chromatic
```

---

## 🔧 커스터마이징

### 색상 테마 변경

```tsx
// 파란색 → 보라색
bg-blue-600 → bg-purple-600
hover:bg-blue-700 → hover:bg-purple-700
text-blue-400 → text-purple-400
```

### 모달 크기 조정

```tsx
// 기본
max-w-lg  // 512px

// 큰 모달
max-w-2xl  // 672px

// 전체 화면
max-w-full
```

### 반응형 조정

```tsx
// 데스크톱에서 더 compact하게
p-5 lg:p-3.5 → p-5 lg:p-2
text-base lg:text-sm → text-base lg:text-xs
```

---

## 🚧 향후 계획

1. **차트 컴포넌트**
   - Recharts 또는 Chart.js 통합
   - 프로젝트 진행률 그래프
   - KPI 트렌드 차트

2. **드래그 앤 드롭**
   - react-beautiful-dnd 통합
   - 프로젝트 순서 변경
   - KR 우선순위 조정

3. **검색 및 필터**
   - 전역 검색 바
   - 프로젝트 필터 (상태, 태그)
   - OKR 검색

4. **데이터 테이블**
   - @tanstack/react-table 통합
   - 정렬, 필터, 페이지네이션
   - 프로젝트 리스트 뷰

5. **라이트 모드**
   - 라이트 테마 색상 시스템
   - 테마 토글 버튼
   - 시스템 설정 연동

---

## 📚 참고 자료

### 외부 리소스
- [Tailwind CSS 공식 문서](https://tailwindcss.com/docs)
- [Tailwind UI Components](https://tailwindui.com)
- [Headless UI](https://headlessui.com) - 접근성 컴포넌트
- [React ARIA](https://react-spectrum.adobe.com/react-aria/) - 접근성 훅

### 내부 문서
- [프로젝트 메트릭스 시스템](./project-metrics-system.md)
- [OKR 시스템](./okr-system.md)
- [SSE 실시간 동기화](./sse-realtime-sync.md)

---

## 💬 피드백 및 기여

### 버그 리포트
이슈 트래커에 버그를 등록해주세요:
- 컴포넌트 이름
- 재현 단계
- 예상 동작 vs 실제 동작
- 스크린샷 (선택)

### 기능 제안
새로운 컴포넌트나 기능을 제안하려면:
- 사용 사례 설명
- 와이어프레임 또는 참고 이미지
- API 제안

### 문서 개선
오타, 불명확한 설명, 누락된 정보를 발견하시면:
- PR로 직접 수정
- 또는 이슈로 제보

---

## 📄 라이선스

이 디자인 시스템은 Life Dashboard 프로젝트의 일부이며,
프로젝트와 동일한 라이선스를 따릅니다.

---

## ✨ 기여자

- **한치** - 초기 디자인 시스템 설계 및 구현

---

**생성일**: 2025-02-28
**최종 수정**: 2025-02-28
**버전**: 1.0.0

---

질문이 있으신가요? [이슈 트래커](https://github.com/your-repo/issues)에 문의해주세요!
