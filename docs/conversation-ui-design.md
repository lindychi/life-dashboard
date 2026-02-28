# Conversation Sessions UI/UX Design

**Life Dashboard - 대화 세션 인터페이스 설계**

## Overview

대화 세션 시스템을 위한 포괄적인 UI/UX 설계 문서입니다. 기존 MessagesPanel 컴포넌트의 디자인 패턴을 계승하면서 컨텍스트 기반 세션 관리 기능을 추가합니다.

## Design Principles

### 1. **Design Continuity (디자인 연속성)**
기존 Life Dashboard의 디자인 언어를 유지:
- Dark theme (bg-gray-900, gray-800/850 계열)
- Blue accent colors (blue-600, blue-500)
- Rounded corners (rounded-xl, rounded-2xl)
- Border styling (border-gray-700/50)
- Glassmorphism effects (backdrop-blur-sm)

### 2. **Progressive Disclosure (점진적 노출)**
정보를 단계적으로 표시:
- 세션 목록 → 세션 상세 → 메시지 히스토리
- 필터/검색은 접을 수 있는 형태로 제공
- 타입 선택기는 팝업 형태로 필요시에만 표시

### 3. **Context Awareness (컨텍스트 인식)**
세션별 컨텍스트를 시각적으로 구분:
- 프로젝트 연관 세션: 🚀 아이콘
- 목표 기반 세션: 🎯 아이콘
- 일반 대화: 기본 스타일

### 4. **Real-time Feedback (실시간 피드백)**
사용자 행동에 즉각 반응:
- Optimistic UI updates (메시지 전송 시 즉시 표시)
- 읽음 상태 자동 업데이트
- 참여자 온라인 상태 표시

## Component Architecture

```
ConversationsPanel (메인 컨테이너)
├── Left Sidebar (세션 목록)
│   ├── Header (제목 + 새 대화 버튼)
│   ├── SearchAndFilterBar (검색/필터)
│   │   ├── Search Input (검색창)
│   │   └── Status Filter Chips (상태 필터)
│   └── Conversation List (세션 목록)
│       └── ConversationListItem × N (세션 아이템)
│           ├── Avatar Stack (참여자 아바타)
│           ├── Conversation Info (제목, 참여자 수)
│           ├── Context Preview (컨텍스트 미리보기)
│           ├── Status Badge (진행중/완료/보관)
│           └── Unread Badge (읽지 않은 메시지 수)
│
├── Right Panel (메시지 영역)
│   ├── Chat Header (대화 헤더)
│   │   ├── Conversation Title (세션 제목)
│   │   ├── Participant Count (참여자 수)
│   │   ├── Status Indicator (상태 표시)
│   │   └── Refresh Button (새로고침)
│   ├── Messages Area (메시지 목록)
│   │   ├── DateSeparator × N (날짜 구분선)
│   │   └── MessageBubble × N (메시지 버블)
│   │       ├── Avatar (발신자 아바타)
│   │       ├── Sender Name (발신자 이름)
│   │       ├── Type Label (메시지 타입)
│   │       ├── Content (Markdown 렌더링)
│   │       └── Timestamp (시간)
│   └── Input Area (입력 영역)
│       ├── Type Selector (타입 선택기)
│       ├── Type Toggle Button (타입 토글)
│       ├── Message Input (메시지 입력)
│       └── Send Button (전송 버튼)
│
└── Modals (모달)
    └── NewConversationModal (새 대화 생성)
        ├── Title Input (제목 입력)
        ├── Goal Input (목표 입력)
        ├── Participant Selector (참여자 선택)
        └── Create Button (생성 버튼)
```

## Key Features

### 1. Session List (세션 목록)

**Layout:**
- 좌측 사이드바 (md:w-80)
- 스크롤 가능한 목록 (scrollbar-thin)
- 고정 헤더 + 검색/필터 영역

**Session List Item:**
```tsx
┌─────────────────────────────────────┐
│ 👤👤  Project Alpha Planning    2분전 │
│ +2   3명 참여 • 🚀 프로젝트 관련      │
│      ● 진행중                      3 │
└─────────────────────────────────────┘
```

**Visual Elements:**
- **Avatar Stack**: 최대 3개 아바타 표시, 초과 시 "+N" 표시
- **Status Dot**: 세션 상태 (green=진행중, gray=완료/보관)
- **Unread Badge**: 파란색 배지로 읽지 않은 메시지 수 표시
- **Context Preview**: 컨텍스트 기반 아이콘 + 텍스트
- **Status Badge**: 상태별 색상 구분 (진행중/완료/보관됨)

