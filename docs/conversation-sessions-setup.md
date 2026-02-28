# Conversation Sessions System - Setup & Testing Guide

## Quick Setup

### 1. Database Migration

```bash
# Connect to your PostgreSQL database
psql life_dashboard < sql/022_conversation_sessions.sql
```

This creates:
- `conversations` table (session metadata and context)
- `conversation_messages` table (messages with threading)
- `conversation_read_status` table (per-agent read tracking)
- `conversation_stats` view (aggregated statistics)
- Triggers for auto-updating `updated_at` and unread counts

### 2. Verify Installation

```bash
# Check tables exist
psql life_dashboard -c "\dt conversation*"

# Should show:
# - conversations
# - conversation_messages
# - conversation_read_status

# Check view exists
psql life_dashboard -c "\dv conversation_stats"
```

### 3. Test Basic CRUD

```bash
# Start dev server
pnpm dev

# Test API endpoints (requires authentication)
# Use the dashboard login flow or set RELAY_API_KEY for testing
```

## API Testing Examples

### Create a Conversation

```bash
curl -X POST http://localhost:3000/api/conversations \
  -H "Content-Type: application/json" \
  -H "x-relay-key: ${RELAY_API_KEY}" \
  -d '{
    "title": "Test Conversation",
    "participants": ["dev-agent", "user"],
    "context": {
      "projectId": "test-project",
      "goal": "Test conversation system"
    },
    "createdBy": "user"
  }'
```

### Add a Message

```bash
# Replace CONVERSATION_ID with the ID from previous response
curl -X POST http://localhost:3000/api/conversations/CONVERSATION_ID/messages \
  -H "Content-Type: application/json" \
  -H "x-relay-key: ${RELAY_API_KEY}" \
  -d '{
    "from": "user",
    "content": "Hello, this is a test message",
    "type": "text"
  }'
```

### Add a Threaded Reply

```bash
# Replace MESSAGE_ID with the ID from previous message
curl -X POST http://localhost:3000/api/conversations/CONVERSATION_ID/messages \
  -H "Content-Type: application/json" \
  -H "x-relay-key: ${RELAY_API_KEY}" \
  -d '{
    "from": "dev-agent",
    "content": "This is a reply to your message",
    "type": "answer",
    "parentMessageId": "MESSAGE_ID",
    "metadata": {
      "model": "sonnet",
      "tokens": 150
    }
  }'
```

### Get Conversation Messages

```bash
curl http://localhost:3000/api/conversations/CONVERSATION_ID/messages \
  -H "x-relay-key: ${RELAY_API_KEY}"
```

### Update Read Status

```bash
curl -X POST http://localhost:3000/api/conversations/CONVERSATION_ID/read-status \
  -H "Content-Type: application/json" \
  -H "x-relay-key: ${RELAY_API_KEY}" \
  -d '{
    "agentId": "dev-agent",
    "lastReadMessageId": "MESSAGE_ID"
  }'
```

### Get Conversation with Stats

```bash
curl "http://localhost:3000/api/conversations/CONVERSATION_ID?stats=true" \
  -H "x-relay-key: ${RELAY_API_KEY}"
```

### List Conversations

```bash
# All conversations
curl http://localhost:3000/api/conversations \
  -H "x-relay-key: ${RELAY_API_KEY}"

# Filter by participant
curl "http://localhost:3000/api/conversations?participantId=dev-agent" \
  -H "x-relay-key: ${RELAY_API_KEY}"

# Filter by status
curl "http://localhost:3000/api/conversations?status=active&limit=10" \
  -H "x-relay-key: ${RELAY_API_KEY}"
```

## MCP Tool Testing

### Using Claude Code Agents

