# Agent Capability Matrix

This matrix shows what each specialist agent can do, which tools it has access to,
and when to use each agent.

---

## Summary Matrix

| Capability | Architect | Developer | Reviewer | Tester | Security | Documenter |
|-----------|:---------:|:---------:|:--------:|:------:|:--------:|:----------:|
| System design | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| OpenAPI specs | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| ADR authoring | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Implementation | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Refactoring | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Code review | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Unit tests | ❌ | 🔶 stubs | ❌ | ✅ | ❌ | ❌ |
| Integration tests | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Coverage analysis | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| OWASP audit | ❌ | ❌ | 🔶 basic | ❌ | ✅ | ❌ |
| Dependency scan | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Secret detection | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| README | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| JSDoc/TSDoc | ❌ | 🔶 inline | ❌ | ❌ | ❌ | ✅ |
| Changelog | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Debate protocol | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

✅ Primary capability | 🔶 Limited/supplementary | ❌ Not in scope

---

## Tool Access Matrix

| Tool | Architect | Developer | Reviewer | Tester | Security | Documenter |
|------|:---------:|:---------:|:--------:|:------:|:--------:|:----------:|
| Read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Write | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| Bash | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Glob | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Grep | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## Model Allocation

| Agent | Default Model | Can Override To |
|-------|--------------|----------------|
| Orchestrator | `claude-opus-4-6` | N/A (always Opus) |
| Architect | `claude-sonnet-4-6` | `claude-opus-4-6` (critical designs) |
| Developer | `claude-sonnet-4-6` | — |
| Reviewer | `claude-sonnet-4-6` | — |
| Tester | `claude-sonnet-4-6` | — |
| Security | `claude-sonnet-4-6` | — |
| Documenter | `claude-sonnet-4-6` | `claude-haiku-4-5` (simple doc tasks) |
| Doc coverage check | `claude-haiku-4-5` | — |

---

## Token Budget Per Agent (defaults)

| Agent | Default Budget | Max Turns | Notes |
|-------|---------------|-----------|-------|
| Architect | 50,000 | 20 | More for bootstrap (80K) |
| Developer | 80,000 | 30 | More for large features (100K) |
| Reviewer | 40,000 | 15 | — |
| Tester | 60,000 | 25 | — |
| Security | 40,000 | 15 | — |
| Documenter | 30,000 | 15 | — |

---

## Quality Gates Produced By Each Agent

| Agent | Produces Gate |
|-------|--------------|
| Architect | `static_analysis` (for spec files) |
| Developer | `static_analysis` |
| Reviewer | `code_review` |
| Tester | `tests` |
| Security | `security` |
| Documenter | `documentation` |

---

## When to Use Each Agent

### Use `architect` when:
- Starting a new feature (always first)
- Making technology stack decisions
- Designing APIs
- Resolving architectural ambiguity
- Debate protocol decisions

### Use `developer` when:
- Implementing features from a spec
- Fixing bugs
- Refactoring code
- Database migrations

### Use `reviewer` when:
- After any developer output
- Before merging code
- When running `/review`
- After security agent finds high-severity issues

### Use `tester` when:
- After developer completes implementation
- Before reporting a bug as fixed
- When coverage is unknown
- Reproducing bugs (before fix)

### Use `security` when:
- After any new API endpoint is implemented
- When working with authentication/authorization
- When dependencies are updated
- For any user-input processing code
- Triggered by `/review --security-only`

### Use `documenter` when:
- After all code is reviewed and approved
- When public APIs change
- When environment variables change
- At the end of every feature workflow
