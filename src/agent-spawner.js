/**
 * Agent Spawner — Launches specialist sub-agents via the Claude Agent SDK.
 *
 * Each agent is spawned with:
 * - Its type-specific system prompt
 * - A structured handoff packet (task + context)
 * - Token budget and max-turns limits
 * - The appropriate model (claude-sonnet-4-6 by default)
 * - cwd set to the project root, with additionalPaths injected into the prompt
 *   (equivalent to /add-dir in interactive Claude Code sessions)
 */

// NOTE: @anthropic-ai/claude-agent-sdk is loaded lazily inside executeAgent()
// so the server starts even if the package is not yet installed.
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import pRetry from 'p-retry';
import { createLogger } from './logger.js';

const logger = createLogger('agent-spawner');

const DEFAULT_MODEL = process.env.DEFAULT_SUB_AGENT_MODEL || 'claude-sonnet-4-6';
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '2');
const CONFIDENCE_THRESHOLD = parseInt(process.env.CONFIDENCE_THRESHOLD || '80');

/** Agent-specific defaults */
const AGENT_DEFAULTS = {
  architect:  { maxTurns: 20, tokenBudget: 50000 },
  developer:  { maxTurns: 30, tokenBudget: 80000 },
  reviewer:   { maxTurns: 15, tokenBudget: 40000 },
  tester:     { maxTurns: 25, tokenBudget: 60000 },
  security:   { maxTurns: 15, tokenBudget: 40000 },
  documenter: { maxTurns: 15, tokenBudget: 30000 },
};

/** Load agent system prompt from disk */
function loadSystemPrompt(agentType) {
  const promptPath = join(process.cwd(), 'agents', agentType, 'system-prompt.md');
  const basePath   = join(process.cwd(), 'prompts', 'system', 'base.md');

  if (!existsSync(promptPath)) {
    throw new Error(`System prompt not found for agent type: ${agentType}`);
  }

  const base     = existsSync(basePath) ? readFileSync(basePath, 'utf8') : '';
  const specific = readFileSync(promptPath, 'utf8');

  return `${base}\n\n---\n\n${specific}`;
}

/**
 * Spawn a specialist agent and return its structured output.
 *
 * @param {object}   options
 * @param {string}   options.agentType       - architect | developer | reviewer | tester | security | documenter
 * @param {string}   options.task            - Task description
 * @param {string}   [options.context]       - Compressed context JSON string
 * @param {string}   [options.taskId]        - UUID (auto-generated if omitted)
 * @param {string}   [options.model]         - Model override
 * @param {number}   [options.maxTurns]      - Override max turns
 * @param {string[]} [options.allowedTools]  - Override allowed tools
 * @param {object}   [options.handoffPacket] - Structured handoff packet
 * @param {string}   [options.cwd]           - Project root (primary working directory)
 * @param {string[]} [options.additionalPaths] - Extra directories (equivalent to /add-dir)
 * @returns {Promise<object>} Parsed agent output conforming to agent-output.json schema
 */
export async function spawnAgent({
  agentType,
  task,
  context,
  taskId = uuidv4(),
  model = DEFAULT_MODEL,
  maxTurns,
  allowedTools,
  handoffPacket,
  cwd,
  additionalPaths = [],
}) {
  const defaults = AGENT_DEFAULTS[agentType];
  if (!defaults) throw new Error(`Unknown agent type: ${agentType}`);

  const effectiveMaxTurns = maxTurns ?? defaults.maxTurns;
  const systemPrompt = loadSystemPrompt(agentType);
  const prompt = buildAgentPrompt({ task, context, taskId, agentType, handoffPacket, cwd, additionalPaths });
  const tools  = allowedTools ?? getDefaultTools(agentType);

  logger.info(
    { agentType, taskId, model, maxTurns: effectiveMaxTurns, cwd, additionalPaths },
    'Spawning agent'
  );

  const startTime = Date.now();

  const result = await pRetry(
    () => executeAgent({ agentType, taskId, prompt, systemPrompt, model, maxTurns: effectiveMaxTurns, tools, cwd, additionalPaths }),
    {
      retries: MAX_RETRIES,
      onFailedAttempt: (error) => {
        logger.warn({
          agentType, taskId,
          attempt: error.attemptNumber,
          retriesLeft: error.retriesLeft,
          error: error.message,
        }, 'Agent attempt failed, retrying');
      },
    }
  );

  const duration = Date.now() - startTime;
  logger.info({ agentType, taskId, duration, confidence: result.confidence_score }, 'Agent completed');

  if (result.confidence_score < CONFIDENCE_THRESHOLD) {
    logger.warn(
      { agentType, taskId, confidence: result.confidence_score, threshold: CONFIDENCE_THRESHOLD },
      'Agent confidence below threshold — consider critic review'
    );
  }

  return { ...result, duration_ms: duration };
}

