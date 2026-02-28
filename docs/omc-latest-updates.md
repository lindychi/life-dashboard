# oh-my-claudecode Latest Updates Research (v4.5.1)

**Last Updated**: 2025-02-28
**Current Version**: 4.5.1
**Status**: Active and operational

## Executive Summary

oh-my-claudecode (OMC) is a sophisticated multi-agent orchestration layer for Claude Code that enables intelligent task delegation, parallel execution, and state persistence. Version 4.5.1 represents a mature, production-ready framework with emphasis on **evidence-based verification**, **smart model routing**, and **native Claude Code team coordination**.

---

## Key Changes & Features in v4.5.1

### 1. **Multi-Agent Orchestration Architecture**

#### Agent Catalog (Canonical Registry)
All agents use the `oh-my-claudecode:` prefix for Task invocations:

**Build/Analysis Lane:**
- `explore` (haiku) - Codebase discovery, symbol/file mapping
- `analyst` (opus) - Requirements clarity, acceptance criteria
- `planner` (opus) - Task sequencing, execution plans
- `architect` (opus) - System design, boundaries, interfaces
- `debugger` (sonnet) - Root-cause analysis, regression isolation
- `executor` (sonnet) - Code implementation, refactoring
- `deep-executor` (opus) - Complex autonomous goal-oriented tasks
- `verifier` (sonnet) - Completion evidence, claim validation

**Review Lane:**
- `quality-reviewer` (sonnet) - Logic defects, anti-patterns, performance
- `security-reviewer` (sonnet) - Vulnerabilities, trust boundaries
- `code-reviewer` (opus) - Comprehensive cross-concern review

**Domain Specialists:**
- `test-engineer` (sonnet) - Test strategy, coverage, flaky-test hardening
- `build-fixer` (sonnet) - Build/toolchain/type failures
- `designer` (sonnet) - UX/UI architecture, interaction design
- `writer` (haiku) - Docs, migration notes, user guidance
- `qa-tester` (sonnet) - Interactive CLI/service runtime validation
- `scientist` (sonnet) - Data/statistical analysis
- `document-specialist` (sonnet) - External documentation & reference lookup

**Coordination:**
- `critic` (opus) - Plan/design critical challenge

#### Deprecated Compatibility Aliases
These are legacy aliases that still route correctly but should not be used in new code:
```
researcher → document-specialist
tdd-guide → test-engineer
api-reviewer → code-reviewer
performance-reviewer → quality-reviewer
dependency-expert → document-specialist
quality-strategist → quality-reviewer
vision → document-specialist
```

### 2. **Claude Call Pattern Updates**

#### Smart Model Routing

Pass `model` parameter on Task calls to match complexity tier:

```typescript
// Quick lookups, lightweight scans
Task(subagent_type="oh-my-claudecode:architect", model="haiku", prompt="Summarize this module boundary.")

// Standard implementation, debugging, reviews
Task(subagent_type="oh-my-claudecode:executor", model="sonnet", prompt="Add input validation to the login flow.")

// Architecture, deep analysis, complex refactors
Task(subagent_type="oh-my-claudecode:executor", model="opus", prompt="Refactor auth/session handling across the API layer.")
```

**Model Selection Guidelines:**
- **Haiku**: Quick lookups, narrow checks, lightweight symbol mapping
- **Sonnet**: Standard implementation, debugging, code reviews, testing
- **Opus**: Architecture decisions, deep analysis, complex multi-file refactors

#### Claude Code Native Teams (NEW)
Instead of spawning external processes, OMC now uses Claude Code's native team coordination:

```
TeamCreate → TaskCreate x N → Task(team_name, name) x N → teammates claim/complete → SendMessage(shutdown_request) → TeamDelete
```

**Tools Used:**
- `TeamCreate`, `TeamDelete`, `SendMessage`
- `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`

**When to Use:**
- Multi-step feature development
- Complex bug investigations
- Code review workflows
- Parallelizable independent tasks