**Interaction:**
- 클릭 시 해당 세션으로 전환
- 선택된 세션은 파란색 하이라이트 (bg-blue-600/15)
- 호버 시 배경색 변경 (hover:bg-gray-700/30)

### 2. Search and Filter (검색 및 필터)

**Search Bar:**
```tsx
┌────────────────────────────────────┐
│ 🔍 대화 검색...               ✕   │
└────────────────────────────────────┘
```
- 실시간 필터링 (제목, 참여자 이름)
- Clear 버튼 (검색어 있을 때만 표시)

**Status Filter Chips:**
```tsx
┌──────────────────────────────────────┐
│ [전체] [● 진행중] [✓ 완료] [📦 보관됨] │
└──────────────────────────────────────┘
```
- 단일 선택 필터
- 선택된 필터는 색상 강조

### 3. Message Bubbles (메시지 버블)

**Message Types:**

1. **Text (일반 텍스트)**
   - 기본 스타일
   - User: bg-blue-600/90
   - Agent: bg-gray-700/80

2. **Task (작업)**
   - 📋 TASK 라벨
   - User: bg-blue-600
   - Agent: bg-blue-500/10

3. **Result (결과)**
   - ✅ RESULT 라벨
   - User: bg-emerald-600
   - Agent: bg-emerald-500/10

4. **Question (질문)**
   - ❓ QUESTION 라벨
   - User: bg-amber-600
   - Agent: bg-amber-500/10

5. **Answer (답변)**
   - 💬 ANSWER 라벨
   - User: bg-violet-600
   - Agent: bg-violet-500/10

6. **System (시스템)**
   - ⚙️ SYSTEM 라벨
   - User: bg-gray-600
   - Agent: bg-gray-600/10

**Bubble Layout:**
```tsx
User Message (오른쪽 정렬):
                    ┌────────────────┐
                    │ 👤             │
                    │ Message content│
                    │ 14:23          │
                    └────────────────┘

Agent Message (왼쪽 정렬):
┌────────────────┐
│ 🤖             │
│ Agent Name     │
│ Message content│
│ 14:23          │
└────────────────┘
```

**Consecutive Messages:**
- 같은 발신자의 연속 메시지는 아바타/이름 생략
- 2분 이내 메시지만 연속으로 처리
- 날짜 구분선이 있으면 연속 처리 해제

### 4. Date Separators (날짜 구분선)

```tsx
──────────  오늘  ──────────
──────────  어제  ──────────
───── 2024년 2월 27일 (화) ─────
```

- 날짜가 바뀔 때마다 표시
- 오늘/어제는 한글로, 그 외는 전체 날짜
- 회색 라인 + 중앙 텍스트

### 5. Input Area (입력 영역)

**Layout:**
```tsx
┌───────────────────────────────────────┐
│ ┌─────────────────────────────────┐  │
│ │ [+] 📋 TASK  메시지 입력...  [→] │  │
│ └─────────────────────────────────┘  │
│ Enter 전송  Shift+Enter 줄바꿈       │
└───────────────────────────────────────┘
```

**Type Selector (타입 선택기):**
- 플로팅 팝업 형태
- 6가지 타입 선택 가능
- 아이콘 + 레이블로 구분
- 선택 시 자동 닫힘

**Message Input:**
- Auto-resizing textarea (최대 120px)
- Enter: 전송
- Shift+Enter: 줄바꿈
- 문자 수 카운터 (1000자 초과 시 경고색)

### 6. New Conversation Modal (새 대화 생성 모달)

```tsx
┌──────────────────────────────────┐
│ 새 대화 세션                  ✕ │
├──────────────────────────────────┤
│                                  │
│ 대화 제목 *                      │
│ ┌──────────────────────────────┐ │
│ │ 예: 프로젝트 알파 기획       │ │
│ └──────────────────────────────┘ │
│                                  │
│ 목표 (선택)                      │
│ ┌──────────────────────────────┐ │
│ │ 예: 시스템 아키텍처 설계     │ │
│ └──────────────────────────────┘ │
│                                  │
│ 참여자 선택 * (최소 2명)         │
│ ┌──────────────────────────────┐ │
│ │ ✓ 👤 User (나)               │ │
│ │ ☐ 🤖 Dev Agent               │ │
│ │ ☐ 🎨 Designer Agent          │ │
│ └──────────────────────────────┘ │
│ 선택된 참여자: 3명               │
│                                  │
│ [취소]              [생성]       │
└──────────────────────────────────┘
```

