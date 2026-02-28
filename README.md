# Claude Orchestrator

A production-ready multi-agent orchestration system using **Claude Code** as the central
coordinator for software development projects. The orchestrator decomposes complex tasks,
spawns specialist agents in parallel or sequence, enforces quality gates, and synthesizes
production-ready deliverables.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│               Master Orchestrator (claude-opus-4-6)         │
│         CLAUDE.md · src/orchestrator.js                     │
└───────────┬─────────┬──────────┬──────────┬────────────────┘
            │         │          │          │
     ┌──────▼──┐ ┌────▼────┐ ┌──▼─────┐ ┌──▼──────────┐
     │Architect│ │Developer│ │Reviewer│ │Tester       │
     │ (sonnet)│ │ (sonnet)│ │(sonnet)│ │(sonnet)     │
     └─────────┘ └─────────┘ └────────┘ └─────────────┘
                                           ┌──────────┐  ┌────────────┐
                                           │Security  │  │Documenter  │
                                           │ (sonnet) │  │(sonnet)    │
                                           └──────────┘  └────────────┘

Quality Gates (between every transition):
  static_analysis → tests → security → documentation → code_review
```

---

## Prerequisites

- **Node.js** 18+
- **Claude Code CLI** installed (`npm install -g @anthropic-ai/claude-code`)
- **Anthropic API Key** with access to `claude-opus-4-6` and `claude-sonnet-4-6`

---

## Installation

```bash
git clone <repo-url>
cd claude-orchestrator
npm install
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

---

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | **Yes** | — | Your Anthropic API key |
| `DEFAULT_SUB_AGENT_MODEL` | No | `claude-sonnet-4-6` | Model for specialist agents |
| `ORCHESTRATOR_MODEL` | No | `claude-opus-4-6` | Model for orchestrator |
| `MAX_PARALLEL_AGENTS` | No | `3` | Max concurrent agent executions |
| `CONFIDENCE_THRESHOLD` | No | `80` | Min confidence before critic cycle |
| `MAX_RETRIES` | No | `2` | Max agent retries on failure |
| `CHECKPOINT_DIR` | No | `.orchestrator/checkpoints` | Where checkpoints are saved |
| `CACHE_DIR` | No | `.orchestrator/cache` | Where results are cached |
| `LOG_LEVEL` | No | `info` | Log level: debug/info/warn/error |

---

## Quickstart

### 1. Orchestrate a feature

```bash
# Via CLI
node src/orchestrator.js "Add JWT authentication to the REST API"

# Via Claude Code slash command (while in Claude Code session)
/orchestrate Add JWT authentication to the REST API
```

### 2. Review code changes

```bash
/review src/auth/
/review --security-only
```

### 3. Fix a bug

```bash
/orchestrate Fix the race condition in the payment processing module
```

### 4. Bootstrap a new project

```bash
/orchestrate bootstrap "Build a SaaS analytics dashboard with React + Node.js"
```

---

## Custom Slash Commands

| Command | Description |
|---------|-------------|
| `/orchestrate <task>` | Analyze → plan → execute with all specialist agents |
| `/spawn-agent <type> <task>` | Launch a single specialist agent |
| `/review [scope]` | Multi-agent code review pipeline |
| `/checkpoint [label]` | Save orchestration state snapshot |
| `/status` | Show active agents, progress, metrics |
| `/rollback [checkpoint]` | Restore to a previous state |

---

## Specialist Agents

| Agent | Model | Role |
|-------|-------|------|
| `architect` | claude-sonnet-4-6 | System design, OpenAPI specs, ADRs |
| `developer` | claude-sonnet-4-6 | Code implementation |
| `reviewer` | claude-sonnet-4-6 | Code review, quality assessment |
| `tester` | claude-sonnet-4-6 | Test writing, coverage analysis |
| `security` | claude-sonnet-4-6 | OWASP audits, vulnerability scanning |
| `documenter` | claude-sonnet-4-6 | API docs, README, changelogs |

---

## Workflows

| Workflow | Trigger | Description |
|----------|---------|-------------|
| `feature-development.yml` | `type=feature` | Design → implement → test → review → document |
| `bug-fix.yml` | `type=bug_fix` | Reproduce → fix → verify → review |
| `code-review.yml` | `/review` | Parallel: code + security + coverage review |
| `full-project-bootstrap.yml` | `type=bootstrap` | Complete greenfield project scaffolding |

---

## Quality Gates

All gates are **mandatory** between agent transitions:

| Gate | Enforced By | Requirement |
|------|-------------|-------------|
| `static_analysis` | PostToolUse hook + gate check | Zero lint errors |
| `tests` | Tester agent | All tests pass, coverage > 80% |
| `security` | Security agent | Zero critical/high vulnerabilities |
| `documentation` | Documenter agent | ≥ 90% public API coverage |
| `code_review` | Reviewer agent | `approve` verdict |

---

## Advanced Features

### Debate Protocol
For ambiguous architectural decisions, spawn a pro/con debate:
```javascript
import { runDebateProtocol } from './src/debate-protocol.js';
await runDebateProtocol({ topic: 'REST vs GraphQL for the API', proposalA: 'REST', context: '...' });
// Produces an ADR with the decision
```

### Speculative Execution
The orchestrator pre-warms the next agent's context while the current one runs,
reducing handoff latency.

### Result Caching
Deterministic subtask results are cached by content hash. Identical tasks on
unchanged files reuse cached results — significant cost savings on large projects.

### Confidence Scoring
Every agent self-reports confidence (0–100). Low confidence (< 70) triggers the
critic-actor cycle automatically.

---

## Project Structure

```
├── .claude/
│   ├── commands/        # /orchestrate, /review, /checkpoint, /status, /rollback
│   └── settings.json    # Permissions, hooks, model config
├── agents/              # System prompts for each specialist
│   ├── architect/
│   ├── developer/
│   ├── reviewer/
│   ├── tester/
│   ├── security/
│   └── documenter/
├── prompts/
│   ├── schemas/         # JSON schemas: handoff, task-definition, agent-output
│   ├── system/          # Base system prompt
│   └── tasks/           # Task templates: feature, bug-fix
├── workflows/           # YAML workflow definitions
├── hooks/               # Pre/post tool-use + notification hooks
├── memory/              # Context manager + handoff protocol
├── src/                 # Core orchestration engine
│   ├── orchestrator.js  # Main entry point
│   ├── agent-spawner.js # Agent lifecycle management
│   ├── quality-gates.js # Gate enforcement
│   ├── debate-protocol.js # Multi-agent consensus
│   ├── checkpoint-manager.js # State persistence
│   └── logger.js        # Structured logging
├── docs/                # ADR template, capability matrix, guides
├── CLAUDE.md            # Master orchestrator instructions
└── README.md
```

---

## Development

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage

# Lint
npm run lint

# Validate JSON schemas
npm run validate-schemas
```

---

## Extending the System

See [`docs/extension-guide.md`](docs/extension-guide.md) for a step-by-step guide to
adding new specialist agents.

---

## Troubleshooting

See [`docs/troubleshooting.md`](docs/troubleshooting.md) for common issues and solutions.

---

## Architecture Decisions

All significant architectural decisions are recorded as ADRs in `docs/adr/`.
Use `docs/ADR-template.md` as the template for new decisions.

---

## License

MIT
