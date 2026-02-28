# oh-my-claudecode: Claude Call Patterns & API Changes (v4.5.1)

**Document Version**: 1.0
**OMC Version**: 4.5.1
**Date**: 2025-02-28
**Status**: Active & Recommended

---

## Overview

This document details how Claude Code agents invoke other Claude instances through oh-my-claudecode, including breaking changes in API patterns, model routing strategies, and team coordination mechanisms.

---

## Part 1: Task Invocation Patterns

### Current Pattern (v4.5.1)

#### Basic Task Invocation
```typescript
// Syntax
Task(
  subagent_type: string,      // "oh-my-claudecode:{agent_name}"
  model?: string,              // "haiku" | "sonnet" | "opus"
  prompt: string,              // Task description
  max_turns?: number,          // Optional: limit recursive depth
  run_in_background?: boolean  // Optional: non-blocking execution
)

// Example
Task(
  subagent_type="oh-my-claudecode:executor",
  model="sonnet",
  prompt="Implement password reset endpoint with JWT validation",
  max_turns=5
)
```

#### Agent Type Resolution
```typescript
// Canonical forms (use these)
"oh-my-claudecode:explore"
"oh-my-claudecode:analyst"
"oh-my-claudecode:planner"
"oh-my-claudecode:architect"
"oh-my-claudecode:debugger"
"oh-my-claudecode:executor"
"oh-my-claudecode:deep-executor"
"oh-my-claudecode:verifier"
"oh-my-claudecode:quality-reviewer"
"oh-my-claudecode:security-reviewer"
"oh-my-claudecode:code-reviewer"
"oh-my-claudecode:test-engineer"
"oh-my-claudecode:build-fixer"
"oh-my-claudecode:designer"
"oh-my-claudecode:writer"
"oh-my-claudecode:qa-tester"
"oh-my-claudecode:scientist"
"oh-my-claudecode:document-specialist"
"oh-my-claudecode:critic"

// Legacy aliases (still work, but canonical forms preferred)
"oh-my-claudecode:researcher"         → "oh-my-claudecode:document-specialist"
"oh-my-claudecode:tdd-guide"          → "oh-my-claudecode:test-engineer"
"oh-my-claudecode:api-reviewer"       → "oh-my-claudecode:code-reviewer"
"oh-my-claudecode:performance-reviewer" → "oh-my-claudecode:quality-reviewer"
"oh-my-claudecode:dependency-expert"  → "oh-my-claudecode:document-specialist"
"oh-my-claudecode:quality-strategist" → "oh-my-claudecode:quality-reviewer"
"oh-my-claudecode:vision"             → "oh-my-claudecode:document-specialist"
```

### API Changes from Previous Versions

#### Breaking Change 1: Model Parameter Becomes Expected
```typescript
// ❌ OLD (v4.4 and earlier - still works but not recommended)
Task(subagent_type="oh-my-claudecode:executor", prompt="Build auth system")

// ✅ NEW (v4.5.1 - preferred, enables cost optimization)
Task(
  subagent_type="oh-my-claudecode:executor",
  model="sonnet",
  prompt="Build auth system"
)
```

**Why Changed:**
- Enables intelligent cost/speed/quality optimization
- Allows framework to route complex tasks to Opus, simple tasks to Haiku
- Provides performance telemetry via `trace` tools

**Impact:**
- No immediate breakage (backwards compatible)
- Future versions may require model parameter
- Performance monitoring will warn on missing model hints

#### Breaking Change 2: Agent Name Normalization
```typescript
// ❌ OLD (v4.4 - direct legacy names, bypass normalization)
Task(subagent_type="researcher", prompt="Research authentication patterns")

// ✅ NEW (v4.5.1 - canonical names with oh-my-claudecode prefix)
Task(
  subagent_type="oh-my-claudecode:document-specialist",
  model="sonnet",
  prompt="Research authentication patterns"
)
```

