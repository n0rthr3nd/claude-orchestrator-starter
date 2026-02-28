# Extension Guide — Adding New Specialist Agents

This guide explains how to extend the orchestrator with new specialized agents.

---

## 1. Create the Agent Directory

```bash
mkdir -p agents/<your-agent-name>
```

Choose a descriptive name: `performance-analyst`, `migration-expert`, `api-designer`, etc.

---

## 2. Write the System Prompt

Create `agents/<your-agent-name>/system-prompt.md`:

```markdown
# <AgentName> Agent — System Prompt

You are the **<AgentName> Agent**, specializing in <domain>.

## Role & Scope

**You DO:**
- <Primary capability 1>
- <Primary capability 2>

**You DON'T:**
- <Out-of-scope task 1> (delegate to <other-agent>)

## Available Tools
- `Read` — <when to use>
- `Write` — <when to use>
- `Bash` — <when to use, if applicable>
- `Glob`, `Grep` — file discovery and search

## Input Schema
\`\`\`json
{
  "task": "<description>",
  "context_summary": "<compressed context>",
  "constraints": [],
  "acceptance_criteria": []
}
\`\`\`

## Output Schema
\`\`\`json
{
  "agent": "<your-agent-name>",
  "task_id": "<uuid>",
  "confidence_score": 85,
  "artifacts": [],
  "quality_gates_passed": [],
  "summary": "",
  "escalation_notes": ""
}
\`\`\`

## Self-Validation Checklist
- [ ] <Check 1>
- [ ] <Check 2>
- [ ] Confidence ≥ 80 before submitting

## Escalation Rules
Escalate to orchestrator if:
- <Condition 1>
- <Condition 2>

## Anti-Patterns to Avoid
- <Pattern to avoid>
```

---

## 3. Register Tool Permissions

In `src/agent-spawner.js`, add to `AGENT_DEFAULTS`:

```javascript
const AGENT_DEFAULTS = {
  // ... existing agents ...
  '<your-agent-name>': { maxTurns: 20, tokenBudget: 50000 },
};
```

And in `getDefaultTools()`:
```javascript
function getDefaultTools(agentType) {
  const toolMap = {
    // ... existing agents ...
    '<your-agent-name>': ['Read', 'Glob', 'Grep', 'Write'],
  };
  return toolMap[agentType] || ['Read', 'Glob', 'Grep'];
}
```

---

## 4. Add Tool Permissions to Settings

In `.claude/settings.json`, update the `pre-tool-use` hook's permission matrix:

```json
{
  "AGENT_TOOL_PERMISSIONS": {
    "<your-agent-name>": ["Read", "Glob", "Grep", "Write", "Edit"]
  }
}
```

In `hooks/pre-tool-use/validate.js`:
```javascript
const AGENT_TOOL_PERMISSIONS = {
  // ... existing agents ...
  '<your-agent-name>': ['Read', 'Glob', 'Grep', 'Write'],
};
```

---

## 5. Update the Agent Capability Matrix

Add a row to `docs/agent-capability-matrix.md`:

```markdown
| <New capability> | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
```

---

## 6. Add to Workflow YAML (if applicable)

Add the agent as a stage in a new or existing workflow:

```yaml
stages:
  - id: <your-stage>
    name: <Stage Name>
    depends_on: [<previous-stage-id>]
    agents:
      - id: <your-agent-name>-main
        type: <your-agent-name>
        model: claude-sonnet-4-6
        max_turns: 20
        token_budget: 50000
        task: >
          <What this agent should do>
        inputs:
          - <input from previous stage>
        outputs:
          - <what this agent produces>
    quality_gates:
      - static_analysis
```

---

## 7. Define Quality Gate (if new gate needed)

If your agent produces a new type of quality check, add it to `src/quality-gates.js`:

```javascript
const GATES = {
  // ... existing gates ...
  '<your_gate_name>': runYourGate,
};

async function runYourGate({ agentOutput } = {}) {
  // Inspect agentOutput for your agent's verdict
  if (agentOutput?.verdict === 'pass') {
    return { status: 'pass' };
  }
  return { status: 'fail', details: agentOutput?.details };
}
```

---

## 8. Write Tests for the New Agent

Create integration tests that verify the agent:
1. Produces output conforming to `agent-output.json` schema
2. Reports accurate quality gates
3. Escalates correctly on failure conditions

---

## 9. Update the Custom Commands

If your agent should be accessible via a slash command, update
`.claude/commands/spawn-agent.md`:

```markdown
## Agent Types
- `<your-agent-name>` — <one sentence description>
```

---

## Example: Adding a Performance Analyst Agent

1. `agents/performance-analyst/system-prompt.md` — specializes in profiling, N+1 detection, latency analysis
2. Add to `AGENT_DEFAULTS`: `'performance-analyst': { maxTurns: 20, tokenBudget: 50000 }`
3. Add to workflow `code-review.yml` as an optional parallel stage
4. Define a `performance` quality gate that checks p95 latency projections
5. Update capability matrix and docs

---

## Agent Versioning

When you update a system prompt, consider versioning it:
```
agents/<name>/
├── system-prompt.md          # Current version
├── system-prompt.v1.md       # Previous version (for rollback)
└── CHANGELOG.md              # What changed and why
```
