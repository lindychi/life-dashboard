# Conversation UI Usage Guide

**Life Dashboard - 대화 세션 UI 사용 가이드**

## Quick Start

### 1. Import Component

```tsx
import ConversationsPanel from "@/components/ConversationsPanel";
```

### 2. Prepare Agent Map

```tsx
const agentMap = {
  "user": { emoji: "👤", name: "User" },
  "dev-agent": { emoji: "🤖", name: "Dev Agent" },
  "pm-agent": { emoji: "📋", name: "PM Agent" },
  "designer-agent": { emoji: "🎨", name: "Designer Agent" },
  "qa-agent": { emoji: "🧪", name: "QA Agent" },
};
```

### 3. Use Component

```tsx
export default function ConversationsTab() {
  return (
    <ConversationsPanel
      currentUserId="user"
      agentMap={agentMap}
    />
  );
}
```

## Integration with Main Page

### Add to Tab Navigation

```tsx
// src/app/page.tsx
export default function Home() {
  const [activeTab, setActiveTab] = useState<
    "agents" | "projects" | "finance" | "messages" | "conversations" | "cronjobs"
  >("agents");

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="border-b border-gray-800">
        {/* ... existing header ... */}

        <div className="flex gap-2 mt-4" role="tablist">
          {/* ... existing tabs ... */}

          <TabButton
            active={activeTab === "conversations"}
            onClick={() => setActiveTab("conversations")}
          >
            💬 Conversations
          </TabButton>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* ... existing tabs ... */}

        {activeTab === "conversations" && (
          <ConversationsPanel
            currentUserId="user"
            agentMap={agentMap}
          />
        )}
      </main>
    </div>
  );
}
```

## User Workflows

### Creating a New Conversation

1. **Click "+ New" Button**
   - Located in the top-right of the conversation list
   - Opens modal dialog

2. **Fill in Conversation Details**
   - **Title** (required): Short descriptive name
   - **Goal** (optional): Purpose or objective
   - **Participants** (required, min 2): Select agents to include

3. **Click "생성" (Create)**
   - Conversation appears in the list
   - Automatically selected and ready for messaging

**Example Use Cases:**
- "Project Alpha Planning" → 프로젝트 기획
- "Bug Investigation #123" → 버그 조사
- "Code Review Session" → 코드 리뷰
- "Architecture Design" → 아키텍처 설계

### Sending Messages

1. **Select Conversation**
   - Click on conversation in the left sidebar
   - Loads message history

2. **Choose Message Type** (optional)
   - Click "+" button to open type selector
   - Select: Text, Task, Result, Question, Answer, or System
   - Type badge appears when non-text selected

3. **Type Message**
   - Enter message in input field
   - Supports markdown formatting
   - Auto-resizing up to 120px

4. **Send**
   - Press Enter (or click send button)
   - Message appears immediately (optimistic UI)
   - Server confirms and updates

**Keyboard Shortcuts:**
- `Enter`: Send message
- `Shift+Enter`: New line
- `Esc`: Close type selector

### Filtering and Searching

**Status Filter:**
- **전체 (All)**: Show all conversations
- **● 진행중 (Active)**: Only active conversations
- **✓ 완료 (Completed)**: Only completed
- **📦 보관됨 (Archived)**: Only archived

**Search:**
- Type in search box
- Filters by:
  - Conversation title
  - Participant names
- Real-time filtering
- Click "×" to clear

### Managing Conversation Status

**Status Lifecycle:**
```
active → completed
   ↓
archived
```

**Change Status:**
1. Select conversation
2. Use status dropdown in header
3. Choose new status

**Status Meanings:**
- **Active**: Ongoing conversation, can send messages
- **Completed**: Conversation finished, goals achieved
- **Archived**: Historical record, read-only

## Advanced Features

### Message Types and Use Cases

#### 1. Text (일반 텍스트)
**When to use:** General discussion, comments, casual messages

