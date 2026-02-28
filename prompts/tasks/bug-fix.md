# Bug Fix Task Template

Use this template when executing a bug fix workflow.

---

## Task: Fix {{bug_title}}

**Type**: Bug Fix
**Severity**: {{severity}} (critical|high|medium|low)
**Reported In**: {{component}}
**Assigned Workflow**: `workflows/bug-fix.yml`

---

## Bug Description

{{bug_description}}

---

## Reproduction Steps

1. {{step_1}}
2. {{step_2}}
3. {{step_3}}

**Expected behavior**: {{expected}}
**Actual behavior**: {{actual}}

---

## Agent Execution Order

```
1. tester     → Write a failing test that reproduces the bug
                [verify: test fails before fix]

2. developer  → Fix the root cause (NOT just the symptom)
                [verify: failing test now passes]

3. tester     → Verify fix, run full test suite
                [quality gate: tests]

4. security   → Security check if bug was security-related
                [quality gate: security — conditional]

5. reviewer   → Review fix for correctness and side effects
                [quality gate: code_review]
```

---

## Root Cause Analysis Template

The developer agent must produce:
```markdown
## Root Cause Analysis

**Symptom**: <what the user observed>
**Root Cause**: <the actual underlying issue>
**Fix**: <what was changed and why>
**Regression Test**: <path to the test that would have caught this>
**Prevention**: <what process change would prevent similar bugs>
```

---

## Artifacts Expected

- Failing test (written BEFORE fix)
- Bug fix implementation
- Passing test suite
- Root cause analysis document
- Updated `CHANGELOG.md` entry
