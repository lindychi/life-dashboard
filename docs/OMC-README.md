# oh-my-claudecode (OMC) v4.5.1 Research & Documentation

**Research Date**: 2025-02-28
**OMC Version**: 4.5.1
**Status**: ✅ Complete & Validated
**Framework**: Claude Code native with multi-agent orchestration

---

## 📚 Documentation Overview

This folder contains comprehensive research on oh-my-claudecode v4.5.1, the latest version of the intelligent multi-agent orchestration layer for Claude Code. The research focuses on breaking changes, new features, and Claude call patterns.

### Document Structure

#### 1. **omc-latest-updates.md** (Primary Reference)
**What It Contains:**
- Executive summary of OMC v4.5.1 capabilities
- Complete agent catalog (14 agents with models)
- 8 key feature areas (orchestration, model routing, team pipeline, etc.)
- New features (notepad, project memory, stage-aware routing, RALPLAN-DR consensus planning)
- 7 major breaking changes with impact analysis
- Configuration files and environment variables
- Quick reference agent selection matrix

**Best For:**
- Understanding OMC capabilities at a glance
- Finding which agent to use for a task
- Learning about the team pipeline architecture
- Reviewing operating principles and delegation rules

**Key Sections:**
```
§1: Multi-Agent Orchestration Architecture
§2: Claude Call Pattern Updates (Smart Model Routing)
§3: Team Pipeline: Stage-Aware Agent Routing
§4: Workflow Skills & Execution Modes
§5: State Management & Persistence
§6: Verification Protocol (NEW)
§7: Delegation Rules
§8: Team + Ralph Composition
```

---

#### 2. **omc-claude-call-patterns.md** (Developer's Guide)
**What It Contains:**
- Detailed Task invocation patterns with syntax
- Agent type resolution and canonical naming
- 7 API changes from v4.4 → v4.5.1
- Team lifecycle and staged pipeline (visual diagrams)
- Intelligent model selection strategy with cost matrix
- Context passing mechanisms (Priority/Working/Project)
- 6 real-world examples (feature development, bug investigation, security review)
- Common pitfalls and solutions
- Complete migration guide from v4.4

**Best For:**
- Writing actual Task calls in code
- Understanding API changes and migration
- Learning context passing strategies
- Real-world implementation examples
- Troubleshooting common mistakes

**Key Sections:**
```
Part 1: Task Invocation Patterns (with code examples)
Part 2: Team Coordination API (lifecycle and state)
Part 3: Model Routing Strategy (haiku/sonnet/opus selection)
Part 4: Context Passing & State (priority/working/project)
Part 5: Parallel Execution Patterns
Part 6: Real-World Examples (6 detailed scenarios)
Part 7: Common Pitfalls & Solutions
Part 8: Migration Guide (v4.4 → v4.5.1 step-by-step)
```

---

#### 3. **omc-breaking-changes-migration.md** (Compliance & Migration)
**What It Contains:**
- Quick summary table of all breaking changes
- Detailed analysis of 7 breaking changes (severity, impact, migration path)
- Complete migration checklist
- Rollback procedure (if needed)
- Version compatibility matrix
- Common issues and diagnostics

**Best For:**
- Upgrading from v4.4 to v4.5.1
- Ensuring breaking change compliance
- Understanding migration timelines
- Fixing migration issues
- Planning rollback if necessary

**Key Changes:**
```
1. Model parameter expected (Low severity)
2. Deprecated agent aliases (Medium severity)
3. Verification mandatory (High severity) ⚠️
4. State storage location (Medium severity)
5. Team pipeline required (Low severity)
6. Context persistence changes (Medium severity)
7. Hook runtime guarantees (Low severity)
```

---

## 🚀 Quick Start

### If You're New to OMC
1. Read **omc-latest-updates.md** § Executive Summary
2. Review the **Agent Catalog** and **Quick Reference Matrix**
3. Look at **omc-claude-call-patterns.md** § Real-World Examples
4. Try a simple Task call with a model parameter

### If You're Upgrading from v4.4
1. Check **omc-breaking-changes-migration.md** § Quick Summary
2. Work through the **Critical** and **High Priority** checklists
3. Follow the migration path for each breaking change
4. Run diagnostics to verify state migration

### If You're Building a Feature
1. Read **omc-claude-call-patterns.md** § Real-World Examples
2. Choose: Manual Task calls vs. Team pipeline
3. For complex features: Use `Skill(skill="team", ...)`
4. Always include verification task
5. Reference **Context Passing** section for knowledge reuse

---

## 📋 Key Concepts at a Glance

### The 14 Core Agents (with Model Defaults)

