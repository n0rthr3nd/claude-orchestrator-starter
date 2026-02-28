# /review

Trigger a multi-agent review pipeline that combines code review, security audit, test coverage
analysis, and documentation completeness checks.

## Usage
```
/review [scope]
```

## Examples
```
/review                     # Review all recent changes
/review src/auth/           # Review specific directory
/review src/api/routes.js   # Review specific file
/review PR#42               # Review a pull request (uses git diff)
/review --security-only     # Only run security audit
/review --full              # Full pipeline: code + security + tests + docs
```

## Review Pipeline

The review command spawns agents in this order:

```
1. reviewer   → Code quality, patterns, SOLID principles, complexity
2. security   → OWASP Top 10, dependency vulnerabilities, secrets exposure
3. tester     → Test coverage gaps, missing test cases, flaky tests
4. documenter → API documentation completeness, README accuracy
```

Steps 1–3 can run in **parallel** (they're independent).
Step 4 (documenter) waits for reviewer output to cross-reference.

## Review Output

Each agent produces a structured report:
```json
{
  "agent": "<type>",
  "severity_counts": {
    "critical": 0,
    "high": 2,
    "medium": 5,
    "low": 8,
    "info": 12
  },
  "findings": [
    {
      "severity": "high",
      "file": "<path>",
      "line": 42,
      "message": "<description>",
      "suggestion": "<fix>"
    }
  ],
  "verdict": "approve|request_changes|block",
  "confidence": 92
}
```

## Verdict Aggregation

| Aggregate Verdict | Condition |
|-------------------|-----------|
| `APPROVE` | All agents approve, no critical/high issues |
| `REQUEST_CHANGES` | Any agent requests changes (medium+ issues) |
| `BLOCK` | Any critical issue found by any agent |

## Integration with Quality Gates

Running `/review` and getting `APPROVE` satisfies the `code_review` + `security` quality gates.
Results are stored and referenced by `/checkpoint` and `/orchestrate`.
