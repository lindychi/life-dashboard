# Conversation Sessions System

PostgreSQL-backed conversation session system for context-aware multi-agent communication with message threading and read status tracking.

## Overview

The conversation sessions system provides:
- **Session-based context management** — Store project info, goals, and metadata per conversation
- **Message threading** — Parent-child relationships for structured discussions
- **Per-agent read status** — Track which messages each participant has read
- **Auto-unread calculation** — Triggers automatically update unread counts
- **Status lifecycle** — `active` → `completed` / `archived`

## Database Schema

### Tables

#### `conversations`
Core session table storing conversation metadata and context.

```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  participants TEXT[] NOT NULL, -- Array of agent IDs or "user"
  context JSONB DEFAULT '{}',   -- Session context data
  status TEXT DEFAULT 'active', -- active | archived | completed
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
```

**Indexes:**
- `idx_conversations_status` — Status + updated_at (for listing active/archived)
- `idx_conversations_participants` — GIN index on participants array
- `idx_conversations_created_by` — Creator + created_at

#### `conversation_messages`
Messages within a conversation with threading support.

```sql
CREATE TABLE conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text', -- text | task | result | question | answer | system
  metadata JSONB DEFAULT '{}',
  parent_message_id UUID REFERENCES conversation_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Indexes:**
- `idx_conversation_messages_conversation` — Conversation + created_at ASC (for message history)
- `idx_conversation_messages_parent` — Parent message ID (for threading)
- `idx_conversation_messages_from` — From + created_at (for sender history)

#### `conversation_read_status`
Per-agent read status tracking.

```sql
CREATE TABLE conversation_read_status (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  last_read_message_id UUID REFERENCES conversation_messages(id) ON DELETE SET NULL,
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  unread_count INTEGER DEFAULT 0,
  PRIMARY KEY (conversation_id, agent_id)
);
```

**Indexes:**
- `idx_conversation_read_status_agent` — Agent + last_read_at (for agent inbox)

### Views

#### `conversation_stats`
Aggregated conversation statistics.

```sql
CREATE VIEW conversation_stats AS
SELECT
  c.id,
  c.title,
  c.participants,
  c.status,
  c.created_by,
  c.created_at,
  c.updated_at,
  COUNT(cm.id) as message_count,
  MAX(cm.created_at) as last_message_at,
  COALESCE(
    jsonb_object_agg(
      crs.agent_id,
      jsonb_build_object('unread', crs.unread_count, 'last_read_at', crs.last_read_at)
    ) FILTER (WHERE crs.agent_id IS NOT NULL),
    '{}'::jsonb
  ) as read_status
FROM conversations c
LEFT JOIN conversation_messages cm ON c.id = cm.conversation_id
LEFT JOIN conversation_read_status crs ON c.id = crs.conversation_id
GROUP BY c.id, c.title, c.participants, c.status, c.created_by, c.created_at, c.updated_at;
```

### Triggers

#### Auto-update `updated_at`
Updates conversation `updated_at` when a new message is added.

```sql
CREATE TRIGGER conversation_messages_update_conversation
  AFTER INSERT ON conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_updated_at();
```

#### Auto-update unread counts
Updates `conversation_read_status.unread_count` when messages are inserted.

```sql
CREATE TRIGGER conversation_messages_update_unread
  AFTER INSERT ON conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_unread_on_message_insert();
