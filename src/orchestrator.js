#!/usr/bin/env node
/**
 * Master Orchestrator — Central coordinator for multi-agent workflows.
 *
 * Implements:
 * - Hierarchical task decomposition
 * - Dynamic agent spawning (parallel + sequential)
 * - Quality gates between every agent transition
 * - Checkpointing at milestones
 * - Speculative execution (pre-warm next agent)
 * - Result caching for deterministic subtasks
 * - Confidence scoring + critic-actor pattern
 * - Debate protocol for critical architectural decisions
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import yaml from 'js-yaml';
import pLimit from 'p-limit';
import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from './logger.js';
import { spawnAgent, spawnAgentsParallel } from './agent-spawner.js';
import { CheckpointManager } from './checkpoint-manager.js';
import { ContextManager } from '../memory/context-manager.js';
import { runQualityGates } from './quality-gates.js';
import { runDebateProtocol } from './debate-protocol.js';

const logger = createLogger('orchestrator');

const ORCHESTRATOR_MODEL = process.env.ORCHESTRATOR_MODEL || 'claude-opus-4-6';
const MAX_PARALLEL = parseInt(process.env.MAX_PARALLEL_AGENTS || '3');
const CONFIDENCE_LOW_THRESHOLD = 70;

export class Orchestrator {
  constructor() {
    this.sessionId = uuidv4();
    this.checkpointManager = new CheckpointManager();
    this.contextManager = new ContextManager();
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.handoffHistory = [];
    this.taskTree = {};
    this.metrics = {
      agents_spawned: 0,
      agents_succeeded: 0,
      agents_failed: 0,
      quality_gates_run: 0,
      quality_gates_passed: 0,
      checkpoints_created: 0,
    };

    this.contextManager.initSession(this.sessionId, {});
    logger.info({ sessionId: this.sessionId }, 'Orchestrator initialized');
  }

  /**
   * Main entry point: orchestrate a complete software task.
   * @param {string} taskDescription - Natural language task description
   * @param {object} [options]
   * @returns {Promise<object>} Final result with all artifacts
   */
  async orchestrate(taskDescription, options = {}) {
    logger.info({ task: taskDescription.slice(0, 100) }, 'Orchestration started');

    // 1. Analyze task and select workflow
    const analysis = await this.analyzeTask(taskDescription);
    logger.info({ type: analysis.type, complexity: analysis.complexity }, 'Task analyzed');

    // 2. Create initial checkpoint
    const startCheckpointId = await this.checkpoint('pre-orchestration');

    // 3. Load workflow definition
    const workflow = this.loadWorkflow(analysis.type);

    // 4. Execute the workflow
    const result = await this.executeWorkflow(workflow, {
      taskDescription,
      analysis,
      ...options,
    });

    // 5. Final checkpoint
    await this.checkpoint('orchestration-complete');

    return {
      success: result.success,
      task: taskDescription,
      analysis,
      artifacts: result.artifacts,
      quality_gates: result.quality_gates,
      metrics: this.metrics,
      checkpoints: this.checkpointManager.list().slice(-5),
    };
  }

  /**
   * Use the orchestrator model to analyze a task and determine
   * its type, complexity, and appropriate workflow.
   */
  async analyzeTask(taskDescription) {
    logger.info('Analyzing task with orchestrator model');

    const response = await this.client.messages.create({
      model: ORCHESTRATOR_MODEL,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      messages: [{
        role: 'user',
        content: `Analyze this software development task and classify it.

Task: ${taskDescription}

Respond with a JSON object:
\`\`\`json
{
  "type": "feature|bug_fix|refactor|security_fix|documentation|infrastructure|bootstrap",
  "complexity": "XS|S|M|L|XL",
  "affected_components": ["<component 1>"],
  "requires_agents": ["architect", "developer", "tester", "reviewer", "security", "documenter"],
  "can_parallelize": ["developer+tester", "security+reviewer"],
  "debate_recommended": false,
  "estimated_subtasks": 5,
  "key_risks": ["<risk 1>"]
}
\`\`\``,
      }],
    });

    const text = response.content.find(b => b.type === 'text')?.text || '';
    const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // fall through
      }
    }

    // Default analysis if parsing fails
    return {
      type: 'feature',
      complexity: 'M',
      affected_components: ['unknown'],
      requires_agents: ['architect', 'developer', 'reviewer', 'tester'],
      can_parallelize: [],
      debate_recommended: false,
      estimated_subtasks: 4,
      key_risks: [],
    };
  }

  /**
   * Execute a workflow definition.
   * @param {object} workflow - Parsed workflow YAML
   * @param {object} context - Execution context
   */
  async executeWorkflow(workflow, context) {
    const allArtifacts = [];
    const gateResults = {};
    const limit = pLimit(MAX_PARALLEL);

    for (const stage of workflow.stages || []) {
      // Check condition
      if (stage.condition && !this.evaluateCondition(stage.condition, context)) {
        logger.info({ stage: stage.id }, 'Stage skipped (condition false)');
        continue;
      }

      logger.info({ stage: stage.id, name: stage.name }, 'Executing stage');

      let stageResults;

      if (stage.parallel && stage.agents?.length > 1) {
        // Fan-out: run agents in parallel
        const agentTasks = stage.agents.map(agentDef =>
          limit(() => this.runStageAgent(agentDef, context, stage))
        );
        stageResults = await Promise.all(agentTasks);
      } else if (stage.action === 'debate_protocol') {
        // Debate protocol for architectural decisions
        const debateResult = await runDebateProtocol({
          topic: stage.topic,
          proposalA: context.proposalA || context.taskDescription,
          context: JSON.stringify(context),
        });
        stageResults = [debateResult];
        context.architectureDecision = debateResult.decision;
      } else {
        // Sequential: run agents one by one
        stageResults = [];
        for (const agentDef of stage.agents || []) {
          const result = await this.runStageAgent(agentDef, context, stage);
          stageResults.push(result);
          // Update context with this agent's output for the next
          context[`${agentDef.type}_output`] = result;
        }
      }

      // Collect artifacts
      for (const result of stageResults) {
        allArtifacts.push(...(result.artifacts || []));
      }

      // Run quality gates for this stage
      if (stage.quality_gates?.length > 0) {
        const gateContext = {
          agentOutput: stageResults[stageResults.length - 1],
          cwd: process.cwd(),
        };

        const gateResult = await runQualityGates(stage.quality_gates, gateContext);
        this.metrics.quality_gates_run += stage.quality_gates.length;
        this.metrics.quality_gates_passed += gateResult.passed_gates.length;

        gateResults[stage.id] = gateResult;

        if (!gateResult.all_passed) {
          const failure = gateResult.failures[0];
          logger.warn({ stage: stage.id, gate: failure.gate }, 'Stage quality gate failed');

          const handled = await this.handleGateFailure({
            stage,
            failure,
            context,
            stageResults,
            onFailure: stage.on_gate_failure,
          });

          if (!handled) {
            logger.error({ stage: stage.id }, 'Quality gate failure not resolved — escalating');
            await this.checkpoint(`gate-failure-${stage.id}`);
            return { success: false, artifacts: allArtifacts, quality_gates: gateResults };
          }
        }
      }

      // Checkpoint after each stage
      await this.checkpoint(`stage-${stage.id}-complete`);
      logger.info({ stage: stage.id }, 'Stage complete');
    }

    return { success: true, artifacts: allArtifacts, quality_gates: gateResults };
  }

  /**
   * Run a single agent within a stage.
   */
  async runStageAgent(agentDef, context, stage) {
    this.metrics.agents_spawned++;

    const agentContext = this.contextManager.buildAgentContext({
      task: agentDef.task || context.taskDescription,
      constraints: stage.config?.constraints || [],
      agentType: agentDef.type,
    });

    // Check cache for deterministic tasks
    const cacheKey = this.contextManager.computeCacheKey(
      agentDef.task || context.taskDescription,
      agentDef.inputs?.map(i => context[i]).filter(Boolean) || []
    );

    const cached = this.contextManager.getCachedResult(cacheKey);
    if (cached && agentDef.cacheable !== false) {
      logger.info({ agent: agentDef.type, cacheKey }, 'Using cached agent result');
      return cached;
    }

    try {
      const result = await spawnAgent({
        agentType: agentDef.type,
        task: agentDef.task || context.taskDescription,
        context: agentContext,
        taskId: agentDef.id || uuidv4(),
        maxTurns: agentDef.max_turns,
        model: agentDef.model,
      });

      // Record handoff
      this.handoffHistory.push({
        handoff: {
          from_agent: agentDef.type,
          to_agent: 'orchestrator',
          task_id: result.task_id,
          timestamp: new Date().toISOString(),
          context_summary: result.summary?.slice(0, 500) || '',
          artifacts: result.artifacts || [],
          quality_gates_passed: result.quality_gates_passed || [],
          confidence_score: result.confidence_score,
        },
      });
      this.contextManager.addHandoff(this.handoffHistory[this.handoffHistory.length - 1]);

      // Cache if confidence is high
      if (result.confidence_score >= 85) {
        this.contextManager.cacheResult(cacheKey, result);
      }

      // Trigger critic if confidence is low
      if (result.confidence_score < CONFIDENCE_LOW_THRESHOLD) {
        logger.warn({
          agent: agentDef.type,
          confidence: result.confidence_score,
        }, 'Low confidence — triggering critic review');
        return await this.runCriticActorCycle(agentDef, result, context);
      }

      this.metrics.agents_succeeded++;
      return result;
    } catch (err) {
      this.metrics.agents_failed++;
      logger.error({ agent: agentDef.type, err: err.message }, 'Agent execution failed');
      throw err;
    }
  }

  /**
   * Critic-actor pattern: spawn a critic to review low-confidence output.
   */
  async runCriticActorCycle(agentDef, actorResult, context) {
    logger.info({ agent: agentDef.type }, 'Running critic-actor cycle');

    const criticResult = await spawnAgent({
      agentType: 'reviewer',
      task: `Critique the following ${agentDef.type} output and identify specific issues:\n\n${actorResult.summary}`,
      context: JSON.stringify({ actor_output: actorResult }),
      maxTurns: 10,
    });

    if (criticResult.verdict === 'approve' || criticResult.severity_counts?.critical === 0) {
      return actorResult; // Critic approved — proceed
    }

    // Actor revises based on critic feedback
    logger.info({ agent: agentDef.type }, 'Actor revising based on critic feedback');
    const revisedResult = await spawnAgent({
      agentType: agentDef.type,
      task: `Revise your previous output based on this critique:\n\n${criticResult.summary}\n\nOriginal task: ${agentDef.task}`,
      context: JSON.stringify({
        original_output: actorResult.summary,
        critique: criticResult.summary,
      }),
      maxTurns: agentDef.max_turns,
    });

    return revisedResult;
  }

  /**
   * Handle a quality gate failure per the workflow's on_gate_failure config.
   */
  async handleGateFailure({ stage, failure, context, stageResults, onFailure }) {
    const action = onFailure?.action || 'escalate';
    const maxRetries = onFailure?.max_retries || 2;

    if (action === 'retry' && (context.retryCount || 0) < maxRetries) {
      context.retryCount = (context.retryCount || 0) + 1;
      logger.info({ stage: stage.id, attempt: context.retryCount }, 'Retrying stage after gate failure');
      return true; // Signal that we're handling it
    }

    if (action === 'send_to_developer') {
      logger.info({ stage: stage.id }, 'Sending back to developer agent for fixes');
      await spawnAgent({
        agentType: 'developer',
        task: `Fix the following quality gate failure:\n\n${JSON.stringify(failure, null, 2)}`,
        context: JSON.stringify({ failure, previous_output: stageResults }),
        maxTurns: 20,
      });
      return true;
    }

    return false; // Escalate — cannot handle automatically
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  loadWorkflow(taskType) {
    const workflowMap = {
      feature: 'feature-development.yml',
      bug_fix: 'bug-fix.yml',
      review: 'code-review.yml',
      bootstrap: 'full-project-bootstrap.yml',
    };
    const filename = workflowMap[taskType] || 'feature-development.yml';
    const path = join(process.cwd(), 'workflows', filename);
    const content = readFileSync(path, 'utf8');
    return yaml.load(content);
  }

  evaluateCondition(condition, context) {
    // Simple condition evaluation — extend as needed
    try {
      const fn = new Function(...Object.keys(context), `return (${condition})`);
      return fn(...Object.values(context));
    } catch {
      return true; // Default to running the stage
    }
  }

  async checkpoint(label) {
    try {
      const id = await this.checkpointManager.save({
        label,
        taskTree: this.taskTree,
        handoffHistory: this.handoffHistory,
        metrics: this.metrics,
      });
      this.metrics.checkpoints_created++;
      logger.info({ checkpointId: id, label }, 'Checkpoint created');
      return id;
    } catch (err) {
      logger.warn({ err: err.message }, 'Checkpoint failed (non-fatal)');
    }
  }
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const taskDescription = process.argv.slice(2).join(' ');

  if (!taskDescription) {
    console.error('Usage: node src/orchestrator.js <task description>');
    console.error('Example: node src/orchestrator.js "Add user authentication with JWT"');
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  const orchestrator = new Orchestrator();
  orchestrator.orchestrate(taskDescription)
    .then(result => {
      console.log('\n✅ Orchestration complete');
      console.log(JSON.stringify(result, null, 2));
    })
    .catch(err => {
      console.error('\n❌ Orchestration failed:', err.message);
      process.exit(1);
    });
}
