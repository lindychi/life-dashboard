#!/usr/bin/env bash
# Pre-commit TDD validation hook
# Usage: Add to .git/hooks/pre-commit or run manually before commit

set -e

BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
RESET='\033[0m'

echo -e "${BOLD}${BLUE}🔍 TDD Pre-Commit Validation${RESET}\n"

# Get staged files
STAGED_TS_FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx)$' | grep -v '\.test\.' || true)
STAGED_TEST_FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.test\.(ts|tsx)$' || true)

if [[ -z "$STAGED_TS_FILES" && -z "$STAGED_TEST_FILES" ]]; then
  echo -e "${GREEN}✓ No TypeScript files to validate${RESET}"
  exit 0
fi

# Check 1: If production code changed, verify tests exist
echo -e "${BOLD}1. Checking for corresponding test files...${RESET}"

MISSING_TESTS=()

for file in $STAGED_TS_FILES; do
  # Skip non-src files
  if [[ ! "$file" =~ ^src/ ]]; then
    continue
  fi

  # Skip type definition files
  if [[ "$file" =~ \.d\.ts$ ]]; then
    continue
  fi

  # Determine expected test file location
  if [[ "$file" =~ ^src/lib/ ]]; then
    # src/lib/foo.ts → src/lib/__tests__/foo.test.ts
    DIR=$(dirname "$file")
    BASENAME=$(basename "$file" .ts)
    TEST_FILE="$DIR/__tests__/$BASENAME.test.ts"
  elif [[ "$file" =~ ^src/components/ ]]; then
    # src/components/Foo.tsx → src/components/__tests__/Foo.test.tsx
    DIR=$(dirname "$file")
    BASENAME=$(basename "$file" .tsx)
    TEST_FILE="$DIR/__tests__/$BASENAME.test.tsx"
  elif [[ "$file" =~ ^src/app/api/ ]]; then
    # src/app/api/foo/route.ts → src/app/api/__tests__/foo.test.ts
    DIR=$(dirname "$file")
    BASENAME=$(basename "$file" .ts)
    TEST_FILE="$DIR/__tests__/$BASENAME.test.ts"
  else
    # Other files: check in same directory
    DIR=$(dirname "$file")
    BASENAME=$(basename "$file" .ts)
    TEST_FILE="$DIR/__tests__/$BASENAME.test.ts"
  fi

  # Check if test file exists
  if [[ ! -f "$TEST_FILE" ]]; then
    MISSING_TESTS+=("$file → $TEST_FILE")
  fi
done

if [[ ${#MISSING_TESTS[@]} -gt 0 ]]; then
  echo -e "${YELLOW}⚠ Warning: Production code without tests:${RESET}"
  for missing in "${MISSING_TESTS[@]}"; do
    echo -e "  ${YELLOW}→ $missing${RESET}"
  done
  echo -e "\n${YELLOW}Consider adding tests before committing (TDD principle).${RESET}"
  echo -e "${YELLOW}Continue anyway? [y/N]${RESET} "
  read -r response
  if [[ ! "$response" =~ ^[Yy]$ ]]; then
    echo -e "${RED}✗ Commit aborted${RESET}"
    exit 1
  fi
else
  echo -e "${GREEN}✓ All production code has corresponding tests${RESET}"
fi

# Check 2: Run tests for changed files
echo -e "\n${BOLD}2. Running tests for changed files...${RESET}"

if [[ -n "$STAGED_TEST_FILES" ]]; then
  # Run only changed test files
  TEST_FILES_ARG=$(echo "$STAGED_TEST_FILES" | tr '\n' ' ')
  if pnpm test --run --reporter=verbose $TEST_FILES_ARG; then
    echo -e "${GREEN}✓ All tests passed${RESET}"
  else
    echo -e "${RED}✗ Tests failed${RESET}"
    echo -e "${RED}Fix failing tests before committing.${RESET}"
    exit 1
  fi
else
  echo -e "${YELLOW}⚠ No test files changed${RESET}"
fi

# Check 3: TypeScript type checking
echo -e "\n${BOLD}3. Running TypeScript type checking...${RESET}"

if pnpm exec tsc --noEmit; then
  echo -e "${GREEN}✓ TypeScript types are valid${RESET}"
else
  echo -e "${RED}✗ TypeScript errors found${RESET}"
  echo -e "${RED}Fix type errors before committing.${RESET}"
  exit 1
fi

# Check 4: Lint staged files
echo -e "\n${BOLD}4. Running ESLint on staged files...${RESET}"

ALL_STAGED_FILES=$(echo "$STAGED_TS_FILES" "$STAGED_TEST_FILES" | tr ' ' '\n' | sort -u)

if [[ -n "$ALL_STAGED_FILES" ]]; then
  if pnpm exec eslint $ALL_STAGED_FILES; then
    echo -e "${GREEN}✓ No lint errors${RESET}"
  else
    echo -e "${RED}✗ Lint errors found${RESET}"
    echo -e "${RED}Fix lint errors before committing.${RESET}"
    exit 1
  fi
fi

echo -e "\n${BOLD}${GREEN}✅ All TDD pre-commit checks passed!${RESET}\n"
