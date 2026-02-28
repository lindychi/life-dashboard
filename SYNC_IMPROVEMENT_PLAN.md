# Messages 동기화 개선 계획

## 🎯 목표
- 메시지 전송/수신 지연 < 500ms
- PostgreSQL 쿼리 응답 시간 < 100ms
- 실시간 push 기반 동기화 (WebSocket or SSE)

## 📊 현재 상태 진단

### ✅ 이미 적용된 최적화
1. **Optimistic UI**: 사용자 메시지 즉시 표시
2. **Adaptive Polling**: 변화 없으면 1s → 5s로 증가
3. **Incremental Fetch**: `since` 파라미터로 증분 조회
4. **Optimistic Read**: 읽음 처리 백그라운드화

### ⚠️ 문제점
1. **PostgreSQL 쿼리 최적화 부족**
   - `getConversation`: LEFT JOIN + batch attachment loading이 느림
   - `getAllAgentsOverview`: 모든 에이전트 스캔 (5초마다)

2. **폴링 기반 동기화의 한계**
   - 최소 1초 지연 (adaptive polling baseline)
   - 불필요한 빈 응답 반복

3. **캐싱 없음**
   - 동일 메시지 반복 조회
   - 에이전트 overview 매번 재계산

4. **프론트엔드 메모리 누수 가능성**
   - 무한 대화 시 `conversation` 배열 무한 증가

## 🔧 개선 방안

### Phase 1: PostgreSQL 쿼리 최적화 (즉시 적용 가능)

#### 1.1 인덱스 추가
```sql
-- messages 테이블에 복합 인덱스 추가
CREATE INDEX idx_messages_to_from_created
  ON messages(to_id, from_id, created_at DESC);

CREATE INDEX idx_messages_created_at_id
  ON messages(created_at DESC, id);

-- message_read_status에 covering 인덱스
CREATE INDEX idx_read_status_message_agent
  ON message_read_status(message_id, agent_id)
  INCLUDE (created_at);
```

#### 1.2 getConversation 쿼리 최적화
- `LIMIT` 적용 전에 날짜 필터링 (인덱스 활용)
- Attachment batch loading을 CTE로 변경

#### 1.3 getAllAgentsOverview 캐싱
- Redis 또는 in-memory cache (5초 TTL)
- 메시지 전송 시 해당 에이전트만 invalidate

### Phase 2: Server-Sent Events (SSE) 도입 (권장)

#### 2.1 왜 SSE인가?
- **WebSocket보다 간단**: 단방향 push만 필요
- **HTTP/2 호환**: 기존 인프라 재사용
- **자동 재연결**: 브라우저가 자동 처리
- **Railway 지원**: WebSocket보다 안정적

#### 2.2 구현 계획
```
[Gateway/Client] → POST /api/messages → [Database]
                                            ↓
[Dashboard] ← SSE /api/messages/stream ← [EventEmitter]
```

**API Routes:**
- `GET /api/messages/stream` - SSE endpoint (에이전트별 subscribe)
- `POST /api/messages` - 메시지 전송 시 이벤트 emit

**이벤트 타입:**
- `new-message` - 새 메시지 수신
- `message-read` - 메시지 읽음 처리
- `typing` - 에이전트 응답 시작 (optional)

#### 2.3 폴백 지원
- SSE 연결 실패 시 자동으로 polling으로 전환
- Railway 환경에서 SSE timeout 대비

### Phase 3: Redis 기반 실시간 동기화 (선택사항)

#### 3.1 아키텍처
```
[Gateway] → PostgreSQL → Redis Pub/Sub → SSE Clients
                ↓
            [Dashboard API]
```

#### 3.2 Redis 채널 구조
- `messages:{agentId}` - 에이전트별 메시지 채널
- `overview` - 전체 overview 갱신 트리거

#### 3.3 장점
- Gateway와 Dashboard 간 실시간 전파
- PostgreSQL 부하 감소 (Redis가 pub/sub 담당)

### Phase 4: 프론트엔드 최적화

#### 4.1 Virtual Scrolling
- `react-window` 또는 `react-virtuoso` 사용
- 1000+ 메시지 시 렌더링 성능 개선

#### 4.2 Message Pagination
- 초기 로딩: 최근 50개만
- Infinite scroll: 스크롤 시 추가 로딩

#### 4.3 Conversation Caching
- `localStorage` 또는 IndexedDB에 최근 대화 캐싱
- 오프라인 지원 가능

## 🚀 구현 우선순위

### P0 (즉시): PostgreSQL 최적화
- [ ] 인덱스 추가 (5분)
- [ ] 쿼리 프로파일링 (EXPLAIN ANALYZE)
- [ ] Overview 캐싱 (in-memory)

### P1 (이번 주): SSE 도입
- [ ] `/api/messages/stream` 구현
- [ ] EventEmitter 통합
- [ ] 프론트엔드 SSE 연결 + 폴백

### P2 (다음 주): Redis 통합
- [ ] Railway Redis 플러그인 추가
- [ ] Pub/Sub 이벤트 발행
- [ ] Gateway 연동

### P3 (추후): 고급 최적화
- [ ] Virtual scrolling
- [ ] Message pagination
- [ ] Offline caching

## 📝 마이그레이션 SQL

```sql
-- sql/004_messages_optimization.sql

-- 복합 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_messages_to_from_created
  ON messages(to_id, from_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_created_at_id
  ON messages(created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_read_status_message_agent
  ON message_read_status(message_id, agent_id);

-- 통계 업데이트
ANALYZE messages;
ANALYZE message_read_status;
```

## 🧪 성능 벤치마크 목표

| Metric | Before | Target | After |
|--------|--------|--------|-------|
| 메시지 전송 → 표시 | ~2s | <500ms | TBD |
| getConversation(50) | ~150ms | <50ms | TBD |
| getAllAgentsOverview | ~200ms | <100ms (cached) | TBD |
| SSE 전파 지연 | N/A | <100ms | TBD |

## 🔍 디버깅 체크리스트

- [ ] PostgreSQL slow query log 활성화
- [ ] API 응답 시간 측정 (middleware)
- [ ] 브라우저 Network 탭에서 폴링 빈도 확인
- [ ] React DevTools Profiler로 렌더링 병목 확인

## 📚 참고 자료

- [PostgreSQL Index Types](https://www.postgresql.org/docs/current/indexes-types.html)
- [Server-Sent Events MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
- [Redis Pub/Sub](https://redis.io/docs/interact/pubsub/)
- [Next.js API Routes with SSE](https://vercel.com/guides/using-server-sent-events-with-next-js)