### 3. **Team Pipeline: Stage-Aware Agent Routing**

OMC uses a canonical **5-stage pipeline** with intelligent agent routing:

```
team-plan → team-prd → team-exec → team-verify → team-fix (loop)
```

#### Stage Routing

**team-plan** (Planning & Decomposition)
- Agents: `explore` (haiku) + `planner` (opus), optionally `analyst`/`architect`
- Output: High-level task breakdown, risk identification

**team-prd** (Specification & Criteria)
- Agents: `analyst` (opus), optionally `critic` (opus)
- Output: Explicit acceptance criteria, scope definition

**team-exec** (Implementation)
- Agents: `executor` (sonnet) + task-appropriate specialists
- Specialists: `designer`, `build-fixer`, `writer`, `test-engineer`, `deep-executor`
- Output: Working code, tests, documentation

**team-verify** (Verification & Review)
- Agents: `verifier` (sonnet) + domain reviewers as needed
- Reviewers: `security-reviewer`, `code-reviewer`, `quality-reviewer`
- Output: Verification evidence, issue identification

**team-fix** (Defect Remediation Loop)
- Agents: `executor`/`build-fixer`/`debugger` depending on defect type
- Output: Fixed code, re-verification

#### Stage Transitions
```
team-plan → team-prd:  planning/decomposition complete
team-prd → team-exec:  acceptance criteria & scope explicit
team-exec → team-verify:  all execution tasks reach terminal states
team-verify → team-fix | complete | failed:  verification decides next step
team-fix → team-exec | team-verify | complete | failed:  fixes feed back, loop bounded
```

**Terminal States:** `complete`, `failed`, `cancelled`

**Loop Bounding:** `team-fix` loop is bounded by max attempts; exceeding bound transitions to `failed`

### 4. **Workflow Skills & Execution Modes**

#### Primary Workflows

**autopilot** (Full Autonomous Execution)
- Trigger: "autopilot", "build me", "I want a"
- Mode: End-to-end feature development with auto-verification
- Can transition to: ralph-loop, ultraqa

**ralph** (Self-Referential Loop with Verification)
- Trigger: "ralph", "don't stop", "must complete"
- Mode: Persisted loop with architect verification + ultrawork parallelism
- Includes: Built-in ultrawork for maximum parallelism
- State: Linked to team state when `team ralph` is used

**team** (Multi-Agent Orchestration)
- Trigger: "team", "coordinated team", "team ralph"
- Mode: N coordinated Claude agents using native teams with stage-aware routing
- Supports: `team ralph` for persistent team execution
- State: Tracks `current_phase`, `team_name`, `fix_loop_count`, `linked_ralph`, `stage_history`

**ultrawork** (Maximum Parallelism)
- Trigger: "ulw", "ultrawork"
- Mode: Parallel agent orchestration for independent tasks
- Integration: Automatically included in ralph-loop

**ultrapilot** (Parallel Autopilot)
- Trigger: "ultrapilot", "parallel build"
- Mode: Compatibility facade over Team; maps onto Team's staged runtime
- Status: Mutually exclusive with autopilot

**pipeline** (Sequential Agent Chaining)
- Trigger: "pipeline", "chain agents"
- Mode: Sequential agent workflow with data passing between stages

#### Specialized Workflows

**plan** (Strategic Planning)
- Trigger: "plan this", "plan the"
- Modes: Standard, `--consensus`, `--review`
- Features: RALPLAN-DR structured deliberation in consensus mode

**ralplan** (Consensus Planning)
- Trigger: "ralplan", "consensus plan"
- Alias: `/plan --consensus`
- Flow: Planner → Architect → Critic until consensus
- Options: `--deliberate` for high-risk work (adds pre-mortem + comprehensive test planning)

**ultraqa** (QA Cycling)
- Trigger: Activated by autopilot
- Mode: Test → verify → fix → repeat until goal met
- State: Tracked via `ultraqa-state.json`

