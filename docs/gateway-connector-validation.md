# Gateway Connector 검증 체크리스트

## 📋 Overview
gateway-connector의 정상 작동을 검증하기 위한 종합 체크리스트입니다.
launchd 서비스 상태, relay 연결성, 로그 모니터링, 프로세스 헬스체크를 포함합니다.

---

## 🔧 Phase 1: launchd 서비스 상태 확인

### 1.1 서비스 설치 상태
```bash
# plist 파일 확인
ls -la ~/Library/LaunchAgents/com.lifedashboard.gateway-connector.plist

# 예상 결과:
# -rw-r--r--  1 hanchi  staff  1234 Feb 28 10:00 com.lifedashboard.gateway-connector.plist
```

**검증 기준:**
- ✅ 파일이 `~/Library/LaunchAgents/` 에 존재
- ✅ 파일 권한이 644 (-rw-r--r--) 이상
- ✅ 파일 소유자가 현재 사용자

### 1.2 launchd 서비스 활성화 상태
```bash
# 서비스 상태 확인
launchctl print "gui/$(id -u)/com.lifedashboard.gateway-connector"
```

**검증 기준:**
```
  "Label" => com.lifedashboard.gateway-connector
  "State" => running    # ✅ 또는 waiting (초기화 중)
  "Program" => /opt/homebrew/bin/npx tsx scripts/gateway-connector.ts
  "ProgramArguments" => [
    "/opt/homebrew/bin/npx",
    "tsx",
    "scripts/gateway-connector.ts"
  ]
  "WorkingDirectory" => /Users/hanchi/work/life-dashboard
```

실패 시 나타나는 증상:
- ❌ `State` => stopped
- ❌ `Error` => Service not loaded
- ❌ 명령어 자체 실패 (launchctl: service not found)

### 1.3 프로세스 활성화 확인
```bash
# npx tsx 프로세스 확인
ps aux | grep 'gateway-connector'

# 예상 결과:
# hanchi 12345  0.5  1.2  501234567 123456 ??  S    10:00AM   0:05.00 npx tsx scripts/gateway-connector.ts
```

**검증 기준:**
- ✅ `npx tsx scripts/gateway-connector.ts` 프로세스가 실행 중 (PID 존재)
- ✅ CPU 사용률이 정상 범위 (0.1% ~ 5%)
- ✅ 메모리 사용률이 정상 범위 (200MB ~ 500MB)
- ⏰ 프로세스 시작 시간이 최근 (최대 5분 이내)

비정상 징후:
- ❌ 프로세스가 없음 (launchd 자동 재시작 안됨)
- ❌ CPU 급증 (> 50%)
- ❌ 메모리 급증 (> 1GB)
- ❌ Zombie 프로세스 (< defunct > 표시)

---

## 🔌 Phase 2: Relay 연결 상태 확인

### 2.1 로그 모니터링 (실시간)
```bash
# 터미널 1: 로그 스트리밍 시작
tail -f /tmp/gateway-connector.log

# 또는 지난 100줄 확인
tail -100 /tmp/gateway-connector.log
```

**정상 로그 패턴:**
```
╔════════════════════════════════════════╗
║     🔌 Gateway Connector v1.1          ║
╚════════════════════════════════════════╝

📡 Relay URL: http://localhost:3000
🔑 Gateway ID: hanchi-MacBook-Pro.local
⏱️  Poll interval: 3000ms

✅ Claude CLI found
✅ Codex CLI found (fallback enabled)
✅ Registered as: hanchi-MacBook-Pro.local

🔄 Starting poll loop... (Ctrl+C to stop)

🔄 0 interrupted task(s) found from previous run
```

**재시작 후 정상 로그:**
```
🛑 Received SIGTERM, shutting down gracefully...
✅ Task states persisted successfully
🔄 Gateway Connector v1.1 starting...
[로그 반복]
```

### 2.2 Registration 확인
```bash
# 로그에서 다음 라인 확인
grep "✅ Registered as:" /tmp/gateway-connector.log | tail -1

# 예상 결과:
# ✅ Registered as: hanchi-MacBook-Pro.local
```