| Agent | Model | Purpose | Typical Use |
|-------|-------|---------|-------------|
| **explore** | haiku | Codebase discovery | Map module structure |
| **analyst** | opus | Requirements clarity | Validate acceptance criteria |
| **planner** | opus | Task sequencing | Break down complex work |
| **architect** | opus | System design | Design boundaries/interfaces |
| **debugger** | sonnet | Root-cause analysis | Fix bugs, isolate regressions |
| **executor** | sonnet | Implementation | Build features, refactor code |
| **deep-executor** | opus | Autonomous goal work | Complex multi-file changes |
| **verifier** | sonnet | Completion validation | Evidence-based verification |
| **quality-reviewer** | sonnet | Code quality | Anti-patterns, performance |
| **security-reviewer** | sonnet | Security validation | Vulnerabilities, auth/authz |
| **code-reviewer** | opus | Comprehensive review | API contracts, versioning |
| **test-engineer** | sonnet | Test strategy | Coverage, flaky-test hardening |
| **build-fixer** | sonnet | Build errors | TypeScript, compilation issues |
| **document-specialist** | sonnet | External research | Documentation, references |

### The 5-Stage Team Pipeline

```
team-plan (planning)
    ↓
team-prd (specification)
    ↓
team-exec (implementation)
    ↓
team-verify (validation) ← ✨ Built-in verification
    ↓
team-fix (repair loop, max 3 attempts)
    ↓
complete or failed
```

### Model Routing Strategy

```
Haiku (Cost: $$$$, Speed: ◀)
├─ Quick lookups
├─ Symbol mapping
└─ Documentation

Sonnet (Cost: $$, Speed: ◀→)
├─ Implementation
├─ Debugging
├─ Testing
└─ Code review

Opus (Cost: $, Speed: →)
├─ Architecture
├─ Deep analysis
├─ Complex refactors
└─ Consensus planning
```

### Context Persistence (NEW)

```
Priority Context (fixed, max 500 chars)
    ↓ Loaded at session start
Working Memory (session-scoped, auto-pruned 7d)
    ↓ Shared within session
Project Memory (persistent, survives sessions)
    ↓ Tech stack, conventions, directives
```

---

## ⚠️ Critical Breaking Changes

### 1. **Verification is Now Mandatory** (High Severity)

**OLD (v4.4):**
```typescript
Task(subagent_type="oh-my-claudecode:executor", prompt="Build auth system")
// Report: "Feature complete" ❌ NO LONGER ACCEPTABLE
```

**NEW (v4.5.1):**
```typescript
Task(subagent_type="oh-my-claudecode:executor", model="sonnet", prompt="Build auth system")
Task(subagent_type="oh-my-claudecode:verifier", model="sonnet", prompt="Verify auth system: all tests passing, no TypeScript errors, security review passed")
// Report: "✅ VERIFIED: Auth system complete (12/12 tests passing, 0 errors)" ✅ REQUIRED
```

### 2. **Model Parameter Now Expected**

**OLD:**
```typescript
Task(subagent_type="oh-my-claudecode:executor", prompt="...")
```

**NEW:**
```typescript
Task(subagent_type="oh-my-claudecode:executor", model="sonnet", prompt="...")
```

### 3. **Use Canonical Agent Names**

**OLD:**
```typescript
Task(subagent_type="researcher", ...)
Task(subagent_type="tdd-guide", ...)
```

**NEW:**
```typescript
Task(subagent_type="oh-my-claudecode:document-specialist", ...)
Task(subagent_type="oh-my-claudecode:test-engineer", ...)
```

### 4. **State Moved to `.omc/` Directory**

**OLD:** `~/.claude/.omc/state/`
**NEW:** `{project}/.omc/state/`

---

## 📊 Version Compatibility

| Feature | v4.4 | v4.5.1 | v4.6 (Planned) |
|---------|------|--------|----------------|
| Legacy aliases | ✅ | ✅ (deprecated) | ❌ |
| Model routing | Optional | Expected | Required |
| Verification | Optional | Mandatory | Required |
| Team pipeline | ❌ | ✅ | ✅ |
| Notepad system | ❌ | ✅ | ✅ |
| Project memory | ❌ | ✅ | ✅ |
| State in .omc/ | ❌ | ✅ | ✅ |

---

## 🔍 Use Case Finder

### "I need to implement a feature"
→ **omc-claude-call-patterns.md** § Real-World Examples § Pattern 1
→ Use `Skill(skill="team", args="...")` for multi-step work

### "I need to fix a bug"
→ **omc-claude-call-patterns.md** § Real-World Examples § Pattern 2
→ Use `debugger` agent, then `verifier` for validation

### "I need a security review"
→ **omc-claude-call-patterns.md** § Real-World Examples § Pattern 3
→ Use `code-reviewer` or `security-reviewer` agent

### "I'm upgrading from v4.4"
→ **omc-breaking-changes-migration.md** § Migration Checklist
→ Follow Critical → High Priority → Medium Priority steps

### "I'm writing a custom Task call"
→ **omc-claude-call-patterns.md** § Part 1: Task Invocation Patterns
→ Follow the syntax and examples

### "I want to parallelize work"
→ **omc-claude-call-patterns.md** § Part 5: Parallel Execution
→ Use Team for coordination, ultrawork for max parallelism

