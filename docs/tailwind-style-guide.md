# Tailwind CSS 스타일 가이드

Life Dashboard에서 사용하는 Tailwind CSS 스타일 패턴과 베스트 프랙티스

## 목차
- [기본 원칙](#기본-원칙)
- [클래스 순서 규칙](#클래스-순서-규칙)
- [공통 패턴 라이브러리](#공통-패턴-라이브러리)
- [반응형 패턴](#반응형-패턴)
- [다크 모드 가이드](#다크-모드-가이드)
- [성능 최적화](#성능-최적화)
- [피해야 할 패턴](#피해야-할-패턴)

---

## 기본 원칙

### 1. Utility-First

항상 Tailwind의 유틸리티 클래스를 우선적으로 사용합니다. 커스텀 CSS는 정말 필요한 경우에만 작성합니다.

```tsx
// ✅ Good
<div className="flex items-center gap-2 px-4 py-2 bg-gray-800 rounded-lg">

// ❌ Bad
<div className="custom-card" style={{ display: 'flex', padding: '8px 16px' }}>
```

### 2. 일관성

동일한 UI 요소는 항상 동일한 클래스 조합을 사용합니다.

```tsx
// Button 스타일을 일관되게 유지
const PRIMARY_BUTTON = "px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg";
```

### 3. 가독성

긴 클래스 목록은 논리적 그룹으로 구분합니다.

```tsx
<button className="
  px-4 py-2.5 lg:px-3 lg:py-2          // Spacing
  bg-blue-600 hover:bg-blue-700        // Background
  text-white font-medium text-sm       // Typography
  rounded-lg                            // Border
  transition-colors duration-150        // Animation
  focus-visible:ring-2                  // Focus state
  disabled:opacity-50                   // Disabled state
">
```

---

## 클래스 순서 규칙

클래스는 다음 순서로 작성합니다:

1. **Layout**: `flex`, `grid`, `block`, `inline-block`, `absolute`, etc.
2. **Positioning**: `relative`, `absolute`, `top-0`, `z-10`, etc.
3. **Display**: `hidden`, `overflow-hidden`, etc.
4. **Sizing**: `w-full`, `h-10`, `min-w-0`, `max-w-lg`, etc.
5. **Spacing**: `p-4`, `m-2`, `gap-3`, `space-y-2`, etc.
6. **Typography**: `text-base`, `font-bold`, `leading-tight`, etc.
7. **Background**: `bg-gray-800`, etc.
8. **Border**: `border`, `border-gray-700`, `rounded-lg`, etc.
9. **Effects**: `shadow-lg`, `opacity-50`, etc.
10. **Transitions**: `transition-colors`, `duration-150`, etc.
11. **Interactivity**: `hover:`, `focus:`, `active:`, etc.
12. **Responsive**: `sm:`, `md:`, `lg:`, etc.
13. **State**: `disabled:`, `aria-selected:`, etc.

### 예시

```tsx
<div className="
  flex items-center justify-between     // 1. Layout
  relative                              // 2. Positioning
  w-full max-w-lg                       // 4. Sizing
  px-4 py-3 gap-2                       // 5. Spacing
  text-sm font-medium text-white        // 6. Typography
  bg-gray-800                           // 7. Background
  border border-gray-700 rounded-lg     // 8. Border
  shadow-md                             // 9. Effects
  transition-colors duration-150        // 10. Transitions
  hover:bg-gray-750                     // 11. Interactivity
  lg:px-3 lg:py-2                       // 12. Responsive
  disabled:opacity-50                   // 13. State
">
```

---

## 공통 패턴 라이브러리

프로젝트 전체에서 재사용할 수 있는 표준 패턴입니다.

### Buttons

```tsx
// Primary Button
const PRIMARY_BTN = `
  px-4 py-2.5 lg:px-3 lg:py-2
  bg-blue-600 hover:bg-blue-700 active:bg-blue-800
  text-white font-medium text-sm
  rounded-lg
  transition-colors duration-150
  focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none
  disabled:opacity-50 disabled:cursor-not-allowed
  min-h-[44px] lg:min-h-0
`;

// Secondary Button
const SECONDARY_BTN = `
  px-4 py-2.5 lg:px-3 lg:py-2
  bg-gray-800 hover:bg-gray-700 active:bg-gray-750
  text-white font-medium text-sm
  border border-gray-700
  rounded-lg
  transition-colors duration-150
  focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:outline-none
  disabled:opacity-50 disabled:cursor-not-allowed
  min-h-[44px] lg:min-h-0
`;

// Danger Button
const DANGER_BTN = `
  px-4 py-2.5 lg:px-3 lg:py-2
  bg-red-600 hover:bg-red-700 active:bg-red-800
  text-white font-medium text-sm
  rounded-lg
  transition-colors duration-150
  focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none
  disabled:opacity-50 disabled:cursor-not-allowed
  min-h-[44px] lg:min-h-0
`;

// Ghost Button
const GHOST_BTN = `
  px-3 py-2
  text-blue-400 hover:text-blue-300
  font-medium text-sm
  rounded-lg
  transition-colors duration-150
  focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none
  disabled:opacity-50
`;

// Icon Button
const ICON_BTN = `
  w-10 h-10 lg:w-8 lg:h-8
  flex items-center justify-center
  bg-gray-800 hover:bg-gray-700
  text-gray-400 hover:text-white
  rounded-lg
  transition-colors duration-150
  focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:outline-none
`;
```

### Cards

```tsx
// Basic Card
const CARD = `
  bg-gray-800
  rounded-xl
  p-5 lg:p-3.5
  border border-gray-700
  hover:bg-gray-750
  transition-colors duration-150
`;

// Interactive Card (clickable)
const INTERACTIVE_CARD = `
  w-full text-left
  bg-gray-800
  rounded-xl
  p-5 lg:p-3.5
  border border-gray-700
  hover:bg-gray-750 hover:border-gray-600
  active:bg-gray-800 active:border-blue-600
  transition-all duration-150
  focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none
`;

// Elevated Card
const ELEVATED_CARD = `
  bg-gray-800
  rounded-xl
  p-5 lg:p-3.5
  border-2 border-blue-600
  shadow-lg shadow-blue-600/20
`;
```

### Form Inputs

```tsx
// Text Input
const TEXT_INPUT = `
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
`;

// Textarea
const TEXTAREA = `
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
`;

// Select
const SELECT = `
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
`;
```

### Badges

```tsx
// Status Badge (Success)
const BADGE_SUCCESS = `
  inline-flex items-center gap-1.5
  px-2.5 py-1 lg:px-2 lg:py-0.5
  bg-green-500/10
  border border-green-500/20
  text-green-500
  text-xs font-medium
  rounded-full
`;

// Status Badge (Warning)
const BADGE_WARNING = `
  inline-flex items-center gap-1.5
  px-2.5 py-1 lg:px-2 lg:py-0.5
  bg-yellow-500/10
  border border-yellow-500/20
  text-yellow-500
  text-xs font-medium
  rounded-full
`;

// Status Badge (Danger)
const BADGE_DANGER = `
  inline-flex items-center gap-1.5
  px-2.5 py-1 lg:px-2 lg:py-0.5
  bg-red-500/10
  border border-red-500/20
  text-red-500
  text-xs font-medium
  rounded-full
`;

// Tag (with remove)
const TAG = `
  inline-flex items-center gap-2
  px-2.5 py-1
  bg-gray-800
  border border-gray-700
  text-gray-300
  text-xs font-medium
  rounded-lg
`;
```

### Modals

```tsx
// Modal Backdrop
const MODAL_BACKDROP = `
  fixed inset-0 z-40
  bg-black/60 backdrop-blur-sm
  flex items-center justify-center
  p-4
  animate-in fade-in duration-150
`;

// Modal Container
const MODAL_CONTAINER = `
  relative z-50
  bg-gray-850
  rounded-2xl
  border border-gray-700
  shadow-2xl
  w-full max-w-lg
  max-h-[90vh]
  overflow-hidden
  animate-in zoom-in-95 duration-150
`;

// Modal Header
const MODAL_HEADER = `
  flex items-center justify-between
  px-6 py-4 lg:px-5 lg:py-3
  border-b border-gray-700
`;

// Modal Body
const MODAL_BODY = `
  px-6 py-5 lg:px-5 lg:py-4
  overflow-y-auto
  max-h-[calc(90vh-140px)]
`;

// Modal Footer
const MODAL_FOOTER = `
  flex items-center justify-end gap-3
  px-6 py-4 lg:px-5 lg:py-3
  border-t border-gray-700
`;
```

---

## 반응형 패턴

### Breakpoint Strategy

모바일 우선(Mobile-First) 접근 방식을 사용합니다.

```tsx
// ✅ Good: Mobile-first
<div className="text-base lg:text-sm">

// ❌ Bad: Desktop-first
<div className="lg:text-sm text-base">
```

### 공통 반응형 패턴

```tsx
// Typography
className="text-2xl sm:text-3xl lg:text-2xl"  // Mobile: 24px, Tablet: 30px, Desktop: 24px

// Spacing
className="px-4 sm:px-6 lg:px-8"  // Mobile: 16px, Tablet: 24px, Desktop: 32px
className="py-6 lg:py-4"          // Mobile: 24px, Desktop: 16px

// Grid Layouts
className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3"  // 1 → 2 → 3 columns

// Touch Targets (모바일)
className="min-h-[44px] lg:min-h-0"  // Mobile: 44px, Desktop: auto
```

### 반응형 Grid 템플릿

```tsx
// 3-column grid
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">

// 4-column grid
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

// Asymmetric (2/3 + 1/3)
<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
  <div className="lg:col-span-2">{/* Main */}</div>
  <div>{/* Sidebar */}</div>
</div>
```

---

## 다크 모드 가이드

현재는 다크 모드만 지원하지만, 향후 라이트 모드 추가를 위해 미리 준비합니다.

### 색상 사용 규칙

```tsx
// ✅ Good: Semantic color names
className="bg-gray-800 text-white border-gray-700"

// ❌ Bad: Hardcoded hex colors
style={{ backgroundColor: '#262626', color: '#ffffff' }}
```

### 다크 모드 전환 준비

```tsx
// 향후 라이트 모드 추가 시
className="bg-gray-900 dark:bg-gray-900 text-white dark:text-white"
```

---

## 성능 최적화

### 1. 조건부 클래스

동적 클래스는 템플릿 리터럴 대신 객체를 사용합니다.

```tsx
// ✅ Good: Predictable for tree-shaking
<button className={`px-4 py-2 ${active ? 'bg-blue-600' : 'bg-gray-800'}`}>

// ✅ Better: Using clsx/classnames
import clsx from 'clsx';
<button className={clsx('px-4 py-2', active ? 'bg-blue-600' : 'bg-gray-800')}>
```

### 2. 애니메이션 성능

GPU 가속 속성만 사용합니다.

```tsx
// ✅ Good: GPU-accelerated
className="transform transition-transform duration-150 hover:scale-105"
className="transition-opacity duration-150 hover:opacity-80"

// ❌ Bad: CPU-heavy
className="transition-all duration-150 hover:w-64"  // width transition is slow
```

### 3. Purge 최적화

사용하지 않는 클래스는 프로덕션 빌드에서 제거됩니다. 동적 클래스명을 피하세요.

```tsx
// ✅ Good: Static class names
className="text-red-500"
className={error ? 'text-red-500' : 'text-gray-400'}

// ❌ Bad: Dynamic construction (won't be purged)
className={`text-${color}-500`}  // Avoid this!
```

---

## 피해야 할 패턴

### 1. 인라인 스타일 남용

```tsx
// ❌ Bad
<div style={{ display: 'flex', padding: '16px' }}>

// ✅ Good
<div className="flex p-4">
```

### 2. 불필요한 커스텀 CSS

```tsx
// ❌ Bad: Custom CSS for simple utilities
<style>
  .my-button {
    padding: 1rem;
    background: blue;
  }
</style>

// ✅ Good: Use Tailwind
<button className="p-4 bg-blue-600">
```

### 3. 중복된 클래스

```tsx
// ❌ Bad
<div className="text-white font-medium text-white">  // 중복된 text-white

// ✅ Good
<div className="text-white font-medium">
```

### 4. 과도한 중첩

```tsx
// ❌ Bad: Too many wrappers
<div className="flex">
  <div className="w-full">
    <div className="p-4">
      <p>Content</p>
    </div>
  </div>
</div>

// ✅ Good: Minimal structure
<div className="flex w-full p-4">
  <p>Content</p>
</div>
```

### 5. !important 사용

Tailwind에서는 `!` 접두사로 `!important`를 추가할 수 있지만, 가능한 사용을 피합니다.

```tsx
// ❌ Bad
<div className="!text-red-500">  // Only use as last resort

// ✅ Good: Fix specificity issue instead
<div className="text-red-500">
```

---

## TypeScript Integration

재사용 가능한 스타일을 상수로 정의합니다.

```tsx
// src/styles/button-styles.ts
export const buttonStyles = {
  primary: `
    px-4 py-2.5 lg:px-3 lg:py-2
    bg-blue-600 hover:bg-blue-700 active:bg-blue-800
    text-white font-medium text-sm
    rounded-lg
    transition-colors duration-150
    focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none
    disabled:opacity-50 disabled:cursor-not-allowed
    min-h-[44px] lg:min-h-0
  `,
  secondary: `
    px-4 py-2.5 lg:px-3 lg:py-2
    bg-gray-800 hover:bg-gray-700 active:bg-gray-750
    text-white font-medium text-sm
    border border-gray-700
    rounded-lg
    transition-colors duration-150
    focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:outline-none
    disabled:opacity-50 disabled:cursor-not-allowed
    min-h-[44px] lg:min-h-0
  `,
} as const;

// Usage
import { buttonStyles } from '@/styles/button-styles';

<button className={buttonStyles.primary}>
  Click me
</button>
```

---

## 클래스 병합 유틸리티

조건부 클래스 관리를 위해 `clsx` 또는 `tailwind-merge` 사용을 권장합니다.

```tsx
import clsx from 'clsx';

<button className={clsx(
  'px-4 py-2 rounded-lg',
  isActive && 'bg-blue-600 text-white',
  !isActive && 'bg-gray-800 text-gray-400',
  isDisabled && 'opacity-50 cursor-not-allowed'
)}>
```

---

## 참고 자료

- [Tailwind CSS 공식 문서](https://tailwindcss.com/docs)
- [Tailwind UI Components](https://tailwindui.com)
- [Headless UI (Accessible components)](https://headlessui.com)

---

이 가이드는 Life Dashboard 프로젝트의 일관성을 유지하기 위한 기준입니다.
새로운 컴포넌트를 작성할 때는 이 패턴을 따르고,
더 나은 패턴을 발견하면 이 문서를 업데이트하세요.