**검증 기준:**
- ✅ "✅ Registered as:" 메시지가 로그에 있음
- ✅ 메시지 타임스탐프가 최근 (max 5분 이내)
- ✅ Gateway ID가 올바른 값 (일반적으로 hostname)

**연결 실패 증상:**
```
❌ Connection failed: Error: getaddrinfo ENOTFOUND localhost
# 원인: RELAY_URL이 잘못되었거나 대시보드가 실행 중이 아님

❌ Registration failed: { error: 'Unauthorized' }
# 원인: RELAY_API_KEY가 잘못됨

❌ Connection failed: Error: connect ECONNREFUSED 127.0.0.1:3000
# 원인: 대시보드 서버가 실행 중이 아님 (pnpm dev 필요)
```

### 2.3 Poll Loop 활성화 확인
```bash
# 로그에서 폴링 활동 확인
grep -E "(✅|⏳|📥)" /tmp/gateway-connector.log | tail -20

# 정상 폴링 로그:
# (별도 커맨드가 없으면 로그가 거의 없음 - 약 3초마다 조용히 폴링)
```

**검증 기준:**
- ✅ 서비스가 조용히 3초마다 폴링 중 (로그가 많지 않음 = 정상)
- ✅ 에러 로그가 없음
- ✅ 타임스탐프가 계속 업데이트됨 (프로세스 활성)

---

## 🧪 Phase 3: 기능 테스트 (대시보드 통합)

### 3.1 대시보드 Relay 상태 확인
```bash
# 대시보드가 실행 중인 경우, 메시지 탭에서:
# 1. 좌상단 "Gateway Status" 또는 "Relay" 섹션 확인
# 2. gateway-connector가 "Connected" 상태인지 확인
```

**검증 기준:**
- ✅ 대시보드 UI에서 gateway가 "Connected" 상태
- ✅ 마지막 연결 시간이 최근 (< 10초)
- ✅ Gateway ID가 일치

**비정상 상태:**
- ❌ "Disconnected" - relay 연결 끊김
- ❌ "Unknown" - 대시보드가 relay 상태를 모름
- ❌ 마지막 연결 시간이 오래됨 (> 30초)

### 3.2 리모트 커맨드 테스트 (선택사항)
```bash
# 대시보드에서 test 에이전트에 간단한 작업 전송
# (예: "echo 'test command'")

# 로그 확인:
tail -50 /tmp/gateway-connector.log | grep -A 5 "📥 Received command"

# 예상 로그:
# 📥 Received command: spawn
#    Payload: { agentId: 'test', task: 'echo test command' }
#    🚀 Spawning Claude for agent: test
#    ✅ Task completed for test
```

**검증 기준:**
- ✅ 커맨드가 수신됨
- ✅ 실행이 시작됨
- ✅ 작업이 완료되거나 예상대로 실패
- ✅ 결과가 대시보드에 반영됨

---

## 📊 Phase 4: 헬스체크 및 모니터링

### 4.1 프로세스 헬스 확인 스크립트
```bash
#!/bin/bash
# gateway-health-check.sh

GATEWAY_PID=$(pgrep -f "gateway-connector.ts")

if [ -z "$GATEWAY_PID" ]; then
  echo "❌ Gateway process not running"
  exit 1
fi

# 메모리 확인
MEMORY=$(ps -p $GATEWAY_PID -o %mem= | xargs)
if (( $(echo "$MEMORY > 5" | bc -l) )); then
  echo "⚠️  High memory usage: ${MEMORY}%"
fi

# CPU 확인
CPU=$(ps -p $GATEWAY_PID -o %cpu= | xargs)
if (( $(echo "$CPU > 50" | bc -l) )); then
  echo "⚠️  High CPU usage: ${CPU}%"
fi

# 로그 최근 에러 확인
RECENT_ERRORS=$(tail -100 /tmp/gateway-connector.log | grep -i "❌\|error\|failed" | wc -l)
if [ $RECENT_ERRORS -gt 5 ]; then
  echo "⚠️  Recent errors detected: $RECENT_ERRORS"
fi

echo "✅ Gateway health check passed"
```

