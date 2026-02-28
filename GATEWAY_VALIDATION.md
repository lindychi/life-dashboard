# Gateway Connector 정상 작동 검증 가이드

## 🎯 목적
launchd 서비스 재시작 후 gateway-connector가 올바르게 작동하는지 검증합니다.
- ✅ launchd 서비스 등록 및 실행 상태
- ✅ Relay 연결 상태
- ✅ 로그 모니터링
- ✅ 헬스체크 및 성능 모니터링

---

## 📋 빠른 체크 (1분)

### Step 1: 서비스 상태 확인
```bash
# 터미널에서 실행
pnpm gateway:status

# 예상 결과:
# State = "running" 또는 "waiting"
# ✅ Running
```

**해석:**
- ✅ `State = "running"` → 정상 작동 중
- ⏳ `State = "waiting"` → 초기화 중 (잠시 대기)
- ❌ 명령어 오류 또는 `not running` → 서비스 미등록

### Step 2: 프로세스 확인
```bash
ps aux | grep gateway-connector.ts | grep -v grep

# 예상 결과:
# hanchi 12345  0.5  0.8  501234567 123456 ??  S    10:00AM   0:05.00 npx tsx scripts/gateway-connector.ts
```

**해석:**
- ✅ 프로세스 라인이 나타남 → 실행 중
- ❌ 결과 없음 → 프로세스 미실행

### Step 3: 로그 확인
```bash
# 최근 20줄 로그 확인
tail -20 /tmp/gateway-connector.log

# 정상 로그 패턴:
# ✅ Registered as: ...
# 🔄 Starting poll loop...
# (조용한 상태 = 정상, 폴링 중)

# 비정상 로그:
# ❌ Connection failed: ...
# Error: ...
# Failed to register: ...
```

**결론:**
- ✅ 모두 정상 → gateway-connector 정상 작동
- ⚠️ 경고 메시지 → Step 4로 이동
- ❌ 에러 메시지 → 트러블슈팅 섹션 참조

---

## 🔍 상세 검증 (5분)

### Phase 1: launchd 서비스 상태

#### 1.1 plist 파일 확인
```bash
ls -la ~/Library/LaunchAgents/com.lifedashboard.gateway-connector.plist

# 예상 결과:
# -rw-r--r--  1 hanchi  staff  1234 Feb 28 10:00 ...
```

**체크리스트:**
- ✅ 파일이 존재하는가?
- ✅ 소유자가 현재 사용자인가?
- ✅ 권한이 644 이상인가?

#### 1.2 launchd 상세 상태
```bash
launchctl print "gui/$(id -u)/com.lifedashboard.gateway-connector" | head -20

# 주요 필드:
# "Label" => com.lifedashboard.gateway-connector ✅
# "State" => running ✅
# "Program" => /opt/homebrew/bin/npx ✅
# "ProgramArguments" => [...] ✅
# "WorkingDirectory" => /Users/hanchi/work/life-dashboard ✅
# "KeepAlive" => true ✅
# "RunAtLoad" => true ✅
```

#### 1.3 프로세스 상세 정보
```bash
GATEWAY_PID=$(pgrep -f "gateway-connector.ts")
ps -p $GATEWAY_PID -o pid,user,%cpu,%mem,command

# 예상 결과:
#   PID USER     %CPU %MEM COMMAND
# 12345 hanchi    0.5  0.8 npx tsx scripts/gateway-connector.ts

# 성능 지표:
# %CPU < 10% ✅ (정상)
# %MEM < 2%  ✅ (정상)
# %CPU > 50% ❌ (CPU 누수)
# %MEM > 5%  ❌ (메모리 누수)
```

---

### Phase 2: Relay 연결 상태

#### 2.1 등록 상태 확인
```bash
# 마지막 등록 기록
grep "✅ Registered as:" /tmp/gateway-connector.log | tail -1

# 예상 결과:
# ✅ Registered as: hanchi-MacBook-Pro.local
```

**기준:**
- ✅ 메시지 있음 → Relay 등록 성공
- ❌ 메시지 없음 → 연결 실패

#### 2.2 등록 시간 확인
```bash
# 마지막 등록 이후 경과 시간
LAST_LOG=$(tail -1 /tmp/gateway-connector.log)
echo "마지막 로그: $LAST_LOG"

# 수동 계산: 타임스탐프 vs 현재 시간
# 경과 시간 < 5분 ✅ (최근)
# 경과 시간 5~10분 ⚠️ (약간 오래)
# 경과 시간 > 10분 ❌ (오래됨, 서비스 재시작 필요)
```