**sciomc** (Parallel Science Analysis)
- Trigger: "sciomc"
- Mode: Parallel scientist agents for comprehensive data analysis

#### CLI Worker Orchestration

**omc-teams** (Codex/Gemini CLI Workers)
- Trigger: "omc-teams", bare "codex", bare "gemini"
- Mode: Spawn CLI processes in tmux panes via `bridge/runtime-cli.cjs`
- Use Case: When you need CLI process workers (not Claude Code agents)

**ccg** (Tri-Model Orchestration)
- Trigger: "ccg", "tri-model", "claude codex gemini"
- Mode: Fan out to Codex (backend/analytical) + Gemini (frontend/UI) in parallel
- Synthesis: Claude synthesizes results
- Priority: Overrides bare "codex"/"gemini" routing
- Requirement: Requires codex and gemini CLIs installed

#### Keyword Priority Resolution
```
explicit mode keywords (ulw, ultrawork) override defaults
generic "fast"/"parallel" → reads ~/.claude/.omc-config.json → defaultExecutionMode
ralph includes ultrawork (persistence wrapper)
Autopilot can transition to ralph or ultraqa
Autopilot and ultrapilot are mutually exclusive

Routing priority:
  "claude codex gemini" (all 3) → ccg
  "codex" or "gemini" (bare) → omc-teams
  "team ralph" → team + ralph linked
```

### 5. **State Management & Persistence**

#### State Storage Architecture
```
All state lives under git worktree root, NOT ~/.claude/

{worktree}/.omc/state/
├── {mode}-state.json                    # Legacy fallback
├── sessions/{sessionId}/
│   ├── {mode}-state.json               # Session-scoped state
│   ├── linked_team.json
│   └── linked_ralph.json
├── notepad.md                           # Session memory
├── project-memory.json                  # Persistent project context
├── plans/                               # Planning documents
├── research/                            # Research outputs
└── logs/                                # Audit logs
```

#### Supported State Modes
- `autopilot` - Full autonomous execution
- `ultrapilot` - Parallel autopilot variant
- `team` - Multi-agent team coordination
- `pipeline` - Sequential chaining
- `ralph` - Persistence loop
- `ultrawork` - Parallelism engine
- `ultraqa` - QA cycling

#### Notepad System (Session Memory)
```typescript
// Priority context (max 500 chars, loaded at session start)
notepad_write_priority("Current focus: implementing auth refactor")

// Working memory (timestamped, auto-pruned after 7 days)
notepad_write_working("Discovered circular dependency in models.ts")

// Manual notes (permanent, never auto-pruned)
notepad_write_manual("Critical: API contract change breaks mobile clients")

// Read operations
notepad_read(section: "all" | "priority" | "working" | "manual")
notepad_prune(daysOld: 7)
notepad_stats()
```

#### Project Memory (Persistent)
```typescript
project_memory_read(section: "techStack" | "build" | "conventions" | "structure" | "notes" | "directives")

project_memory_write({
  memory: {
    techStack: "Next.js 16, TypeScript, Tailwind CSS 4",
    build: "pnpm build → standalone output",
    conventions: "PascalCase components, camelCase functions",
    structure: "src/app (routes), src/lib (utilities), src/components (UI)",
    notes: "Database: PostgreSQL 14",
    directives: "Always use TypeScript strict mode"
  },
  merge: true  // Merge with existing; false = replace
})

project_memory_add_note(category: string, content: string)
project_memory_add_directive(directive: string, priority: "high" | "normal", context?: string)
```

### 6. **Verification Protocol**

#### Verification Before Completion (Breaking Change)
**New Requirement:** Verify before claiming completion. Goal is evidence-backed confidence, not ceremony.

```typescript
// Sizing guidance
Small changes (<5 files, <100 lines)
  → verifier with model="haiku"

Standard changes (5-20 files)
  → verifier with model="sonnet"

Large or security/architectural changes (>20 files)
  → verifier with model="opus"
```

