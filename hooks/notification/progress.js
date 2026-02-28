#!/usr/bin/env node
/**
 * Notification hook: Real-time progress updates on long-running orchestrations.
 */

import { readFileSync } from 'fs';
import { createLogger } from '../../src/logger.js';

const logger = createLogger('notification');

// ANSI color codes
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

const ICONS = {
  start: '🚀',
  complete: '✅',
  error: '❌',
  warn: '⚠️',
  info: 'ℹ️',
  checkpoint: '📸',
  gate: '🔒',
  agent: '🤖',
};

async function main() {
  let input;
  try {
    const rawInput = readFileSync('/dev/stdin', 'utf8');
    input = JSON.parse(rawInput);
  } catch {
    process.exit(0);
  }

  const { notification_type, message, agent_type, task_id, timestamp } = input;

  const ts = new Date(timestamp || Date.now()).toLocaleTimeString();

  switch (notification_type) {
    case 'agent_started':
      console.log(
        `${COLORS.cyan}${ICONS.agent} [${ts}] Agent started: ${agent_type}${COLORS.reset}`
      );
      break;

    case 'agent_completed':
      console.log(
        `${COLORS.green}${ICONS.complete} [${ts}] Agent completed: ${agent_type} (confidence: ${input.confidence_score}%)${COLORS.reset}`
      );
      break;

    case 'agent_failed':
      console.log(
        `${COLORS.red}${ICONS.error} [${ts}] Agent failed: ${agent_type} — ${message}${COLORS.reset}`
      );
      break;

    case 'quality_gate_passed':
      console.log(
        `${COLORS.green}${ICONS.gate} [${ts}] Quality gate passed: ${input.gate_name}${COLORS.reset}`
      );
      break;

    case 'quality_gate_failed':
      console.log(
        `${COLORS.red}${ICONS.gate} [${ts}] Quality gate FAILED: ${input.gate_name} — ${message}${COLORS.reset}`
      );
      break;

    case 'checkpoint_saved':
      console.log(
        `${COLORS.blue}${ICONS.checkpoint} [${ts}] Checkpoint saved: ${input.checkpoint_id}${COLORS.reset}`
      );
      break;

    case 'escalation':
      console.log(
        `${COLORS.yellow}${ICONS.warn} [${ts}] ESCALATION — requires human attention: ${message}${COLORS.reset}`
      );
      break;

    case 'task_progress':
      const bar = buildProgressBar(input.progress_pct || 0);
      console.log(
        `${COLORS.gray}${ICONS.info} [${ts}] ${bar} ${input.progress_pct || 0}% — ${message}${COLORS.reset}`
      );
      break;

    default:
      if (message) {
        logger.info({ notification_type, agent_type, task_id }, message);
      }
  }

  process.exit(0);
}

function buildProgressBar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

main().catch(() => process.exit(0));
