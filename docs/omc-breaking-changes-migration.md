# oh-my-claudecode v4.5.1: Breaking Changes & Migration Guide

**Document Version**: 1.0
**OMC Version**: 4.5.1
**Migration Target**: From v4.4 and earlier
**Date**: 2025-02-28
**Status**: Active & Required for Compliance

---

## Quick Summary

| Change | Impact | Severity | Migration Path |
|--------|--------|----------|-----------------|
| **Model parameter expected** | Cost/quality optimization | Low | Add `model="sonnet"` to all Task calls |
| **Deprecated agent aliases removed** | Name collision risk | Medium | Use canonical names (`oh-my-claudecode:*`) |
| **Verification mandatory** | Evidence-based completion | High | Add verifier tasks to all features |
| **State storage moved** | Project isolation | Medium | `.omc/` instead of `~/.claude/` |
| **Team pipeline required** | Multi-step orchestration | Low | Use `Skill(skill="team", ...)` instead of manual staging |
| **Context persistence changes** | Priority/Working/Project separation | Medium | Use notepad/project-memory APIs |

---

## Breaking Change 1: Model Parameter Expected (Low Severity)

### What Changed
In v4.4 and earlier, the `model` parameter was optional; the framework would guess based on agent type. In v4.5.1, explicit model routing is strongly recommended and will eventually become required.

### Impact
- **Now**: Still backwards compatible; Task calls work without model parameter
- **v4.6+**: May require explicit model parameter
- **Cost**: Suboptimal routing → higher costs on simple tasks

### Why Changed
- Enables cost optimization (haiku for simple tasks, opus for complex)
- Provides performance telemetry
- Makes routing intent explicit

### Migration Path
```typescript
// ❌ OLD (v4.4)
Task(
  subagent_type="oh-my-claudecode:explore",
  prompt="Map the authentication module"
)

// ✅ NEW (v4.5.1)
Task(
  subagent_type="oh-my-claudecode:explore",
  model="haiku",  // ← Add explicit model
  prompt="Map the authentication module"
)
```

### Model Routing Reference
```typescript
// Haiku (quick operations, max context: ~750K tokens)
Task(subagent_type="oh-my-claudecode:explore", model="haiku", ...)
Task(subagent_type="oh-my-claudecode:writer", model="haiku", ...)

// Sonnet (standard work, max context: ~200K tokens)
Task(subagent_type="oh-my-claudecode:executor", model="sonnet", ...)
Task(subagent_type="oh-my-claudecode:test-engineer", model="sonnet", ...)
Task(subagent_type="oh-my-claudecode:debugger", model="sonnet", ...)

// Opus (complex analysis, max context: ~200K tokens)
Task(subagent_type="oh-my-claudecode:architect", model="opus", ...)
Task(subagent_type="oh-my-claudecode:analyst", model="opus", ...)
Task(subagent_type="oh-my-claudecode:deep-executor", model="opus", ...)
```

### Checklist
- [ ] Audit all Task calls in codebase
- [ ] Add model parameter to explore operations
- [ ] Add model parameter to executor operations
- [ ] Add model parameter to architecture/analysis operations
- [ ] Test performance via `/omc-teams trace` if available

---

## Breaking Change 2: Deprecated Agent Aliases (Medium Severity)

### What Changed
Legacy agent aliases are deprecated. Use canonical names with `oh-my-claudecode:` prefix instead.

### Impact
- **Now**: Aliases still route correctly (backward compatibility layer)
- **v4.6+**: Aliases may be removed entirely
- **Audit**: Deprecated alias usage may trigger warnings in logs
- **Metrics**: Performance metrics tagged to canonical names; alias usage not tracked

### Why Changed
- Centralizes agent registry (`src/agents/definitions.ts`)
- Eliminates naming collisions
- Makes delegation intent explicit
- Enables proper audit logging

### Migration Path

#### Complete Alias List
```typescript
// ❌ DEPRECATED (still works in v4.5.1, but avoid)
"researcher"              → "oh-my-claudecode:document-specialist"
"tdd-guide"               → "oh-my-claudecode:test-engineer"
"api-reviewer"            → "oh-my-claudecode:code-reviewer"
"performance-reviewer"    → "oh-my-claudecode:quality-reviewer"
"dependency-expert"       → "oh-my-claudecode:document-specialist"
"quality-strategist"      → "oh-my-claudecode:quality-reviewer"
"vision"                  → "oh-my-claudecode:document-specialist"

// ✅ CANONICAL (use these)
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
```

