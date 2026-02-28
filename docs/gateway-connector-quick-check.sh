#!/bin/bash
# Gateway Connector Quick Check
# 빠른 상태 확인용 스크립트 (bash로 실행 불필요)

echo "🔍 Gateway Connector Quick Status Check"
echo "========================================"
echo ""

# 1. launchd 서비스 상태
echo "1️⃣  launchd 서비스 상태:"
launchctl print "gui/$(id -u)/com.lifedashboard.gateway-connector" 2>/dev/null | head -10 || echo "   ❌ 서비스 등록 안됨"
echo ""

# 2. 프로세스 상태
echo "2️⃣  프로세스 상태:"
ps aux | grep "gateway-connector.ts" | grep -v grep || echo "   ❌ 프로세스 실행 안됨"
echo ""

# 3. 로그 최근 10줄
echo "3️⃣  최근 로그 (10줄):"
tail -10 /tmp/gateway-connector.log 2>/dev/null || echo "   ⚠️  로그 파일 없음"
echo ""

# 4. 최근 에러
echo "4️⃣  최근 에러:"
tail -50 /tmp/gateway-connector.log 2>/dev/null | grep -E "❌|Error|error|Failed" || echo "   ✅ 에러 없음"
echo ""

# 5. Relay 등록 상태
echo "5️⃣  Relay 등록 상태:"
tail -100 /tmp/gateway-connector.log 2>/dev/null | grep "✅ Registered as:" | tail -1 || echo "   ⚠️  등록 정보 없음"
