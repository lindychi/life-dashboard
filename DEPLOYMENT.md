# Deployment Guide

Life Dashboard의 완전한 배포 가이드입니다.

## 🚀 빠른 시작

### 1단계: 로컬 설정

```bash
# 저장소 클론
git clone <repository-url>
cd life-dashboard

# 의존성 설치
pnpm install

# 환경 변수 설정
cp .env.example .env.local

# 데이터베이스 설정 (로컬)
brew install postgresql@14
brew services start postgresql@14
createdb life_dashboard

# 마이그레이션 실행
pnpm migrate

# 개발 서버 시작
pnpm dev
```

### 2단계: Railway 배포 준비

```bash
# Railway 프로젝트 생성
railway init

# PostgreSQL 서비스 추가
railway add --service postgres

# 환경 변수 설정
railway variables

# 필수 환경 변수:
# - DATABASE_URL (Railway PostgreSQL에서 자동 생성)
# - JWT_SECRET (새로 생성)
# - ALLOWED_EMAILS (로그인 이메일)
```

### 3단계: GitHub 연동

```bash
# GitHub에 푸시
git push origin main

# GitHub Actions 워크플로우 자동 실행
# → build-and-test
# → deploy (main만)
# → verify-migrations

# Railway 자동 배포 (GHCR 이미지 풀)
```

## 📋 배포 체크리스트

### Local Development
- [ ] `pnpm install` 완료
- [ ] `.env.local` 설정
- [ ] PostgreSQL 실행 중
- [ ] `pnpm migrate` 성공
- [ ] `pnpm test` 전부 통과
- [ ] `pnpm build` 성공
- [ ] `pnpm dev`에서 http://localhost:3000 정상 동작

### GitHub Setup
- [ ] 저장소 생성
- [ ] main 브랜치 보호 규칙 설정
- [ ] `.github/workflows/deploy.yml` 존재
- [ ] Secrets 설정 (필요시):
  - `RAILWAY_TOKEN` (필요시)
  - `RAILWAY_PROJECT_ID` (필요시)

### Railway Setup
- [ ] 프로젝트 생성
- [ ] PostgreSQL 서비스 추가
- [ ] 환경 변수 설정:
  - `DATABASE_URL` (자동)
  - `JWT_SECRET` (생성)
  - `ALLOWED_EMAILS` (설정)
  - `NEXT_PUBLIC_APP_URL` (Railway URL)
- [ ] 볼륨 설정:
  - Mount Path: `/app/uploads`
- [ ] GitHub 연동 (자동 배포)

### Post-Deployment
- [ ] Health check 통과: `GET /api/tasks/health`
- [ ] SSE 메트릭 조회: `GET /api/sse-metrics`
- [ ] 데이터베이스 마이그레이션 확인:
  ```bash
  railway shell --service postgres
  SELECT COUNT(*) FROM _migrations;
  ```
- [ ] 로그 확인: `railway logs --service life-dashboard`

## 🔄 배포 프로세스

### 자동 배포 (메인 브랜치)

```
git push origin main
    ↓
GitHub Actions 트리거
    ├─ build-and-test 실행
    │  ├─ Lint
    │  ├─ Test
    │  ├─ Build
    │  └─ Migration dry-run
    ├─ deploy 실행 (main만)
    │  ├─ Docker build
    │  └─ GHCR push
    └─ verify-migrations 실행
       └─ Migration test
    ↓
Railway 자동 감지 (GHCR 이미지)
    ├─ Docker pull
    ├─ 마이그레이션 자동 실행
    ├─ 서버 시작
    └─ Health check
    ↓
Production Live ✅
```

### 수동 배포 (필요시)

```bash
# Railway CLI로 수동 배포
railway up

# 또는 GitHub에서 수동 배포
gh workflow run deploy.yml

# 배포 상태 확인
railway status
railway logs --follow
```

## 🛠️ 마이그레이션 관리

### 새로운 마이그레이션 추가

```bash
# 1. SQL 파일 생성
cat > sql/020_my_feature.sql << 'EOF'
-- 마이그레이션 내용
CREATE TABLE IF NOT EXISTS my_table (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
EOF

# 2. 로컬 테스트
pnpm migrate:dry-run
pnpm migrate

# 3. Git 커밋
git add sql/020_my_feature.sql
git commit -m "feat: add my_table migration"
git push origin main

# 4. 자동 배포 (Railway가 마이그레이션 자동 적용)
```

### 마이그레이션 상태 확인

```bash
# 로컬
psql life_dashboard -c "SELECT * FROM _migrations ORDER BY applied_at DESC;"

# Production (Railway)
railway shell --service postgres
SELECT filename, applied_at FROM _migrations ORDER BY applied_at DESC;
```

### 마이그레이션 문제 해결

```bash
# Dry-run으로 테스트
pnpm migrate:dry-run

# 마이그레이션 초기화 (주의!)
pnpm migrate:reset

# 특정 SQL 파일 테스트
psql $DATABASE_URL < sql/020_my_feature.sql
```

