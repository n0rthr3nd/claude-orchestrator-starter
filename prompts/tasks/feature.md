# Feature Development Task Template

Use this template when the orchestrator is executing a new feature development workflow.
Fill in all `{{variables}}` before spawning agents.

---

## Task: Implement {{feature_name}}

**Type**: Feature
**Priority**: {{priority}}
**Complexity**: {{complexity}}
**Assigned Workflow**: `workflows/feature-development.yml`

---

## Objectives

{{feature_description}}

---

## Acceptance Criteria

- [ ] All API endpoints defined in spec are implemented
- [ ] Input validation on all user-facing endpoints
- [ ] Error handling for all failure modes with appropriate HTTP status codes
- [ ] Structured logging on all significant operations
- [ ] Unit test coverage > 80% on new code
- [ ] Integration tests for all API endpoints
- [ ] OpenAPI spec updated to reflect new endpoints
- [ ] Environment variables documented in README
- [ ] No hardcoded values
- [ ] Security agent audit passed

---

## Technical Constraints

{{technical_constraints}}

---

## Out of Scope

{{out_of_scope}}

---

## Agent Execution Order

```
1. architect    → Design system, write OpenAPI spec, create ADR
                  [quality gate: static_analysis]

2. developer    → Implement per architect's spec
   (parallel)     [quality gate: static_analysis]

3. tester       → Write tests targeting 85% coverage
   (parallel)     [quality gate: tests]

4. security     → OWASP audit of implementation
                  [quality gate: security]

5. reviewer     → Code review, verify spec compliance
                  [quality gate: code_review]

6. documenter   → Update docs, OpenAPI, changelog
                  [quality gate: documentation]
```

---

## Artifacts Expected

- `prompts/tasks/{{feature_name}}.openapi.yaml` — API spec
- `docs/adr/{{number}}-{{feature_name}}.md` — ADR
- `src/{{module}}/**` — Implementation
- `src/{{module}}/**/*.test.ts` — Tests
- Updated `README.md`
- Updated `CHANGELOG.md`

---

## Token Budget Per Agent

| Agent | Budget | Max Turns |
|-------|--------|-----------|
| architect | 50,000 | 20 |
| developer | 80,000 | 30 |
| tester | 60,000 | 25 |
| security | 40,000 | 15 |
| reviewer | 40,000 | 15 |
| documenter | 30,000 | 15 |
