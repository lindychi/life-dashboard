# Conversation UI Visual Guide

**Life Dashboard - 대화 세션 UI 시각적 가이드**

## 🎨 Component Layout

### Full Interface Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ LifeDashboard                                    user@example.com  [로그아웃] │
│ 2024년 2월 28일 수요일                                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│ [🤖 Agents] [🚀 Projects] [💰 Finance] [💬 Messages] [💬 Conversations] [⏰ Cron] │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────┬───────────────────────────────────────────────────┐ │
│  │ Conversations      │  Project Alpha Planning                           │ │
│  │           [+ New]  │  👤🤖📋 5명 참여 • ● 진행중          [Refresh 🔄] │ │
│  ├────────────────────┼───────────────────────────────────────────────────┤ │
│  │ [🔍 대화 검색...]  │                                                   │ │
│  │                    │  ──────────  오늘  ──────────                     │ │
│  │ [전체] [●진행중]   │                                                   │ │
│  │ [✓완료] [📦보관됨] │  ┌─────────────────────────┐                     │ │
│  ├────────────────────┤  │ 👤                       │                     │ │
│  │ ┌────────────────┐ │  │ User                     │                     │ │
│  │ │ 👤🤖📋         │ │  │ 프로젝트 시작합니다      │                     │ │
│  │ │ +2  Project A  │ │  │ 10:30                    │                     │ │
│  │ │ 5명•🚀진행중  3 │ │  └─────────────────────────┘                     │ │
│  │ └────────────────┘ │                                                   │ │
│  │ ┌────────────────┐ │  ┌─────────────────────────┐                     │ │
│  │ │ 👤🤖           │ │  │                      🤖 │                     │ │
│  │ │ Bug Fix #123   │ │  │              Dev Agent  │                     │ │
│  │ │ 2명•✓완료       │ │  │        알겠습니다!       │                     │ │
│  │ └────────────────┘ │  │                   10:31 │                     │ │
│  │ ┌────────────────┐ │  └─────────────────────────┘                     │ │
│  │ │ 👤🎨           │ │                                                   │ │
│  │ │ Design Review  │ │  ┌─────────────────────────┐                     │ │
│  │ │ 2명•📦보관됨    │ │  │ 👤                       │                     │ │
│  │ └────────────────┘ │  │ User                     │                     │ │
│  │                    │  │ 📋 TASK                  │                     │ │
│  │                    │  │ 인증 API 구현해주세요    │                     │ │
│  │                    │  │ 10:32                    │                     │ │
│  │                    │  └─────────────────────────┘                     │ │
│  │                    │                                                   │ │
│  │                    ├───────────────────────────────────────────────────┤ │
│  │                    │ [+] 📋 TASK  [메시지 입력...]            [→]    │ │
│  │                    │ Enter 전송  Shift+Enter 줄바꿈                    │ │
│  └────────────────────┴───────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 📱 Mobile Layout

### Portrait Mode - Conversation List

```
┌────────────────────────────┐
│ LifeDashboard              │
│ 2024년 2월 28일 수요일      │
├────────────────────────────┤
│ [💬 Conversations] [+ New] │
├────────────────────────────┤
│ [🔍 대화 검색...]          │
│ [전체] [●진행중] [✓완료]   │
├────────────────────────────┤
│ ┌────────────────────────┐ │
│ │ 👤🤖📋 +2               │ │
│ │ Project Alpha Planning │ │
│ │ 5명 참여 • 🚀프로젝트  │ │
│ │ ● 진행중          2분전│ │
│ │ 15 messages         3  │ │
│ └────────────────────────┘ │
│ ┌────────────────────────┐ │
│ │ 👤🤖                   │ │
│ │ Bug Fix #123           │ │
│ │ 2명 참여               │ │
│ │ ✓ 완료            1시간│ │
│ │ 8 messages             │ │
│ └────────────────────────┘ │
│ ┌────────────────────────┐ │
│ │ 👤🎨                   │ │
│ │ Design Review          │ │
│ │ 2명 참여               │ │
│ │ 📦 보관됨         3일전│ │
│ │ 42 messages            │ │
│ └────────────────────────┘ │
│                            │
└────────────────────────────┘
```

