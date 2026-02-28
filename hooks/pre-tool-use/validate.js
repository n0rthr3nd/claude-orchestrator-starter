#!/usr/bin/env node
/**
 * Pre-tool-use hook: Validates tool calls match agent permissions and logs all actions.
 *
 * Receives a JSON payload on stdin from Claude Code with the tool call details.
 * Exit 0 = allow, Exit 1 = block (with message on stderr/stdout).
 */

import { readFileSync } from 'fs';
import { createLogger } from '../../src/logger.js';

const logger = createLogger('pre-tool-use');

// Blocked patterns — never allow these
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(?!.*orchestrator)/,  // rm -rf / (allow only in project)
  /curl.*\|\s*(bash|sh|zsh)/,         // curl | bash (supply chain)
  /wget.*\|\s*(bash|sh|zsh)/,         // wget | bash
  /eval\s*\(/,                         // eval() calls
  /process\.exit\s*\(\s*0\s*\)/,      // silent exit
];

// Tool-specific permission matrix
const AGENT_TOOL_PERMISSIONS = {
  architect: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
  developer: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
  reviewer: ['Read', 'Glob', 'Grep', 'Write'],
  tester: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
  security: ['Read', 'Glob', 'Grep', 'Write', 'Bash'],
  documenter: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
};

async function main() {
  let input;
  try {
    const rawInput = readFileSync('/dev/stdin', 'utf8');
    input = JSON.parse(rawInput);
  } catch {
    // No stdin or not JSON — allow by default
    process.exit(0);
  }

  const { tool_name, tool_input, agent_type } = input;

  logger.info({
    tool: tool_name,
    agent: agent_type,
    input_preview: JSON.stringify(tool_input).slice(0, 200),
  }, 'PreToolUse: validating tool call');

  // Check agent tool permissions
  if (agent_type && AGENT_TOOL_PERMISSIONS[agent_type]) {
    const allowed = AGENT_TOOL_PERMISSIONS[agent_type];
    if (!allowed.includes(tool_name)) {
      logger.warn({ tool: tool_name, agent: agent_type }, 'PreToolUse: BLOCKED — tool not permitted for agent');
      console.error(JSON.stringify({
        action: 'block',
        reason: `Agent '${agent_type}' is not permitted to use tool '${tool_name}'`,
      }));
      process.exit(1);
    }
  }

  // Check for blocked patterns in Bash commands
  if (tool_name === 'Bash' && tool_input?.command) {
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(tool_input.command)) {
        logger.error({
          tool: tool_name,
          command: tool_input.command,
          pattern: pattern.toString(),
        }, 'PreToolUse: BLOCKED — dangerous command pattern detected');
        console.error(JSON.stringify({
          action: 'block',
          reason: `Blocked dangerous command pattern: ${pattern.toString()}`,
        }));
        process.exit(1);
      }
    }
  }

  // Check for secret patterns in Write/Edit operations
  if (['Write', 'Edit'].includes(tool_name)) {
    const content = tool_input?.content || tool_input?.new_string || '';
    const SECRET_PATTERNS = [
      /sk-ant-[a-zA-Z0-9-]+/,  // Anthropic API key
      /AKIA[0-9A-Z]{16}/,       // AWS access key
      /-----BEGIN.*PRIVATE KEY-----/,  // Private keys
    ];
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        logger.error({ tool: tool_name }, 'PreToolUse: BLOCKED — potential secret detected in write');
        console.error(JSON.stringify({
          action: 'block',
          reason: 'Potential secret/credential detected in file write. Remove before proceeding.',
        }));
        process.exit(1);
      }
    }
  }

  logger.info({ tool: tool_name, agent: agent_type }, 'PreToolUse: allowed');
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'PreToolUse hook error');
  process.exit(0); // Fail open on unexpected errors
});