**Features:**
- 필수 필드: 제목, 참여자 (최소 2명)
- 선택 필드: 목표, 기타 컨텍스트
- 현재 사용자는 자동 포함 (제거 불가)
- 체크박스로 다중 선택
- 실시간 참여자 수 표시

### 7. Empty States (빈 상태)

**No Conversations (세션 없음):**
```tsx
        ╔═══════════╗
        ║    💬     ║
        ╚═══════════╝
      대화 세션 없음
  새 대화를 시작하려면
    + 버튼을 클릭하세요
```

**No Conversation Selected (미선택):**
```tsx
        ╔═══════════╗
        ║    💬     ║
        ╚═══════════╝
     대화를 선택하세요
   왼쪽에서 대화를 선택하거나
   새로운 대화를 시작하세요
```

**No Messages (메시지 없음):**
```tsx
        ┌───────────┐
        │    👋     │
        └───────────┘
   Project Alpha의 첫 메시지
   아래에서 첫 메시지를 보내보세요
```

## Responsive Design

### Desktop (md: 768px+)
- 좌우 분할 레이아웃
- 세션 목록: 320px 고정 너비
- 메시지 영역: 나머지 공간 차지
- 모든 요소 동시 표시

### Mobile (< 768px)
- 세션 목록과 메시지 영역 교대로 표시
- 세션 선택 시 메시지 영역으로 전환
- 뒤로가기 버튼으로 목록 복귀
- 최대 높이 조정 (max-h-[500px])

## Color Palette

### Backgrounds
- **Primary Background**: `bg-gray-900`
- **Secondary Background**: `bg-gray-850`
- **Card Background**: `bg-gray-800`
- **Hover Background**: `bg-gray-700/30`
- **Selected Background**: `bg-blue-600/15`

### Text
- **Primary Text**: `text-white`
- **Secondary Text**: `text-gray-300`
- **Tertiary Text**: `text-gray-500`
- **Disabled Text**: `text-gray-600`

### Accents
- **Primary Accent**: `bg-blue-600`, `text-blue-400`
- **Success**: `bg-green-500`, `text-green-400`
- **Warning**: `bg-amber-500`, `text-amber-400`
- **Error**: `bg-red-500`, `text-red-400`
- **Info**: `bg-violet-500`, `text-violet-400`

### Borders
- **Default Border**: `border-gray-700/50`
- **Focus Border**: `border-blue-500/50`
- **Selected Border**: `border-blue-500`

## Typography

### Font Sizes
- **Large Title**: `text-lg` (18px)
- **Title**: `text-base` (16px)
- **Body**: `text-sm` (14px)
- **Caption**: `text-xs` (12px)
- **Micro**: `text-[11px]`
- **Tiny**: `text-[10px]`

### Font Weights
- **Bold**: `font-bold` (700)
- **Semibold**: `font-semibold` (600)
- **Medium**: `font-medium` (500)
- **Regular**: `font-normal` (400)

## Animation & Transitions

### Hover Effects
```tsx
transition-colors duration-150
hover:bg-gray-700/30
hover:text-white
```

### Focus States
```tsx
focus-visible:ring-2
focus-visible:ring-blue-500
focus-visible:outline-none
```

### Smooth Scrolling
```tsx
scroll-behavior: smooth
scrollbar-thin
scrollbar-track-transparent
scrollbar-thumb-gray-700
```

### Fade In
```tsx
animate-in fade-in slide-in-from-bottom-2 duration-150
```

## Accessibility

### Keyboard Navigation
- Tab 키로 포커스 이동
- Enter/Space로 선택
- Escape로 모달 닫기
- 모든 인터랙티브 요소에 focus-visible 스타일

### Screen Readers
- Semantic HTML 사용 (button, form, input)
- aria-selected, role="tab" 속성
- title 속성으로 추가 컨텍스트 제공

### Color Contrast
- WCAG AA 기준 준수
- 텍스트와 배경 대비 최소 4.5:1
- 인터랙티브 요소 대비 최소 3:1

## Performance Optimizations