### Portrait Mode - Message View

```
┌────────────────────────────┐
│ [←] Project Alpha Planning │
│ 👤🤖📋 5명 참여 • ● 진행중  │
│                      [🔄]  │
├────────────────────────────┤
│                            │
│ ───────  오늘  ───────    │
│                            │
│ ┌────────────────────────┐ │
│ │ 👤 User                 │ │
│ │ 프로젝트 시작합니다    │ │
│ │ 10:30                  │ │
│ └────────────────────────┘ │
│                            │
│ ┌────────────────────────┐ │
│ │              Dev Agent │ │
│ │           알겠습니다!  │ │
│ │                  10:31 │ │
│ └────────────────────────┘ │
│                            │
│ ┌────────────────────────┐ │
│ │ 👤 User                 │ │
│ │ 📋 TASK                 │ │
│ │ 인증 API 구현해주세요  │ │
│ │ 10:32                  │ │
│ └────────────────────────┘ │
│                            │
├────────────────────────────┤
│ [+] [메시지 입력...] [→]  │
│ Enter 전송 Shift+Enter 줄  │
└────────────────────────────┘
```

## 🎭 Component States

### Empty States

#### No Conversations
```
        ╔═════════════════╗
        ║                 ║
        ║      ╭───╮      ║
        ║      │💬 │      ║
        ║      ╰───╯      ║
        ║                 ║
        ║  대화 세션 없음  ║
        ║                 ║
        ║  새 대화를       ║
        ║  시작하려면      ║
        ║  + 버튼을        ║
        ║  클릭하세요      ║
        ║                 ║
        ╚═════════════════╝
```

#### No Conversation Selected
```
        ╔═════════════════╗
        ║                 ║
        ║      ╭───╮      ║
        ║      │💬 │      ║
        ║      ╰───╯      ║
        ║                 ║
        ║  대화를          ║
        ║  선택하세요      ║
        ║                 ║
        ║  왼쪽에서        ║
        ║  대화를 선택하거나║
        ║  새로운 대화를    ║
        ║  시작하세요      ║
        ║                 ║
        ╚═════════════════╝
```

#### No Messages
```
        ╔═════════════════╗
        ║                 ║
        ║    ┌─────┐      ║
        ║    │ 👋  │      ║
        ║    └─────┘      ║
        ║                 ║
        ║  Project Alpha의 ║
        ║  첫 메시지       ║
        ║                 ║
        ║  아래에서        ║
        ║  첫 메시지를     ║
        ║  보내보세요      ║
        ║                 ║
        ╚═════════════════╝
```

### Loading States

```
┌────────────────────────┐
│ Conversations          │
│           [+ New]      │
├────────────────────────┤
│                        │
│    ⟳  Loading...       │
│                        │
└────────────────────────┘
```

## 💬 Message Type Examples

### 1. Text (일반 텍스트)

```
User:
                    ┌──────────────────────┐
                    │ 👤                    │
                    │ 프로젝트 진행 상황   │
                    │ 공유드립니다.        │
                    │ 14:30                │
                    └──────────────────────┘

Agent:
┌──────────────────────┐
│ 🤖                    │
│ Dev Agent             │
│ 네, 확인했습니다.     │
│ 14:31                │
└──────────────────────┘
```

### 2. Task (작업)

```
User:
                    ┌──────────────────────┐
                    │ 👤                    │
                    │ 📋 TASK               │
                    │ 사용자 인증 API       │
                    │ 엔드포인트 구현       │
                    │ - JWT 토큰 발급       │
                    │ - 세션 관리           │
                    │ 14:30                │
                    └──────────────────────┘

Agent:
┌──────────────────────┐
│ 🤖                    │
│ Dev Agent             │
│ 📋 TASK               │
│ 작업 시작하겠습니다.  │
│ 14:32                │
└──────────────────────┘
```

### 3. Result (결과)

```
Agent:
┌──────────────────────┐
│ 🤖                    │
│ Dev Agent             │
│ ✅ RESULT             │
│ 인증 API 구현 완료    │
│ - 모든 테스트 통과    │
│ - 배포 준비 완료      │
│ 16:45                │
└──────────────────────┘
```