**Why Changed:**
- Centralizes agent registry in `src/agents/definitions.ts`
- Eliminates name collision risks
- Enables audit logging per agent type
- Makes delegation intent explicit

**Migration Path:**
1. All legacy names still route (via backward compatibility layer)
2. Canonical registry is source of truth
3. Performance metrics tagged to canonical names
4. Future versions will remove legacy aliases

#### Breaking Change 3: Verification Becomes Mandatory
```typescript
// ❌ OLD (v4.4 and earlier)
"I've implemented the login flow. It should work."

// ✅ NEW (v4.5.1 - REQUIRED)
Task(
  subagent_type="oh-my-claudecode:verifier",
  model="sonnet",
  prompt="Verify that the login flow implementation in src/lib/auth.ts passes all tests, builds without errors, and validates JWT tokens correctly"
)

// Then report with evidence:
"✅ VERIFIED: Login flow implementation complete
Evidence:
- TypeScript compilation: ✓ No errors (src/lib/auth.ts)
- Unit tests: 12/12 passing (100% coverage of JWT validation)
- Integration tests: 3/3 passing (login flow, token refresh, logout)
- Type safety: 100% (no implicit any)
- Security: No password logged, JWT secret not exposed"
```

**Why Changed:**
- Prevents false completion claims
- Enables automated verification workflows
- Provides verifiable evidence trail
- Catches regressions early

**Impact:**
- All task completions must include verification
- Verifier agent is integrated into Team pipeline automatically
- Manual verification required for non-automated environments

---

## Part 2: Team Coordination API

### Team Lifecycle (Claude Code Native)

#### Full Team Workflow
```typescript
// Step 1: Create team
TeamCreate(
  name: string,
  description?: string
)

// Step 2: Create task backlog
TaskCreate(
  team_name: string,
  name: string,
  description: string,
  context?: object
)

// Step 3: Spawn agents to work on tasks
Task(
  team_name: string,
  name: string,
  // Agent claims and completes the task
)

// Step 4: Agents communicate via messaging
SendMessage(
  from: string,        // Agent ID
  to: string,          // Agent ID or team name
  content: string,
  type?: "text" | "status"
)

// Step 5: Monitor task progress
TaskList(team_name: string)
TaskGet(team_name: string, task_name: string)
TaskUpdate(
  team_name: string,
  task_name: string,
  status: "pending" | "in_progress" | "completed" | "failed"
)

// Step 6: Shutdown team
TeamDelete(name: string)
```

### Team Staged Pipeline

#### Pipeline Architecture
```
┌─────────────┐
│ team-plan   │  explore (haiku) + planner (opus)
│             │  → Decompose task into subtasks
│             │  → Identify risks & constraints
└──────┬──────┘
       │
       ↓
┌─────────────┐
│ team-prd    │  analyst (opus) + critic (optional)
│             │  → Define acceptance criteria
│             │  → Specify interface contracts
│             │  → Validate scope
└──────┬──────┘
       │
       ↓
┌─────────────┐
│ team-exec   │  executor (sonnet) + specialists
│             │  → Implement features
│             │  → Run tests
│             │  → Generate docs
└──────┬──────┘
       │
       ↓
┌─────────────┐
│ team-verify │  verifier (sonnet) + reviewers
│             │  → Validate completion
│             │  → Check security
│             │  → Review code quality
└──────┬──────┘
       │
       ├─ If verified: → Complete
       │
       └─ If issues found: → team-fix

┌─────────────┐
│ team-fix    │  executor/build-fixer/debugger
│             │  → Fix identified issues
│             │  → Loop back to team-exec or team-verify
│             │  → Bounded by max_fix_attempts (default: 3)
└──────┬──────┘
       │
       └─ If max_fix_attempts exceeded: → Failed
```