### Migration Script
```bash
# Find all deprecated aliases
grep -r "subagent_type=\"researcher\"" .
grep -r "subagent_type=\"tdd-guide\"" .
grep -r "subagent_type=\"api-reviewer\"" .
# ... and so on

# Replace with canonical forms
sed -i 's/subagent_type="researcher"/subagent_type="oh-my-claudecode:document-specialist"/g' .
sed -i 's/subagent_type="tdd-guide"/subagent_type="oh-my-claudecode:test-engineer"/g' .
sed -i 's/subagent_type="api-reviewer"/subagent_type="oh-my-claudecode:code-reviewer"/g' .
```

### Checklist
- [ ] Search codebase for deprecated aliases
- [ ] Replace with canonical names
- [ ] Test Task invocations
- [ ] Verify agent routing in logs

---

## Breaking Change 3: Verification Mandatory (High Severity)

### What Changed
All task completions must now include explicit verification with evidence. The phrase "should work" or "probably complete" is no longer acceptable.

### Impact
- **Critical**: All features must be verified before claiming completion
- **Workflow**: Every Task → Verification cycle
- **Evidence**: Must provide concrete proof (test results, build output, type checking)
- **Regression**: Previous completions without verification are suspect

### Why Changed
- Prevents false completion claims
- Provides verifiable evidence trail
- Enables automated verification workflows
- Catches regressions early

### Migration Path

#### Pattern 1: Simple Feature (Executor + Verifier)
```typescript
// STEP 1: Implement
await Task(
  subagent_type="oh-my-claudecode:executor",
  model="sonnet",
  prompt="Implement password reset endpoint with JWT validation"
)

// STEP 2: Verify (MANDATORY)
const verificationResult = await Task(
  subagent_type="oh-my-claudecode:verifier",
  model="haiku",  // Small changes use haiku
  prompt="Verify the password reset endpoint: 1) Unit tests passing, 2) No TypeScript errors, 3) JWT validation working"
)

// STEP 3: Report with evidence
console.log(`
✅ VERIFIED: Password reset endpoint complete
Evidence:
${verificationResult.evidence}
`)
```

#### Pattern 2: Complex Feature (Team)
```typescript
// Team automatically includes verification in pipeline
await Skill(skill="team", args="Implement multi-factor authentication with TOTP and SMS support")

// Team stages:
// 1. team-plan: explore + planner → decomposition
// 2. team-prd: analyst + critic → spec + criteria
// 3. team-exec: executor + specialists → implementation
// 4. team-verify: verifier + security-reviewer → VERIFICATION WITH EVIDENCE
// 5. team-fix: Fix loop if issues found
```

#### Pattern 3: Bug Fix (Debugger + Verifier)
```typescript
// STEP 1: Debug and fix
await Task(
  subagent_type="oh-my-claudecode:debugger",
  model="sonnet",
  prompt="Fix: Login endpoint returns 500 when email has special characters"
)

// STEP 2: Verify
await Task(
  subagent_type="oh-my-claudecode:verifier",
  model="haiku",
  prompt="Verify login fix: 1) Reproduce test case passes, 2) New regression test added, 3) All tests still pass"
)

// STEP 3: Report
console.log(`
✅ VERIFIED: Login special character fix complete
Evidence:
- Regression test: PASS (user+tag@example.com login)
- Full test suite: 42/42 passing
- Build: No TypeScript errors
`)
```

### Verification Evidence Template
```
✅ VERIFIED: [Feature Name] complete
Evidence:
- Unit Tests: [X/Y passing] ([%] coverage)
- Integration Tests: [X/Y passing]
- Build: [No errors / N errors]
- Type Safety: [100% / X% coverage]
- Security: [No vulnerabilities / N issues]
- Performance: [Metrics or "Meets baseline"]
- Code Review: [Approved / N comments]
```

### Checklist
- [ ] All Task calls paired with verification
- [ ] Verification uses appropriate model (haiku for small, sonnet for standard, opus for large)
- [ ] Evidence collected before marking complete
- [ ] No "should work" or "probably complete" claims
- [ ] Test coverage > 80% for critical paths
- [ ] TypeScript strict mode compliance
- [ ] Security review completed for auth/data access features

---

## Breaking Change 4: State Storage Location (Medium Severity)

