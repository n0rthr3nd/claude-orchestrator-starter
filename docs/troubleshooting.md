# Troubleshooting Guide

Common issues and their solutions when running the Claude Orchestrator.

---

## Orchestration Issues

### Agent fails to start

**Symptom**: `Error: System prompt not found for agent type: <type>`

**Cause**: Missing agent system prompt file.

**Solution**:
```bash
ls agents/
# Should show: architect/ developer/ reviewer/ tester/ security/ documenter/
# Each must contain system-prompt.md
```

---

### Agent produces malformed JSON output

**Symptom**: `Failed to parse agent JSON output, using fallback`

**Cause**: Agent didn't wrap its output in ` ```json ... ``` ` blocks.

**Solution**: The orchestrator uses a fallback (raw text as summary) — this is non-fatal.
The output will have `confidence_score: 60` and an `escalation_notes` flag.

To prevent this:
- The agent's task prompt explicitly requests JSON output
- If it persists, check if the agent's max_turns is too low (agent couldn't complete the task)

---

### Quality gate failing on ESLint

**Symptom**: `PostToolUse: ESLint warnings/errors`

**Solution**:
```bash
# Check exact errors
npm run lint

# Auto-fix what's fixable
npm run lint:fix

# If config missing, initialize
npx eslint --init
```

---

### Quality gate failing on tests

**Symptom**: Gate `tests` fails with coverage below threshold

**Solution**:
1. Check which files are under-covered: `npm test -- --coverage --verbose`
2. The tester agent needs to write more tests
3. Re-run: `/spawn-agent tester "Improve coverage to 85% on <file>"`
4. Or lower threshold in `.claude/settings.json` (`COVERAGE_THRESHOLD`)

---

### Handoff schema validation fails

**Symptom**: `Invalid handoff packet: missing required field 'confidence_score'`

**Cause**: Agent output didn't include all required fields.

**Solution**: The schema is at `prompts/schemas/handoff.json`.
Required fields: `from_agent`, `to_agent`, `task_id`, `timestamp`, `context_summary`.
The orchestrator will use defaults for missing optional fields.

---

### Token budget exceeded

**Symptom**: Agent stops mid-task with `max_turns` reached

**Solutions**:
1. Increase `max_turns` for that agent in the workflow YAML
2. Break the task into smaller subtasks (`/orchestrate` will decompose automatically)
3. Check context compression settings — large context wastes turns

---

### Checkpoint fails to save

**Symptom**: `Checkpoint failed (non-fatal)` in logs

**Cause**: Usually a file system permissions issue or disk full.

**Solution**:
```bash
ls -la .orchestrator/
mkdir -p .orchestrator/checkpoints
chmod 755 .orchestrator/checkpoints
```

---

### Debate protocol produces no decision

**Symptom**: Debate completes but `decision.chosen` is undefined

**Cause**: Judge agent couldn't parse the pro/con arguments.

**Solution**:
- Check that `debate-protocol.js` judge prompt is asking for JSON output
- Ensure both pro/con agents produced non-empty summaries
- Fallback: `chosen: 'A'` is used automatically

---

## Agent-Specific Issues

### Architect agent loops without producing a spec

**Symptom**: Architect uses all turns without writing an OpenAPI file.

**Solutions**:
1. Simplify the task — break large features into smaller design tasks
2. Increase max_turns from 20 to 25
3. Add more specific acceptance criteria to the task prompt

---

### Security agent reports false positives

**Symptom**: Security agent flags safe patterns as vulnerabilities.

**Solutions**:
1. Review finding carefully — security agent can be conservative
2. If clearly a false positive, note in `escalation_notes` for the human to confirm
3. The security gate will still pass if there are no `critical` or `high` findings

---

### Reviewer keeps requesting changes

**Symptom**: Reviewer loops with `request_changes` verdict after developer fixes.

**Solutions**:
1. Check for circular issues — reviewer might be enforcing conflicting standards
2. Examine findings: are they the same issues repeating?
3. If standards conflict, use debate protocol to resolve: `/spawn-agent architect "Clarify coding standard for <issue>"`

---

## Setup Issues

### `ANTHROPIC_API_KEY` not found

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# Or add to .env file (never commit .env)
```

### `@anthropic-ai/claude-agent-sdk` not installed

```bash
npm install
# If still missing:
npm install @anthropic-ai/claude-agent-sdk @anthropic-ai/sdk
```

### Hooks not executing

**Symptom**: Pre/post tool-use hooks are silent.

**Check**:
1. `.claude/settings.json` must have correct hook paths
2. Hook files must be executable: `chmod +x hooks/**/*.js`
3. Check Node.js is in PATH: `node --version`
4. Hook files use ES modules — requires `"type": "module"` in package.json ✅

---

## Performance Issues

### Orchestration is very slow

**Causes and solutions**:
- **Large context**: Check context compression. Context > 60K tokens triggers compression.
- **Sequential stages**: Check workflow YAML — add `parallel: true` to stages that can run concurrently.
- **Cache disabled**: Result caching is on by default. Check `CACHE_DIR` exists.
- **Network latency**: API calls take time — use `claude-haiku-4-5` for simple tasks.

### High API costs

**Solutions**:
1. Check token budget per agent in workflow YAMLs — reduce if too high
2. Enable result caching (already on by default)
3. Use `claude-haiku-4-5` for simple documentation tasks (see workflow config)
4. Run batch reviews instead of per-file reviews
5. Check for agents re-reading files that are already in context

---

## Recovery Procedures

### Restore from checkpoint after crash

```bash
# List available checkpoints
node src/checkpoint-manager.js list

# Restore specific checkpoint
node src/checkpoint-manager.js restore <checkpoint-id>

# Or use the slash command
/rollback <label>
```

### Recover from failed agent with partial work

1. Check `.orchestrator/cache/` for partial results
2. Review the last handoff in the checkpoint
3. Re-run just the failed stage: `/spawn-agent <type> <specific-task>`
4. Use `/checkpoint` before retrying

### Reset all state (full restart)

```bash
rm -rf .orchestrator/
git checkout .  # Reset any partial code changes
/orchestrate <your-task>  # Start fresh
```
