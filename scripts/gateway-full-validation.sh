#!/bin/bash
# Gateway Connector Full Validation Script
# 종합적인 gateway-connector 정상 작동 검증

set -e

GATEWAY_LABEL="com.lifedashboard.gateway-connector"
LOG_FILE="/tmp/gateway-connector.log"
ERR_FILE="/tmp/gateway-connector.err"
PROJECT_DIR="/Users/hanchi/work/life-dashboard"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# Helper functions
check_pass() {
  echo -e "${GREEN}✅${NC} $1"
  ((PASSED++))
}

check_fail() {
  echo -e "${RED}❌${NC} $1"
  ((FAILED++))
}

check_warn() {
  echo -e "${YELLOW}⚠️${NC}  $1"
  ((WARNINGS++))
}

check_info() {
  echo -e "${BLUE}ℹ️${NC}  $1"
}

section() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Main validation
main() {
  echo ""
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║    🔌 Gateway Connector Full Validation Script             ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""
  echo "시작 시간: $(date '+%Y-%m-%d %H:%M:%S')"
  echo ""

  # Phase 1: launchd Service Status
  section "Phase 1: launchd 서비스 상태"

  # 1.1 plist 파일 확인
  PLIST_PATH="$HOME/Library/LaunchAgents/$GATEWAY_LABEL.plist"
  if [ -f "$PLIST_PATH" ]; then
    check_pass "plist 파일 존재: $PLIST_PATH"

    # 파일 권한 확인
    PERMS=$(stat -f "%OLp" "$PLIST_PATH")
    if [ "$PERMS" = "-rw-r--r--" ] || [ "$PERMS" = "-rw-r--r-" ]; then
      check_pass "plist 파일 권한 정상: $PERMS"
    else
      check_warn "plist 파일 권한: $PERMS (644 권장)"
    fi
  else
    check_fail "plist 파일 없음: $PLIST_PATH"
  fi

  # 1.2 launchd 서비스 상태
  if launchctl print "gui/$(id -u)/$GATEWAY_LABEL" >/dev/null 2>&1; then
    check_pass "launchd 서비스 등록됨"

    # 상태 추출
    STATE=$(launchctl print "gui/$(id -u)/$GATEWAY_LABEL" 2>/dev/null | grep -A1 '"State"' | tail -1 | grep -oE '(running|stopped|waiting)' || echo "unknown")
    if [ "$STATE" = "running" ]; then
      check_pass "서비스 상태: running"
    elif [ "$STATE" = "waiting" ]; then
      check_warn "서비스 상태: waiting (초기화 중)"
    else
      check_fail "서비스 상태: $STATE"
    fi
  else
    check_fail "launchd 서비스 등록 안됨"
  fi

  # 1.3 프로세스 활성화 확인
  GATEWAY_PID=$(pgrep -f "gateway-connector.ts" || echo "")
  if [ -n "$GATEWAY_PID" ]; then
    check_pass "프로세스 실행 중: PID=$GATEWAY_PID"

    # CPU 사용률
    CPU=$(ps -p $GATEWAY_PID -o %cpu= 2>/dev/null | xargs || echo "0")
    if (( $(echo "$CPU < 10" | bc -l 2>/dev/null || echo 0) )); then
      check_pass "CPU 사용률 정상: ${CPU}%"
    else
      check_warn "CPU 사용률 높음: ${CPU}%"
    fi

    # 메모리 사용률
    MEMORY=$(ps -p $GATEWAY_PID -o %mem= 2>/dev/null | xargs || echo "0")
    if (( $(echo "$MEMORY < 2" | bc -l 2>/dev/null || echo 0) )); then
      check_pass "메모리 사용률 정상: ${MEMORY}%"
    else
      check_warn "메모리 사용률 높음: ${MEMORY}%"
    fi

    # 프로세스 시작 시간
    START_TIME=$(ps -p $GATEWAY_PID -o lstart= 2>/dev/null || echo "unknown")
    check_info "프로세스 시작 시간: $START_TIME"
  else
    check_fail "프로세스 실행 안됨"
  fi

  # Phase 2: Relay Connection
  section "Phase 2: Relay 연결 상태"

  # 2.1 로그 파일 확인
  if [ -f "$LOG_FILE" ]; then
    check_pass "로그 파일 존재: $LOG_FILE"
    LOG_SIZE=$(du -h "$LOG_FILE" | cut -f1)
    check_info "로그 파일 크기: $LOG_SIZE"
  else
    check_fail "로그 파일 없음: $LOG_FILE"
  fi

  # 2.2 Registration 확인
  if grep -q "✅ Registered as:" "$LOG_FILE" 2>/dev/null; then
    check_pass "Relay 등록됨"

    # 마지막 registration 시간
    LAST_REG=$(grep "✅ Registered as:" "$LOG_FILE" | tail -1 || echo "")
    check_info "마지막 등록: ${LAST_REG:0:80}"

    # 등록 후 경과 시간
    if [ -n "$LAST_REG" ]; then
      REG_TIMESTAMP=$(date -jf "%a %b %d %H:%M:%S %Z %Y" "$(echo $LAST_REG | grep -oE '[A-Za-z]{3} [A-Za-z]{3} [0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}')" 2>/dev/null || echo "")
      if [ -n "$REG_TIMESTAMP" ]; then
        ELAPSED=$(($(date +%s) - REG_TIMESTAMP))
        if [ $ELAPSED -lt 300 ]; then
          check_pass "등록 이후 경과 시간: ${ELAPSED}초 (최근)"
        elif [ $ELAPSED -lt 600 ]; then
          check_warn "등록 이후 경과 시간: ${ELAPSED}초 (약간 오래됨)"
        else
          check_warn "등록 이후 경과 시간: $((ELAPSED/60))분 (오래됨)"
        fi
      fi
    fi
  else
    check_fail "Relay 등록 안됨"
  fi

  # 2.3 Poll Loop 확인
  POLL_COUNT=$(grep -c "poll\|polling" "$LOG_FILE" 2>/dev/null || echo "0")
  if [ "$POLL_COUNT" -gt 0 ]; then
    check_pass "Poll loop 활성: $POLL_COUNT 항목"
  else
    check_warn "Poll loop 항목 없음 (최근 로그 없을 수 있음)"
  fi

  # 2.4 연결 에러 확인
  CONNECTION_ERRORS=$(tail -200 "$LOG_FILE" 2>/dev/null | grep -c "Connection failed\|ECONNREFUSED\|ENOTFOUND" || echo "0")
  if [ "$CONNECTION_ERRORS" -eq 0 ]; then
    check_pass "연결 에러 없음"
  else
    check_fail "최근 연결 에러: $CONNECTION_ERRORS"
    tail -200 "$LOG_FILE" | grep -E "Connection failed|ECONNREFUSED|ENOTFOUND" | head -3
  fi

  # Phase 3: CLI Tools
  section "Phase 3: 필수 CLI 도구"

  # Claude CLI
  if which claude >/dev/null 2>&1; then
    CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
    check_pass "Claude CLI 설치됨: $CLAUDE_VERSION"
  else
    check_fail "Claude CLI 설치 안됨"
  fi

  # Codex CLI
  if which codex >/dev/null 2>&1; then
    CODEX_VERSION=$(codex --version 2>/dev/null || echo "unknown")
    check_pass "Codex CLI 설치됨: $CODEX_VERSION (fallback)"
  else
    check_warn "Codex CLI 설치 안됨 (fallback 비활성화)"
  fi

  # Node.js
  if which node >/dev/null 2>&1; then
    NODE_VERSION=$(node --version)
    check_pass "Node.js 설치됨: $NODE_VERSION"
  else
    check_fail "Node.js 설치 안됨"
  fi

  # pnpm
  if which pnpm >/dev/null 2>&1; then
    PNPM_VERSION=$(pnpm --version)
    check_pass "pnpm 설치됨: $PNPM_VERSION"
  else
    check_fail "pnpm 설치 안됨"
  fi

  # Phase 4: Environment Variables
  section "Phase 4: 환경변수 확인"

  ENV_FILE="$PROJECT_DIR/.env.local"
  if [ -f "$ENV_FILE" ]; then
    check_pass "환경파일 존재: $ENV_FILE"

    # RELAY_URL 확인
    if grep -q "^RELAY_URL=" "$ENV_FILE"; then
      RELAY_URL=$(grep "^RELAY_URL=" "$ENV_FILE" | cut -d'=' -f2)
      check_info "RELAY_URL: $RELAY_URL"
    else
      check_warn "RELAY_URL 설정 안됨"
    fi

    # RELAY_API_KEY 확인
    if grep -q "^RELAY_API_KEY=" "$ENV_FILE"; then
      check_pass "RELAY_API_KEY 설정됨"
    else
      check_warn "RELAY_API_KEY 설정 안됨"
    fi
  else
    check_warn "환경파일 없음: $ENV_FILE (기본값 사용)"
  fi

  # Phase 5: Recent Errors
  section "Phase 5: 최근 에러 분석"

  # 최근 100줄에서 에러 검색
  ERROR_COUNT=$(tail -100 "$LOG_FILE" 2>/dev/null | grep -c "❌\|Error\|error\|Failed\|failed" || echo "0")
  if [ "$ERROR_COUNT" -eq 0 ]; then
    check_pass "최근 에러 없음 (최근 100줄)"
  else
    check_warn "최근 에러 감지: $ERROR_COUNT"
    check_info "최근 에러 목록:"
    tail -100 "$LOG_FILE" | grep -E "❌|Error|error|Failed|failed" | head -5 | while read line; do
      echo "  $line"
    done
  fi

  # Phase 6: Network Connectivity
  section "Phase 6: 네트워크 연결"

  # 호스트 연결 확인
  RELAY_URL=$(grep "^RELAY_URL=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 || echo "http://localhost:3000")
  RELAY_HOST=$(echo "$RELAY_URL" | sed 's|.*://||' | cut -d':' -f1)
  RELAY_PORT=$(echo "$RELAY_URL" | sed 's|.*:||' | grep -oE '[0-9]+' || echo "80")

  if timeout 5 bash -c "echo > /dev/tcp/$RELAY_HOST/$RELAY_PORT" 2>/dev/null; then
    check_pass "Relay 서버 연결 가능: $RELAY_HOST:$RELAY_PORT"
  else
    check_fail "Relay 서버 연결 불가: $RELAY_HOST:$RELAY_PORT"
  fi

  # 게이트웨이의 네트워크 연결 확인 (프로세스가 실행 중인 경우)
  if [ -n "$GATEWAY_PID" ]; then
    ESTABLISHED=$(lsof -i -a -p $GATEWAY_PID 2>/dev/null | grep -c "ESTABLISHED" || echo "0")
    if [ "$ESTABLISHED" -gt 0 ]; then
      check_pass "게이트웨이 활성 연결: $ESTABLISHED개"
    else
      check_warn "게이트웨이 활성 연결 없음"
    fi
  fi

  # Phase 7: Summary
  section "최종 검증 요약"

  TOTAL=$((PASSED + FAILED + WARNINGS))
  echo ""
  echo "검증 완료 시간: $(date '+%Y-%m-%d %H:%M:%S')"
  echo ""
  echo -e "결과:"
  echo -e "  ${GREEN}✅ 통과${NC}:  $PASSED"
  if [ $WARNINGS -gt 0 ]; then
    echo -e "  ${YELLOW}⚠️  경고${NC}:  $WARNINGS"
  fi
  if [ $FAILED -gt 0 ]; then
    echo -e "  ${RED}❌ 실패${NC}:  $FAILED"
  fi
  echo -e "  총계:    $TOTAL"
  echo ""

  # 최종 판정
  if [ $FAILED -eq 0 ]; then
    if [ $WARNINGS -eq 0 ]; then
      echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
      echo -e "${GREEN}✅ 모든 검증 통과! Gateway Connector가 정상 작동 중입니다.${NC}"
      echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
      exit 0
    else
      echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
      echo -e "${YELLOW}⚠️  검증 통과 (경고 $WARNINGS개). 상세 확인 권장.${NC}"
      echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
      exit 0
    fi
  else
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}❌ 검증 실패! 아래 항목을 확인하세요:${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "1. 로그 파일 확인:"
    echo "   tail -100 /tmp/gateway-connector.log | grep -E '❌|Error|error'"
    echo ""
    echo "2. 서비스 재시작:"
    echo "   pnpm gateway:restart"
    echo ""
    echo "3. 상태 확인:"
    echo "   pnpm gateway:status"
    echo ""
    exit 1
  fi
}

# 스크립트 실행
main "$@"
