/**
 * Quality Gates — Enforce mandatory checks between agent transitions.
 *
 * Each gate validates a specific quality dimension.
 * All gates must pass before work proceeds to the next agent.
 */

import { execSync } from 'child_process';
import { createLogger } from './logger.js';

const logger = createLogger('quality-gates');

/** Gate definitions */
const GATES = {
  static_analysis: runStaticAnalysis,
  tests: runTests,
  security: runSecurityCheck,
  documentation: runDocCheck,
  code_review: runCodeReviewCheck,
};

/**
 * Run one or more quality gates.
 * @param {string[]} gateNames - Gates to run
 * @param {object} context - Context for the gate (files changed, agent output, etc.)
 * @returns {Promise<object>} Results for each gate
 */
export async function runQualityGates(gateNames, context = {}) {
  const results = {};
  const failures = [];

  for (const gateName of gateNames) {
    const gateFn = GATES[gateName];
    if (!gateFn) {
      logger.warn({ gate: gateName }, 'Unknown quality gate — skipping');
      results[gateName] = { status: 'skipped', reason: 'Unknown gate' };
      continue;
    }

    logger.info({ gate: gateName }, 'Running quality gate');
    try {
      const result = await gateFn(context);
      results[gateName] = result;
      if (result.status === 'fail') {
        failures.push({ gate: gateName, ...result });
        logger.warn({ gate: gateName, details: result.details }, 'Quality gate FAILED');
      } else {
        logger.info({ gate: gateName }, 'Quality gate passed');
      }
    } catch (err) {
      logger.error({ gate: gateName, err: err.message }, 'Quality gate threw an error');
      results[gateName] = { status: 'fail', reason: 'Gate threw an error', details: err.message };
      failures.push({ gate: gateName, error: err.message });
    }
  }

  return {
    all_passed: failures.length === 0,
    results,
    failures,
    passed_gates: Object.keys(results).filter(g => results[g].status === 'pass'),
  };
}

// ── Gate implementations ──────────────────────────────────────────────────────

async function runStaticAnalysis({ cwd = process.cwd() } = {}) {
  try {
    execSync('npx eslint . --ext .js,.ts --max-warnings=0 --quiet', {
      cwd,
      stdio: 'pipe',
    });
    return { status: 'pass' };
  } catch (err) {
    const output = (err.stdout || err.stderr || '').toString().slice(0, 1000);
    return { status: 'fail', details: output, gate: 'static_analysis' };
  }
}

async function runTests({ cwd = process.cwd(), coverageTarget = 80 } = {}) {
  try {
    const output = execSync('npm test -- --coverage --passWithNoTests', {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    });

    // Extract coverage percentage from Jest output
    const coverageMatch = output.match(/All files\s+\|\s+([\d.]+)/);
    const coverage = coverageMatch ? parseFloat(coverageMatch[1]) : null;

    if (coverage !== null && coverage < coverageTarget) {
      return {
        status: 'fail',
        details: `Test coverage ${coverage}% is below target ${coverageTarget}%`,
        coverage,
      };
    }

    return { status: 'pass', coverage };
  } catch (err) {
    const output = (err.stdout || err.stderr || '').toString().slice(0, 1500);
    return { status: 'fail', details: output, gate: 'tests' };
  }
}

async function runSecurityCheck({ agentOutput } = {}) {
  // Check if security agent has run and provided a verdict
  if (agentOutput?.verdict === 'pass' || agentOutput?.verdict === 'conditional') {
    const critical = agentOutput?.vulnerability_counts?.critical || 0;
    const high = agentOutput?.vulnerability_counts?.high || 0;
    if (critical > 0) {
      return { status: 'fail', details: `${critical} critical security vulnerabilities found` };
    }
    if (high > 0) {
      return { status: 'fail', details: `${high} high security vulnerabilities found` };
    }
    return { status: 'pass', vulnerability_counts: agentOutput?.vulnerability_counts };
  }

  // Fallback: run npm audit
  try {
    execSync('npm audit --audit-level=high', { stdio: 'pipe' });
    return { status: 'pass' };
  } catch (err) {
    const output = (err.stdout || '').toString().slice(0, 1000);
    return { status: 'fail', details: `npm audit found vulnerabilities: ${output}`, gate: 'security' };
  }
}

async function runDocCheck({ agentOutput } = {}) {
  if (agentOutput?.coverage_report?.coverage_pct !== undefined) {
    const pct = agentOutput.coverage_report.coverage_pct;
    if (pct < 90) {
      return { status: 'fail', details: `Documentation coverage ${pct}% is below 90%` };
    }
    return { status: 'pass', coverage_pct: pct };
  }
  // Documentation check is informational if no agent output
  return { status: 'pass', details: 'No documentation agent output to validate' };
}

async function runCodeReviewCheck({ agentOutput } = {}) {
  if (!agentOutput) {
    return { status: 'fail', details: 'No reviewer agent output provided' };
  }

  const verdict = agentOutput?.verdict;
  if (verdict === 'block') {
    return {
      status: 'fail',
      details: `Reviewer blocked: ${agentOutput?.severity_counts?.critical || 0} critical, ${agentOutput?.severity_counts?.high || 0} high issues`,
    };
  }
  if (verdict === 'request_changes') {
    return {
      status: 'fail',
      details: `Reviewer requested changes: ${agentOutput.findings?.filter(f => f.blocking)?.length || 0} blocking issues`,
    };
  }
  if (verdict === 'approve') {
    return { status: 'pass' };
  }

  return { status: 'fail', details: `Unknown reviewer verdict: ${verdict}` };
}
