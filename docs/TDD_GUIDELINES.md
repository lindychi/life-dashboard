# TDD Guidelines for Life Dashboard

## Overview

This document defines the Test-Driven Development (TDD) process for the Life Dashboard project. Following these guidelines ensures high code quality, prevents regressions, and maintains comprehensive test coverage.

## Core Principles

### 1. Red → Green → Refactor Cycle

**ALWAYS follow this sequence:**

```
1. 🔴 RED: Write a failing test first
2. 🟢 GREEN: Write minimal code to make it pass
3. 🔵 REFACTOR: Clean up while keeping tests green
```

### 2. Test-First Mandate

**Before writing ANY production code:**
- Write the test that describes the desired behavior
- Run the test and verify it fails (red)
- Only then write the implementation

**Exceptions (write production code directly):**
- Simple type definitions
- Configuration files
- Documentation

## Implementation Checklist

### For New Features

- [ ] **Phase 1: Red (Failing Test)**
  - [ ] Create test file: `src/**/__tests__/[feature-name].test.ts`
  - [ ] Write test cases covering happy path + edge cases
  - [ ] Run `pnpm test` to verify tests fail
  - [ ] Commit: `test: add failing tests for [feature]`

- [ ] **Phase 2: Green (Implementation)**
  - [ ] Write minimal production code to pass tests
  - [ ] Run `pnpm test` to verify tests pass
  - [ ] Commit: `feat: implement [feature]`

- [ ] **Phase 3: Refactor**
  - [ ] Clean up code structure
  - [ ] Run `pnpm test` to verify tests still pass
  - [ ] Commit: `refactor: clean up [feature] implementation`

### For Bug Fixes

- [ ] **Phase 1: Reproduce Bug**
  - [ ] Create regression test that fails due to the bug
  - [ ] Run `pnpm test` to confirm test fails
  - [ ] Commit: `test: add regression test for [bug]`

- [ ] **Phase 2: Fix**
  - [ ] Fix the bug with minimal changes
  - [ ] Run `pnpm test` to verify regression test passes
  - [ ] Commit: `fix: resolve [bug]`

- [ ] **Phase 3: Verify**
  - [ ] Run full test suite: `pnpm test`
  - [ ] Verify no other tests broke

## Test Organization

### Directory Structure

```
src/
├── lib/
│   ├── __tests__/
│   │   ├── [module].test.ts          # Unit tests for lib modules
│   │   └── [module]-integration.test.ts  # Integration tests
│   └── [module].ts
├── components/
│   ├── __tests__/
│   │   └── [Component].test.tsx      # Component tests (jsdom)
│   └── [Component].tsx
└── app/
    └── api/
        └── __tests__/
            └── [route].test.ts       # API route tests
```

### Test File Naming

- **Unit tests**: `[module].test.ts`
- **Integration tests**: `[module]-integration.test.ts`
- **E2E tests**: `[feature]-e2e.test.ts`
- **Regression tests**: `[bug-description].test.ts`

### Test Suite Organization

```typescript
describe("[Module/Component Name]", () => {
  describe("[Feature/Method Name]", () => {
    it("should [expected behavior] when [condition]", () => {
      // Arrange
      const input = setupTestData();

      // Act
      const result = functionUnderTest(input);

      // Assert
      expect(result).toBe(expectedValue);
    });

    it("should throw error when [invalid condition]", () => {
      expect(() => functionUnderTest(invalidInput)).toThrow();
    });
  });
});
```

## Coverage Requirements

### Minimum Coverage Targets

- **Statements**: 80%
- **Branches**: 75%
- **Functions**: 80%
- **Lines**: 80%

### Critical Code Coverage (100%)

These modules MUST have 100% test coverage:

- Authentication (`src/lib/auth.ts`)
- Database operations (`src/lib/db.ts`)
- Task queue (`src/lib/task-queue.ts`)
- Orchestrator (`src/lib/orchestrator.ts`)
- Relay system (`src/lib/relay.ts`)

### Coverage Checking

```bash
# Run tests with coverage report
pnpm test -- --coverage

# Coverage report location: coverage/index.html
```

