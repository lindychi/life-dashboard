# DevOps Integration Guide

Life Dashboard의 SSE 실시간 연결, Railway 배포, DB 마이그레이션 자동화를 통합한 DevOps 시스템입니다.

## 📊 1. SSE 실시간 연결 모니터링

### 개요

- **파일**: `src/lib/sse-metrics.ts`, `src/lib/sse-broadcaster.ts`
- **기능**: 실시간 SSE 연결 상태, 이벤트 처리량, 에러율 모니터링
- **API**: `GET /api/sse-metrics` (인증 필요)

### 메트릭 수집

SSE 시스템은 다음 메트릭을 자동으로 수집합니다:

```typescript
interface SSEMetrics {
  timestamp: string;
  activeConnections: number;        // 현재 활성 연결 수
  connectionsByUser: Record<string, number>;
  totalEventsFromTime: number;      // 총 이벤트 처리 수
  eventTypes: Record<string, number>; // 이벤트 타입별 분류
  heartbeatsMissed: number;         // 놓친 하트비트
  avgEventLatency: number;          // 평균 이벤트 처리 지연 (ms)
  reconnectAttempts: number;        // 재연결 시도 횟수
  errorCount: number;               // 에러 발생 횟수
}
```

### 헬스 상태

```
OK       - 에러율 < 5%, 평균 지연 < 1000ms
WARNING  - 에러율 5-10%, 평균 지연 1000ms 이상
CRITICAL - 에러율 > 10%, 재연결 시도 > 50회
```

### 모니터링 대시보드 통합

클라이언트에서 메트릭 조회:

```typescript
const response = await fetch('/api/sse-metrics');
const { metrics, healthStatus } = await response.json();

console.log(`Active connections: ${metrics.activeConnections}`);
console.log(`Health: ${healthStatus}`);
```

### 메트릭 초기화

```bash
# 메트릭 초기화
curl -X POST /api/sse-metrics \
  -H "Content-Type: application/json" \
  -d '{"action":"reset"}'

# 오래된 연결 정리
curl -X POST /api/sse-metrics \
  -H "Content-Type: application/json" \
  -d '{"action":"cleanup"}'
```

## 🚀 2. Railway 배포 설정

### WebSocket/SSE 지원

Railway에서 SSE 연결을 안정적으로 유지하기 위한 설정:

#### `railway.toml` 설정

```toml
[deploy]
healthcheckPath = "/api/tasks/health"
healthcheckTimeout = 100
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3

[deploy.proxyHeaders]
"X-Accel-Buffering" = "no"      # Nginx 버퍼링 비활성화
"Connection" = "keep-alive"      # SSE 연결 유지
"Upgrade" = "websocket"          # WebSocket 업그레이드
```

#### Dockerfile 최적화

```dockerfile
# 파일 디스크립터 한계 증가 (동시 연결 수 증대)
RUN echo "fs.file-max = 100000" >> /etc/sysctl.conf
RUN echo "* soft nofile 65535" >> /etc/security/limits.conf
RUN echo "* hard nofile 65535" >> /etc/security/limits.conf

# 시작 스크립트에서 ulimit 설정
ulimit -n 65535
```

### Railway 배포 절차

1. **자동 배포 활성화**:
   - GitHub 저장소 연결
   - Railway가 `main` 브랜치 변경 감지하면 자동 배포

2. **데이터베이스 설정**:
   - Railway PostgreSQL 서비스 생성
   - `DATABASE_URL` 환경 변수 설정
   - 마이그레이션은 Docker 시작 시 자동 실행

3. **볼륨 설정**:
   - Railway 대시보드 → Volumes
   - Mount Path: `/app/uploads`
   - 파일 업로드 디렉토리 영속성 보장

### 배포 후 확인

```bash
# 헬스 체크
curl https://your-railway-url.railway.app/api/tasks/health

# SSE 메트릭 조회
curl -H "Authorization: Bearer $TOKEN" \
  https://your-railway-url.railway.app/api/sse-metrics

# 로그 확인
railway logs --service life-dashboard
```

## 🗄️ 3. 데이터베이스 마이그레이션

### 마이그레이션 시스템

마이그레이션은 추적 테이블 `_migrations`으로 관리됩니다:

```sql
CREATE TABLE _migrations (
  id SERIAL PRIMARY KEY,
  filename TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  executed_by TEXT DEFAULT 'system',
  checksum TEXT
);
```

### 사용법

```bash
# 현재 대기 중인 마이그레이션 실행
pnpm migrate

# Dry-run (실제 적용하지 않고 확인만)
pnpm migrate:dry-run

# 마이그레이션 초기화 (주의!)
pnpm migrate:reset
```

### 마이그레이션 파일 작성

`sql/` 디렉토리에 SQL 파일을 추가합니다 (예: `sql/003_my_new_table.sql`):

```sql
-- 자동 추적됨, idempotent 작성 권장
CREATE TABLE IF NOT EXISTS new_table (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_created_at ON new_table(created_at);
```

### Docker 자동 마이그레이션

`scripts/docker-entrypoint.sh`에서 시작 시 자동 마이그레이션:

```bash
# 컨테이너 시작 → docker-entrypoint.sh 실행 → 마이그레이션 → 서버 시작
```

## 🔄 4. CI/CD 워크플로우

