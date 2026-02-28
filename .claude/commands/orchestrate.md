# /orchestrate

Analyze a software task, decompose it into atomic subtasks, create an execution plan with a
dependency graph, and spawn the appropriate specialist agents to execute it.

## Usage
```
/orchestrate <task description>
```

## Examples
```
/orchestrate Build a REST API for user authentication with JWT tokens
/orchestrate Fix the race condition in the payment processing module
/orchestrate Refactor the database layer to use the repository pattern
/orchestrate Add comprehensive test coverage to the auth service
```

## What this command does

1. **Parse & classify** the task (feature / bug / refactor / infra / security)
2. **Decompose** into atomic subtasks with dependency relationships
3. **Select workflow** from `workflows/` matching the task type
4. **Assign agents** to each subtask based on the Agent Roster in CLAUDE.md
5. **Identify parallelism** — which subtasks can run concurrently
6. **Estimate complexity** — S/M/L/XL based on scope analysis
7. **Create execution plan** — ordered list with agent assignments and quality gates
8. **Confirm with user** — present the plan before spawning any agents
9. **Execute** — spawn agents per the plan, respecting dependencies
10. **Monitor** — track progress, handle failures, enforce quality gates
11. **Synthesize** — collect all artifacts, run final integration check
12. **Checkpoint** — save final state automatically

## Output Format

The orchestrator will produce:
- An execution plan (JSON + human-readable summary)
- Progress updates as each agent completes its work
- A final summary with all artifacts, metrics, and quality gate results
- An auto-checkpoint of the completed state

## Orchestration algorithm

```
ANALYZE task → identify type, scope, affected components
DECOMPOSE into subtasks → build DAG
PARALLELIZE where possible (fan-out)
FOR each task_group in topological_order(DAG):
  SPAWN agents in parallel for independent tasks
  WAIT for all to complete
  RUN quality gates
  IF any gate fails:
    RETRY (max 2x) with enriched context
    IF still failing: ESCALATE to human
FAN-IN results
SYNTHESIZE final output
CHECKPOINT
```