## Testing Patterns

### 1. Database Tests

**Always mock the database in unit tests:**

```typescript
import { vi } from "vitest";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

// Also mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));
```

**Integration tests use real database:**

```typescript
import { pool } from "@/lib/db";

describe("Database Integration", () => {
  beforeEach(async () => {
    // Clean up test data
    await pool.query("DELETE FROM test_table WHERE id LIKE 'test-%'");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("should persist data correctly", async () => {
    // Test with real database
  });
});
```

### 2. Recursive Function Tests

**Use `mockResolvedValueOnce` to prevent infinite recursion:**

```typescript
const mockQuery = vi.fn()
  .mockResolvedValueOnce({ rows: [{ id: "1" }] }) // First call
  .mockResolvedValueOnce({ rows: [{ id: "2" }] }) // Second call
  .mockResolvedValueOnce({ rows: [] });           // Termination

await recursiveFunction();
expect(mockQuery).toHaveBeenCalledTimes(3);
```

### 3. Component Tests

**Use Testing Library best practices:**

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

describe("MyComponent", () => {
  it("should render with correct text", () => {
    render(<MyComponent text="Hello" />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("should handle click events", async () => {
    const handleClick = vi.fn();
    render(<MyComponent onClick={handleClick} />);

    await userEvent.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledOnce();
  });
});
```

### 4. API Route Tests

**Test request/response flow:**

```typescript
import { POST } from "@/app/api/endpoint/route";

describe("POST /api/endpoint", () => {
  it("should return 200 with valid input", async () => {
    const request = new Request("http://localhost/api/endpoint", {
      method: "POST",
      body: JSON.stringify({ valid: "data" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toEqual({ success: true });
  });
});
```

## Common Pitfalls

### ❌ BAD: Test After Implementation

```typescript
// DON'T: Write code first
function add(a: number, b: number) {
  return a + b;
}

// Then write tests
it("should add numbers", () => {
  expect(add(2, 3)).toBe(5);
});
```

### ✅ GOOD: Test Before Implementation

```typescript
// DO: Write test first
it("should add two numbers", () => {
  expect(add(2, 3)).toBe(5);
});

// Then implement
function add(a: number, b: number) {
  return a + b;
}
```

### ❌ BAD: Testing Implementation Details

```typescript
// DON'T: Test internal state
it("should set _isLoading to true", () => {
  component._isLoading = true;
  expect(component._isLoading).toBe(true);
});
```

### ✅ GOOD: Testing Behavior

```typescript
// DO: Test observable behavior
it("should show loading spinner while fetching", () => {
  render(<Component />);
  expect(screen.getByRole("progressbar")).toBeInTheDocument();
});
```

## Pre-Commit Verification

**Before committing ANY code, run:**

```bash
# Run all tests
pnpm test

# Run linter
pnpm lint

# Check types
pnpm build
```

**Pre-deploy checklist:**

```bash
# Full verification suite
pnpm predeploy

# Quick check (skip build/tests)
pnpm predeploy:quick
```

## CI/CD Integration

### GitHub Actions Workflow

```yaml
name: Test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          node-version: 20
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm test -- --coverage
      - run: pnpm lint
      - run: pnpm build

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
```

## Monitoring Test Quality

### Test Health Metrics

Track these metrics over time:

1. **Test Coverage**: Maintain ≥80% coverage
2. **Test Speed**: Keep test suite under 30 seconds
3. **Flakiness**: Zero flaky tests allowed
4. **Failure Rate**: <5% of CI runs should fail

### Test Maintenance

- **Weekly**: Review and update flaky tests
- **Monthly**: Review test coverage gaps
- **Per Sprint**: Add regression tests for all bugs

## Resources

- **Vitest Docs**: https://vitest.dev/
- **Testing Library**: https://testing-library.com/
- **Test Doubles**: https://martinfowler.com/bliki/TestDouble.html
- **TDD by Example**: Kent Beck's book

## Support

For questions about TDD practices:
1. Review this document
2. Check existing test examples in `src/**/__tests__`
3. Ask team in #engineering channel