#### Stage State Management
```typescript
// State file: {project}/.omc/state/team-state.json
{
  "active": true,
  "team_name": "auth-feature-team",
  "current_phase": "team-exec",
  "stage_history": [
    { "stage": "team-plan", "status": "completed", "started_at": "2025-02-28T10:00:00Z", "completed_at": "2025-02-28T10:05:00Z" },
    { "stage": "team-prd", "status": "completed", "started_at": "2025-02-28T10:05:00Z", "completed_at": "2025-02-28T10:12:00Z" },
    { "stage": "team-exec", "status": "in_progress", "started_at": "2025-02-28T10:12:00Z" }
  ],
  "fix_loop_count": 0,
  "max_fix_attempts": 3,
  "linked_ralph": "2025-02-28-auth-feature-ralph",
  "created_at": "2025-02-28T10:00:00Z"
}
```

#### Resuming Interrupted Teams
```typescript
// Automatic resume on next Team invocation
// 1. Detect existing team-state.json
// 2. Read current_phase
// 3. Resume from last incomplete stage
// 4. Restore context from notepad + project-memory
// 5. Continue execution

// Manual resume (if auto-detect fails)
Task(
  subagent_type="oh-my-claudecode:planner",
  prompt="Resume auth-feature team from team-exec stage. State file: {project}/.omc/state/team-state.json"
)
```

---

## Part 3: Model Routing Strategy

### Intelligent Model Selection

#### Cost/Quality/Speed Matrix
```
┌────────────────────────────────────────────────────────────────┐
│ Task Complexity │ Model  │ Cost │ Quality │ Speed │ Typical Use │
├────────────────────────────────────────────────────────────────┤
│ Trivial         │ haiku  │ $$$$ │ Basic   │ ◀    │ Lookups, summaries
│ Simple          │ haiku  │ $$$$ │ Basic   │ ◀    │ Symbol mapping, quick scans
│ Standard        │ sonnet │ $$   │ High    │ ◀→   │ Implementation, reviews
│ Complex         │ sonnet │ $$   │ High    │ ◀→   │ Debugging, refactoring
│ Architectural   │ opus   │ $    │ Highest │ →    │ Design, deep analysis
│ Multi-file      │ opus   │ $    │ Highest │ →    │ Large refactors
└────────────────────────────────────────────────────────────────┘
```

#### Model Selection Heuristics
```typescript
// Automatic selection (if model not specified)
function selectModel(taskType: string): string {
  switch(taskType) {
    // Haiku: Quick operations
    case "explore":
    case "writer":
      return "haiku"

    // Sonnet: Standard work
    case "executor":
    case "test-engineer":
    case "build-fixer":
    case "debugger":
    case "verifier":
    case "quality-reviewer":
    case "security-reviewer":
    case "designer":
    case "qa-tester":
    case "scientist":
      return "sonnet"

    // Opus: Complex work
    case "analyst":
    case "planner":
    case "architect":
    case "deep-executor":
    case "code-reviewer":
    case "critic":
    case "document-specialist":
      return "opus"
  }
}

// Explicit override (RECOMMENDED for cost control)
Task(
  subagent_type="oh-my-claudecode:architect",
  model="opus",  // Explicit override
  prompt="Design authentication system boundaries"
)
```

#### Cost Optimization Examples
```typescript
// ❌ EXPENSIVE: Everything with Opus
Task(subagent_type="oh-my-claudecode:explore", model="opus", ...)  // Overkill!

// ✅ OPTIMIZED: Right tool for right job
Task(subagent_type="oh-my-claudecode:explore", model="haiku", ...)   // Fast & cheap
Task(subagent_type="oh-my-claudecode:executor", model="sonnet", ...) // Quality work
Task(subagent_type="oh-my-claudecode:architect", model="opus", ...)  // Expert design
```

---

## Part 4: Context Passing & State