### 4. Question (질문)

```
User:
                    ┌──────────────────────┐
                    │ 👤                    │
                    │ ❓ QUESTION           │
                    │ PostgreSQL과 MySQL    │
                    │ 중 어느 것을          │
                    │ 사용할까요?           │
                    │ 14:30                │
                    └──────────────────────┘
```

### 5. Answer (답변)

```
Agent:
┌──────────────────────┐
│ 🤖                    │
│ Architect Agent       │
│ 💬 ANSWER             │
│ PostgreSQL을          │
│ 추천합니다:           │
│ - JSONB 지원          │
│ - 강력한 ACID         │
│ - 우수한 확장성       │
│ 14:35                │
└──────────────────────┘
```

### 6. System (시스템)

```
┌──────────────────────┐
│ ⚙️                    │
│ System                │
│ ⚙️ SYSTEM             │
│ 프로젝트 상태가       │
│ "구현 중"으로         │
│ 변경되었습니다.       │
│ 14:40                │
└──────────────────────┘
```

## 🎨 Status Indicators

### Conversation Status Badges

```
● 진행중      [green background, green text]
✓ 완료        [blue background, blue text]
📦 보관됨     [gray background, gray text]
```

### Visual Examples

```
┌──────────────────────────┐
│ Project Planning         │
│ ● 진행중                 │  ← Active (green)
└──────────────────────────┘

┌──────────────────────────┐
│ Bug Fix #123             │
│ ✓ 완료                   │  ← Completed (blue)
└──────────────────────────┘

┌──────────────────────────┐
│ Design Review            │
│ 📦 보관됨                │  ← Archived (gray)
└──────────────────────────┘
```

## 👥 Participant Avatars

### Single Participant
```
┌─────┐
│ 👤  │  User only
└─────┘
```

### Two Participants
```
┌─────┬─────┐
│ 👤  │ 🤖  │  User + Agent
└─────┴─────┘
```

### Three Participants
```
┌─────┬─────┬─────┐
│ 👤  │ 🤖  │ 📋  │  User + Dev + PM
└─────┴─────┴─────┘
```

### Many Participants (Stack)
```
  ┌─────┐
  │ 👤  │
┌─┴───┬─┴─┐
│ 🤖  │+3 │  User + Dev + 3 more
└─────┴───┘
```

## 🔍 Search and Filter

### Search Active
```
┌────────────────────────────────┐
│ 🔍 project                  ✕ │  ← Search input with clear
├────────────────────────────────┤
│ Results: 3 conversations       │
│                                │
│ ┌────────────────────────────┐ │
│ │ 👤🤖 Project Alpha         │ │
│ └────────────────────────────┘ │
│ ┌────────────────────────────┐ │
│ │ 👤🎨 Project Design        │ │
│ └────────────────────────────┘ │
│ ┌────────────────────────────┐ │
│ │ 👤📋 Project Planning      │ │
│ └────────────────────────────┘ │
└────────────────────────────────┘
```

### Filters Active
```
┌────────────────────────────────┐
│ [전체] [● 진행중] [✓완료] [📦] │  ← Status filters
│          ^^^^^^^^              │  ← Selected
├────────────────────────────────┤
│ Active conversations only      │
│                                │
│ ┌────────────────────────────┐ │
│ │ 👤🤖 Project Alpha         │ │
│ │ ● 진행중                   │ │
│ └────────────────────────────┘ │
│ ┌────────────────────────────┐ │
│ │ 👤📋 Daily Standup         │ │
│ │ ● 진행중                   │ │
│ └────────────────────────────┘ │
└────────────────────────────────┘
```

## 📝 Input Area States

### Default State
```
┌──────────────────────────────────────┐
│ [+] [메시지를 입력하세요...]    [→] │
│ Enter 전송  Shift+Enter 줄바꿈       │
└──────────────────────────────────────┘
```

### Type Selector Open
```
┌──────────────────────────────────────┐
│ ┌──────────────────────────────────┐ │
│ │ [📝 Text] [📋 Task] [✅ Result]  │ │
│ │ [❓ Question] [💬 Answer] [⚙️ Sys]│ │
│ └──────────────────────────────────┘ │
│ [+] 📋 TASK  [구현해주세요...]  [→] │
│ Enter 전송  Shift+Enter 줄바꿈       │
└──────────────────────────────────────┘
```