```

## API Endpoints

### Conversations

#### `GET /api/conversations`
List conversation sessions with filters.

**Query Parameters:**
- `participantId` (string, optional) — Filter by participant ID
- `status` (enum, optional) — `active` | `archived` | `completed`
- `createdBy` (string, optional) — Filter by creator ID
- `limit` (number, optional) — Max results (default: unlimited, max: 1000)

**Response:**
```json
{
  "conversations": [
    {
      "id": "uuid",
      "title": "Project Alpha Planning",
      "participants": ["dev-agent", "pm-agent", "user"],
      "context": { "projectId": "uuid", "goal": "..." },
      "status": "active",
      "createdBy": "user",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T12:00:00Z"
    }
  ]
}
```

#### `POST /api/conversations`
Create a new conversation session.

**Request Body:**
```json
{
  "title": "Project Alpha Planning",
  "participants": ["dev-agent", "pm-agent", "user"],
  "context": {
    "projectId": "uuid",
    "goal": "Plan project architecture",
    "deadline": "2024-12-31"
  },
  "createdBy": "user"
}
```

**Response:**
```json
{
  "success": true,
  "conversation": { /* conversation object */ }
}
```

#### `GET /api/conversations/[id]`
Get a specific conversation with optional statistics.

**Query Parameters:**
- `stats` (boolean, optional) — Include statistics (message count, read status)

**Response (with stats=true):**
```json
{
  "conversation": {
    "id": "uuid",
    "title": "Project Alpha Planning",
    "participants": ["dev-agent", "pm-agent", "user"],
    "status": "active",
    "messageCount": 42,
    "lastMessageAt": "2024-01-01T12:00:00Z",
    "readStatus": {
      "dev-agent": { "unread": 0, "last_read_at": "2024-01-01T12:00:00Z" },
      "pm-agent": { "unread": 5, "last_read_at": "2024-01-01T10:00:00Z" }
    }
  }
}
```

#### `PATCH /api/conversations/[id]`
Update conversation title, context, or status.

**Request Body:**
```json
{
  "title": "New Title",
  "context": { "updatedField": "new value" },
  "status": "completed"
}
```

**Note:** Context updates are **merged** with existing context (not replaced).

#### `DELETE /api/conversations/[id]`
Delete conversation and all messages (CASCADE).

**Response:**
```json
{
  "success": true
}
```

### Messages

#### `GET /api/conversations/[id]/messages`
Get messages from a conversation.

**Query Parameters:**
- `limit` (number, optional) — Max results (default: unlimited, max: 1000)
- `since` (ISO timestamp, optional) — Only return messages after this time
- `parentMessageId` (UUID or empty, optional) — Filter by parent (empty = top-level only)

**Response:**
```json
{
  "conversationId": "uuid",
  "messages": [
    {
      "id": "uuid",
      "conversationId": "uuid",
      "from": "user",
      "content": "What's the best database?",
      "type": "question",
      "metadata": {},
      "parentMessageId": null,
      "createdAt": "2024-01-01T00:00:00Z"
    },
    {
      "id": "uuid",
      "conversationId": "uuid",
      "from": "dev-agent",
      "content": "PostgreSQL would be ideal...",
      "type": "answer",
      "metadata": { "model": "sonnet", "tokens": 450 },
      "parentMessageId": "parent-uuid",
      "createdAt": "2024-01-01T00:05:00Z"
    }
  ]
}
```

#### `POST /api/conversations/[id]/messages`
Add a message to a conversation.

**Request Body:**
```json
{
  "from": "dev-agent",
  "content": "Here's my analysis...",
  "type": "text",
  "metadata": {
    "model": "sonnet",
    "tokens": 1200,
    "confidence": 0.95
  },
  "parentMessageId": "parent-uuid"
}
```

**Response:**
```json
{
  "success": true,
  "message": { /* message object */ }
}
```

### Read Status

#### `POST /api/conversations/[id]/read-status`
Update read status (mark messages as read).

**Request Body:**
```json
{
  "agentId": "dev-agent",
  "lastReadMessageId": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "readStatus": {
    "conversationId": "uuid",
    "agentId": "dev-agent",
    "lastReadMessageId": "uuid",
    "lastReadAt": "2024-01-01T12:00:00Z",
    "unreadCount": 0
  }
}
```

## Core Library (`src/lib/conversations.ts`)

### Functions

#### Conversation CRUD

```typescript
// Create conversation
const conversation = await createConversation({
  title: "Project Alpha Planning",
  participants: ["dev-agent", "pm-agent", "user"],
  context: { projectId: "uuid", goal: "Plan architecture" },
  createdBy: "user",
});