### Priority Context System
```typescript
// Set priority context (loaded at session start, persists across all agents)
notepad_write_priority(
  "🎯 PRIORITY CONTEXT\n" +
  "- Auth system must support: OAuth2, JWT, Magic Links\n" +
  "- Database: PostgreSQL, migrations via sql/\n" +
  "- Framework: Next.js 16, TypeScript strict mode\n" +
  "- Deadline: 2025-03-15"
)

// Every agent automatically receives priority context in system prompt
// Agents can reference: "As per priority context: ..."
```

### Working Memory (Session-Scoped)
```typescript
// Add timestamped working notes (auto-pruned after 7 days)
notepad_write_working("DEBUG: Found circular dependency in models.ts ← user.ts ← models.ts")
notepad_write_working("BLOCKER: S3 SDK version mismatch, downgrade to v3.1.0")
notepad_write_working("PATTERN: All routes require Content-Type validation header")

// Agents can search and reference working memory
// Used for knowledge sharing within a session
```

### Project Memory (Persistent)
```typescript
// Store permanent project knowledge
project_memory_write({
  memory: {
    techStack: "Next.js 16, TypeScript 5.3, Tailwind CSS 4, PostgreSQL 14",
    build: "pnpm install → pnpm build → .next/standalone output",
    conventions: "PascalCase React components, camelCase functions/vars",
    structure: "src/app → routes, src/lib → utilities, src/components → UI",
    notes: "Database URL: DATABASE_URL env var, migrations in sql/",
    directives: "Always use TypeScript strict mode, no implicit any"
  },
  merge: true  // Merge with existing, don't replace
})

// Add priority directives (appear in all agent system prompts)
project_memory_add_directive(
  directive="All API routes must validate Content-Type header",
  priority="high",
  context="Prevents JSON injection attacks"
)

project_memory_add_directive(
  directive="Use parametrized SQL queries only, never string concatenation",
  priority="high",
  context="SQL injection prevention"
)

// Agents automatically receive project memory context
// Used for long-term project knowledge
```

### Context Flow Across Pipeline Stages
```
Priority Context (fixed)
        ↓
    ┌───────────────────────────┐
    │ Team-Plan Stage           │
    │ explore + planner         │
    │ Outputs: Decomposition    │
    └────────────┬──────────────┘
                 ↓
    ┌───────────────────────────┐
    │ Team-Prd Stage            │
    │ + planner outputs         │
    │ analyst + critic          │
    │ Outputs: Spec + Criteria  │
    └────────────┬──────────────┘
                 ↓
    ┌───────────────────────────┐
    │ Team-Exec Stage           │
    │ + spec outputs            │
    │ executor + specialists    │
    │ Outputs: Code + Tests     │
    └────────────┬──────────────┘
                 ↓
    ┌───────────────────────────┐
    │ Team-Verify Stage         │
    │ + code/test outputs       │
    │ verifier + reviewers      │
    │ Outputs: Issues or ✓      │
    └────────────┬──────────────┘
                 ↓
Project Memory (evolving)
        + working memory
        + notepad outputs
```

---

## Part 5: Parallel Execution Patterns

### Team-Based Parallelization
```typescript
// Team automatically parallelizes within team-exec stage
Skill(skill="team", args="Implement auth system with OAuth2, JWT, and Magic Link support")

// Behind the scenes:
// 1. team-plan: Sequential planning (decompose into OAuth2 module, JWT module, Magic Link module)
// 2. team-prd: Sequential spec (define interfaces)
// 3. team-exec: PARALLEL execution
//    - executor-1: Implements OAuth2 module (in parallel)
//    - executor-2: Implements JWT module (in parallel)
//    - executor-3: Implements Magic Link module (in parallel)
//    - test-engineer: Writes integration tests (as modules complete)
// 4. team-verify: Sequential verification
// 5. team-fix: Sequential fixing (if needed)
```

