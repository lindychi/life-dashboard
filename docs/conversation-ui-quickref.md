# Conversation UI Quick Reference

**Life Dashboard - 대화 세션 UI 빠른 참조**

## Component Import

```tsx
import ConversationsPanel from "@/components/ConversationsPanel";
```

## Basic Usage

```tsx
<ConversationsPanel
  currentUserId="user"
  agentMap={{
    "user": { emoji: "👤", name: "User" },
    "dev-agent": { emoji: "🤖", name: "Dev Agent" },
  }}
/>
```

## Message Types

| Type | Icon | Color | Usage |
|------|------|-------|-------|
| `text` | - | Gray/Blue | General messages |
| `task` | 📋 | Blue | Action items |
| `result` | ✅ | Green | Outcomes |
| `question` | ❓ | Amber | Questions |
| `answer` | 💬 | Violet | Answers |
| `system` | ⚙️ | Gray | System notifications |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `Esc` | Close type selector/modal |
| `Tab` | Navigate elements |

## API Endpoints

```
GET    /api/conversations              List conversations
POST   /api/conversations              Create conversation
GET    /api/conversations/[id]         Get conversation
PATCH  /api/conversations/[id]         Update conversation
DELETE /api/conversations/[id]         Delete conversation

GET    /api/conversations/[id]/messages        Get messages
POST   /api/conversations/[id]/messages        Send message
POST   /api/conversations/[id]/read-status     Mark as read
```

## Status Lifecycle

```
active → completed → archived
```

## Context Examples

**Project-linked:**
```json
{
  "projectId": "uuid",
  "goal": "System architecture design",
  "deadline": "2024-12-31"
}
```

**Goal-driven:**
```json
{
  "goal": "Fix bug #123",
  "priority": "high",
  "assignee": "dev-agent"
}
```

## Common Patterns

**Sequential Workflow:**
```
User (Question) → Agent A (Answer) → Agent B (Result)
```

**Parallel Input:**
```
User (Question) → [Agent A, Agent B, Agent C] (Answers) → User (Result)
```

**Iterative:**
```
User ↔ Agent (multiple rounds) → Final Result
```

## Styling Classes

```tsx
// Status colors
bg-green-500  // Active
bg-blue-500   // Completed
bg-gray-500   // Archived

// Message types
bg-blue-600   // Task (user)
bg-blue-500/10  // Task (agent)
bg-emerald-600  // Result (user)
bg-amber-600    // Question (user)
bg-violet-600   // Answer (user)
```

## Responsive Breakpoints

```tsx
md:  // Desktop (768px+)
     // Split layout, 320px sidebar

<md: // Mobile
     // Single view, toggle between list/messages
```

## Performance Tips

1. **Filter actively** - Use status filters
2. **Archive old** - Move completed to archived
3. **Limit participants** - Keep teams focused (2-6 people)
4. **Use search** - Find conversations quickly

## Troubleshooting

**Message not sending?**
→ Check conversation is "active" status

**Can't create conversation?**
→ Ensure title + min 2 participants

**Search not working?**
→ Check status filter isn't hiding results

**Optimistic message stuck?**
→ Refresh page, server may have rejected

## File Locations

```
Component:   src/components/ConversationsPanel.tsx
Hook:        src/hooks/useConversationSSE.ts
Types:       src/lib/conversations.ts
API:         src/app/api/conversations/*
SQL:         sql/022_conversation_sessions.sql
Docs:        docs/conversation-ui-design.md
```

## Quick Commands

**Create conversation:**
```tsx
POST /api/conversations
{
  "title": "Project Planning",
  "participants": ["user", "dev-agent", "pm-agent"],
  "context": { "projectId": "uuid" },
  "createdBy": "user"
}
```

**Send message:**
```tsx
POST /api/conversations/{id}/messages
{
  "from": "user",
  "content": "Let's start planning",
  "type": "text"
}
```

**Update status:**
```tsx
PATCH /api/conversations/{id}
{
  "status": "completed"
}
```

## Component Props

```tsx
interface ConversationsPanelProps {
  currentUserId: string;           // "user" or agent ID
  agentMap: Record<string, {       // Agent info map
    emoji: string;                 // Display emoji
    name: string;                  // Display name
  }>;
}
```

