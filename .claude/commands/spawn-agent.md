# /spawn-agent

Launch a specialist sub-agent with full context injection. The agent receives a structured
handoff packet containing its task, constraints, relevant artifacts, and expected output schema.

## Usage
```
/spawn-agent <type> <task> [context]
```

## Agent Types
- `architect` — System design, API specs, ADRs, architecture decisions
- `developer` — Code implementation, refactoring
- `reviewer` — Code review, quality checks, security scanning
- `tester` — Test writing, coverage analysis, test execution
- `security` — Security audits, OWASP analysis, dependency scanning
- `documenter` — API docs, README, changelogs, ADRs

## Examples
```
/spawn-agent architect "Design the event-driven notification system"
/spawn-agent developer "Implement the UserRepository class per the spec in prompts/tasks/"
/spawn-agent reviewer "Review the PR changes in src/auth/"
/spawn-agent tester "Write unit tests for the payment service, target 90% coverage"
/spawn-agent security "Audit the API endpoints for OWASP Top 10 vulnerabilities"
/spawn-agent documenter "Generate OpenAPI spec for the REST API in src/api/"
```

## What this command does

1. **Load agent system prompt** from `agents/<type>/system-prompt.md`
2. **Build handoff packet** with current context, task description, constraints
3. **Inject context** — pass only relevant artifacts (compress if > 80K tokens)
4. **Set token budget** based on agent type (see Agent Roster in CLAUDE.md)
5. **Launch sub-agent** with `--max-turns` limit per agent type
6. **Monitor** — stream progress, detect quality gate results
7. **Validate output** — verify handoff schema compliance
8. **Return result** — structured JSON output + artifacts

## Handoff Packet Structure

The agent will receive:
```json
{
  "agent_type": "<type>",
  "task_id": "<uuid>",
  "task": "<task description>",
  "context_summary": "<compressed context>",
  "relevant_artifacts": ["<file paths>"],
  "constraints": ["<constraint list>"],
  "quality_gates": ["static_analysis", "tests", "security", "docs", "review"],
  "expected_output": {
    "format": "json|code|markdown",
    "artifacts": ["<paths>"],
    "acceptance_criteria": ["<criteria>"]
  },
  "confidence_threshold": 80
}
```

## Context Injection Strategy

- Pass **file contents** for files the agent needs to read (< 50K tokens total)
- Pass **summaries** for large codebases (compress to key facts)
- Pass **previous handoffs** as context chain (last 3 handoffs only)
- Never pass the full conversation history — always compress first