### "I need to persist project knowledge"
→ **omc-latest-updates.md** § State Management & Persistence
→ Use `project_memory_write()` and `project_memory_add_directive()`

---

## 🛠️ Operational Principles

1. **Delegate specialized work** to appropriate agent
2. **Keep users informed** with concise progress updates
3. **Prefer clear evidence** over assumptions; verify before claiming completion
4. **Choose lightest-weight path** that preserves quality
5. **Use context files** and concrete outputs
6. **Consult documentation** before implementing with SDKs

---

## 📞 Troubleshooting Quick Links

**Problem: Agent not found**
→ omc-claude-call-patterns.md § Agent Type Resolution
→ Use `oh-my-claudecode:agent-name` format

**Problem: Verification task fails**
→ omc-breaking-changes-migration.md § Breaking Change 3
→ Add explicit model parameter, specify clear criteria

**Problem: State file conflicts**
→ omc-breaking-changes-migration.md § Breaking Change 4
→ Auto-migration runs on first use; manual copy if needed

**Problem: Model parameter errors**
→ omc-breaking-changes-migration.md § Breaking Change 1
→ Use `model="haiku"`, `model="sonnet"`, or `model="opus"`

**Problem: Performance issues**
→ omc-latest-updates.md § Model Routing Strategy
→ Right-size model to task complexity

---

## 📈 Implementation Path

### Phase 1: Understanding (30 min)
- [ ] Read omc-latest-updates.md Executive Summary
- [ ] Review Agent Catalog
- [ ] Skim Real-World Examples

### Phase 2: Migration Planning (45 min)
- [ ] Read omc-breaking-changes-migration.md
- [ ] Identify breaking changes applicable to your project
- [ ] Create migration checklist

### Phase 3: Implementation (2-4 hours)
- [ ] Follow Migration Checklist
- [ ] Update Task calls with model parameters
- [ ] Replace deprecated agent names
- [ ] Add verification tasks
- [ ] Initialize project memory

### Phase 4: Validation (30 min)
- [ ] Test Task invocations
- [ ] Verify state migration
- [ ] Run diagnostics
- [ ] Confirm no cross-project state leakage

---

## 📚 Related Documentation

**In This Repository:**
- `/Users/hanchi/work/life-dashboard/CLAUDE.md` - Project-specific OMC configuration
- `/Users/hanchi/work/life-dashboard/.omc/project-memory.json` - Project knowledge base
- `/Users/hanchi/work/life-dashboard/.omc/notepad.md` - Session notes

**Global Configuration:**
- `/Users/hanchi/.claude/CLAUDE.md` - Global OMC 4.5.1 configuration (embedded in system)
- `~/.claude/.omc-config.json` - Optional global settings

---

## ✅ Validation Checklist

Use this checklist to verify your OMC setup:

### Configuration
- [ ] OMC version is 4.5.1 (check CLAUDE.md)
- [ ] `.omc/` directory exists in project root
- [ ] `.omc/` is in `.gitignore`
- [ ] Project memory initialized (`project-memory.json`)

### Code Quality
- [ ] All Task calls have explicit `model` parameter
- [ ] No deprecated agent aliases (`researcher`, `tdd-guide`, etc.)
- [ ] All feature implementations include verification task
- [ ] Priority context set via `notepad_write_priority()`

### Breaking Changes
- [ ] Verification tasks for all features (§ Change 3)
- [ ] State migrated to `.omc/` (§ Change 4)
- [ ] Agent names use canonical form (§ Change 2)
- [ ] Model parameters explicit (§ Change 1)
- [ ] Complex features use Team pipeline (§ Change 5)

### Documentation
- [ ] Project memory includes tech stack section
- [ ] Custom directives documented with priority levels
- [ ] Team pipeline state managed automatically

---

## 📝 Version History

| Version | Date | Status | Key Features |
|---------|------|--------|--------------|
| 4.5.1 | 2025-02-28 | ✅ Current | Evidence-based verification, smart model routing, native team coordination |
| 4.5.0 | 2025-02-15 | 🔄 Deprecated | Introduced team pipeline architecture |
| 4.4.x | 2025-01-xx | ⚠️ Legacy | Manual agent orchestration |

---

## 🎯 Next Steps

1. **Pick a document based on your role:**
   - **Learning**: Start with omc-latest-updates.md
   - **Implementing**: Use omc-claude-call-patterns.md
   - **Upgrading**: Follow omc-breaking-changes-migration.md

2. **Set up your project:**
   - Initialize project memory
   - Set priority context
   - Verify state directory structure

3. **Start delegating:**
   - Use explicit model parameters
   - Include verification in every feature
   - Reference appropriate agents from catalog

4. **Keep improving:**
   - Monitor performance via `/omc trace`
   - Update project memory with learnings
   - Share patterns with team

---

**Last Validated**: 2025-02-28
**Maintained By**: Life Dashboard Team
**Questions**: Review the relevant document above, then check `/omc-help` skill