### 4.2 자동 모니터링 (cron)
```bash
# 10분마다 헬스체크 실행
*/10 * * * * /Users/hanchi/work/life-dashboard/scripts/gateway-health-check.sh >> /tmp/gateway-health.log 2>&1

# 로그 확인
tail -f /tmp/gateway-health.log
```

### 4.3 에러 로그 분석
```bash
# 최근 에러 추출
tail -1000 /tmp/gateway-connector.log | grep -E "❌|Error|Failed"

# 특정 에러 검색
grep "Connection failed" /tmp/gateway-connector.log | tail -5

# 에러 빈도 분석
grep -c "❌" /tmp/gateway-connector.log
```

---

## 🔄 Phase 5: 재시작 및 복구 검증

### 5.1 정상 재시작 테스트
```bash
# 1. 서비스 재시작
pnpm gateway:restart

# 2. 재시작 확인
sleep 2
pnpm gateway:status

# 3. 로그에서 재시작 이벤트 확인
tail -50 /tmp/gateway-connector.log | grep -E "Gateway Connector|Restarting|🔄"

# 예상 로그:
# 🛑 Received SIGTERM, shutting down gracefully...
# ✅ Task states persisted successfully
# 🔌 Gateway Connector v1.1
# ✅ Registered as: hanchi-MacBook-Pro.local
# 🔄 Starting poll loop...
```

**검증 기준:**
- ✅ 서비스가 graceful shutdown 수행
- ✅ 다시 시작되고 registration 성공
- ✅ 재시작 후 상태가 "running"

### 5.2 강제 재시작 후 태스크 복구
```bash
# 1. 대시보드에서 장시간 작업 전송 (선택사항)
# 2. 강제 종료
sudo kill -9 $(pgrep -f "gateway-connector.ts")

# 3. 복구 로그 확인
tail -100 /tmp/gateway-connector.log | grep -E "interrupted|복구|Recovery"

# 예상 로그:
# 🔄 {N} interrupted task(s) found from previous run
# 📨 PM에게 재시작 알림 전송 완료
# 🔄 Recovering task for {agentId}: ...
# ✅ Recovery process completed ({N} tasks re-queued)
```

**검증 기준:**
- ✅ 중단된 태스크가 감지됨
- ✅ 복구 시도가 수행됨
- ✅ 복구 완료 로그가 있음

---

## 🛠️ Phase 6: 환경 및 의존성 검증

### 6.1 필수 CLI 도구 확인
```bash
# Claude CLI
which claude
claude --version  # 예: claude 1.x.x

# Codex CLI (fallback)
which codex
codex --version  # 예: Codex version ...

# Node.js / npm / pnpm
node --version   # v20.x.x 이상
pnpm --version   # 9.x.x 이상
```

**로그 확인:**
```bash
grep -E "Claude CLI|Codex CLI" /tmp/gateway-connector.log

# 정상:
# ✅ Claude CLI found
# ✅ Codex CLI found (fallback enabled)

# 경고:
# ⚠️  Claude CLI not found - tasks will fail
# ⚠️  Codex CLI not found - fallback disabled
```

### 6.2 환경변수 확인
```bash
# .env.local 파일 확인
grep -E "RELAY_URL|RELAY_API_KEY|GATEWAY_ID|POLL_INTERVAL" ~/.env.local

# 또는 gateway-connector 로그에서:
grep "Relay URL\|Gateway ID\|Poll interval" /tmp/gateway-connector.log
```

