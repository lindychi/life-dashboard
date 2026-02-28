#!/bin/bash

# Permission System Test Runner
# Runs all permission-related tests with detailed output

echo "🔒 Permission Approval System - Test Suite"
echo "=========================================="
echo ""

# Run permission tests with coverage
echo "📋 Running permission system tests..."
echo ""

# Core permission logic tests
echo "1️⃣  Core Permission Logic"
pnpm vitest run src/lib/__tests__/permissions.test.ts --reporter=verbose

# Permission approvals data layer tests
echo ""
echo "2️⃣  Permission Approvals Data Layer"
pnpm vitest run src/lib/__tests__/permission-approvals.test.ts --reporter=verbose

# E2E scenario tests
echo ""
echo "3️⃣  End-to-End Scenario Tests"
pnpm vitest run src/lib/__tests__/permission-scenarios.test.ts --reporter=verbose

# API route tests
echo ""
echo "4️⃣  API Route Tests"
pnpm vitest run src/app/api/permissions/approvals/__tests__/route.test.ts --reporter=verbose
pnpm vitest run "src/app/api/permissions/approvals/[id]/__tests__/route.test.ts" --reporter=verbose

# Gateway integration tests
echo ""
echo "5️⃣  Gateway Connector Integration"
pnpm vitest run scripts/__tests__/permission-checker.test.ts --reporter=verbose

echo ""
echo "=========================================="
echo "✅ Test suite completed!"