## State Management

```tsx
// Local state
const [conversations, setConversations] = useState<ConversationStats[]>([]);
const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
const [messages, setMessages] = useState<ConversationMessage[]>([]);
const [messageInput, setMessageInput] = useState("");
const [messageType, setMessageType] = useState<ConversationMessageType>("text");
const [searchQuery, setSearchQuery] = useState("");
const [statusFilter, setStatusFilter] = useState<ConversationStatus | "all">("all");
```

## SSE Events (Future)

```tsx
conversation:created       // New conversation
conversation:updated       // Conversation changed
conversation:deleted       // Conversation removed
conversation:message:new   // New message
conversation:read:update   // Read status changed
```

## Accessibility

```tsx
// ARIA labels
role="tablist"           // Filter chips
role="tab"               // Filter chip
aria-selected={active}   // Selected filter

// Focus management
focus-visible:ring-2
focus-visible:ring-blue-500
focus-visible:outline-none

// Keyboard navigation
Tab, Shift+Tab           // Navigate
Enter, Space             // Activate
Escape                   // Close
```

## Color Palette Quick Reference

```css
/* Backgrounds */
bg-gray-900      /* Main background */
bg-gray-850      /* Sidebar */
bg-gray-800      /* Cards */
bg-gray-700/30   /* Hover */
bg-blue-600/15   /* Selected */

/* Text */
text-white       /* Primary */
text-gray-300    /* Secondary */
text-gray-500    /* Tertiary */
text-gray-600    /* Disabled */

/* Accents */
bg-blue-600      /* Primary action */
bg-green-500     /* Success/Active */
bg-amber-500     /* Warning/Question */
bg-red-500       /* Error */
bg-violet-500    /* Info/Answer */

/* Borders */
border-gray-700/50   /* Default */
border-blue-500/50   /* Focus */
border-blue-500      /* Selected */
```

## Typography Scale

```css
text-lg      /* 18px - Large title */
text-base    /* 16px - Title */
text-sm      /* 14px - Body */
text-xs      /* 12px - Caption */
text-[11px]  /* 11px - Micro */
text-[10px]  /* 10px - Tiny */
```

## Animation Classes

```css
/* Transitions */
transition-colors        /* Color changes */
transition-all          /* All properties */

/* Hover */
hover:bg-gray-700/30
hover:text-white

/* Focus */
focus-visible:ring-2
focus-visible:ring-blue-500

/* Scroll */
scrollbar-thin
scrollbar-track-transparent
scrollbar-thumb-gray-700

/* Fade in */
animate-in fade-in slide-in-from-bottom-2 duration-150
```

## Common Queries

**Get all active conversations:**
```
GET /api/conversations?status=active&participantId=user
```

**Get conversation with stats:**
```
GET /api/conversations/{id}?stats=true
```

**Get recent messages:**
```
GET /api/conversations/{id}/messages?limit=50
```

**Get messages since timestamp:**
```
GET /api/conversations/{id}/messages?since=2024-02-28T10:00:00Z
```

**Get unread conversations:**
```
GET /api/conversations?participantId=user
// Filter client-side by readStatus[userId].unread > 0
```

## Debug Tips

```tsx
// Log conversation state
console.log("Conversations:", conversations);
console.log("Selected:", selectedConversation);
console.log("Messages:", messages);

// Check filters
console.log("Status filter:", statusFilter);
console.log("Search query:", searchQuery);

// Verify participant
console.log("Current user:", currentUserId);
console.log("Is participant:",
  selectedConversation?.participants.includes(currentUserId)
);
```

## Testing Checklist

- [ ] Create conversation
- [ ] Send all message types
- [ ] Filter by status
- [ ] Search conversations
- [ ] Update conversation status
- [ ] Delete conversation
- [ ] Multi-agent participation
- [ ] Optimistic UI updates
- [ ] Keyboard navigation
- [ ] Mobile responsiveness

## Quick Links

- [Full Design Spec](./conversation-ui-design.md)
- [Usage Guide](./conversation-ui-usage.md)
- [Comparison](./conversation-ui-comparison.md)
- [System Docs](./conversation-sessions.md)