### Maximum Parallelism (Ultrawork)
```typescript
// For independent tasks with no cross-dependencies
Skill(skill="ultrawork", args="task1, task2, task3, task4")

// All 4 run in parallel orchestrated by ultrawork agent
// Use when:
// - Tasks are completely independent
// - No shared state
// - No data dependencies
// Avoid when:
// - Tasks depend on each other
// - Shared resource access needed
// - Sequential verification required
```

### Dependency Management
```typescript
// Task queue supports explicit dependencies
// (Auto-managed by Team pipeline, rarely need manual deps)

// Manual dependency (if using Task directly, not Team)
{
  name: "Implement API endpoint",
  depends_on: ["Database schema defined", "API spec written"]
}

// Dependencies checked via PostgreSQL function
// Dependents auto-fail if dependency fails (cascade)
```

---

## Part 6: Real-World Examples

### Example 1: Feature Development (Team)
```typescript
// Request
Skill(skill="team", args="Implement user profile page with avatar upload, bio editing, and social links")

// Automatic execution:
// 1. team-plan (explore+planner, 2min)
//    - Decompose into components: ProfileCard, AvatarUpload, BioEditor, SocialLinks, Gallery
//    - Identify dependencies: S3 bucket needed, database schema for social_links
//    - Risk flags: Avatar upload file size limits, CORS setup
//
// 2. team-prd (analyst+critic, 3min)
//    - Define acceptance criteria:
//      * Avatar upload: max 5MB, JPEG/PNG only, resized to 400x400px
//      * Bio: max 500 chars, markdown support, XSS prevention
//      * Social links: 5 platforms (GitHub, LinkedIn, Twitter, Website, Email)
//    - Specify interfaces & data models
//    - Validate against constraints
//
// 3. team-exec (executor+designers+test-engineer, 15min parallel)
//    - executor-1: ProfileCard component (React, Tailwind)
//    - executor-2: AvatarUpload (S3 integration, client-side validation)
//    - executor-3: BioEditor (markdown preview, real-time validation)
//    - executor-4: SocialLinks form (input validation, link validation)
//    - test-engineer: Unit + integration tests for all components
//
// 4. team-verify (verifier+quality-reviewer+security-reviewer, 5min)
//    - Verifier: Run all tests, check builds, validate TypeScript
//    - Quality-reviewer: Code review for maintainability
//    - Security-reviewer: Check for XSS, file upload vulnerabilities, SQL injection
//
// 5. team-fix (if issues found, loop back to team-exec, max 3 attempts)

// Result: Complete profile page with tests, security review, code review, ready to merge
```

### Example 2: Bug Investigation (Task + Verification)
```typescript
// Request
Task(
  subagent_type="oh-my-claudecode:debugger",
  model="sonnet",
  prompt="Investigate and fix: Login endpoint returns 500 error when email contains special characters (+ or =). Reproduction: POST /api/auth/login with email='user+tag@example.com'"
)

// Debugger process:
// 1. Reproduce error (POST /api/auth/login with user+tag@example.com)
// 2. Examine logs (check server logs for 500 error)
// 3. Trace execution (step through src/lib/auth.ts)
// 4. Identify root cause (likely URL encoding issue in email validation)
// 5. Fix the bug
// 6. Add regression test

// Then verify:
Task(
  subagent_type="oh-my-claudecode:verifier",
  model="haiku",
  prompt="Verify the login email special character fix. Confirm: 1) POST /api/auth/login with email='user+tag@example.com' succeeds, 2) New test case added, 3) All existing tests still pass"
)

// Verification output:
// ✅ VERIFIED: Login special character bug fixed
// - Manual test: email='user+tag@example.com' → 200 OK
// - Manual test: email='user=encoded@example.com' → 200 OK
// - Unit tests: 1 new test added (special char handling)
// - All tests: 42/42 passing
// - Build: No TypeScript errors
```