### With Content
```
┌──────────────────────────────────────┐
│ [+] [인증 API를 구현해주세요]   [→] │
│ Enter 전송  Shift+Enter 줄바꿈    24 │  ← Character count
└──────────────────────────────────────┘
```

### Sending State
```
┌──────────────────────────────────────┐
│ [+] [                         ] [⟳] │  ← Sending indicator
│ Enter 전송  Shift+Enter 줄바꿈       │
└──────────────────────────────────────┘
```

### Disabled (Archived)
```
┌──────────────────────────────────────┐
│ [+] [                         ] [→] │  ← Grayed out
│ This conversation is archived.       │
│ Set status to "active" to send.      │
└──────────────────────────────────────┘
```

## 🔔 Notification Badges

### Unread Count Badges

```
Small (1-9):
┌────┐
│  3 │  Blue badge, white text
└────┘

Medium (10-99):
┌────┐
│ 42 │
└────┘

Large (100+):
┌────┐
│99+ │
└────┘
```

### Conversation List with Badges

```
┌────────────────────────────┐
│ 👤🤖 Project Alpha         │
│ 5명 참여 • ● 진행중    [3] │  ← Badge
└────────────────────────────┘

┌────────────────────────────┐
│ 👤📋 Daily Meeting         │
│ 3명 참여 • ● 진행중   [12] │
└────────────────────────────┘

┌────────────────────────────┐
│ 👤🎨 Design Sprint         │
│ 4명 참여 • ● 진행중  [99+] │
└────────────────────────────┘
```

## 📅 Date Separators

### Today
```
────────────  오늘  ────────────
```

### Yesterday
```
────────────  어제  ────────────
```

### Specific Date
```
──── 2024년 2월 27일 (화) ────
```

### Multiple Separators
```
Messages:

────────────  2월 26일 (월)  ────────────
│ Message 1...
│ Message 2...

────────────  어제  ────────────
│ Message 3...
│ Message 4...

────────────  오늘  ────────────
│ Message 5...
│ Message 6...
```

## 🎯 Context Indicators

### Project-linked
```
┌────────────────────────────┐
│ 👤🤖 System Architecture   │
│ 3명 참여 • 🚀 프로젝트     │  ← Rocket icon
│ ● 진행중                   │
└────────────────────────────┘
```

### Goal-driven
```
┌────────────────────────────┐
│ 👤📋 Q1 Planning           │
│ 5명 참여 • 🎯 목표 기반    │  ← Target icon
│ ● 진행중                   │
└────────────────────────────┘
```

### Generic
```
┌────────────────────────────┐
│ 👤🤖 General Discussion    │
│ 2명 참여                   │  ← No special icon
│ ● 진행중                   │
└────────────────────────────┘
```

## 🎭 Modal Dialogs

### New Conversation Modal

```
┌──────────────────────────────────────┐
│ 새 대화 세션                      ✕ │
├──────────────────────────────────────┤
│                                      │
│ 대화 제목 *                          │
│ ┌──────────────────────────────────┐ │
│ │ 프로젝트 알파 기획               │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 목표 (선택)                          │
│ ┌──────────────────────────────────┐ │
│ │ 시스템 아키텍처 설계             │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 참여자 선택 * (최소 2명)             │
│ ┌──────────────────────────────────┐ │
│ │ ✓ 👤 User (나)                   │ │
│ │ ✓ 🤖 Dev Agent                   │ │
│ │ ☐ 📋 PM Agent                    │ │
│ │ ✓ 🎨 Designer Agent              │ │
│ │ ☐ 🧪 QA Agent                    │ │
│ └──────────────────────────────────┘ │
│ 선택된 참여자: 3명                   │
│                                      │
│         [취소]        [생성]         │
└──────────────────────────────────────┘
```

## 🎨 Color Coding

### Message Bubble Colors