// Get single conversation
const conversation = await getConversation(conversationId);

// List conversations with filters
const conversations = await getConversations({
  participantId: "dev-agent",
  status: "active",
  limit: 50,
});

// Get conversation with stats
const stats = await getConversationStats(conversationId);

// Update conversation
const updated = await updateConversation(conversationId, {
  title: "New Title",
  context: { newField: "value" }, // Merged with existing
  status: "completed",
});

// Delete conversation
const success = await deleteConversation(conversationId);
```

#### Message Management

```typescript
// Add message
const message = await addConversationMessage({
  conversationId: "uuid",
  from: "dev-agent",
  content: "Here's my analysis...",
  type: "text",
  metadata: { model: "sonnet", tokens: 1200 },
  parentMessageId: "parent-uuid", // Optional threading
});

// Get messages
const messages = await getConversationMessages(conversationId, {
  limit: 50,
  since: "2024-01-01T00:00:00Z",
  parentMessageId: "uuid", // null for top-level only
});

// Get message thread (recursive)
const thread = await getMessageThread(messageId);
```

#### Read Status

```typescript
// Update read status
const readStatus = await updateConversationReadStatus(
  conversationId,
  "dev-agent",
  lastReadMessageId
);

// Get unread conversations
const unreadConversations = await getUnreadConversations("dev-agent");

// Update context (merge)
const updated = await updateConversationContext(conversationId, {
  phase: "implementation",
  blockers: ["API design pending"],
});
```

## MCP Tools

### `dashboard_create_conversation`
Create a new conversation session.

```typescript
await use_mcp_tool("life-dashboard", "dashboard_create_conversation", {
  title: "Project Alpha Planning",
  participants: ["dev-agent", "pm-agent", "user"],
  context: {
    projectId: "uuid",
    goal: "Plan project architecture",
  },
  createdBy: "dev-agent",
});
```

### `dashboard_get_conversations`
List conversations with filters.

```typescript
await use_mcp_tool("life-dashboard", "dashboard_get_conversations", {
  participantId: "dev-agent",
  status: "active",
  limit: 20,
});
```

### `dashboard_get_conversation`
Get conversation with optional statistics.

```typescript
await use_mcp_tool("life-dashboard", "dashboard_get_conversation", {
  conversationId: "uuid",
  includeStats: true,
});
```

### `dashboard_update_conversation`
Update conversation title, context, or status.

```typescript
await use_mcp_tool("life-dashboard", "dashboard_update_conversation", {
  conversationId: "uuid",
  title: "New Title",
  context: { phase: "implementation" },
  status: "completed",
});
```

### `dashboard_delete_conversation`
Delete conversation and all messages.

```typescript
await use_mcp_tool("life-dashboard", "dashboard_delete_conversation", {
  conversationId: "uuid",
});
```

### `dashboard_add_conversation_message`
Add message with threading support.

```typescript
await use_mcp_tool("life-dashboard", "dashboard_add_conversation_message", {
  conversationId: "uuid",
  from: "dev-agent",
  content: "Here's my analysis...",
  type: "text",
  metadata: { model: "sonnet", tokens: 1200 },
  parentMessageId: "parent-uuid", // Optional
});
```

### `dashboard_get_conversation_messages`
Get messages with pagination and filtering.

```typescript
await use_mcp_tool("life-dashboard", "dashboard_get_conversation_messages", {
  conversationId: "uuid",
  limit: 50,
  since: "2024-01-01T00:00:00Z",
  parentMessageId: "uuid", // null for top-level only
});
```

### `dashboard_update_conversation_read_status`
Mark messages as read.

```typescript
await use_mcp_tool("life-dashboard", "dashboard_update_conversation_read_status", {
  conversationId: "uuid",
  agentId: "dev-agent",
  lastReadMessageId: "uuid",
});
```

### `dashboard_get_unread_conversations`
Get all conversations with unread messages.

```typescript
await use_mcp_tool("life-dashboard", "dashboard_get_unread_conversations", {
  agentId: "dev-agent",
});
```

## Use Cases

### Multi-Agent Project Planning

```typescript
// 1. User creates a conversation for project planning
const conversation = await createConversation({
  title: "E-commerce Platform Architecture",
  participants: ["dev-agent", "architect-agent", "pm-agent", "user"],
  context: {
    projectId: "uuid",
    goal: "Design scalable e-commerce architecture",
    deadline: "2024-12-31",
    tech_stack: ["Node.js", "PostgreSQL", "Redis"],
  },
  createdBy: "user",
});