### Example 3: Security Review (Code Review Agent)
```typescript
// Request
Task(
  subagent_type="oh-my-claudecode:code-reviewer",
  model="opus",
  prompt="Review the authentication flow in src/lib/auth.ts. Check for: JWT validation, password hashing, SQL injection, XSS, CSRF protection, rate limiting, and session management."
)

// Code-reviewer output:
// ✅ JWT Validation: Correct kid/alg verification using jose library
// ⚠️ Password Hashing: Using bcrypt, but iteration count is default (10). Consider increasing to 12 for higher security
// ✅ SQL Injection: All queries use parameterized statements via sql/ migrations
// ✅ XSS: HTML escaping applied via React, Content-Security-Policy header set
// ❌ CSRF Protection: MISSING. Add csrf-token header validation to all mutations
// ⚠️ Rate Limiting: Implemented via Redis, but max 10 attempts/min is too lenient. Recommend 5/min
// ✅ Session Management: JWT tokens with 24h expiry, refresh token rotation enabled

// Then fix:
Task(
  subagent_type="oh-my-claudecode:executor",
  model="sonnet",
  prompt="Fix the security issues from the code review: 1) Add CSRF protection, 2) Reduce rate limit to 5 attempts/min, 3) Increase bcrypt iterations to 12"
)

// Then re-verify:
Task(
  subagent_type="oh-my-claudecode:security-reviewer",
  model="sonnet",
  prompt="Verify the security fixes. Check: CSRF token validation, rate limiting reduced, bcrypt iterations increased to 12, and no regressions"
)
```

---

## Part 7: Common Pitfalls & Solutions

### Pitfall 1: Missing Model Parameter
```typescript
// ❌ BAD: No model hint, framework guesses
Task(subagent_type="oh-my-claudecode:executor", prompt="Implement complex auth system")

// ✅ GOOD: Explicit model routing
Task(
  subagent_type="oh-my-claudecode:executor",
  model="sonnet",
  prompt="Implement complex auth system"
)
```

### Pitfall 2: Verification Not Included
```typescript
// ❌ BAD: Just delegate, don't verify
Task(subagent_type="oh-my-claudecode:executor", model="sonnet", prompt="Build API")
// (No verification = no evidence of completion)

// ✅ GOOD: Delegate + Verify
Task(subagent_type="oh-my-claudecode:executor", model="sonnet", prompt="Build API")
Task(
  subagent_type="oh-my-claudecode:verifier",
  model="sonnet",
  prompt="Verify the API: all endpoints working, tests passing, no errors"
)
```

### Pitfall 3: Overloading Single Task
```typescript
// ❌ BAD: Everything in one task
Task(
  subagent_type="oh-my-claudecode:executor",
  model="sonnet",
  prompt="Build complete user authentication system including database schema, API endpoints, frontend login page, tests, and security review"
)

// ✅ GOOD: Use Team for complex features
Skill(skill="team", args="Build complete user authentication system with database schema, API endpoints, frontend login page, tests, and security review")

// Team automatically breaks down into stages and parallel subtasks
```

### Pitfall 4: Circular Dependencies in Context
```typescript
// ❌ BAD: Context references each other
notepad_write_working("Feature A depends on Feature B")
notepad_write_working("Feature B depends on Feature A")

// ✅ GOOD: Break dependencies in planning
// Use planner agent to identify and resolve circular deps:
Task(
  subagent_type="oh-my-claudecode:planner",
  model="opus",
  prompt="Analyze and break the circular dependency between Feature A and Feature B. Propose execution order."
)
```

### Pitfall 5: Verification Without Clear Criteria
```typescript
// ❌ BAD: Vague verification
Task(subagent_type="oh-my-claudecode:verifier", model="sonnet", prompt="Is the code good?")

// ✅ GOOD: Specific verification criteria
Task(
  subagent_type="oh-my-claudecode:verifier",
  model="sonnet",
  prompt="Verify the login implementation. Criteria: 1) All unit tests pass, 2) TypeScript strict mode, 3) No console errors in dev server, 4) Security review confirms no injection vulnerabilities"
)
```

