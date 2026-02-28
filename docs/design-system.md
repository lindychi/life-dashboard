# Life Dashboard Design System

프로젝트 관리, OKR, KPI 대시보드를 위한 UI/UX 디자인 시스템

## 목차
- [디자인 원칙](#디자인-원칙)
- [컬러 시스템](#컬러-시스템)
- [타이포그래피](#타이포그래피)
- [스페이싱 시스템](#스페이싱-시스템)
- [컴포넌트 라이브러리](#컴포넌트-라이브러리)
- [레이아웃 패턴](#레이아웃-패턴)
- [애니메이션 가이드](#애니메이션-가이드)
- [반응형 디자인](#반응형-디자인)

---

## 디자인 원칙

### 1. **정보 밀도의 최적화**
대시보드는 많은 데이터를 효율적으로 전달해야 합니다. 불필요한 장식을 제거하고 정보에 집중합니다.

### 2. **명확한 계층 구조**
중요도에 따라 시각적 계층을 명확히 하여 사용자가 빠르게 핵심 정보를 파악할 수 있도록 합니다.

### 3. **일관성**
모든 인터랙션과 시각적 요소는 일관된 패턴을 따릅니다.

### 4. **접근성 우선**
WCAG 2.1 AA 기준을 준수하며, 키보드 내비게이션과 스크린 리더를 지원합니다.

### 5. **성능 중심**
애니메이션과 인터랙션은 성능을 저해하지 않는 범위에서 사용합니다.

---

## 컬러 시스템

### Primary Colors (액션 및 강조)

```css
/* Blue - Primary Action */
--blue-50: #eff6ff;    /* 극히 연한 배경 */
--blue-100: #dbeafe;   /* 연한 배경 */
--blue-200: #bfdbfe;   /* 호버 배경 */
--blue-300: #93c5fd;   /* 비활성 텍스트 */
--blue-400: #60a5fa;   /* 링크 호버 */
--blue-500: #3b82f6;   /* 기본 링크 */
--blue-600: #2563eb;   /* Primary 버튼 */
--blue-700: #1d4ed8;   /* Primary 버튼 호버 */
--blue-800: #1e40af;   /* 진한 강조 */
--blue-900: #1e3a8a;   /* 최고 강조 */
```

### Semantic Colors (상태 표시)

```css
/* Success - 성공, 완료, 활성 */
--green-400: #4ade80;  /* 연한 성공 */
--green-500: #22c55e;  /* 기본 성공 */
--green-600: #16a34a;  /* 진한 성공 */
--green-700: #15803d;  /* 최고 성공 */

/* Warning - 주의, 대기 */
--yellow-400: #facc15; /* 연한 경고 */
--yellow-500: #eab308; /* 기본 경고 */
--yellow-600: #ca8a04; /* 진한 경고 */

/* Danger - 오류, 실패, 위험 */
--red-400: #f87171;    /* 연한 위험 */
--red-500: #ef4444;    /* 기본 위험 */
--red-600: #dc2626;    /* 진한 위험 */
--red-700: #b91c1c;    /* 최고 위험 */

/* Info - 정보 */
--cyan-400: #22d3ee;   /* 연한 정보 */
--cyan-500: #06b6d4;   /* 기본 정보 */
--cyan-600: #0891b2;   /* 진한 정보 */
```

### Neutral Colors (UI 요소)

```css
/* Gray Scale - 다크 테마 */
--gray-50: #fafafa;    /* 라이트 모드 배경 */
--gray-100: #f5f5f5;   /* 라이트 모드 카드 */
--gray-200: #e5e5e5;   /* 구분선 (라이트) */
--gray-300: #d4d4d4;   /* 비활성 요소 */
--gray-400: #a3a3a3;   /* Secondary 텍스트 */
--gray-500: #737373;   /* Tertiary 텍스트 */
--gray-600: #525252;   /* 진한 텍스트 */
--gray-700: #404040;   /* 다크 모드 Border */
--gray-750: #2d2d2d;   /* 다크 모드 Hover */
--gray-800: #262626;   /* 다크 모드 Card */
--gray-850: #1f1f1f;   /* 다크 모드 Secondary BG */
--gray-900: #171717;   /* 다크 모드 Main BG */
--gray-950: #0a0a0a;   /* 다크 모드 Deep BG */
```

### Usage Guidelines

```tsx
// 배경색
bg-gray-900      // 메인 배경
bg-gray-850      // Secondary 배경 (모달, 사이드바)
bg-gray-800      // 카드 배경
bg-gray-750      // 카드 호버

// 텍스트
text-white       // Primary 텍스트
text-gray-400    // Secondary 텍스트
text-gray-500    // Tertiary 텍스트

// 경계선
border-gray-700  // 기본 경계선
border-gray-600  // 강조 경계선

// 상태 색상
text-green-500   // 성공, 활성
text-yellow-500  // 주의, 대기
text-red-500     // 오류, 실패
text-blue-400    // 링크
```

---

## 타이포그래피

### Font Family

```css
/* System Font Stack */
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, sans-serif;
```

### Font Sizes

```tsx
// Heading
text-3xl  // 30px / 36px - Page Title
text-2xl  // 24px / 32px - Section Title
text-xl   // 20px / 28px - Card Title
text-lg   // 18px / 28px - Subsection Title

// Body
text-base // 16px / 24px - Body Text
text-sm   // 14px / 20px - Small Text
text-xs   // 12px / 16px - Caption, Label

// Display
text-4xl  // 36px / 40px - Dashboard Metrics (큰 숫자)
text-5xl  // 48px / 1 - Hero Metrics
```

### Font Weights

```tsx
font-normal   // 400 - Body Text
font-medium   // 500 - Emphasis
font-semibold // 600 - Subheadings
font-bold     // 700 - Headings
font-extrabold // 800 - Display Numbers
```

### Line Heights

```tsx
leading-none    // 1 - Tight (큰 숫자)
leading-tight   // 1.25 - Headings
leading-snug    // 1.375 - Compact Text
leading-normal  // 1.5 - Body Text
leading-relaxed // 1.625 - Reading Text
```

### Usage Examples

```tsx
// Page Title
<h1 className="text-3xl lg:text-2xl font-bold text-white">
  프로젝트 대시보드
</h1>

// Section Title
<h2 className="text-xl lg:text-lg font-bold text-white mb-4">
  진행 중인 프로젝트
</h2>

// Card Title
<h3 className="text-lg lg:text-base font-semibold text-white mb-2">
  Life Dashboard
</h3>

// Body Text
<p className="text-base lg:text-sm text-gray-400">
  설명 텍스트가 여기에 들어갑니다.
</p>

// Metric Display
<div className="text-4xl font-extrabold text-white">
  87%
</div>
<div className="text-sm text-gray-400">완료율</div>

// Label
<label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
  상태
</label>
```

---

## 스페이싱 시스템

Tailwind의 4px 기반 스케일을 사용합니다.

### Spacing Scale

```tsx
// Component Internal Spacing
p-1   // 4px  - Tight padding (태그, 배지)
p-2   // 8px  - Button padding (vertical)
p-3   // 12px - Small card padding
p-4   // 16px - Default card padding
p-5   // 20px - Large card padding
p-6   // 24px - Section padding
p-8   // 32px - Page padding

// Gaps & Margins
gap-1    // 4px  - Tight elements
gap-2    // 8px  - List items
gap-3    // 12px - Form fields
gap-4    // 16px - Card grid
gap-6    // 24px - Section spacing
gap-8    // 32px - Page sections

// Responsive Spacing
px-4 sm:px-6  // Mobile: 16px, Desktop: 24px
py-3 lg:py-2  // Desktop compact: 8px instead of 12px
```

### Common Patterns

```tsx
// Card Spacing
<div className="p-5 lg:p-3.5">  // 20px → 14px on large screens

// Section Spacing
<div className="space-y-6 lg:space-y-4">  // Vertical rhythm

// Grid Gaps
<div className="grid gap-4 md:gap-5 lg:gap-6">  // Responsive grid

// Button Padding
<button className="px-4 py-2.5 lg:px-3 lg:py-1.5">
  // 16px/10px → 12px/6px
</button>
```

---

## 컴포넌트 라이브러리

### 1. Buttons

#### Primary Button
```tsx
<button className="
  px-4 py-2.5 lg:px-3 lg:py-2
  bg-blue-600 hover:bg-blue-700 active:bg-blue-800
  text-white font-medium text-sm
  rounded-lg
  transition-colors duration-150
  focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
  focus-visible:ring-offset-gray-900 focus-visible:outline-none
  disabled:opacity-50 disabled:cursor-not-allowed
  min-h-[44px] lg:min-h-0
">
  저장하기
</button>
```

#### Secondary Button
```tsx
<button className="
  px-4 py-2.5 lg:px-3 lg:py-2
  bg-gray-800 hover:bg-gray-700 active:bg-gray-750
  text-white font-medium text-sm
  border border-gray-700
  rounded-lg
  transition-colors duration-150
  focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:outline-none
  disabled:opacity-50 disabled:cursor-not-allowed
  min-h-[44px] lg:min-h-0
">
  취소
</button>
```

#### Danger Button
```tsx
<button className="
  px-4 py-2.5 lg:px-3 lg:py-2
  bg-red-600 hover:bg-red-700 active:bg-red-800
  text-white font-medium text-sm
  rounded-lg
  transition-colors duration-150
  focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none
  disabled:opacity-50 disabled:cursor-not-allowed
  min-h-[44px] lg:min-h-0
">
  삭제
</button>
```

#### Ghost Button (텍스트 버튼)
```tsx
<button className="
  px-3 py-2
  text-blue-400 hover:text-blue-300
  font-medium text-sm
  rounded-lg
  transition-colors duration-150
  focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none
  disabled:opacity-50
">
  더 보기 →
</button>
```

#### Icon Button
```tsx
<button className="
  w-10 h-10 lg:w-8 lg:h-8
  flex items-center justify-center
  bg-gray-800 hover:bg-gray-700
  text-gray-400 hover:text-white
  rounded-lg
  transition-colors duration-150
  focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:outline-none
" aria-label="닫기">
  <svg className="w-5 h-5 lg:w-4 lg:h-4">...</svg>
</button>
```

### 2. Cards

#### Basic Card
```tsx
<div className="
  bg-gray-800
  rounded-xl
  p-5 lg:p-3.5
  border border-gray-700
  hover:bg-gray-750
  transition-colors duration-150
">
  {/* Card content */}
</div>
```

#### Interactive Card (클릭 가능)
```tsx
<button className="
  w-full text-left
  bg-gray-800
  rounded-xl
  p-5 lg:p-3.5
  border border-gray-700
  hover:bg-gray-750 hover:border-gray-600
  active:bg-gray-800 active:border-blue-600
  transition-all duration-150
  focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none
">
  {/* Card content */}
</button>
```

#### Elevated Card (강조)
```tsx
<div className="
  bg-gray-800
  rounded-xl
  p-5 lg:p-3.5
  border-2 border-blue-600
  shadow-lg shadow-blue-600/20
">
  {/* Card content */}
</div>
```

### 3. Form Inputs

#### Text Input
```tsx
<input
  type="text"
  className="
    w-full
    px-4 py-2.5 lg:px-3 lg:py-2
    bg-gray-900
    border border-gray-700
    text-white placeholder-gray-500
    rounded-lg
    text-base lg:text-sm
    transition-colors duration-150
    focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none
    disabled:opacity-50 disabled:cursor-not-allowed
    min-h-[44px] lg:min-h-0
  "
  placeholder="프로젝트 이름을 입력하세요"
/>
```

#### Textarea
```tsx
<textarea
  rows={4}
  className="
    w-full
    px-4 py-3 lg:px-3 lg:py-2
    bg-gray-900
    border border-gray-700
    text-white placeholder-gray-500
    rounded-lg
    text-base lg:text-sm
    resize-none
    transition-colors duration-150
    focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none
  "
  placeholder="프로젝트 설명을 입력하세요"
/>
```

#### Select
```tsx
<select className="
  w-full
  px-4 py-2.5 lg:px-3 lg:py-2
  bg-gray-900
  border border-gray-700
  text-white
  rounded-lg
  text-base lg:text-sm
  transition-colors duration-150
  focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none
  min-h-[44px] lg:min-h-0
">
  <option value="">상태 선택</option>
  <option value="active">진행 중</option>
  <option value="completed">완료</option>
</select>
```

#### Checkbox
```tsx
<label className="flex items-center gap-3 cursor-pointer">
  <input
    type="checkbox"
    className="
      w-5 h-5
      bg-gray-900
      border-2 border-gray-700
      text-blue-600
      rounded
      transition-colors duration-150
      focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
      focus:ring-offset-gray-800
    "
  />
  <span className="text-sm text-gray-400">
    이 프로젝트를 공개합니다
  </span>
</label>
```

### 4. Modals

```tsx
// Backdrop
<div className="
  fixed inset-0 z-40
  bg-black/60 backdrop-blur-sm
  flex items-center justify-center
  p-4
  animate-in fade-in duration-150
">
  {/* Modal */}
  <div className="
    relative z-50
    bg-gray-850
    rounded-2xl
    border border-gray-700
    shadow-2xl
    w-full max-w-lg
    animate-in zoom-in-95 duration-150
  ">
    {/* Header */}
    <div className="
      flex items-center justify-between
      px-6 py-4 lg:px-5 lg:py-3
      border-b border-gray-700
    ">
      <h2 className="text-xl lg:text-lg font-bold text-white">
        프로젝트 생성
      </h2>
      <button className="
        w-8 h-8
        flex items-center justify-center
        text-gray-400 hover:text-white
        rounded-lg hover:bg-gray-800
        transition-colors duration-150
      " aria-label="닫기">
        ×
      </button>
    </div>

    {/* Body */}
    <div className="px-6 py-5 lg:px-5 lg:py-4">
      {/* Form content */}
    </div>

    {/* Footer */}
    <div className="
      flex items-center justify-end gap-3
      px-6 py-4 lg:px-5 lg:py-3
      border-t border-gray-700
    ">
      <button className="secondary-button">취소</button>
      <button className="primary-button">생성하기</button>
    </div>
  </div>
</div>
```

### 5. Badges & Tags

#### Status Badge
```tsx
// Success
<span className="
  inline-flex items-center gap-1.5
  px-2.5 py-1 lg:px-2 lg:py-0.5
  bg-green-500/10
  border border-green-500/20
  text-green-500
  text-xs font-medium
  rounded-full
">
  <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
  활성
</span>

// Warning
<span className="
  inline-flex items-center gap-1.5
  px-2.5 py-1 lg:px-2 lg:py-0.5
  bg-yellow-500/10
  border border-yellow-500/20
  text-yellow-500
  text-xs font-medium
  rounded-full
">
  <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full" />
  대기
</span>

// Danger
<span className="
  inline-flex items-center gap-1.5
  px-2.5 py-1 lg:px-2 lg:py-0.5
  bg-red-500/10
  border border-red-500/20
  text-red-500
  text-xs font-medium
  rounded-full
">
  <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
  오류
</span>
```

#### Tag (제거 가능)
```tsx
<span className="
  inline-flex items-center gap-2
  px-2.5 py-1
  bg-gray-800
  border border-gray-700
  text-gray-300
  text-xs font-medium
  rounded-lg
">
  Frontend
  <button className="
    hover:text-red-400
    transition-colors duration-150
  " aria-label="제거">
    ×
  </button>
</span>
```

### 6. Progress Bars

#### Basic Progress
```tsx
<div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
  <div
    className="bg-green-500 h-2 rounded-full transition-all duration-500 ease-out"
    style={{ width: `${progress}%` }}
  />
</div>
```

#### Progress with Label
```tsx
<div className="space-y-2">
  <div className="flex justify-between items-center text-sm">
    <span className="text-gray-400">진행률</span>
    <span className="text-white font-medium">{progress}%</span>
  </div>
  <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
    <div
      className="bg-green-500 h-2 rounded-full transition-all duration-500"
      style={{ width: `${progress}%` }}
    />
  </div>
</div>
```

#### Segmented Progress (multi-step)
```tsx
<div className="flex gap-1">
  {[1, 2, 3, 4, 5].map((step) => (
    <div
      key={step}
      className={`
        h-2 rounded-full flex-1 transition-colors duration-300
        ${step <= currentStep ? 'bg-blue-600' : 'bg-gray-700'}
      `}
    />
  ))}
</div>
```

### 7. KPI Metric Cards

#### Simple Metric
```tsx
<div className="bg-gray-800 rounded-xl p-5 lg:p-4 border border-gray-700">
  <div className="text-sm text-gray-400 mb-2">완료율</div>
  <div className="text-3xl lg:text-2xl font-extrabold text-white">87%</div>
  <div className="flex items-center gap-1 mt-2 text-xs text-green-500">
    <svg className="w-4 h-4">↑</svg>
    <span>+5% from last week</span>
  </div>
</div>
```

#### Metric with Progress
```tsx
<div className="bg-gray-800 rounded-xl p-5 lg:p-4 border border-gray-700">
  <div className="flex justify-between items-start mb-3">
    <div>
      <div className="text-sm text-gray-400 mb-1">목표 달성</div>
      <div className="text-2xl lg:text-xl font-extrabold text-white">
        8 / 12
      </div>
    </div>
    <span className="text-lg">🎯</span>
  </div>
  <div className="w-full bg-gray-700 rounded-full h-2">
    <div
      className="bg-blue-600 h-2 rounded-full transition-all duration-500"
      style={{ width: '67%' }}
    />
  </div>
</div>
```

### 8. Tabs

```tsx
<div className="border-b border-gray-700">
  <div className="flex gap-1 -mb-px overflow-x-auto scrollbar-none">
    {tabs.map((tab) => (
      <button
        key={tab.id}
        role="tab"
        aria-selected={activeTab === tab.id}
        className={`
          px-4 py-2.5 lg:px-3 lg:py-2
          text-sm font-medium
          border-b-2 transition-colors duration-150
          whitespace-nowrap
          min-h-[44px] lg:min-h-0
          ${activeTab === tab.id
            ? 'border-blue-600 text-white'
            : 'border-transparent text-gray-400 hover:text-white'
          }
        `}
      >
        {tab.label}
      </button>
    ))}
  </div>
</div>
```

### 9. Tooltips

```tsx
<div className="relative group">
  <button className="...">
    정보
  </button>
  <div className="
    absolute bottom-full left-1/2 -translate-x-1/2 mb-2
    px-3 py-2
    bg-gray-950
    border border-gray-700
    text-white text-xs
    rounded-lg
    whitespace-nowrap
    opacity-0 invisible
    group-hover:opacity-100 group-hover:visible
    transition-all duration-150
    pointer-events-none
  ">
    도움말 텍스트
    <div className="
      absolute top-full left-1/2 -translate-x-1/2
      w-0 h-0
      border-l-4 border-l-transparent
      border-r-4 border-r-transparent
      border-t-4 border-t-gray-950
    " />
  </div>
</div>
```

### 10. Empty States

```tsx
<div className="
  flex flex-col items-center justify-center
  py-16 lg:py-12
  text-center
">
  <div className="
    w-16 h-16 lg:w-12 lg:h-12
    flex items-center justify-center
    bg-gray-800
    rounded-full
    mb-4
  ">
    <span className="text-3xl lg:text-2xl">📊</span>
  </div>
  <h3 className="text-lg lg:text-base font-semibold text-white mb-2">
    프로젝트가 없습니다
  </h3>
  <p className="text-sm text-gray-400 mb-6 max-w-sm">
    첫 번째 프로젝트를 생성하여 목표를 추적하고 관리하세요.
  </p>
  <button className="primary-button">
    프로젝트 생성하기
  </button>
</div>
```

---

## 레이아웃 패턴

### Dashboard Grid

```tsx
// 3-column grid (responsive)
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
  <MetricCard />
  <MetricCard />
  <MetricCard />
</div>

// 4-column grid
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
  <QuickStat />
  <QuickStat />
  <QuickStat />
  <QuickStat />
</div>

// Asymmetric grid (2/3 + 1/3)
<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
  <div className="lg:col-span-2">
    <MainContent />
  </div>
  <div>
    <Sidebar />
  </div>
</div>
```

### Section Layout

```tsx
<section className="space-y-6 lg:space-y-4">
  {/* Section Header */}
  <div className="flex items-center justify-between">
    <h2 className="text-xl lg:text-lg font-bold text-white">
      진행 중인 프로젝트
    </h2>
    <button className="text-sm text-blue-400 hover:text-blue-300">
      모두 보기 →
    </button>
  </div>

  {/* Section Content */}
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <ProjectCard />
    <ProjectCard />
  </div>
</section>
```

---

## 애니메이션 가이드

### Transition Durations

```tsx
// Quick (UI 피드백)
duration-75    // 75ms  - 매우 빠른 피드백 (버튼 active)
duration-100   // 100ms - 빠른 피드백 (호버)
duration-150   // 150ms - 기본 트랜지션 (대부분의 경우)

// Standard (컴포넌트 전환)
duration-200   // 200ms - 모달 fade
duration-300   // 300ms - 컨텐츠 슬라이드

// Slow (복잡한 애니메이션)
duration-500   // 500ms - 프로그레스 바, 차트
duration-700   // 700ms - 페이지 전환
```

### Easing Functions

```tsx
ease-out      // 기본 - 대부분의 UI 전환
ease-in-out   // 모달, 드로어 열기/닫기
ease-linear   // 로딩, 무한 회전
```

### Common Animations

```tsx
// Fade In
className="animate-in fade-in duration-150"

// Slide Up
className="animate-in slide-in-from-bottom-4 duration-200"

// Zoom In (modal)
className="animate-in zoom-in-95 fade-in duration-150"

// Pulse (loading)
className="animate-pulse"

// Spin (loading icon)
className="animate-spin"
```

### Hover Effects

```tsx
// Card Lift
className="
  transition-all duration-150
  hover:-translate-y-0.5 hover:shadow-lg
"

// Glow Effect
className="
  transition-shadow duration-200
  hover:shadow-lg hover:shadow-blue-600/20
"

// Scale
className="
  transition-transform duration-150
  hover:scale-105 active:scale-95
"
```

---

## 반응형 디자인

### Breakpoints

```tsx
sm:   // 640px  - Small tablets
md:   // 768px  - Tablets
lg:   // 1024px - Desktops (primary target)
xl:   // 1280px - Large desktops
2xl:  // 1536px - Extra large screens
```

### Mobile-First Approach

모든 스타일은 모바일부터 작성하고, 큰 화면으로 갈수록 오버라이드합니다.

```tsx
// ✅ Good
<div className="text-base lg:text-sm">

// ❌ Bad
<div className="lg:text-sm text-base">
```

### Touch Targets (모바일)

모바일에서는 최소 44x44px 터치 영역을 확보합니다.

```tsx
// Button
<button className="
  px-4 py-2.5    // Mobile: 44px height
  lg:px-3 lg:py-1.5  // Desktop: compact
  min-h-[44px] lg:min-h-0
">

// Icon Button
<button className="
  w-10 h-10     // Mobile: 40px (테두리 포함 44px)
  lg:w-8 lg:h-8 // Desktop: compact
">
```

### Responsive Typography

```tsx
// Page Title
className="text-2xl sm:text-3xl lg:text-2xl"
// Mobile: 24px, Tablet: 30px, Desktop: 24px (compact)

// Section Title
className="text-xl lg:text-lg"
// Mobile/Tablet: 20px, Desktop: 18px

// Body Text
className="text-base lg:text-sm"
// Mobile: 16px, Desktop: 14px
```

### Responsive Spacing

```tsx
// Container Padding
className="px-4 sm:px-6 lg:px-8"
// Mobile: 16px, Tablet: 24px, Desktop: 32px

// Section Spacing
className="py-8 lg:py-6"
// Mobile: 32px, Desktop: 24px

// Card Padding
className="p-5 lg:p-3.5"
// Mobile: 20px, Desktop: 14px
```

### Responsive Grid

```tsx
// 1 → 2 → 3 columns
<div className="
  grid
  grid-cols-1
  md:grid-cols-2
  lg:grid-cols-3
  gap-4 md:gap-5 lg:gap-6
">

// Asymmetric layout
<div className="
  grid
  grid-cols-1
  lg:grid-cols-[2fr_1fr]
  gap-6
">
```

---

## Accessibility Guidelines

### Focus States

모든 인터랙티브 요소는 명확한 포커스 상태를 가져야 합니다.

```tsx
className="
  focus-visible:ring-2
  focus-visible:ring-blue-500
  focus-visible:ring-offset-2
  focus-visible:ring-offset-gray-900
  focus-visible:outline-none
"
```

### ARIA Labels

```tsx
// Icon buttons
<button aria-label="닫기">×</button>

// Tabs
<button role="tab" aria-selected={active}>

// Progress
<div role="progressbar" aria-valuenow={75} aria-valuemin={0} aria-valuemax={100}>
```

### Semantic HTML

```tsx
// ✅ Good
<button onClick={...}>클릭</button>

// ❌ Bad
<div onClick={...}>클릭</div>
```

### Color Contrast

모든 텍스트는 WCAG AA 기준 (4.5:1)을 만족해야 합니다.

```tsx
// ✅ Good (충분한 대비)
text-white on bg-gray-800
text-gray-400 on bg-gray-900

// ⚠️ Check (경계선)
text-gray-500 on bg-gray-800
```

---

## Performance Guidelines

### 1. CSS 최적화

```tsx
// ✅ Use Tailwind utilities (tree-shakeable)
className="flex items-center gap-2"

// ❌ Avoid inline styles unless dynamic
style={{ display: 'flex' }}
```

### 2. 애니메이션 성능

```tsx
// ✅ GPU-accelerated properties
transform, opacity

// ❌ CPU-heavy properties
width, height, top, left
```

### 3. 이미지 최적화

```tsx
// Next.js Image component
<Image
  src="/image.jpg"
  width={300}
  height={200}
  alt="Description"
  loading="lazy"
/>
```

---

## Dark Mode (향후 확장)

현재는 다크 모드만 지원하지만, 향후 라이트 모드 추가 시 다음 패턴 사용:

```tsx
// Background
className="bg-gray-900 dark:bg-gray-900"

// Text
className="text-white dark:text-white"

// Card
className="bg-gray-800 dark:bg-gray-800"
```

---

## 예제: 프로젝트 카드 (종합)

```tsx
function ProjectCard({ project }: { project: Project }) {
  return (
    <div className="
      bg-gray-800
      rounded-xl
      p-5 lg:p-3.5
      border border-gray-700
      hover:bg-gray-750 hover:border-gray-600
      transition-all duration-150
    ">
      {/* Header */}
      <div className="flex justify-between items-start mb-3 lg:mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="
            text-lg lg:text-base
            font-bold
            text-white
            truncate
          ">
            {project.name}
          </h3>
          <p className="
            text-sm lg:text-xs
            text-gray-400
            line-clamp-2
            mt-1
          ">
            {project.description}
          </p>
        </div>
        <span className="
          ml-3
          px-2.5 py-1 lg:px-2 lg:py-0.5
          bg-green-500/10
          border border-green-500/20
          text-green-500
          text-xs font-medium
          rounded-full
          whitespace-nowrap
        ">
          {project.status}
        </span>
      </div>

      {/* Progress */}
      <div className="mb-3 lg:mb-2">
        <div className="flex justify-between text-xs text-gray-400 mb-1.5">
          <span>진행률</span>
          <span className="font-medium text-white">{project.progress}%</span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className="
              bg-green-500
              h-2
              rounded-full
              transition-all duration-500 ease-out
            "
            style={{ width: `${project.progress}%` }}
          />
        </div>
      </div>

      {/* KPIs */}
      {project.kpis && project.kpis.length > 0 && (
        <div className="space-y-1.5 lg:space-y-1">
          {project.kpis.map((kpi, i) => (
            <div key={i} className="flex justify-between text-sm lg:text-xs">
              <span className="text-gray-400">{kpi.label}</span>
              <span className="font-medium text-white">{kpi.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Link */}
      {project.url && (
        <a
          href={project.url}
          target="_blank"
          rel="noopener noreferrer"
          className="
            mt-4 lg:mt-3
            flex items-center justify-center gap-2
            text-sm lg:text-xs
            text-blue-400
            hover:text-blue-300
            transition-colors duration-150
            focus-visible:ring-2 focus-visible:ring-blue-500
            focus-visible:outline-none
            rounded-lg
            py-2
          "
        >
          방문하기
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
    </div>
  );
}
```

---

## 향후 확장

1. **Chart Components**: Recharts 또는 Chart.js 통합
2. **Data Tables**: 정렬, 필터, 페이지네이션 지원
3. **Drag & Drop**: 프로젝트/태스크 재정렬
4. **Search & Filter**: 전역 검색 인터페이스
5. **Notifications**: 토스트/배너 알림 시스템
6. **Theme Switcher**: 라이트/다크 모드 토글

---

이 디자인 시스템은 Life Dashboard의 일관성 있고 확장 가능한 UI/UX를 위한 기초입니다.
모든 새로운 컴포넌트는 이 가이드를 기반으로 작성되어야 하며,
필요한 경우 이 문서를 업데이트하여 팀 전체가 최신 패턴을 공유할 수 있도록 합니다.