### What Changed
OMC state moved from `~/.claude/` to project-specific `.omc/` directory. State is now per-project, not global.

### Impact
- **Isolation**: Each project has independent state (no cross-project conflicts)
- **Migration**: Existing state in `~/.claude/` will be auto-migrated on first run
- **Storage**: `{project}/.omc/state/` instead of `~/.claude/.omc/state/`
- **Persistence**: State no longer shared across projects

### Why Changed
- Project-specific isolation (multi-project safety)
- Easier backup/restore per project
- Clearer file organization
- Supports worktree workflows

### Migration Path

#### Automatic Migration (Preferred)
```bash
# On first OMC 4.5.1 run in a project:
# 1. Framework detects ~/.claude/.omc/ state
# 2. Auto-copies to {project}/.omc/
# 3. Marks ~/.claude/ copy as migrated
# 4. Subsequent runs use {project}/.omc/
```

#### Manual Migration (If Auto-Detect Fails)
```bash
# Check current state
ls -la ~/.claude/.omc/

# Copy to project
cp -r ~/.claude/.omc {project_root}/.omc

# Verify
ls -la {project_root}/.omc/
```

#### Directory Structure
```
OLD (v4.4 and earlier):
~/.claude/
├── .omc/
│   ├── state/
│   ├── notepad.md
│   └── project-memory.json

NEW (v4.5.1):
{project}/
├── .omc/
│   ├── state/
│   │   ├── autopilot-state.json
│   │   ├── team-state.json
│   │   ├── ralph-state.json
│   │   ├── ultrawork-state.json
│   │   └── sessions/{sessionId}/
│   ├── notepad.md
│   ├── project-memory.json
│   ├── plans/
│   ├── research/
│   └── logs/
```

### Checklist
- [ ] Verify state migration completed
- [ ] Check `{project}/.omc/state/` exists
- [ ] Confirm `.gitignore` includes `.omc/` (already added by init)
- [ ] Test state persistence across sessions
- [ ] Verify no cross-project state leakage

---

## Breaking Change 5: Team Pipeline Required (Low Severity)

### What Changed
Manual agent orchestration is no longer recommended. Use Team pipeline (`Skill(skill="team", ...)`) instead for multi-step features.

### Impact
- **Simplification**: Less manual coordination
- **Reliability**: Automatic stage management, error recovery
- **Verification**: Built-in verifier integration
- **Parallelization**: Automatic parallel execution where possible

### Why Changed
- Team pipeline is more robust
- Automatic stage transitions
- Better resource utilization
- Integrated verification

### Migration Path

#### Pattern 1: Manual Orchestration (OLD)
```typescript
// ❌ OLD (v4.4) - Manual staging
await Task(subagent_type="oh-my-claudecode:planner", model="opus", prompt="Plan the auth system")
// → Get plan output manually
await Task(subagent_type="oh-my-claudecode:executor", model="sonnet", prompt="Implement based on plan: ${planOutput}")
// → Get implementation manually
await Task(subagent_type="oh-my-claudecode:test-engineer", model="sonnet", prompt="Write tests for: ${implementationOutput}")
// → Get tests manually
await Task(subagent_type="oh-my-claudecode:code-reviewer", model="opus", prompt="Review: ${implementationOutput}")
// → Handle results manually
```

#### Pattern 2: Team Pipeline (NEW)
```typescript
// ✅ NEW (v4.5.1) - Automatic orchestration
await Skill(skill="team", args="Implement complete authentication system with OAuth2, JWT, and Magic Links")

// Behind scenes:
// 1. team-plan: planner decomposes into OAuth2, JWT, Magic Link modules
// 2. team-prd: analyst specifies interfaces and acceptance criteria
// 3. team-exec: executor + specialists implement in parallel
// 4. team-verify: verifier + reviewers validate
// 5. team-fix: Automatic fix loop if issues found
```

### When to Use Manual vs. Team
```
Manual Task Calls:
- Single agent for isolated task
- Quick exploratory work
- Specific agent required (not orchestration)

Team Pipeline:
- Multi-step features
- Cross-functional work (design + dev + test)
- Complex coordination needed
- Verification required
```

### Checklist
- [ ] Audit feature implementation patterns
- [ ] Replace manual orchestration with Team
- [ ] Test Team pipeline state management
- [ ] Verify automatic stage transitions
- [ ] Confirm verification included

---

## Breaking Change 6: Context Persistence Changes (Medium Severity)