```
User Messages (Right-aligned):
┌──────────────┐
│ Blue         │  bg-blue-600/90
└──────────────┘

Agent Messages (Left-aligned):
┌──────────────┐
│ Gray         │  bg-gray-700/80
└──────────────┘

Task Messages:
┌──────────────┐
│ Light Blue   │  bg-blue-500/10 (agent)
└──────────────┘

Result Messages:
┌──────────────┐
│ Green        │  bg-emerald-500/10 (agent)
└──────────────┘

Question Messages:
┌──────────────┐
│ Amber        │  bg-amber-500/10 (agent)
└──────────────┘

Answer Messages:
┌──────────────┐
│ Violet       │  bg-violet-500/10 (agent)
└──────────────┘

System Messages:
┌──────────────┐
│ Dark Gray    │  bg-gray-600/10 (agent)
└──────────────┘
```

## 📏 Spacing and Sizing

### Message Spacing

```
Consecutive messages (same sender, <2min):
┌──────────────┐
│ Message 1    │  ← 0.5px gap (mt-0.5)
┌──────────────┐
│ Message 2    │
└──────────────┘

Non-consecutive messages:
┌──────────────┐
│ Message 1    │
                   ← 12px gap (mt-3)
┌──────────────┐
│ Message 2    │
└──────────────┘
```

### Avatar Sizes

```
Small (List):  24px × 24px  (w-6 h-6)
Medium (Chat): 32px × 32px  (w-8 h-8)
Large (Header): 40px × 40px  (w-10 h-10)
```

### Corner Radius

```
Small:  4px   (rounded)
Medium: 8px   (rounded-lg)
Large:  12px  (rounded-xl)
XLarge: 16px  (rounded-2xl)
Full:   50%   (rounded-full)
```

## 🎬 Animation Examples

### Hover State Transition

```
Before hover:
┌────────────────────────────┐
│ Conversation Item          │  bg-transparent
└────────────────────────────┘

During hover:
┌────────────────────────────┐
│ Conversation Item          │  bg-gray-700/30
└────────────────────────────┘  transition-colors
```

### Selected State

```
Unselected:
┌─────────────────────────────┐
│ Conversation Item           │  bg-transparent
└─────────────────────────────┘  border-l-transparent

Selected:
┌╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍╍┐
│ Conversation Item           │  bg-blue-600/15
└─────────────────────────────┘  border-l-blue-500 (2px)
```

### Fade In Animation

```
Frame 1 (opacity: 0):
┌────────────────┐
│                │  (invisible)
└────────────────┘

Frame 2 (opacity: 0.5):
┌────────────────┐
│ Message...     │  (fading in)
└────────────────┘

Frame 3 (opacity: 1):
┌────────────────┐
│ Message Text   │  (fully visible)
└────────────────┘
```

## 🎯 Focus States

### Keyboard Focus

```
No focus:
┌────────────────────────────┐
│ Button                     │
└────────────────────────────┘

Focused:
╔════════════════════════════╗
║ Button                     ║  ring-2 ring-blue-500
╚════════════════════════════╝
```

### Input Focus

```
No focus:
┌────────────────────────────┐
│ Type message...            │  border-gray-600/50
└────────────────────────────┘

Focused:
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Type message...            ┃  border-blue-500/50
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

---

## 📚 Legend

```
Symbols:
─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼    Standard borders
═ ║ ╔ ╗ ╚ ╝ ╠ ╣ ╦ ╩ ╬    Focus borders
╍ ╎                        Selected borders
🔍                         Search icon
✕                         Close icon
🔄                         Refresh icon
[→]                        Send button
[+]                        Add/Type button
[✓]                        Checkbox checked
[☐]                        Checkbox unchecked

Colors (described):
Blue    - Primary actions, user messages
Green   - Active status, success, results
Amber   - Warning, questions
Red     - Errors, urgent notifications
Violet  - Answers, info
Gray    - Neutral, system, archived

Emojis:
👤 User
🤖 Dev Agent
📋 PM Agent
🎨 Designer Agent
🧪 QA Agent
🚀 Project context
🎯 Goal context
● Active status
✓ Completed status
📦 Archived status
```

---

**End of Visual Guide**

For interactive demonstrations, run the component in your development environment.
For detailed specifications, see `conversation-ui-design.md`.
