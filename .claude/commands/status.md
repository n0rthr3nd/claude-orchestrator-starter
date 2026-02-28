# /status

Display a real-time dashboard of the orchestration session: active agents, completed tasks,
pending items, quality gate results, token usage, and available checkpoints.

## Usage
```
/status
/status --verbose    # Include full handoff history
/status --metrics    # Include detailed token/cost metrics
/status --checkpoints # List all available checkpoints
```

## Output Format

```
╔══════════════════════════════════════════════════════════╗
║           ORCHESTRATOR STATUS DASHBOARD                  ║
╠══════════════════════════════════════════════════════════╣
║ Session: <session-id>    Started: <timestamp>            ║
║ Current Task: <task description>                         ║
╠═══════════════╦══════════════╦═══════════════════════════╣
║ COMPLETED (3) ║ IN PROGRESS  ║ PENDING (2)               ║
╠═══════════════╬══════════════╬═══════════════════════════╣
║ ✅ architect  ║ 🔄 developer ║ ⏳ reviewer               ║
║ ✅ security   ║              ║ ⏳ tester                  ║
║ ✅ documenter ║              ║                           ║
╠═══════════════╩══════════════╩═══════════════════════════╣
║ QUALITY GATES                                            ║
║ ✅ static_analysis  ✅ security  ⏳ tests  ⏳ docs       ║
╠══════════════════════════════════════════════════════════╣
║ METRICS                                                  ║
║ Tokens used: 42,847 / 200,000   Cost: ~$0.43            ║
║ Agents spawned: 5   Success rate: 100%                   ║
╠══════════════════════════════════════════════════════════╣
║ CHECKPOINTS                                              ║
║ 📸 2024-01-15T14:23:00 — "after-architect"               ║
║ 📸 2024-01-15T14:45:00 — "pre-developer"                 ║
╚══════════════════════════════════════════════════════════╝
```

## Fields Explained

- **COMPLETED**: Agents that have finished their tasks with quality gates passed
- **IN PROGRESS**: Currently active agent sessions
- **PENDING**: Tasks queued, waiting for dependencies to complete
- **QUALITY GATES**: Status of each mandatory quality check
- **METRICS**: Aggregate token consumption, cost estimate, success rates
- **CHECKPOINTS**: Available restore points (use `/rollback` to restore)

## Agent Status Icons
- ✅ Completed successfully
- 🔄 Currently running
- ⏳ Pending (waiting for dependency)
- ❌ Failed (see logs)
- ⚠️ Completed with warnings