**검증 기준:**
- ✅ RELAY_URL이 설정됨 (예: http://localhost:3000)
- ✅ RELAY_API_KEY가 설정됨
- ✅ POLL_INTERVAL이 합리적 (기본 3000ms)
- ✅ 값들이 로그에 표시됨

### 6.3 데이터베이스 연결 확인
```bash
# (gateway-connector는 DB에 직접 접근하지 않지만, relay는 접근함)
# PostgreSQL 상태 확인
psql postgresql://localhost:5432/life_dashboard -c "SELECT 1;"

# 결과:
# ?column?
# ----------
#        1
```

---

## 📈 Phase 7: 성능 및 안정성 모니터링

### 7.1 메모리 누수 감시
```bash
# 1시간 동안 메모리 사용률 기록
for i in {1..60}; do
  date >> /tmp/gateway-memory.log
  ps -p $(pgrep -f "gateway-connector.ts") -o %mem= >> /tmp/gateway-memory.log
  sleep 60
done

# 분석
sort -n /tmp/gateway-memory.log | tail -10
# 평상시: 0.2% ~ 0.5% (안정적)
# 증가 추세: > 1% (메모리 누수 의심)
```

### 7.2 로그 파일 크기 모니터링
```bash
# 일일 로그 회전 설정 (선택사항)
ls -lh /tmp/gateway-connector.log
ls -lh /tmp/gateway-connector.err

# 로그가 1GB 이상이면 회전 필요
# logrotate 또는 다른 로그 관리 도구 사용
```

### 7.3 네트워크 연결 확인
```bash
# gateway-connector의 네트워크 연결 상태
lsof -i -a -p $(pgrep -f "gateway-connector.ts")

# 예상 결과:
# npx    PID  user    FD   TYPE            DEVICE SIZE/OFF NODE NAME
# npx    123  user    10u  IPv4 0x12345678      0t0  TCP localhost:60123->localhost:3000 (ESTABLISHED)
```

**검증 기준:**
- ✅ RELAY_URL 호스트로의 ESTABLISHED 연결이 있음
- ✅ 연결이 지속적으로 유지됨
- ✅ TIME_WAIT 상태의 연결만 많음 (정상)

---

## ✅ 최종 체크리스트

### 자동 검증 스크립트
```bash
#!/bin/bash
# gateway-full-validation.sh

echo "🔍 Gateway Connector Full Validation"
echo "===================================="

# 1. 서비스 상태
echo -n "✓ Service installed: "
launchctl print "gui/$(id -u)/com.lifedashboard.gateway-connector" >/dev/null 2>&1 && echo "✅" || echo "❌"

# 2. 프로세스 활성
echo -n "✓ Process running: "
pgrep -f "gateway-connector.ts" >/dev/null && echo "✅" || echo "❌"

# 3. 최근 로그
echo -n "✓ Recent logs: "
[ -f /tmp/gateway-connector.log ] && echo "✅" || echo "❌"

# 4. Registration
echo -n "✓ Registered with relay: "
grep "✅ Registered as:" /tmp/gateway-connector.log >/dev/null && echo "✅" || echo "❌"

# 5. Recent errors
ERRORS=$(tail -100 /tmp/gateway-connector.log | grep -c "❌")
echo -n "✓ No recent errors (last 100 lines): "
[ $ERRORS -eq 0 ] && echo "✅" || echo "⚠️ ($ERRORS errors)"

# 6. CLI tools
echo -n "✓ Claude CLI: "
which claude >/dev/null && echo "✅" || echo "❌"

echo -n "✓ Codex CLI: "
which codex >/dev/null && echo "✅ (fallback)" || echo "⚠️ (fallback disabled)"

echo ""
echo "Validation complete!"
```

### 사용법
```bash
chmod +x scripts/gateway-full-validation.sh
./scripts/gateway-full-validation.sh
```

---

## 🐛 트러블슈팅

| 증상 | 원인 | 해결책 |
|------|------|--------|
| "Service not loaded" | plist 파일이 없음 또는 설치 실패 | `pnpm gateway:install` 재실행 |
| "Process not running" | launchd가 프로세스를 시작하지 못함 | `tail -f /tmp/gateway-connector.err` 확인 후 `pnpm gateway:restart` |
| "Connection refused" | 대시보드가 실행 중이 아님 | `pnpm dev` 로 대시보드 시작 |
| "Registration failed" | RELAY_API_KEY 틀림 | `.env.local` 확인 후 서비스 재시작 |
| "High memory usage" | 메모리 누수 | 서비스 재시작 후 메모리 모니터링 |
| "No logs" | 로그 파일이 없음 | plist 파일의 StandardOutPath 확인, 권한 확인 |

---

## 📞 지원

검증 중 문제가 발생하면:
1. `/tmp/gateway-connector.log` 및 `/tmp/gateway-connector.err` 확인
2. `pnpm gateway:status` 로 서비스 상태 확인
3. `pnpm gateway:restart` 로 재시작
4. 로그 파일 공유 및 오류 메시지 수집