// 2. User asks a question
const question = await addConversationMessage({
  conversationId: conversation.id,
  from: "user",
  content: "What's the best database architecture for product catalog?",
  type: "question",
});

// 3. Architect agent responds with threading
const architectResponse = await addConversationMessage({
  conversationId: conversation.id,
  from: "architect-agent",
  content: "I recommend a hybrid approach:\n1. PostgreSQL for product data\n2. Redis for caching\n3. Elasticsearch for search",
  type: "answer",
  parentMessageId: question.id,
  metadata: { model: "opus", tokens: 850, confidence: 0.92 },
});

// 4. Dev agent adds implementation details
const devResponse = await addConversationMessage({
  conversationId: conversation.id,
  from: "dev-agent",
  content: "I can implement the PostgreSQL schema with JSONB for flexible attributes...",
  type: "answer",
  parentMessageId: architectResponse.id,
  metadata: { model: "sonnet", tokens: 1200 },
});

// 5. PM agent marks messages as read
await updateConversationReadStatus(
  conversation.id,
  "pm-agent",
  devResponse.id
);

// 6. Update context as planning progresses
await updateConversationContext(conversation.id, {
  phase: "implementation",
  decisions: {
    database: "PostgreSQL + Redis + Elasticsearch",
    architecture: "microservices",
  },
});
```

### Long-Running Technical Discussion

```typescript
// 1. Create conversation for code review
const conversation = await createConversation({
  title: "Payment Gateway Security Review",
  participants: ["security-agent", "dev-agent", "user"],
  context: {
    prNumber: 123,
    files: ["src/payment/gateway.ts", "src/payment/encryption.ts"],
    priority: "high",
  },
  createdBy: "user",
});

// 2. Security agent finds issues
const issue1 = await addConversationMessage({
  conversationId: conversation.id,
  from: "security-agent",
  content: "⚠️ Found potential SQL injection in payment validation",
  type: "task",
  metadata: { severity: "critical", file: "gateway.ts", line: 145 },
});

// 3. Dev agent responds with fix
const fix1 = await addConversationMessage({
  conversationId: conversation.id,
  from: "dev-agent",
  content: "Fixed by using parameterized queries. Updated code:\n```typescript\n...\n```",
  type: "result",
  parentMessageId: issue1.id,
});

// 4. Security agent verifies
await addConversationMessage({
  conversationId: conversation.id,
  from: "security-agent",
  content: "✅ Verified. SQL injection vulnerability resolved.",
  type: "answer",
  parentMessageId: fix1.id,
});

// 5. Mark conversation as completed
await updateConversation(conversation.id, {
  status: "completed",
  context: {
    ...conversation.context,
    resolved: true,
    issues_fixed: 1,
  },
});
```

### Agent Inbox/Notifications

```typescript
// Get all unread conversations for an agent
const unreadConversations = await getUnreadConversations("dev-agent");

console.log(`You have ${unreadConversations.length} unread conversations:`);
for (const conv of unreadConversations) {
  console.log(`- ${conv.title} (${conv.unreadCount} unread messages)`);
  console.log(`  Last message: ${conv.lastMessageAt}`);
}