### What Changed
Context is now managed through explicit APIs (Priority, Working, Project memory) instead of implicit session state.

### Impact
- **Separation**: Priority (fixed) vs. Working (session) vs. Project (persistent)
- **Clarity**: Explicit context management
- **Persistence**: Project memory survives across sessions
- **Auto-Pruning**: Working memory auto-pruned after 7 days

### Why Changed
- Better knowledge reuse across sessions
- Clearer context lifecycle
- Prevents stale context pollution
- Enables permanent project directives

### Migration Path

#### Pattern 1: Priority Context (Fixed, Loaded at Start)
```typescript
// Set once at project start
notepad_write_priority(
  "🎯 PRIORITY CONTEXT\n" +
  "- Framework: Next.js 16, TypeScript strict mode\n" +
  "- Database: PostgreSQL, migrations in sql/\n" +
  "- Auth: JWT + Magic Links\n" +
  "- Deadline: 2025-03-15"
)

// All agents automatically receive in system prompt
// Updated only when explicitly called
```

#### Pattern 2: Working Memory (Session-Scoped, Auto-Pruned)
```typescript
// Add timestamped notes during session
notepad_write_working("DEBUG: Found circular dependency in models.ts")
notepad_write_working("BLOCKER: S3 upload failing, needs credentials")
notepad_write_working("PATTERN: All API routes need Content-Type validation")

// Auto-pruned after 7 days
notepad_prune(daysOld=7)

// Agents can reference and add to working memory
```

#### Pattern 3: Project Memory (Persistent)
```typescript
// Initialize at project setup
project_memory_write({
  memory: {
    techStack: "Next.js 16, TypeScript 5.3, PostgreSQL 14, Tailwind CSS 4",
    build: "pnpm install → pnpm build → .next/standalone",
    conventions: "PascalCase React components, camelCase functions",
    structure: "src/app (routes), src/lib (utilities), src/components (UI)",
    notes: "Database: PostgreSQL 14, migrations in sql/",
    directives: "Always use TypeScript strict mode, no implicit any"
  },
  merge: false  // Initial setup
})

// Add permanent directives (appear in all agent prompts)
project_memory_add_directive(
  directive="All API routes must validate Content-Type header",
  priority="high",
  context="Prevents JSON injection attacks"
)

// Later sessions: merge new knowledge
project_memory_write({
  memory: {
    notes: "Database: PostgreSQL 14, migrations in sql/, connection pooling via pg"
  },
  merge: true  // Merge with existing
})
```

#### Context Flow Visualization
```
┌─────────────────────┐
│ Priority Context    │ (Persistent, manually updated)
│ max 500 chars       │
└──────────┬──────────┘
           │
           ↓ (Injected into every agent prompt)
    ┌──────────────────┐
    │ Agent Execution  │
    └────────┬─────────┘
             │
    ┌────────↓──────────┐
    │ Working Memory    │ (Session-scoped, timestamped)
    │ auto-pruned 7d    │
    └──────────────────┘

    ┌──────────────────┐
    │ Project Memory   │ (Persistent, survives sessions)
    │ Tech stack, etc. │
    └──────────────────┘
```

### Checklist
- [ ] Set priority context at project initialization
- [ ] Initialize project memory with tech stack and conventions
- [ ] Add high-priority directives to project memory
- [ ] Document custom conventions in project memory
- [ ] Use working memory for temporary notes during sessions
- [ ] Periodically review and update project memory

---

## Breaking Change 7: Hook Runtime Guarantees (Low Severity)

### What Changed
Hook input/output uses strict allowlist for sensitive fields. Unknown fields are dropped; only validated fields pass through.

### Impact
- **Security**: No accidental data leakage through hooks
- **Predictability**: Hook contract is explicit
- **Validation**: Required fields must be present
- **Filtering**: Sensitive fields filtered before execution

### Why Changed
- Prevent sensitive data exposure
- Make hook contracts explicit
- Enable secure inter-service communication

### Migration Path

#### Guaranteed Fields
```typescript
// These fields always available in hooks
hook_input: {
  tool_name: string,           // e.g., "Task"
  tool_input: object,          // e.g., { subagent_type: "...", prompt: "..." }
  tool_response: string,       // e.g., "Task completed with result..."
  session_id: string,          // e.g., "2025-02-28-session-abc123"
  cwd: string,                 // e.g., "/Users/hanchi/work/life-dashboard"
  hook_event_name: string      // e.g., "pre-tool-use", "post-tool-use"
}

// Filtered (never passed through)
hook_input: {
  permission_request?: object,  // Filtered by allowlist
  setup?: object,               // Filtered by allowlist
  session_end?: object          // Filtered by allowlist
}
```

