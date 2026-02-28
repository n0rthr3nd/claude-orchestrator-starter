# /checkpoint

Save a complete snapshot of the current project state, including all active tasks, completed
artifacts, agent handoff history, and git state.

## Usage
```
/checkpoint [label]
```

## Examples
```
/checkpoint
/checkpoint "after-architect-phase"
/checkpoint "pre-refactor"
/checkpoint "feature-x-complete"
```

## What this command saves

### State Snapshot
- Current task tree (all tasks, their status, assigned agents)
- Completed artifacts list with file hashes
- Agent handoff chain (full JSON history)
- Quality gate results for each completed task
- Active agent sessions (paused, ready to resume)

### Git State
- Current branch, commit hash, and diff summary
- List of modified/staged/untracked files
- Whether working tree is clean

### Metrics
- Total tokens consumed per agent
- Agent success/failure rates
- Quality gate pass/fail counts
- Elapsed time

## Checkpoint File Format
```json
{
  "checkpoint_id": "<uuid>",
  "label": "<user label>",
  "timestamp": "<iso8601>",
  "git": {
    "branch": "<branch>",
    "commit": "<hash>",
    "clean": true
  },
  "tasks": {
    "completed": [],
    "in_progress": [],
    "pending": []
  },
  "artifacts": [],
  "handoff_history": [],
  "quality_gates": {},
  "metrics": {}
}
```

## Checkpoint Location
Checkpoints are saved to `.orchestrator/checkpoints/<timestamp>-<label>.json`

Use `/rollback <checkpoint>` to restore to any saved state.
Use `/status` to see available checkpoints.
