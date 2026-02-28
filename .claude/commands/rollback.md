# /rollback

Restore the project state to a previously saved checkpoint. This restores the orchestrator's
internal state (task list, handoff history, quality gate results) but does NOT automatically
revert git changes — you must confirm file restoration separately.

## Usage
```
/rollback [checkpoint-id-or-label]
```

## Examples
```
/rollback                           # Interactive: list checkpoints and prompt to choose
/rollback after-architect           # Restore by label
/rollback 2024-01-15T14:23:00       # Restore by timestamp
/rollback cp_a3f2b1c9               # Restore by checkpoint ID
/rollback --list                    # List all available checkpoints
/rollback --dry-run after-architect # Preview what would be restored
```

## What gets restored

### Always restored (orchestrator state):
- Task tree (which tasks completed, in-progress, pending)
- Agent handoff history
- Quality gate results
- Metrics snapshot

### Optionally restored (requires confirmation):
- **File system state**: Revert modified files to checkpoint's git commit
  - Uses `git checkout <commit> -- <files>` for tracked files
  - Warning: untracked files from after the checkpoint are NOT removed
- **Git state**: `git reset --soft <commit>` to move HEAD (preserves index)

## Safety Prompts

The rollback command will:
1. Show what changed between the checkpoint and now
2. List files that would be reverted
3. Ask for explicit confirmation before making changes
4. Create a "pre-rollback" checkpoint automatically before restoring

## Checkpoint Discovery

Checkpoints are stored in `.orchestrator/checkpoints/` and indexed in
`.orchestrator/checkpoint-index.json`. Use `/status --checkpoints` to list them.

## Warning

Rolling back does NOT:
- Undo git pushes to remote
- Restore deleted branches
- Undo changes to external systems (database migrations, API calls)

Always verify the rollback target before confirming.