### 1. Optimistic UI Updates
메시지 전송 시 서버 응답 전 즉시 UI 업데이트:
```typescript
// 1. Optimistic message 즉시 표시
const optimisticMsg = { id: 'optimistic-...', ... };
setMessages(prev => [...prev, optimisticMsg]);

// 2. 서버 전송
const response = await fetch('/api/...');

// 3. 실제 메시지로 교체
setMessages(prev => prev.map(m =>
  m.id === optimisticMsg.id ? response.message : m
));
```

### 2. Memoization
- `useMemo`로 필터링된 세션 목록 캐싱
- `useCallback`로 이벤트 핸들러 안정화
- 불필요한 리렌더링 방지

### 3. Lazy Loading
- 메시지 목록 페이지네이션 (limit=100)
- 세션 통계는 필요시에만 로드
- 무한 스크롤 지원 가능

### 4. Debouncing
- 검색 입력 디바운싱 (300ms)
- 스크롤 이벤트 쓰로틀링

## Integration Points

### API Endpoints
```typescript
// Conversations
GET    /api/conversations                    // 목록 조회
POST   /api/conversations                    // 생성
GET    /api/conversations/[id]               // 상세 조회
PATCH  /api/conversations/[id]               // 업데이트
DELETE /api/conversations/[id]               // 삭제

// Messages
GET    /api/conversations/[id]/messages      // 메시지 목록
POST   /api/conversations/[id]/messages      // 메시지 전송

// Read Status
POST   /api/conversations/[id]/read-status   // 읽음 처리
```

### State Management
```typescript
// Local State (useState)
- conversations: ConversationStats[]
- selectedConversationId: string | null
- messages: ConversationMessage[]
- messageInput: string
- messageType: ConversationMessageType
- searchQuery: string
- statusFilter: ConversationStatus | "all"

// Refs (useRef)
- messagesEndRef: 자동 스크롤 타겟
- messagesContainerRef: 스크롤 컨테이너
- typeSelectorRef: 외부 클릭 감지
```

### SSE Real-time Updates (Future)
```typescript
// 실시간 업데이트 이벤트
conversation:created      // 새 세션 생성
conversation:updated      // 세션 정보 변경
conversation:message:new  // 새 메시지 수신
conversation:read:update  // 읽음 상태 변경
```

## Usage Example

```tsx
import ConversationsPanel from "@/components/ConversationsPanel";

export default function ConversationsTab() {
  const agentMap = {
    "user": { emoji: "👤", name: "User" },
    "dev-agent": { emoji: "🤖", name: "Dev Agent" },
    "pm-agent": { emoji: "📋", name: "PM Agent" },
  };

  return (
    <ConversationsPanel
      currentUserId="user"
      agentMap={agentMap}
    />
  );
}
```

## Future Enhancements

### Phase 2
- [ ] 메시지 검색 (전체 텍스트 검색)
- [ ] 파일 첨부 기능 연동
- [ ] 메시지 반응/이모지
- [ ] 메시지 스레딩 UI (답장 시각화)

### Phase 3
- [ ] SSE 실시간 동기화
- [ ] 음성 메시지 지원
- [ ] 코드 블록 syntax highlighting
- [ ] 메시지 편집/삭제

### Phase 4
- [ ] 세션 템플릿 (프로젝트 기획, 코드 리뷰 등)
- [ ] AI 요약 (세션 요약, 결정 사항 추출)
- [ ] Export (Markdown, PDF)
- [ ] 세션 브랜치/포크

## Testing Checklist

### Functional Testing
- [ ] 세션 생성 (제목, 참여자, 컨텍스트)
- [ ] 세션 목록 조회 (필터, 검색)
- [ ] 세션 선택 및 전환
- [ ] 메시지 전송 (각 타입별)
- [ ] 메시지 수신 및 표시
- [ ] 읽음 상태 자동 업데이트
- [ ] 날짜 구분선 표시
- [ ] Optimistic UI 동작

### UI/UX Testing
- [ ] 반응형 레이아웃 (모바일/데스크톱)
- [ ] 키보드 네비게이션
- [ ] 포커스 관리
- [ ] 스크롤 동작 (자동 스크롤)
- [ ] 호버 효과
- [ ] 애니메이션 부드러움

### Edge Cases
- [ ] 빈 세션 목록
- [ ] 빈 메시지 목록
- [ ] 긴 제목/메시지 처리
- [ ] 다수 참여자 (10명+)
- [ ] 네트워크 오류 처리
- [ ] 동시 메시지 전송

## Changelog

### v1.0.0 (2024-02-28)
- Initial design document
- Complete UI/UX specification
- ConversationsPanel component implementation
- Integration with existing conversation system