#### 2.3 폴링 활동 확인
```bash
# 최근 100줄 로그에서 폴링 횟수
tail -100 /tmp/gateway-connector.log | wc -l

# 예상:
# 로그가 5줄 미만 → 정상 (조용히 폴링 중)
# 로그가 많음 + 에러 없음 → 정상
# 로그에 에러 있음 → 문제 있음
```

#### 2.4 연결 에러 확인
```bash
# 최근 연결 에러 검색
tail -200 /tmp/gateway-connector.log | grep -E "Connection failed|ECONNREFUSED|ENOTFOUND|error" | head -5

# 없음 ✅ → 정상
# 있음 ❌ → 문제 분석 필요
```

---

### Phase 3: 환경 및 의존성

#### 3.1 CLI 도구 확인
```bash
# Claude CLI
which claude && claude --version || echo "❌ Claude CLI not found"

# Codex CLI (fallback)
which codex && codex --version || echo "⚠️  Codex CLI not found"

# Node.js / npm
node --version
npm --version
```

#### 3.2 환경변수 확인
```bash
# .env.local 확인
grep -E "RELAY_URL|RELAY_API_KEY|GATEWAY_ID|POLL_INTERVAL" ~/.env.local

# 각 항목 확인:
# RELAY_URL=... ✅
# RELAY_API_KEY=... ✅
# GATEWAY_ID=... ✅
# POLL_INTERVAL=... ✅
```

#### 3.3 데이터베이스 연결 (선택)
```bash
# PostgreSQL 상태 확인
psql postgresql://localhost:5432/life_dashboard -c "SELECT 1;"

# 결과: "1" ✅ → 정상
```

---

### Phase 4: 성능 모니터링

#### 4.1 메모리 안정성 (1분 간격, 10회)
```bash
for i in {1..10}; do
  GATEWAY_PID=$(pgrep -f "gateway-connector.ts")
  echo "$(date '+%H:%M:%S') - Memory: $(ps -p $GATEWAY_PID -o %mem= 2>/dev/null || echo 'N/A')%"
  sleep 60
done

# 예상:
# 10:00:00 - Memory: 0.5%
# 10:01:00 - Memory: 0.5%
# 10:02:00 - Memory: 0.5%
# ...
#
# ✅ 안정적 (메모리 변화 없음)
# ❌ 증가 추세 (메모리 누수)
```

#### 4.2 네트워크 연결 확인
```bash
# gateway-connector의 활성 연결
GATEWAY_PID=$(pgrep -f "gateway-connector.ts")
lsof -i -a -p $GATEWAY_PID | grep ESTABLISHED

# 예상 결과:
# npx    PID  user   10u IPv4 ...TCP localhost:60123->localhost:3000 (ESTABLISHED)
#
# ✅ ESTABLISHED 연결이 있음 → Relay와 통신 중
# ❌ 연결이 없음 → 연결 끊김
```

---

## 🔄 재시작 및 복구 검증

### 시나리오 1: 정상 재시작
```bash
# 1. 서비스 재시작
pnpm gateway:restart

# 2. 재시작 확인 (5초 대기)
sleep 5
pnpm gateway:status

# 예상:
# ✅ Running

# 3. 로그에서 재시작 이벤트 확인
tail -20 /tmp/gateway-connector.log | grep -E "Restarting|Starting|Registered"

# 예상 로그:
# 🛑 Received SIGTERM, shutting down gracefully...
# ✅ Task states persisted successfully
# 🔌 Gateway Connector v1.1
# ✅ Registered as: ...
# 🔄 Starting poll loop...
```

### 시나리오 2: 강제 종료 후 복구
```bash
# 1. 프로세스 강제 종료
GATEWAY_PID=$(pgrep -f "gateway-connector.ts")
kill -9 $GATEWAY_PID

# 2. launchd가 자동 재시작할 때까지 대기 (최대 5초)
sleep 6

# 3. 재시작 확인
pgrep -f "gateway-connector.ts" && echo "✅ 자동 재시작됨" || echo "❌ 자동 재시작 실패"

# 4. 복구 로그 확인
tail -30 /tmp/gateway-connector.log | grep -E "interrupted|Recovery|recovering"

# 예상:
# 🔄 {N} interrupted task(s) found from previous run
# 🔄 Recovering task for ...
# ✅ Recovery process completed
```

---

## ✅ 최종 검증 체크리스트

