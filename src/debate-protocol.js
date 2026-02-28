/**
 * Debate Protocol — Multi-agent consensus for critical architectural decisions.
 *
 * Spawns two opposing architect agents (pro/con) that argue for different
 * approaches, then a judge agent synthesizes the debate and makes a final decision.
 * The decision is recorded in an ADR.
 */

import { spawnAgent } from './agent-spawner.js';
import { createLogger } from './logger.js';
import { v4 as uuidv4 } from 'uuid';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const logger = createLogger('debate-protocol');

/**
 * Run a debate between two architect agents on an architectural question.
 *
 * @param {object} options
 * @param {string} options.topic - The architectural question to debate
 * @param {string} options.proposalA - The first proposed approach
 * @param {string} options.proposalB - The alternative approach (if known)
 * @param {string} options.context - Relevant context for the decision
 * @param {string} [options.taskId] - Task ID for tracking
 * @returns {Promise<object>} Decision with ADR artifact
 */
export async function runDebateProtocol({
  topic,
  proposalA,
  proposalB = null,
  context,
  taskId = uuidv4(),
}) {
  logger.info({ topic, taskId }, 'Starting debate protocol');

  // Round 1: Pro-agent argues FOR proposal A
  logger.info({ taskId }, 'Debate round 1: Pro-agent arguing for proposal A');
  const proResult = await spawnAgent({
    agentType: 'architect',
    taskId: `${taskId}-pro`,
    task: buildProPrompt(topic, proposalA, context),
    context,
    maxTurns: 10,
  });

  // Round 2: Con-agent argues AGAINST A and proposes alternative
  logger.info({ taskId }, 'Debate round 2: Con-agent critiquing and proposing alternative');
  const conResult = await spawnAgent({
    agentType: 'architect',
    taskId: `${taskId}-con`,
    task: buildConPrompt(topic, proposalA, proposalB, context, proResult.summary),
    context,
    maxTurns: 10,
  });

  // Round 3: Judge synthesizes and decides
  logger.info({ taskId }, 'Debate round 3: Judge synthesizing decision');
  const judgeResult = await spawnAgent({
    agentType: 'architect',
    taskId: `${taskId}-judge`,
    task: buildJudgePrompt(topic, proResult.summary, conResult.summary, context),
    context,
    maxTurns: 12,
  });

  // Extract the final decision from judge output
  const decision = parseDecision(judgeResult);

  // Write ADR for the decision
  const adrPath = await writeDecisionADR({
    topic,
    decision,
    proArgument: proResult.summary,
    conArgument: conResult.summary,
    judgeReasoning: judgeResult.summary,
    taskId,
  });

  logger.info({ taskId, decision: decision.chosen, adrPath }, 'Debate protocol complete');

  return {
    topic,
    decision,
    pro_argument: proResult.summary,
    con_argument: conResult.summary,
    judge_reasoning: judgeResult.summary,
    confidence: judgeResult.confidence_score,
    adr_path: adrPath,
    artifacts: [
      { type: 'adr', path: adrPath, description: `ADR for: ${topic}` },
      ...judgeResult.artifacts,
    ],
  };
}

// ── Prompt builders ──────────────────────────────────────────────────────────

function buildProPrompt(topic, proposalA, context) {
  return `You are arguing IN FAVOR of the following architectural approach.

## Architectural Question
${topic}

## Proposal A (you are defending this)
${proposalA}

## Context
${context}

## Your Task
Construct the strongest possible argument FOR Proposal A. Address:
1. Why this approach is the right solution for the problem
2. Key technical advantages
3. Business value and ROI
4. Risk mitigation
5. How known objections can be addressed

Be thorough but focused. Conclude with your top 3 reasons this approach should be chosen.`;
}

function buildConPrompt(topic, proposalA, proposalB, context, proArgument) {
  const altSection = proposalB
    ? `## Your Alternative (Proposal B)\n${proposalB}`
    : `## Your Task\nYou must propose a better alternative AND argue why Proposal A is insufficient.`;

  return `You are the critic/devil's advocate. Your job is to identify flaws in Proposal A and propose a better approach.

## Architectural Question
${topic}

## Proposal A (you are critiquing this)
${proposalA}

## Pro-Agent's Argument (what you're responding to)
${proArgument}

${altSection}

## Context
${context}

Address:
1. What are the key weaknesses or risks of Proposal A?
2. What does Proposal A fail to account for?
3. Why is the alternative approach superior?
4. What are the trade-offs of your alternative?

Be constructive — find real weaknesses, not manufactured ones.`;
}

function buildJudgePrompt(topic, proArgument, conArgument, context) {
  return `You are the judge. You must make a final architectural decision based on the debate below.

## Architectural Question
${topic}

## Context
${context}

## Pro-Agent's Argument (for Proposal A)
${proArgument}

## Con-Agent's Argument (critique + alternative)
${conArgument}

## Your Task
1. Evaluate both arguments objectively
2. Identify which argument is stronger and why
3. Make a DEFINITIVE decision (do not hedge — pick one approach)
4. State what conditions or constraints drove your decision
5. Identify any elements from BOTH proposals worth combining

Output a JSON object:
\`\`\`json
{
  "chosen": "A|B|hybrid",
  "chosen_name": "<short name for the decision>",
  "reasoning": "<3-5 sentence explanation>",
  "key_factors": ["<factor 1>", "<factor 2>"],
  "risks_acknowledged": ["<risk 1>"],
  "conditions": ["<condition that must be true for this to work>"]
}
\`\`\``;
}

// ── Result parsing ───────────────────────────────────────────────────────────

function parseDecision(judgeResult) {
  const jsonMatch = judgeResult.summary?.match(/```json\s*([\s\S]+?)\s*```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      // Fall through to default
    }
  }
  return {
    chosen: 'A',
    chosen_name: 'Default (parse failed)',
    reasoning: judgeResult.summary?.slice(0, 500) || 'Unable to parse decision',
    key_factors: [],
    risks_acknowledged: [],
    conditions: [],
  };
}

// ── ADR writer ───────────────────────────────────────────────────────────────

async function writeDecisionADR({ topic, decision, proArgument, conArgument, judgeReasoning, taskId }) {
  const adrDir = join(process.cwd(), 'docs', 'adr');
  if (!existsSync(adrDir)) {
    mkdirSync(adrDir, { recursive: true });
  }

  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
  const adrNum = String(Date.now()).slice(-4); // Simple unique number
  const adrPath = join(adrDir, `${adrNum}-${slug}.md`);

  const content = `# ADR-${adrNum}: ${topic}

**Status**: Accepted
**Task ID**: ${taskId}
**Date**: ${new Date().toISOString().split('T')[0]}
**Decision Method**: Multi-agent debate protocol

---

## Context

${topic}

## Decision

**Chosen approach**: ${decision.chosen_name || decision.chosen}

${decision.reasoning}

**Key decision factors:**
${(decision.key_factors || []).map(f => `- ${f}`).join('\n')}

## Conditions

This decision is valid under the following conditions:
${(decision.conditions || []).map(c => `- ${c}`).join('\n')}

## Consequences

**Risks acknowledged:**
${(decision.risks_acknowledged || []).map(r => `- ${r}`).join('\n')}

---

## Debate Record

### Pro-Argument (for chosen approach)

${proArgument || 'Not recorded'}

### Con-Argument (critique + alternative)

${conArgument || 'Not recorded'}

### Judge's Synthesis

${judgeReasoning || 'Not recorded'}
`;

  writeFileSync(adrPath, content, 'utf8');
  logger.info({ adrPath }, 'ADR written for debate decision');
  return adrPath;
}