```typescript
// 1. Create a conversation
const result = await use_mcp_tool("life-dashboard", "dashboard_create_conversation", {
  title: "Agent Planning Session",
  participants: ["dev-agent", "pm-agent", "user"],
  context: {
    projectId: "my-project-uuid",
    goal: "Plan Q1 features",
    deadline: "2024-03-31"
  },
  createdBy: "user"
});

const conversationId = JSON.parse(result).conversation.id;

// 2. Add a message
await use_mcp_tool("life-dashboard", "dashboard_add_conversation_message", {
  conversationId: conversationId,
  from: "dev-agent",
  content: "I suggest we start with user authentication",
  type: "text",
  metadata: {
    model: "sonnet",
    tokens: 120
  }
});

// 3. Get messages
const messages = await use_mcp_tool("life-dashboard", "dashboard_get_conversation_messages", {
  conversationId: conversationId,
  limit: 50
});

// 4. Update read status
await use_mcp_tool("life-dashboard", "dashboard_update_conversation_read_status", {
  conversationId: conversationId,
  agentId: "dev-agent",
  lastReadMessageId: "last-message-uuid"
});

// 5. Get unread conversations
const unread = await use_mcp_tool("life-dashboard", "dashboard_get_unread_conversations", {
  agentId: "dev-agent"
});
```

## Library Testing (TypeScript)

```typescript
import {
  createConversation,
  addConversationMessage,
  getConversationMessages,
  updateConversationReadStatus,
  getUnreadConversations,
} from "@/lib/conversations";

// Test conversation creation
const conversation = await createConversation({
  title: "Test Session",
  participants: ["dev-agent", "user"],
  context: { test: true },
  createdBy: "user",
});

console.log("Created conversation:", conversation.id);

// Test message addition
const message1 = await addConversationMessage({
  conversationId: conversation.id,
  from: "user",
  content: "Test question?",
  type: "question",
});

const message2 = await addConversationMessage({
  conversationId: conversation.id,
  from: "dev-agent",
  content: "Test answer",
  type: "answer",
  parentMessageId: message1.id, // Threading
  metadata: { model: "sonnet", tokens: 100 },
});

// Test message retrieval
const messages = await getConversationMessages(conversation.id);
console.log(`Found ${messages.length} messages`);

// Test read status
const readStatus = await updateConversationReadStatus(
  conversation.id,
  "dev-agent",
  message2.id
);

console.log(`Unread count: ${readStatus.unreadCount}`);

// Test unread conversations
const unread = await getUnreadConversations("user");
console.log(`User has ${unread.length} unread conversations`);
```

## Database Verification

### Check Triggers

```sql
-- Verify updated_at trigger works
SELECT id, title, updated_at
FROM conversations
ORDER BY updated_at DESC
LIMIT 5;

-- Add a message (should update conversation.updated_at)
-- Then re-run the query to verify timestamp changed
```

### Check Unread Count Calculation

```sql
-- Verify unread counts are correct
SELECT
  c.title,
  crs.agent_id,
  crs.unread_count,
  crs.last_read_at
FROM conversations c
JOIN conversation_read_status crs ON c.id = crs.conversation_id
WHERE crs.unread_count > 0;

-- Manually verify by counting messages after last_read_at
SELECT COUNT(*)
FROM conversation_messages
WHERE conversation_id = 'CONVERSATION_ID'
  AND created_at > (
    SELECT created_at
    FROM conversation_messages
    WHERE id = 'LAST_READ_MESSAGE_ID'
  )
  AND from_id != 'AGENT_ID';
```

### Check Threading

```sql
-- View message thread structure
WITH RECURSIVE thread AS (
  SELECT id, from_id, content, parent_message_id, 0 as depth
  FROM conversation_messages
  WHERE id = 'ROOT_MESSAGE_ID'

  UNION ALL

  SELECT cm.id, cm.from_id, cm.content, cm.parent_message_id, t.depth + 1
  FROM conversation_messages cm
  JOIN thread t ON cm.parent_message_id = t.id
)
SELECT
  REPEAT('  ', depth) || from_id as sender,
  SUBSTRING(content, 1, 50) as preview,
  depth
FROM thread
ORDER BY depth, id;
```