| 항목 | 확인 방법 | 성공 기준 | 상태 |
|------|---------|---------|------|
| plist 파일 | `ls -la ~/Library/LaunchAgents/com.lifedashboard.gateway-connector.plist` | 파일 존재, 644 권한 | ⬜ |
| launchd 등록 | `launchctl print "gui/$(id -u)/com.lifedashboard.gateway-connector"` | State = running/waiting | ⬜ |
| 프로세스 실행 | `ps aux \| grep gateway-connector.ts` | PID 존재 | ⬜ |
| CPU 사용률 | `ps -p $PID -o %cpu=` | < 10% | ⬜ |
| 메모리 사용률 | `ps -p $PID -o %mem=` | < 2% | ⬜ |
| Relay 등록 | `grep "✅ Registered as:" /tmp/gateway-connector.log` | 메시지 있음 | ⬜ |
| 등록 시간 | 마지막 로그 타임스탐프 | < 5분 | ⬜ |
| 연결 에러 | `tail -200 /tmp/gateway-connector.log \| grep error` | 에러 없음 | ⬜ |
| Claude CLI | `which claude && claude --version` | 설치됨 | ⬜ |
| Codex CLI | `which codex && codex --version` | 설치됨 (fallback) | ⬜ |
| 환경변수 | `.env.local` 내용 | RELAY_URL 등 설정 | ⬜ |
| 네트워크 연결 | `lsof -i -a -p $PID \| grep ESTABLISHED` | 연결 존재 | ⬜ |

---

## 🐛 트러블슈팅

### 문제 1: "Service not loaded"
```
증상: launchctl print 명령어에서 오류 발생
원인: plist 파일이 없거나 설치 실패
해결책:
  1. pnpm gateway:install
  2. pnpm gateway:status 확인
```

### 문제 2: "Process not running"
```
증상: ps aux 결과에 프로세스 없음
원인: launchd가 프로세스를 시작하지 못함
해결책:
  1. 로그 확인: tail -f /tmp/gateway-connector.err
  2. 서비스 재시작: pnpm gateway:restart
  3. 환경변수 확인: .env.local
```

### 문제 3: "Connection refused"
```
증상: 로그에 "ECONNREFUSED" 또는 "Connection failed"
원인: 대시보드가 실행 중이 아님
해결책:
  1. 대시보드 시작: pnpm dev
  2. RELAY_URL 확인 (.env.local)
  3. 서비스 재시작: pnpm gateway:restart
```

### 문제 4: "High memory usage"
```
증상: 메모리 사용률 > 5%
원인: 메모리 누수
해결책:
  1. 서비스 재시작: pnpm gateway:restart
  2. 메모리 재확인
  3. 증가 추세 계속되면 원인 분석 필요
```

### 문제 5: "No logs"
```
증상: /tmp/gateway-connector.log 파일 없음
원인: 로그 파일이 생성되지 않음
해결책:
  1. 파일 권한 확인: ls -la /tmp
  2. 서비스 재시작: pnpm gateway:restart
  3. 로그 경로 plist에서 확인
```

---

## 📊 자동화된 검증

### 전체 검증 스크립트 실행
```bash
# 스크립트에 실행 권한 부여
chmod +x scripts/gateway-full-validation.sh

# 실행
./scripts/gateway-full-validation.sh

# 출력:
# 🔌 Gateway Connector Full Validation Script
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Phase 1: launchd 서비스 상태
# ✅ plist 파일 존재
# ✅ launchd 서비스 등록됨
# ...
# 최종 결과:
# ✅ 통과: 12
# ⚠️  경고: 0
# ❌ 실패: 0
```

### 정기적인 모니터링 (cron)
```bash
# crontab 편집
crontab -e

# 10분마다 헬스체크 추가
*/10 * * * * /Users/hanchi/work/life-dashboard/scripts/gateway-full-validation.sh >> /tmp/gateway-health.log 2>&1
```

---

## 📞 지원

검증 중 문제가 발생하면:

1. **로그 수집**
   ```bash
   tail -100 /tmp/gateway-connector.log
   tail -100 /tmp/gateway-connector.err
   ```

2. **상태 스냅샷**
   ```bash
   pnpm gateway:status
   ps aux | grep gateway-connector.ts
   ```

3. **환경 확인**
   ```bash
   grep RELAY ~/.env.local
   which claude && claude --version
   which codex && codex --version
   ```

4. **문제 보고 시 포함 사항**
   - 위 로그/상태 정보
   - 에러 메시지 전체
   - 수행한 조치 내역
   - 예상 vs 실제 동작

---

## 📝 버전 정보

- **Gateway Connector**: v1.1
- **Last Updated**: 2025-02-28
- **Documentation**: `docs/gateway-connector-validation.md`