---

## Part 8: Migration Guide from v4.4 → v4.5.1

### Step 1: Update All Task Calls
```typescript
// ❌ OLD (v4.4)
Task(subagent_type="oh-my-claudecode:executor", prompt="Implement feature")

// ✅ NEW (v4.5.1)
Task(
  subagent_type="oh-my-claudecode:executor",
  model="sonnet",
  prompt="Implement feature"
)
```

### Step 2: Standardize Agent Names
```typescript
// ❌ OLD (v4.4 - deprecated aliases)
Task(subagent_type="researcher", ...)
Task(subagent_type="tdd-guide", ...)
Task(subagent_type="api-reviewer", ...)

// ✅ NEW (v4.5.1 - canonical forms)
Task(subagent_type="oh-my-claudecode:document-specialist", ...)
Task(subagent_type="oh-my-claudecode:test-engineer", ...)
Task(subagent_type="oh-my-claudecode:code-reviewer", ...)
```

### Step 3: Add Verification to Completions
```typescript
// ❌ OLD (v4.4)
Task(subagent_type="oh-my-claudecode:executor", model="sonnet", prompt="Implement auth")
// Report: "Feature complete"

// ✅ NEW (v4.5.1)
Task(subagent_type="oh-my-claudecode:executor", model="sonnet", prompt="Implement auth")
Task(subagent_type="oh-my-claudecode:verifier", model="sonnet", prompt="Verify auth implementation passes all tests")
// Report: "✅ VERIFIED: Auth implementation complete (8/8 tests passing, 0 TypeScript errors)"
```

### Step 4: Use Team for Complex Features
```typescript
// ❌ OLD (v4.4 - manual orchestration)
Task(subagent_type="oh-my-claudecode:planner", ...)
Task(subagent_type="oh-my-claudecode:executor", ...)
Task(subagent_type="oh-my-claudecode:test-engineer", ...)
Task(subagent_type="oh-my-claudecode:code-reviewer", ...)

// ✅ NEW (v4.5.1 - automatic orchestration)
Skill(skill="team", args="Feature description")
// Team automatically: plan → prd → exec → verify → fix
```

### Step 5: Initialize Project Memory
```typescript
// Add to project setup
project_memory_write({
  memory: {
    techStack: "Next.js 16, TypeScript, PostgreSQL",
    build: "pnpm build → .next/standalone",
    conventions: "PascalCase components, camelCase functions",
    structure: "src/app → routes, src/lib → utilities",
    notes: "Database: PostgreSQL 14",
    directives: "Strict TypeScript mode, parametrized SQL only"
  },
  merge: false  // Initial setup, replace defaults
})
```

---

## Summary: Key Takeaways

| Concept | v4.4 | v4.5.1 | Impact |
|---------|------|--------|--------|
| **Model Parameter** | Optional | Expected | Better cost/quality optimization |
| **Agent Names** | Legacy aliases OK | Canonical + prefix | Clearer intent, audit trail |
| **Verification** | Optional | Mandatory | Evidence-based completion |
| **Team Orchestration** | Manual staging | Automatic pipeline | Less manual coordination |
| **Context Persistence** | Session-only | Priority + Working + Project | Better knowledge reuse |
| **State Storage** | `~/.claude/` | `{project}/.omc/` | Per-project isolation |
| **Parallelization** | Ad-hoc | Team-aware pipeline | Better resource utilization |

---

## References

- **OMC Documentation**: `/Users/hanchi/.claude/CLAUDE.md` (version 4.5.1)
- **Project Setup**: `/Users/hanchi/work/life-dashboard/CLAUDE.md`
- **State Locations**: `{project}/.omc/state/`, `{project}/.omc/notepad.md`, `{project}/.omc/project-memory.json`
- **Configuration**: `~/.claude/.omc-config.json` (optional, auto-initialized)