## 📊 모니터링

### SSE 연결 상태

```bash
# 실시간 메트릭
curl -H "Authorization: Bearer $TOKEN" \
  https://your-app.railway.app/api/sse-metrics | jq '.'

# 응답 예시:
{
  "success": true,
  "metrics": {
    "activeConnections": 42,
    "healthStatus": "OK",
    "avgEventLatency": 2.5,
    "totalEventsFromTime": 1523,
    "eventTypes": { "heartbeat": 1000, ... }
  }
}
```

### Railway 로그

```bash
# 실시간 로그
railway logs --follow

# 마이그레이션 로그만
railway logs | grep "\[Migration\]"

# SSE 로그만
railway logs | grep "\[SSE\]"

# 에러만
railway logs | grep "ERROR"
```

### 데이터베이스 상태

```bash
# PostgreSQL 접속
railway shell --service postgres

# 연결 수
SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;

# 테이블 크기
SELECT tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

# 마이그레이션 상태
SELECT * FROM _migrations ORDER BY applied_at DESC;
```

## 🔐 보안 체크리스트

- [ ] `JWT_SECRET` 강력한 무작위 문자열
- [ ] `ALLOWED_EMAILS` 신뢰할 수 있는 이메일만
- [ ] 파일 업로드 크기 제한 설정 (`UPLOAD_MAX_SIZE`)
- [ ] HTTPS 강제 (Railway 자동)
- [ ] 데이터베이스 백업 설정
- [ ] 로그 보존 정책 설정
- [ ] 정기적인 보안 업데이트

## 📈 성능 최적화

### SSE 연결 최적화

```bash
# 현재 동시 연결 확인
curl https://your-app.railway.app/api/sse-metrics | jq '.metrics.activeConnections'

# 하트비트 간격 조정 (.env)
SSE_HEARTBEAT_INTERVAL_MS=30000  # 30초

# 메트릭 자동 정리 (10분마다)
# → src/lib/sse-metrics.ts의 cleanup() 자동 호출
```

### 데이터베이스 최적화

```bash
# 인덱스 분석
railway shell --service postgres
ANALYZE;

# 테이블 통계 업데이트
VACUUM ANALYZE;

# 슬로우 쿼리 찾기
SELECT query, calls, total_time
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 10;
```

### 메모리 사용 모니터링

```bash
# Railway 메트릭
railway status

# 컨테이너 메모리
docker stats (로컬 테스트 시)
```

## 🚨 문제 해결

### SSE 연결 끊김

**증상**: 클라이언트가 자주 재연결

**확인**:
```bash
# 메트릭 확인
curl https://your-app.railway.app/api/sse-metrics

# 에러율 > 5%? → 서버 부하 확인
# reconnectAttempts > 50? → 네트워크 문제

# 로그 확인
railway logs | grep "\[SSE\]"
```

**해결**:
1. 서버 리소스 확인 (CPU, 메모리)
2. 동시 연결 수 확인
3. 파일 디스크립터 확인: `ulimit -n`
4. Railway 재배포

### 마이그레이션 실패

**증상**: 배포 후 데이터베이스 스키마 미적용

**확인**:
```bash
# 마이그레이션 테이블 확인
railway shell --service postgres
SELECT * FROM _migrations;

# 서버 로그 확인
railway logs | grep "\[Migration\]"
```

**해결**:
1. SQL 문법 검증: `pnpm migrate:dry-run`
2. 로컬 테스트: `pnpm migrate`
3. 필요시 수동 적용:
   ```bash
   railway shell --service postgres
   psql < sql/020_my_feature.sql
   INSERT INTO _migrations (filename) VALUES ('020_my_feature.sql');
   ```

### 배포 실패

**증상**: GitHub Actions 또는 Railway 배포 실패

**확인**:
1. GitHub Actions 로그: Actions 탭에서 워크플로우 확인
2. Railway 배포 로그: Railway 대시보드 → Deployments
3. Docker 이미지: GHCR 저장소에 이미지 존재 확인

**해결**:
1. 로컬 `pnpm build` 테스트
2. Dockerfile 검증
3. 환경 변수 재확인
4. 이미지 수동 빌드:
   ```bash
   docker build -t my-app:latest .
   docker run --rm -e DATABASE_URL=... my-app:latest node server.js
   ```

## 📚 추가 리소스

- [Railway 문서](https://docs.railway.app/)
- [Next.js 배포](https://nextjs.org/docs/deployment)
- [PostgreSQL 마이그레이션](https://www.postgresql.org/docs/)
- [DevOps 통합 가이드](./docs/devops-integration.md)
- [SSE 구현](./docs/sse-realtime-sync.md)

---

**배포 후 문제 발생 시**: 위 문제 해결 섹션을 참고하거나 `docs/devops-integration.md`의 트러블슈팅을 확인하세요.