**Example:**
```
안녕하세요! 프로젝트 진행 상황 공유드립니다.
```

#### 2. Task (작업)
**When to use:** Assigning work, creating action items

**Example:**
```
📋 TASK
사용자 인증 API 엔드포인트 구현
- JWT 토큰 발급
- 세션 관리
- 권한 검증
```

#### 3. Result (결과)
**When to use:** Reporting completion, sharing outcomes

**Example:**
```
✅ RESULT
인증 API 구현 완료
- 모든 테스트 통과
- 배포 준비 완료
```

#### 4. Question (질문)
**When to use:** Asking for information or clarification

**Example:**
```
❓ QUESTION
데이터베이스는 PostgreSQL과 MySQL 중 어느 것을 사용할까요?
성능과 확장성을 고려해주세요.
```

#### 5. Answer (답변)
**When to use:** Responding to questions

**Example:**
```
💬 ANSWER
PostgreSQL을 추천합니다.
- JSONB 지원으로 유연한 스키마
- 강력한 ACID 보장
- 우수한 확장성
```

#### 6. System (시스템)
**When to use:** Automated notifications, system events

**Example:**
```
⚙️ SYSTEM
프로젝트 상태가 "구현 중"으로 변경되었습니다.
변경자: PM Agent
시간: 2024-02-28 14:30
```

### Context-Based Sessions

**Project-Linked Conversations:**
```tsx
context: {
  projectId: "uuid",
  goal: "시스템 아키텍처 설계",
  deadline: "2024-12-31"
}
```
- Shows 🚀 icon in list
- Automatically linked to project
- Accessible from project view

**Goal-Driven Conversations:**
```tsx
context: {
  goal: "버그 #123 해결",
  priority: "high",
  assignee: "dev-agent"
}
```
- Shows 🎯 icon in list
- Tracks objective
- Measurable outcome

**Custom Context:**
```tsx
context: {
  sprint: "Sprint 24",
  epic: "User Authentication",
  tags: ["security", "api"]
}
```

### Multi-Agent Collaboration Patterns

#### 1. Sequential Handoff
**Pattern:** A → B → C
```
User asks question (Question)
  → Dev Agent analyzes (Answer)
    → Architect Agent reviews (Answer)
      → PM Agent approves (Result)
```

#### 2. Parallel Input
**Pattern:** User → [A, B, C] → User
```
User requests proposals (Question)
  → Dev Agent: Technical approach (Answer)
  → Designer: UI/UX approach (Answer)
  → PM: Business approach (Answer)
User makes decision (Result)
```

#### 3. Iterative Refinement
**Pattern:** User ↔ Agent × N
```
User: Initial requirement (Task)
Agent: Clarification questions (Question)
User: Additional details (Answer)
Agent: Proposal (Answer)
User: Feedback (Question)
Agent: Revised proposal (Answer)
User: Approval (Result)
```

## Best Practices

### Conversation Organization

**DO:**
- ✅ Create focused conversations per topic/project
- ✅ Use descriptive titles (e.g., "Auth System Design" not "Discussion")
- ✅ Include relevant participants only
- ✅ Update status when completed
- ✅ Archive old conversations regularly

**DON'T:**
- ❌ Mix unrelated topics in one conversation
- ❌ Add all agents to every conversation
- ❌ Leave completed conversations as "active"
- ❌ Delete important conversations (archive instead)

### Message Composition

**DO:**
- ✅ Use markdown for formatting (lists, code blocks, headings)
- ✅ Select appropriate message type
- ✅ Be specific and actionable
- ✅ Break long messages into paragraphs
- ✅ Use code blocks for code snippets

**DON'T:**
- ❌ Write walls of text without formatting
- ❌ Use "text" type for everything
- ❌ Be vague or ambiguous
- ❌ Include sensitive information in plain text

### Participant Selection

**Small Teams (2-3):**
- Focused discussions
- Quick decision-making
- Example: User + Dev Agent + Designer