#### Verification Loop
1. Identify what proves the claim
2. Run the verification
3. Read the output
4. Report with evidence
5. If verification fails → iterate rather than reporting incomplete work

#### No More "Should/Probably" Claims
- Removed: "should work", "probably complete"
- Required: "evidence of completion"
- Mechanism: Verifier agent validates test results, builds, deployments

### 7. **Delegation Rules**

#### When to Delegate
- Multi-file implementations, refactors, debugging, reviews, planning, research, verification
- Work benefiting from specialist prompts (security, API compatibility, test strategy)
- Independent tasks that can run in parallel

#### When to Work Directly
Only for trivial operations where delegation adds disproportionate overhead:
- Small clarifications, quick status checks
- Single-command sequential operations

#### Path Write Rules
**Direct writes OK for:**
- `~/.claude/**`
- `.omc/**`
- `.claude/**`
- `CLAUDE.md`, `AGENTS.md`

**Delegate for:**
- Primary source-code edits (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.c`, `.cpp`, `.svelte`, `.vue`)

### 8. **Team + Ralph Composition (NEW)**

When both keywords detected (e.g., `/team ralph "task"`):
```
Team: provides multi-agent orchestration
Ralph: provides persistence loop

State Files:
  linked_team.json
  linked_ralph.json

Cancellation:
  Cancel either mode → cancels both
  Both marked active=false
```

---

## Breaking Changes from Previous Versions

### 1. **Deprecated Agent Name Aliases**
- **Old**: Using `researcher`, `tdd-guide`, `api-reviewer` directly
- **New**: Must use canonical names (`document-specialist`, `test-engineer`, `code-reviewer`)
- **Status**: Aliases still route, but canonical registry is authoritative
- **Impact**: Future versions may remove aliases entirely

### 2. **Verification-Before-Completion Requirement**
- **Old**: "This should be complete"
- **New**: Must provide verification evidence
- **Impact**: All task completions require proof
- **Implementation**: Verifier agent validates outputs before marking complete

### 3. **State Storage Location Changed**
- **Old**: Some state in `~/.claude/`
- **New**: All OMC state in `{worktree}/.omc/`
- **Impact**: State is per-project, not global
- **Migration**: Existing `~/.claude/` state will be migrated on first run

### 4. **Team Pipeline Replaces Direct Delegation**
- **Old**: Direct Task calls to individual agents
- **New**: Team pipeline with stage-aware routing (team-plan → team-prd → team-exec → team-verify → team-fix)
- **Impact**: Better orchestration, automatic verifier integration
- **Transition**: Autopilot and ralph now use Team internally

### 5. **Model Routing is Now Mandatory**
- **Old**: Optional model parameter
- **New**: Expected on all non-trivial Task calls
- **Impact**: Better cost/quality/speed optimization
- **Enforcement**: Performance monitoring via `trace` tools

### 6. **Hook Runtime Guarantees**
- **New**: Strict allowlist for sensitive hook fields
- **Impact**: Better security, no accidental data leakage
- **Fields**: `tool_name`, `tool_input`, `tool_response`, `session_id`, `cwd`, `hook_event_name`
- **Filtered**: Sensitive fields via allowlist (permission-request, setup, session-end)

---

## New Features

### 1. **Notepad System**
Session-scoped memory with auto-pruning:
- Priority context (max 500 chars, always loaded)
- Working memory (timestamped, 7-day auto-pruning)
- Manual notes (permanent)

### 2. **Project Memory**
Persistent project context across sessions:
- Tech stack, build commands, conventions
- Custom directives with priority levels
- Auto-merge or replace semantics

### 3. **Stage-Aware Agent Routing**
Team pipeline automatically routes specialists to appropriate stages:
- Planning: explore + planner
- Specification: analyst + critic
- Execution: executor + task-specific specialists
- Verification: verifier + domain reviewers
- Fixing: executor/build-fixer/debugger based on defect type

### 4. **RALPLAN-DR Consensus Planning**
Structured deliberation mode for consensus planning:
- Planner, Architect, Critic iterative loop
- `--consensus` standard mode (short deliberation)
- `--deliberate` option (adds pre-mortem + comprehensive test planning)
- Produces explicit acceptance criteria

### 5. **Tri-Model Orchestration (ccg)**
Parallel execution across Claude, Codex, and Gemini:
- Backend/analytical tasks → Codex
- Frontend/UI tasks → Gemini
- Synthesis → Claude
- Requirement: Codex and Gemini CLIs

### 6. **Fix Loop with Bounded Retries**
Team verification → fix → re-verify cycle:
- Bounded by max attempts
- Exceeding bound transitions to `failed`
- Prevents infinite loops
- Enables recovery from transient failures

### 7. **SSE Real-Time Synchronization**
Server-Sent Events for project/OKR updates (Life Dashboard specific):
- Project CRUD events
- OKR objective/key-result changes
- Metrics update broadcasts
- Auto-reconnect with backoff

---

## Configuration Files

### `.omc/` Directory Structure
```
.omc/
├── state/
│   ├── autopilot-state.json
│   ├── team-state.json
│   ├── ralph-state.json
│   ├── ultrawork-state.json
│   └── sessions/{sessionId}/
├── notepad.md
├── project-memory.json
├── plans/
├── research/
└── logs/
```

### `~/.claude/.omc-config.json`
```json
{
  "defaultExecutionMode": "team",
  "enableTmux": false,
  "staleTimeout": 300000,
  "complexTaskTimeout": 600000,
  "verificationModel": "sonnet"
}
```

### Kill Switches & Env Vars
```bash
DISABLE_OMC=1              # Disable all hooks
OMC_SKIP_HOOKS="hook1,hook2"  # Skip specific hooks
ENABLE_TMUX=true           # Enable tmux integration for agent monitoring
```

---

## Operating Principles (Enforced in v4.5.1)

1. **Delegate specialized or tool-heavy work** to appropriate agent
2. **Keep users informed** with concise progress updates while work is in flight
3. **Prefer clear evidence** over assumptions; verify outcomes before final claims
4. **Choose lightest-weight path** that preserves quality (direct action, tmux worker, or agent)
5. **Use context files** and concrete outputs so delegated tasks are grounded
6. **Consult official documentation** before implementing with SDKs/frameworks/APIs

---

## Claude Call Pattern Best Practices

### Pattern 1: Smart Model Routing
```typescript
// For exploration/quick checks: haiku
Task(subagent_type="oh-my-claudecode:explore", model="haiku", prompt="Map the authentication module structure")

// For implementation/testing/review: sonnet
Task(subagent_type="oh-my-claudecode:executor", model="sonnet", prompt="Implement password reset flow with tests")

// For architecture/complex analysis: opus
Task(subagent_type="oh-my-claudecode:architect", model="opus", prompt="Design microservice boundary between auth and API")
```

### Pattern 2: Team Coordination for Complex Features
```typescript
// Instead of:
Task(subagent_type="oh-my-claudecode:executor", prompt="Build complete auth system")

// Use Team:
// Stage 1: Planning (explore + planner)
// Stage 2: Specification (analyst determines requirements)
// Stage 3: Execution (executor + test-engineer)
// Stage 4: Verification (verifier + security-reviewer)
// Stage 5: Fixes (as needed, re-verify)
Skill(skill="team", args="Build complete auth system with email verification")
```

### Pattern 3: Verification Evidence
```typescript
// OLD (no longer acceptable):
"I've implemented the feature. It should work."

// NEW (required):
"✅ VERIFIED: Feature implementation complete
- Unit tests: 8/8 passing (100% coverage of auth.ts)
- Integration tests: 5/5 passing (login flow end-to-end)
- Build: No TypeScript errors
- Type coverage: 100%
- Security review: No vulnerabilities found"
```

### Pattern 4: Context Persistence Across Stages
```typescript
// Priority context (stays across all stages)
notepad_write_priority("Auth system: must support OAuth2, JWT, Magic Links")

// Working memory (shared within session)
notepad_write_working("Found circular dependency: models.ts ← user.ts ← models.ts")

// Project memory (persistent across sessions)
project_memory_add_directive(
  directive: "All API routes must validate Content-Type header",
  priority: "high",
  context: "Prevents JSON injection attacks"
)
```

### Pattern 5: Parallelization with Team
```typescript
// Sequential (use Team stages):
Skill(skill="team", args="Feature ABC")
// Automatically: plan (sequential) → prd (sequential) → exec (parallel where possible) → verify (sequential)

// Maximum parallelism:
Skill(skill="ultrawork", args="task1, task2, task3, task4")
// All 4 run in parallel with intelligent dependency management
```

---

## Troubleshooting & Known Issues

### Issue: Hook Permissions Hang
**Symptom**: Agent blocked on permission-request hook
**Root Cause**: Tool availability constraint not appended to system prompt
**Solution**: `claude-executor.ts` automatically appends constraint; verify `ENABLE_CONSTRAINT=true`

### Issue: State File Conflicts
**Symptom**: Multiple `.omc/state/*.json` files, unclear which is active
**Solution**: Check `active` field; use `state_get_status()` to see all modes

### Issue: Team Pipeline Stuck in Fix Loop
**Symptom**: `team-fix` repeats indefinitely
**Solution**: Loop is bounded by `max_fix_attempts` (default 3); exceeding bound transitions to `failed`

### Issue: Model Overrun on Deep Recursion
**Symptom**: haiku/sonnet insufficient context for deep analysis
**Solution**: Use `model="opus"` for recursion-heavy tasks; set `max_turns` to limit depth

---

## Upcoming Features & Roadmap

### Planned (Q1 2025)
- Enhanced RALPLAN-DR with weighted consensus voting
- Automatic cost budgeting per task tier
- Knowledge graph integration for architecture discovery

### Under Consideration
- ❌ ultrapilot/swarm (single gateway model preferred over multi-gateway)
- ❌ ralph-loop replacement (existing retry logic sufficient)
- ❌ pipeline mode replacement (priority-based execution proves more flexible)

---

## References

- **Current Version**: 4.5.1 (validated 2025-02-28)
- **Configuration**: `/Users/hanchi/.claude/CLAUDE.md` (embedded)
- **Life Dashboard Integration**: `/Users/hanchi/work/life-dashboard/CLAUDE.md`
- **OMC State Location**: `{project}/.omc/`
- **Notepad**: `{project}/.omc/notepad.md`
- **Project Memory**: `{project}/.omc/project-memory.json`

---

## Quick Reference: Agent Selection Matrix

| Task Type | Agent | Model | Typical Duration |
|-----------|-------|-------|------------------|
| Explore codebase | `explore` | haiku | 30-60s |
| Clarify requirements | `analyst` | opus | 2-5m |
| Design architecture | `architect` | opus | 5-15m |
| Sequence tasks | `planner` | opus | 3-8m |
| Debug failures | `debugger` | sonnet | 5-15m |
| Implement feature | `executor` | sonnet | 10-30m |
| Complex autonomous work | `deep-executor` | opus | 20-60m |
| Verify completion | `verifier` | sonnet* | 3-10m |
| Security review | `security-reviewer` | sonnet | 5-15m |
| Code quality review | `quality-reviewer` | sonnet | 5-15m |
| Comprehensive review | `code-reviewer` | opus | 10-20m |
| Test strategy | `test-engineer` | sonnet | 5-10m |
| Build/type errors | `build-fixer` | sonnet | 5-15m |
| UI/UX design | `designer` | sonnet | 10-20m |
| Documentation | `writer` | haiku | 5-15m |
| Data analysis | `scientist` | sonnet | 10-30m |
| External research | `document-specialist` | sonnet | 5-15m |

*`verifier` model can be sized: haiku (<5 files), sonnet (5-20 files), opus (>20 files)