GitHub Actions 자동화:

### `.github/workflows/deploy.yml`

#### 1️⃣ Build & Test (모든 커밋)

```yaml
- Lint 검사
- 단위 테스트 (PostgreSQL 서비스 포함)
- 빌드 검증
- 마이그레이션 dry-run 테스트
```

#### 2️⃣ Docker Build & Push (main 브랜치만)

```yaml
- Docker 이미지 빌드
- GitHub Container Registry(GHCR)에 푸시
- 캐시 활용으로 빌드 시간 단축
```

#### 3️⃣ Railway 배포 (main 브랜치만)

```yaml
- GHCR 이미지를 Railway로 배포
- 자동 헬스 체크
- 마이그레이션 자동 실행
```

#### 4️⃣ 마이그레이션 검증 (모든 워크플로우)

```yaml
- 모든 SQL 마이그레이션 테스트
- 마이그레이션 테이블 검증
- 데이터베이스 연결 확인
```

### 워크플로우 실행

```bash
# 1. PR 생성 또는 main에 커밋
git push origin main

# 2. GitHub Actions 자동 실행
# → build-and-test (모든 브랜치)
# → deploy (main만)
# → verify-migrations (모든 워크플로우)

# 3. Railway 자동 배포
# → Docker 이미지 풀
# → 마이그레이션 실행
# → 서버 시작
# → 헬스 체크 통과
```

## 📈 모니터링 & 로깅

### SSE 연결 모니터링

```bash
# 실시간 메트릭 조회
curl -s https://your-railway-url.railway.app/api/sse-metrics | jq '.'

# 응답 예시:
{
  "success": true,
  "metrics": {
    "timestamp": "2025-02-28T10:30:00Z",
    "activeConnections": 42,
    "connectionsByUser": {"user@example.com": 2},
    "totalEventsFromTime": 1523,
    "eventTypes": {
      "project:updated": 450,
      "heartbeat": 1000,
      "okr:key-result:updated": 73
    },
    "avgEventLatency": 2.5,
    "reconnectAttempts": 3,
    "errorCount": 0,
    "healthStatus": "OK",
    "broadcasterStats": {
      "totalClients": 42,
      "clientsByUser": {"user@example.com": 2}
    }
  }
}
```

### Railway 로그 확인

```bash
# 최근 로그
railway logs --service life-dashboard --tail 100

# 마이그레이션 로그
railway logs --service life-dashboard | grep "\[Migration\]"

# SSE 로그
railway logs --service life-dashboard | grep "\[SSE\]"
```

### 데이터베이스 마이그레이션 확인

```bash
# Railway PostgreSQL에 연결
railway shell --service postgres

# 마이그레이션 상태 확인
SELECT * FROM _migrations ORDER BY applied_at DESC;
```

## 🔧 트러블슈팅

### SSE 연결 끊김

**증상**: 클라이언트가 자주 재연결

**해결**:
1. 헬스 메트릭 확인: `curl /api/sse-metrics`
2. 에러율 > 5%인지 확인
3. Railway 로그에서 메모리/CPU 부하 확인
4. 파일 디스크립터 한계 확인: `ulimit -n`

### 마이그레이션 실패

**증상**: 배포 후 데이터베이스 스키마 미적용

**해결**:
1. 마이그레이션 테이블 확인: `SELECT * FROM _migrations;`
2. SQL 파일 문법 검증
3. `pnpm migrate:dry-run`으로 테스트
4. 필요시 `pnpm migrate:reset` 후 재적용

### Railway 배포 실패

**증상**: Docker 빌드 성공, 배포 실패

**해결**:
1. Railway 대시보드에서 배포 로그 확인
2. 환경 변수 설정 확인 (`DATABASE_URL` 등)
3. 헬스 체크 엔드포인트 검증
4. 이미지 풀 실패 시 GHCR 토큰 재생성

## 📋 체크리스트

배포 전 확인 사항:

- [ ] 로컬에서 `pnpm migrate --dry-run` 통과
- [ ] `pnpm build` 성공
- [ ] `pnpm test` 모두 통과
- [ ] GitHub Actions 워크플로우 정상
- [ ] Railway 환경 변수 설정 완료
- [ ] PostgreSQL 서비스 연결 확인
- [ ] 볼륨 마운트 경로 설정
- [ ] 헬스 체크 엔드포인트 정상
- [ ] SSE 메트릭 조회 가능
- [ ] 마이그레이션 자동 실행 확인

## 🚀 배포 프로세스

```
Local Development
       ↓
git commit & push
       ↓
GitHub Actions (build-and-test)
  - Lint
  - Test
  - Build
       ↓ (main 브랜치만)
Docker Build & Push (GHCR)
       ↓
Railway Automatic Deploy
  - Pull Image
  - Run Migrations
  - Start Server
  - Health Check
       ↓
Production Live
  - Monitor SSE
  - Track metrics
  - Handle connections
```

## 📚 참고 자료

- [Railway 배포 문서](https://docs.railway.app/)
- [GitHub Actions 보안](https://github.blog/security/vulnerability-research/how-to-catch-github-actions-workflow-injections-before-attackers-do/)
- [PostgreSQL 마이그레이션](https://www.postgresql.org/docs/)
- [Next.js 배포](https://nextjs.org/docs/app/building-your-application/deploying)