**Medium Teams (4-6):**
- Cross-functional collaboration
- Balanced perspectives
- Example: User + Dev + Designer + QA + PM

**Large Teams (7+):**
- Major initiatives
- Stakeholder alignment
- Example: User + Full team + External consultants

## Troubleshooting

### Common Issues

#### Messages Not Appearing
**Symptom:** Sent message doesn't show up

**Solutions:**
1. Check conversation status (must be "active")
2. Refresh the page
3. Check network connection
4. Verify user is a participant

#### Can't Create Conversation
**Symptom:** Create button disabled or error message

**Solutions:**
1. Ensure title is filled
2. Select at least 2 participants
3. Check that current user is included
4. Verify all participant IDs are valid

#### Search Not Working
**Symptom:** No results despite matching conversations

**Solutions:**
1. Clear search and try again
2. Check spelling
3. Try searching participant name instead
4. Verify status filter isn't hiding results

#### Optimistic Message Stuck
**Symptom:** Message shows as "sending" forever

**Solutions:**
1. Check browser console for errors
2. Refresh the page
3. Message will disappear if send failed
4. Try sending again

## Performance Tips

### For Many Conversations (100+)

1. **Use Filters Actively**
   - Filter by status to reduce list size
   - Archive old conversations regularly
   - Search for specific conversations

2. **Limit Message History**
   - API loads last 100 messages by default
   - Pagination coming in future update

3. **Monitor Network**
   - Conversations fetch in parallel
   - Stats loaded on-demand per conversation

### For Real-Time Updates (Future)

When SSE is enabled:
- Conversations auto-update on changes
- New messages appear instantly
- Read status syncs across devices
- Reduced polling overhead

## Mobile Usage

### Touch Interactions

**Conversation List:**
- Tap to select conversation
- Swipe gestures (future feature)

**Message Area:**
- Tap to focus input
- Long press on message (future: context menu)

**Navigation:**
- Back button appears on mobile
- Tap to return to conversation list

### Screen Optimization

**Portrait Mode:**
- Full-width conversation list
- Switches to message view on selection
- Compact header

**Landscape Mode:**
- Split view (if screen width allows)
- More visible messages

## Accessibility

### Screen Readers

**Navigation:**
- "Conversations list" region
- "Conversation: [title]" buttons
- "Message from [sender]" labels

**Actions:**
- "New conversation button"
- "Send message button"
- "Filter by [status]"

### Keyboard-Only Navigation

1. `Tab` through conversations
2. `Enter` to select
3. `Tab` to message input
4. Type and `Enter` to send
5. `Shift+Tab` to navigate back

## Future Enhancements

### Planned Features

- [ ] Message threading (visual reply tree)
- [ ] File attachments
- [ ] Message reactions (emoji)
- [ ] Full-text search across messages
- [ ] Export conversations (Markdown/PDF)
- [ ] Voice messages
- [ ] Code syntax highlighting
- [ ] @mentions for participants
- [ ] Message editing/deletion
- [ ] Conversation templates
- [ ] AI summaries
- [ ] Read receipts
- [ ] Typing indicators

### Roadmap

**Q2 2024:**
- Message threading UI
- File attachments
- SSE real-time sync

**Q3 2024:**
- Full-text search
- Message reactions
- Export functionality

**Q4 2024:**
- AI summaries
- Templates
- Advanced analytics

## Support

### Getting Help

**Documentation:**
- Design spec: `docs/conversation-ui-design.md`
- System docs: `docs/conversation-sessions.md`
- API docs: Check endpoint routes

**Common Resources:**
- Component: `src/components/ConversationsPanel.tsx`
- API: `src/app/api/conversations/*`
- Database: `sql/022_conversation_sessions.sql`

**Report Issues:**
- Check existing conversations in "Support" channel
- Create new conversation with "Bug Report" title
- Include steps to reproduce
- Attach screenshots if helpful