// Get latest messages from each conversation
for (const conv of unreadConversations) {
  const messages = await getConversationMessages(conv.id, {
    limit: 5,
    since: conv.readStatus["dev-agent"]?.last_read_at,
  });

  console.log(`\n${conv.title}:`);
  for (const msg of messages) {
    console.log(`  [${msg.from}] ${msg.content.slice(0, 100)}...`);
  }
}
```

## Best Practices

### Context Management

Store structured data in the `context` field:

```typescript
{
  // Project linkage
  projectId: "uuid",
  objectiveId: "uuid",

  // Goals and scope
  goal: "Design authentication system",
  scope: ["OAuth2", "JWT", "SSO"],

  // Constraints
  deadline: "2024-12-31",
  budget: 40000,

  // Decisions made
  decisions: {
    auth_method: "OAuth2 + JWT",
    token_storage: "httpOnly cookies",
  },

  // Current phase
  phase: "implementation",
  blockers: ["Waiting for API keys"],
}
```

### Message Types

Use appropriate message types for clarity:

- `text` — General discussion
- `question` — Asking for information
- `answer` — Responding to a question
- `task` — Action items or assignments
- `result` — Task completion or output
- `system` — System-generated notifications

### Threading

Use threading for structured discussions:

```typescript
// Root question
const question = await addConversationMessage({
  conversationId: "uuid",
  from: "user",
  content: "How should we handle rate limiting?",
  type: "question",
});

// Multiple agents respond in parallel (all point to root)
await addConversationMessage({
  conversationId: "uuid",
  from: "architect-agent",
  content: "I recommend token bucket algorithm...",
  type: "answer",
  parentMessageId: question.id,
});

await addConversationMessage({
  conversationId: "uuid",
  from: "dev-agent",
  content: "We can use Redis for distributed rate limiting...",
  type: "answer",
  parentMessageId: question.id,
});
```

### Status Lifecycle

Manage conversation lifecycle:

1. **active** — Ongoing discussion
2. **completed** — Goals achieved, conversation concluded
3. **archived** — Historical record, no longer active

```typescript
// Start conversation
const conv = await createConversation({
  title: "Bug Investigation",
  participants: ["dev-agent", "user"],
  context: { issueId: 123 },
  createdBy: "user",
});

// ... discussion happens ...

// Mark as completed when done
await updateConversation(conv.id, {
  status: "completed",
  context: {
    ...conv.context,
    resolution: "Fixed in PR #456",
    root_cause: "Race condition in cache invalidation",
  },
});

// Archive old completed conversations periodically
await updateConversation(conv.id, {
  status: "archived",
});
```

### Read Status Updates

Update read status after processing messages:

```typescript
const messages = await getConversationMessages(conversationId, {
  limit: 50,
});

// Process messages...
for (const msg of messages) {
  console.log(`[${msg.from}] ${msg.content}`);
}

// Mark last message as read
if (messages.length > 0) {
  await updateConversationReadStatus(
    conversationId,
    "my-agent-id",
    messages[messages.length - 1].id
  );
}
```

## Performance Considerations

### Indexes

All critical queries are indexed:
- Participants array (GIN index for `ANY()` queries)
- Status + updated_at (for active conversation listings)
- Conversation + created_at (for message history)
- Parent message ID (for threading)

### Pagination

Use `limit` and `since` for large message histories:

```typescript
// Initial fetch
const messages = await getConversationMessages(conversationId, {
  limit: 50,
});

// Incremental updates
const newMessages = await getConversationMessages(conversationId, {
  since: messages[messages.length - 1].createdAt,
});
```

### Unread Count Triggers

Unread counts are automatically maintained by database triggers:
- No manual calculation needed
- Consistent across all clients
- Real-time updates on message insert

## Future Enhancements

Potential additions:
- **Reactions/emoji responses** to messages
- **File attachments** integration with existing attachment system
- **Search within conversations** (full-text search on message content)
- **Conversation templates** for common workflows
- **Conversation branching** (fork conversations at specific points)
- **SSE real-time updates** for live message delivery
- **Conversation summaries** (AI-generated TL;DR)
- **Export conversations** to Markdown/PDF
