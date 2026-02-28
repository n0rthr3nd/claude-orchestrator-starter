# Agent Handoff Protocol

This document defines the strict communication protocol between agents in the orchestration
pipeline. All agents MUST follow this protocol when passing work to another agent.

---

## Protocol Overview

All agent-to-agent communication is **structured** and **validated**. No free-form text
handoffs are permitted. Every handoff must:

1. Conform to `prompts/schemas/handoff.json`
2. Include all required fields
3. Accurately report quality gates passed
4. Include a confidence score
5. Be validated by the orchestrator before dispatch

---

## Handoff Lifecycle

```
Producing Agent
  │
  ├─ completes task
  ├─ runs self-validation checklist
  ├─ assigns confidence score
  ├─ constructs handoff JSON
  │
  ▼
Orchestrator (validates handoff)
  │
  ├─ validates JSON schema
  ├─ verifies quality gates are accurate
  ├─ checks confidence score
  │   ├─ < 70: triggers critic-actor cycle
  │   └─ 70+: proceeds normally
  ├─ routes to next agent OR human (if escalation_notes)
  │
  ▼
Receiving Agent
  │
  ├─ reads handoff packet
  ├─ loads referenced artifacts
  ├─ executes assigned task
  └─ produces next handoff
```

---

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `from_agent` | string | Agent producing this handoff |
| `to_agent` | string | Next agent in pipeline |
| `task_id` | UUID | Unique task chain identifier |
| `timestamp` | ISO8601 | When handoff was created |
| `context_summary` | string | Compressed context (< 500 words) |
| `artifacts` | array | List of produced/consumed artifacts |
| `quality_gates_passed` | array | Only gates that were actually run AND passed |
| `confidence_score` | integer | 0–100 self-assessed confidence |
| `next_expected_output` | object | What the receiving agent should produce |

---

## Context Compression Rules

Context passed to sub-agents MUST be compressed to minimize token waste:

### Include
- Task description (concise, complete)
- Relevant constraints (technical + business)
- File paths of artifacts to read (not content)
- Quality gate results (pass/fail only, not full reports)
- Key decisions made in previous stages (ADR references)

### Exclude
- Full file contents (agent reads them directly)
- Previous agent's thought process
- Redundant information
- The full conversation history

### Compression Template
```
Task: <one sentence>
Context: <2-3 sentences of relevant background>
Constraints: <bullet list>
Artifacts to review: <file paths>
Quality gates already passed: <list>
Next expected output: <brief description>
```

---

## Quality Gate Accuracy

**Agents MUST NOT claim quality gates passed unless they actually ran the check.**

| Gate | When to claim it | How to verify |
|------|-----------------|---------------|
| `static_analysis` | Linter ran with zero errors | `npm run lint` exit 0 |
| `tests` | Test suite ran and all pass | `npm test` exit 0 |
| `security` | OWASP audit completed | Security report produced |
| `documentation` | All public APIs documented | Coverage ≥ 90% |
| `code_review` | Reviewer gave approve verdict | Review report: verdict=approve |

---

## Confidence Score Thresholds

| Score | Action |
|-------|--------|
| 90–100 | Proceed, no special handling |
| 70–89 | Proceed with standard review |
| 50–69 | Trigger critic-actor review cycle |
| 30–49 | Escalate to orchestrator for guidance |
| < 30 | Block — surface to human immediately |

---

## Escalation Protocol

If an agent encounters a blocking issue, it MUST:

1. Complete as much of the task as possible
2. Populate `escalation_notes` with:
   - What the blocker is
   - What information is needed
   - Suggested approaches (if any)
3. Set confidence score appropriately (often < 70)
4. Include in `artifacts` any partial work produced

The orchestrator will then:
1. Surface the escalation to the human
2. Collect clarification
3. Re-inject the clarification into the agent's context
4. Resume the agent with the enriched context

---

## Retry Protocol

Maximum 2 retries per task before escalating to human.

Each retry MUST:
1. Include the failure details from the previous attempt
2. Include specific guidance on what to do differently
3. Increment `retry_count` in the handoff

After 2 failed retries:
1. Create a checkpoint preserving all partial work
2. Escalate to human with full failure history
3. Do NOT discard partial work
