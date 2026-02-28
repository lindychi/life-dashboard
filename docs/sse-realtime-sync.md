# SSE Real-time Synchronization

This document describes the Server-Sent Events (SSE) real-time synchronization system for the Life Dashboard.

## Overview

The SSE system enables real-time updates for dashboard data without requiring client polling. Changes to projects, KPIs, OKRs, and other data are automatically pushed to connected clients.

## Architecture

### Server Components

#### 1. SSE Broadcaster (`src/lib/sse-broadcaster.ts`)

Singleton service that manages SSE client connections and broadcasts events.

**Key Features:**
- Client connection management
- Event broadcasting to all/specific clients
- Automatic heartbeat (30s interval)
- Connection health monitoring
- Graceful cleanup

**API:**
```typescript
// Add client
sseBroadcaster.addClient(client: SSEClient): void

// Remove client
sseBroadcaster.removeClient(clientId: string): void

// Broadcast to all clients
sseBroadcaster.broadcast(event: SSEEvent): void

// Send to specific client
sseBroadcaster.sendToClient(clientId: string, event: SSEEvent): void

// Broadcast to user's clients only
sseBroadcaster.broadcastToUser(userId: string, event: SSEEvent): void

// Get stats
sseBroadcaster.getStats(): { totalClients: number; clientsByUser: Record<string, number> }
```

#### 2. SSE Endpoint (`src/app/api/sse/route.ts`)

HTTP endpoint that establishes SSE connections.

**Endpoint:** `GET /api/sse`

**Authentication:** Required (JWT session cookie)

**Response:** `text/event-stream` with continuous event stream

**Connection Flow:**
1. Client connects to `/api/sse`
2. Server verifies authentication
3. Server creates `ReadableStream` for client
4. Server registers client with broadcaster
5. Server sends `connected` event
6. Server sends periodic `heartbeat` events
7. Server pushes data events as they occur
8. On disconnect, server removes client

#### 3. Integration in API Routes

SSE events are broadcast from relevant API routes:

**Projects:**
- `POST /api/projects` → `project:created`
- `PUT /api/projects/[id]` → `project:updated`
- `DELETE /api/projects/[id]` → `project:deleted`
- `POST /api/projects/[id]/metrics` → `project:metrics:updated`

**OKR Objectives:**
- `POST /api/okr/objectives` → `okr:objective:created`
- `PATCH /api/okr/objectives/[id]` → `okr:objective:updated`
- `DELETE /api/okr/objectives/[id]` → `okr:objective:deleted`

**OKR Key Results:**
- `POST /api/okr/key-results` → `okr:key-result:created`
- `PATCH /api/okr/key-results/[id]` → `okr:key-result:updated`
- `DELETE /api/okr/key-results/[id]` → `okr:key-result:deleted`

### Client Components

#### 1. Base SSE Hook (`src/hooks/useSSE.ts`)

Low-level React hook for SSE connection management.

**Features:**
- Auto-connect on mount
- Auto-reconnect on disconnect (with backoff)
- Event parsing and dispatching
- Connection state management

**Usage:**
```typescript
import { useSSE } from "@/hooks/useSSE";

function MyComponent() {
  const { disconnect, reconnect } = useSSE({
    onConnect: () => console.log("Connected!"),
    onDisconnect: () => console.log("Disconnected"),
    onError: (error) => console.error("Error:", error),
    onEvent: (event) => {
      console.log("Event:", event.type, event.data);
    },
    reconnectInterval: 3000,
    maxReconnectAttempts: 10,
  });

  return (
    <div>
      <button onClick={disconnect}>Disconnect</button>
      <button onClick={reconnect}>Reconnect</button>
    </div>
  );
}
```

#### 2. Project SSE Hook (`src/hooks/useProjectSSE.ts`)

High-level hook for project-related events.

**Usage:**
```typescript
import { useProjectSSE } from "@/hooks/useProjectSSE";

function ProjectsPage() {
  const [projects, setProjects] = useState([]);

  useProjectSSE({
    onProjectCreated: ({ project }) => {
      setProjects((prev) => [...prev, project]);
    },
    onProjectUpdated: ({ project }) => {
      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? project : p))
      );
    },
    onProjectDeleted: ({ projectId }) => {
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    },
    onMetricsUpdated: ({ projectId, metrics }) => {
      console.log("Metrics updated for project:", projectId, metrics);
      // Optionally refetch project metrics
    },
  });

  return <ProjectList projects={projects} />;
}
```

#### 3. OKR SSE Hook (`src/hooks/useOKRSSE.ts`)

High-level hook for OKR-related events.

**Usage:**
```typescript
import { useOKRSSE } from "@/hooks/useOKRSSE";

function OKRPage() {
  const [objectives, setObjectives] = useState([]);

  useOKRSSE({
    onObjectiveCreated: ({ objective }) => {
      setObjectives((prev) => [...prev, objective]);
    },
    onObjectiveUpdated: ({ objective }) => {
      setObjectives((prev) =>
        prev.map((o) => (o.id === objective.id ? objective : o))
      );
    },
    onObjectiveDeleted: ({ objectiveId }) => {
      setObjectives((prev) => prev.filter((o) => o.id !== objectiveId));
    },
    onKeyResultCreated: ({ keyResult }) => {
      console.log("Key result created:", keyResult);
      // Optionally refetch objectives
    },
    onKeyResultUpdated: ({ keyResult }) => {
      console.log("Key result updated:", keyResult);
      // Optionally refetch objectives
    },
  });

  return <ObjectiveList objectives={objectives} />;
}
```