### Check Conversation Stats View

```sql
-- Test the stats view
SELECT
  title,
  array_length(participants, 1) as participant_count,
  message_count,
  last_message_at,
  read_status
FROM conversation_stats
WHERE status = 'active'
ORDER BY updated_at DESC
LIMIT 10;
```

## Common Issues & Solutions

### Issue: "Invalid participant ID"

**Cause:** Participant ID not in `agents.json` or special IDs (`user`, `broadcast`)

**Solution:**
```typescript
// Check valid IDs
import { getAgentIds } from "@/lib/agents";
console.log("Valid agent IDs:", getAgentIds());

// Or use "user" for dashboard user
participants: ["user", "dev-agent"]
```

### Issue: "Conversation not found"

**Cause:** Using wrong conversation ID or conversation was deleted

**Solution:**
```bash
# List all conversations
curl http://localhost:3000/api/conversations \
  -H "x-relay-key: ${RELAY_API_KEY}"

# Verify ID exists
psql life_dashboard -c "SELECT id, title FROM conversations;"
```

### Issue: Unread count not updating

**Cause:** Trigger not fired or participant not in read_status table

**Solution:**
```sql
-- Check if trigger exists
SELECT tgname FROM pg_trigger WHERE tgname LIKE '%unread%';

-- Manually recalculate (if needed)
SELECT update_conversation_unread_counts('CONVERSATION_ID');

-- Verify read_status entries exist
SELECT * FROM conversation_read_status WHERE conversation_id = 'CONVERSATION_ID';
```

### Issue: "Sender not a participant"

**Cause:** Trying to send message from non-participant

**Solution:**
```typescript
// Check conversation participants
const conv = await getConversation(conversationId);
console.log("Participants:", conv.participants);

// Ensure sender is in participants array
if (!conv.participants.includes(senderId)) {
  console.error(`${senderId} is not a participant`);
}
```

## Performance Testing

### Test with Many Messages

```typescript
// Create a conversation with 1000 messages
const conversation = await createConversation({
  title: "Performance Test",
  participants: ["dev-agent", "user"],
  context: { test: "performance" },
  createdBy: "user",
});

for (let i = 0; i < 1000; i++) {
  await addConversationMessage({
    conversationId: conversation.id,
    from: i % 2 === 0 ? "user" : "dev-agent",
    content: `Test message ${i}`,
    type: "text",
  });
}

// Test pagination
console.time("Fetch 50 messages");
const messages = await getConversationMessages(conversation.id, { limit: 50 });
console.timeEnd("Fetch 50 messages");

// Test incremental fetch
const since = messages[messages.length - 1].createdAt;
console.time("Incremental fetch");
const newMessages = await getConversationMessages(conversation.id, { since });
console.timeEnd("Incremental fetch");
```

### Monitor Query Performance

```sql
-- Enable query logging
ALTER DATABASE life_dashboard SET log_min_duration_statement = 100;

-- Then run your queries and check logs
-- Look for slow queries in PostgreSQL logs

-- Check index usage
EXPLAIN ANALYZE
SELECT * FROM conversation_messages
WHERE conversation_id = 'UUID'
ORDER BY created_at ASC
LIMIT 50;
```

## Next Steps

1. **Add to frontend** — Create UI components for conversation sessions
2. **SSE integration** — Real-time message delivery
3. **Attachments** — Link file attachments to conversation messages
4. **Search** — Full-text search across conversation content
5. **Analytics** — Track conversation patterns and agent collaboration metrics

## Documentation

- **Full Documentation:** `docs/conversation-sessions.md`
- **API Reference:** `CLAUDE.md` (Conversation Sessions System section)
- **Schema:** `sql/022_conversation_sessions.sql`
- **Library:** `src/lib/conversations.ts`
- **MCP Tools:** `scripts/mcp-server.ts` (search for `dashboard_*_conversation`)
