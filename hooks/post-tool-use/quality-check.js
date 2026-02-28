#!/usr/bin/env node
/**
 * Post-tool-use hook: Verifies outputs and triggers quality checks automatically.
 * Runs after Write/Edit operations to validate code quality.
 */

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { createLogger } from '../../src/logger.js';

const logger = createLogger('post-tool-use');

async function main() {
  let input;
  try {
    const rawInput = readFileSync('/dev/stdin', 'utf8');
    input = JSON.parse(rawInput);
  } catch {
    process.exit(0);
  }

  const { tool_name, tool_input, tool_result } = input;

  logger.info({ tool: tool_name }, 'PostToolUse: running quality checks');

  // Only run quality checks after file modifications
  if (!['Write', 'Edit'].includes(tool_name)) {
    process.exit(0);
  }

  const filePath = tool_input?.file_path || tool_input?.path;
  if (!filePath) {
    process.exit(0);
  }

  const checks = [];

  // Run ESLint for JS/TS files
  if (/\.(js|ts|jsx|tsx)$/.test(filePath)) {
    try {
      execSync(`npx eslint "${filePath}" --max-warnings=0 --quiet`, {
        stdio: 'pipe',
        cwd: process.cwd(),
      });
      checks.push({ check: 'eslint', status: 'pass' });
      logger.info({ file: filePath }, 'PostToolUse: ESLint passed');
    } catch (err) {
      const output = err.stdout?.toString() || err.message;
      checks.push({ check: 'eslint', status: 'fail', details: output.slice(0, 500) });
      logger.warn({ file: filePath, details: output.slice(0, 200) }, 'PostToolUse: ESLint warnings/errors');
    }
  }

  // Check for TypeScript errors
  if (/\.(ts|tsx)$/.test(filePath)) {
    try {
      execSync('npx tsc --noEmit --skipLibCheck', {
        stdio: 'pipe',
        cwd: process.cwd(),
      });
      checks.push({ check: 'typescript', status: 'pass' });
    } catch (err) {
      const output = err.stdout?.toString() || err.message;
      checks.push({ check: 'typescript', status: 'warn', details: output.slice(0, 500) });
      logger.warn({ file: filePath }, 'PostToolUse: TypeScript errors detected');
    }
  }

  // Check for TODO/FIXME markers in production code
  if (!/\.test\.(js|ts)$/.test(filePath) && !filePath.includes('__tests__')) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const todoCount = (content.match(/\b(TODO|FIXME|HACK|XXX)\b/g) || []).length;
      if (todoCount > 0) {
        checks.push({ check: 'todo_markers', status: 'warn', count: todoCount });
        logger.warn({ file: filePath, count: todoCount }, 'PostToolUse: TODO/FIXME markers found');
      } else {
        checks.push({ check: 'todo_markers', status: 'pass' });
      }
    } catch {
      // File might not exist yet (Write creates it)
    }
  }

  const failedChecks = checks.filter(c => c.status === 'fail');

  if (failedChecks.length > 0) {
    // Output feedback for Claude to act on
    const feedback = failedChecks.map(c => `${c.check}: ${c.details}`).join('\n');
    console.log(JSON.stringify({
      action: 'feedback',
      message: `Quality check failures after writing ${filePath}:\n${feedback}\n\nPlease fix these issues.`,
    }));
  }

  logger.info({
    file: filePath,
    checks: checks.map(c => `${c.check}:${c.status}`).join(', '),
  }, 'PostToolUse: quality checks complete');

  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'PostToolUse hook error');
  process.exit(0);
});