#### Validation Examples
```typescript
// ✅ Valid hook call (all required fields)
{
  tool_name: "Task",
  tool_input: { subagent_type: "oh-my-claudecode:executor", ... },
  tool_response: "Task result...",
  session_id: "...",
  cwd: "...",
  hook_event_name: "post-tool-use"
}

// ❌ Invalid hook call (missing session_id)
{
  tool_name: "Task",
  tool_input: { ... },
  tool_response: "...",
  // session_id: MISSING ← Will cause validation error
  cwd: "...",
  hook_event_name: "post-tool-use"
}
```

### Checklist
- [ ] No custom hooks relying on filtered fields
- [ ] All hook handlers use guaranteed field names
- [ ] Test hook validation with mock payloads
- [ ] Document custom hooks if any

---

## Summary: Migration Checklist

### Critical (Must Do)
- [ ] **Verification**: Add verifier tasks to all features
- [ ] **Agent Names**: Replace deprecated aliases with canonical forms
- [ ] **State Migration**: Verify `.omc/` state directory exists

### High Priority (Should Do)
- [ ] **Model Routing**: Add explicit model parameters to all Task calls
- [ ] **Project Memory**: Initialize with tech stack and conventions
- [ ] **Priority Context**: Set project-level focus/constraints

### Medium Priority (Nice to Have)
- [ ] **Team Pipeline**: Migrate manual orchestration to Team
- [ ] **Context APIs**: Use notepad/project-memory systematically
- [ ] **Hook Contracts**: Verify custom hooks use guaranteed fields

### Low Priority (FYI)
- [ ] **Documentation**: Update internal docs with new patterns
- [ ] **Telemetry**: Check `/omc trace` for deprecated alias warnings

---

## Rollback Procedure (If Needed)

If migration causes issues and you need to revert to v4.4:

```bash
# 1. Backup current state
cp -r {project}/.omc {project}/.omc-backup-4.5.1

# 2. Check git history for last v4.4 configuration
git log --oneline ~/.claude/CLAUDE.md | head -5

# 3. Restore v4.4 CLAUDE.md
git checkout {commit-hash} ~/.claude/CLAUDE.md

# 4. Restart session
# Framework will detect version mismatch and alert
```

---

## Getting Help

### Documentation
- **Latest OMC Docs**: `/Users/hanchi/.claude/CLAUDE.md` (v4.5.1)
- **Project-Specific**: `/Users/hanchi/work/life-dashboard/CLAUDE.md`
- **Memory Files**: `/Users/hanchi/work/life-dashboard/.omc/project-memory.json`

### Diagnostics
```bash
# Check OMC version
grep "OMC:VERSION" ~/.claude/CLAUDE.md

# View state status
cat {project}/.omc/state/autopilot-state.json

# Check recent hooks
tail -50 {project}/.omc/logs/hooks.log
```

### Common Issues

**Issue**: Task calls not finding agents
- **Cause**: Using deprecated alias without prefix
- **Fix**: Use `oh-my-claudecode:agent-name` format

**Issue**: State file conflicts
- **Cause**: State in both `~/.claude/` and `.omc/`
- **Fix**: Delete `~/.claude/.omc/` after migration

**Issue**: Verification task not found
- **Cause**: Using `verifier` without proper agent routing
- **Fix**: Use `oh-my-claudecode:verifier` with `model="sonnet"`

---

## Version Compatibility Matrix

| Feature | v4.4 | v4.5.1 | v4.6 (planned) |
|---------|------|--------|----------------|
| Legacy agent aliases | ✅ | ✅ (deprecated) | ❌ |
| Model routing | Optional | Expected | Required |
| Verification | Optional | Mandatory | Required |
| State in ~/.claude/ | ✅ | ✅ (migrated) | ❌ |
| State in .omc/ | ❌ | ✅ | ✅ |
| Team pipeline | ❌ | ✅ | ✅ |
| Notepad system | ❌ | ✅ | ✅ |
| Project memory | ❌ | ✅ | ✅ |

---

**Document Status**: Complete & Ready for Implementation
**Last Updated**: 2025-02-28
**Maintenance**: Update quarterly with new OMC releases