## Event Types

### Event Structure

All SSE events follow this structure:

```typescript
interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  timestamp: string; // ISO 8601
}
```

### Supported Event Types

| Event Type | Trigger | Data Payload |
|------------|---------|--------------|
| `connected` | Client connects | `{ type: "connected", clientId: string, timestamp: string }` |
| `heartbeat` | Every 30s | `{ timestamp: string }` |
| `project:created` | Project created | `{ project: Project }` |
| `project:updated` | Project updated | `{ project: Project }` |
| `project:deleted` | Project deleted | `{ projectId: string }` |
| `project:metrics:updated` | Metrics snapshot created | `{ projectId: string, snapshotId: string, metrics: KPISummary }` |
| `okr:objective:created` | Objective created | `{ objective: Objective }` |
| `okr:objective:updated` | Objective updated | `{ objective: Objective }` |
| `okr:objective:deleted` | Objective deleted | `{ objectiveId: string }` |
| `okr:key-result:created` | Key result created | `{ keyResult: KeyResult }` |
| `okr:key-result:updated` | Key result updated | `{ keyResult: KeyResult }` |
| `okr:key-result:deleted` | Key result deleted | `{ keyResultId: string }` |
| `task:status:changed` | Task status changes | `{ taskId: string, status: string }` (future) |

## Connection Management

### Reconnection Strategy

- **Initial connection:** Immediate on component mount
- **On error:** Exponential backoff with max 10 attempts
- **Reconnect interval:** 3 seconds (default)
- **Max attempts:** 10 (default)

### Heartbeat

- **Interval:** 30 seconds
- **Purpose:** Keep connection alive, detect stale clients
- **Client action:** Ignored (used for connection health only)

### Connection Cleanup

- **On component unmount:** Auto-disconnect
- **On intentional disconnect:** Stop reconnection attempts
- **On server shutdown:** Gracefully close all connections

## Testing

### Manual Testing

1. **Connect to SSE endpoint:**
   ```bash
   curl -N -H "Cookie: auth-token=YOUR_TOKEN" http://localhost:3000/api/sse
   ```

2. **Create a project:**
   ```bash
   curl -X POST http://localhost:3000/api/projects \
     -H "Cookie: auth-token=YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"Test","description":"Test project"}'
   ```

3. **Verify event received in SSE stream:**
   ```
   event: project:created
   data: {"type":"project:created","data":{"project":{...}},"timestamp":"2025-02-28T..."}
   ```

### Debugging

**Server-side logs:**
```
[SSE] Client {clientId} connected (total: 1)
[SSE] Broadcast project:created: 1 success, 0 errors
[SSE] Client {clientId} disconnected (total: 0)
```

**Client-side logs:**
```
[SSE] Connecting to /api/sse...
[SSE] Connection established
[SSE] Event received: project:created {...}
```

## Performance Considerations

### Scalability

- **Memory:** Each client uses ~1KB memory for connection state
- **CPU:** Minimal overhead per broadcast (O(n) where n = clients)
- **Network:** ~50 bytes per heartbeat every 30s per client

### Optimization Tips

1. **Filter events client-side:** Only handle relevant events
2. **Debounce updates:** Batch rapid state changes
3. **Use specific hooks:** `useProjectSSE`, `useOKRSSE` vs generic `useSSE`
4. **Monitor stats:** Use `sseBroadcaster.getStats()` for metrics

### Limitations

- **No horizontal scaling:** In-memory broadcaster (single instance)
- **No persistence:** Events lost if no clients connected
- **One-way communication:** Server → Client only

**Future improvements:**
- Redis-backed broadcaster for multi-instance support
- Event history/replay for late joiners
- WebSocket upgrade for bidirectional communication

## Security

### Authentication

- **Required:** All SSE connections require valid JWT session
- **Enforcement:** Middleware verifies `auth-token` cookie
- **Rejection:** 401 Unauthorized if missing/invalid

### Authorization

- **Current:** All authenticated users receive all events
- **Future:** User-scoped filtering (`broadcastToUser`)

### Rate Limiting

- **Not implemented:** No per-client rate limiting
- **Recommendation:** Add nginx/proxy-level rate limiting

## Troubleshooting

### Client not receiving events

1. Check authentication (valid session cookie)
2. Check browser console for connection errors
3. Verify SSE endpoint responds (`curl -N ...`)
4. Check server logs for broadcast messages

### Frequent disconnections

1. Check network stability
2. Verify heartbeat interval appropriate
3. Check server resource limits (max connections)
4. Review reconnection backoff settings

### Memory leak

1. Verify components properly unmount/cleanup
2. Check `disconnect()` called on unmount
3. Monitor server stats (`sseBroadcaster.getStats()`)
4. Review server logs for unclosed connections

## Future Enhancements

1. **Task execution events:** `task:status:changed`, `task:completed`
2. **Message events:** Inter-agent message notifications
3. **Agent events:** Agent connection/disconnection status
4. **History events:** New history entries
5. **Redis PubSub:** Multi-instance support
6. **Event filtering:** Per-client subscriptions
7. **Compression:** Gzip event stream
8. **Binary protocol:** WebSocket upgrade for efficiency