/**
 * Spawn multiple agents in parallel (fan-out).
 * @param {object[]} agentConfigs - Array of spawnAgent option objects
 * @returns {Promise<object[]>} Results in the same order as input
 */
export async function spawnAgentsParallel(agentConfigs) {
  logger.info({ count: agentConfigs.length }, 'Spawning agents in parallel');
  const results = await Promise.allSettled(agentConfigs.map(cfg => spawnAgent(cfg)));

  return results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    logger.error({ agentType: agentConfigs[i].agentType, error: result.reason?.message }, 'Parallel agent failed');
    return {
      agent: agentConfigs[i].agentType,
      error: result.reason?.message,
      confidence_score: 0,
      quality_gates_passed: [],
      artifacts: [],
    };
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function executeAgent({ agentType, taskId, prompt, systemPrompt, model, maxTurns, tools, cwd, additionalPaths }) {
  // Lazy import — only resolved when actually spawning an agent.
  let query;
  try {
    ({ query } = await import('@anthropic-ai/claude-agent-sdk'));
  } catch {
    throw new Error('Claude Agent SDK not installed. Run: npm install @anthropic-ai/claude-agent-sdk');
  }

  let resultText = '';

  for await (const message of query({
    prompt,
    options: {
      model,
      systemPrompt,
      allowedTools: tools,
      maxTurns,
      permissionMode: 'acceptEdits',
      // Primary working directory for this agent session
      ...(cwd && { cwd }),
      // Additional directories — the SDK passes these as /add-dir equivalents
      ...(additionalPaths.length > 0 && { additionalDirectories: additionalPaths }),
      env: {
        AGENT_TYPE: agentType,
        TASK_ID: taskId,
        // Also expose paths as env vars so agents can reference them in shell commands
        PROJECT_ROOT: cwd || process.cwd(),
        ADDITIONAL_PATHS: additionalPaths.join(':'),
      },
    },
  })) {
    if ('result' in message) resultText = message.result;
  }

  return parseAgentOutput(resultText, agentType, taskId);
}

function buildAgentPrompt({ task, context, taskId, agentType, handoffPacket, cwd, additionalPaths }) {
  const sections = [
    `## Task ID: ${taskId}`,
    `## Your Role: ${agentType}`,
    '',
  ];

  // ── Workspace context (replaces /add-dir) ────────────────────────────────
  if (cwd || additionalPaths.length > 0) {
    sections.push('## Workspace');

    if (cwd) {
      sections.push(`- **Root (cwd):** \`${cwd}\``);
    }

    if (additionalPaths.length > 0) {
      sections.push('- **Additional directories** (all fully accessible):');
      additionalPaths.forEach(p => sections.push(`  - \`${p}\``));
    }

    sections.push(
      '',
      '> You have full read/write access to all directories listed above.',
      '> When exploring the codebase, check all directories — types may be in one',
      '> directory, implementation in another, tests in a third.',
      ''
    );
  }

  sections.push('## Task', task);

  if (context) {
    sections.push('', '## Context', '```json', context, '```');
  }

  if (handoffPacket) {
    sections.push('', '## Incoming Handoff Packet', '```json', JSON.stringify(handoffPacket, null, 2), '```');
  }

  sections.push(
    '',
    '## Output Instructions',
    'When complete, output your result as a JSON object conforming to the agent-output.json schema.',
    'Wrap the JSON in ```json ... ``` code blocks.',
    'Include: agent, task_id, confidence_score, artifacts, quality_gates_passed, summary, escalation_notes.'
  );

  return sections.join('\n');
}

function parseAgentOutput(text, agentType, taskId) {
  const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      return {
        agent: agentType,
        task_id: taskId,
        confidence_score: 75,
        artifacts: [],
        quality_gates_passed: [],
        ...parsed,
      };
    } catch {
      logger.warn({ agentType, taskId }, 'Failed to parse agent JSON output, using fallback');
    }
  }

  return {
    agent: agentType,
    task_id: taskId,
    confidence_score: 60,
    artifacts: [],
    quality_gates_passed: [],
    summary: text.slice(0, 2000),
    escalation_notes: 'Agent output was not in expected JSON format — review manually',
  };
}

function getDefaultTools(agentType) {
  const toolMap = {
    architect:  ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
    developer:  ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    reviewer:   ['Read', 'Glob', 'Grep', 'Write'],
    tester:     ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    security:   ['Read', 'Glob', 'Grep', 'Write', 'Bash'],
    documenter: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
  };
  return toolMap[agentType] || ['Read', 'Glob', 'Grep'];
}
