/**
 * Context Manager — Persistent context management between agents.
 *
 * Manages the shared context window, compresses large contexts,
 * and maintains the handoff chain across agent boundaries.
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../src/logger.js';

const logger = createLogger('context-manager');

const CACHE_DIR = process.env.CACHE_DIR || '.orchestrator/cache';
const MAX_CONTEXT_TOKENS = parseInt(process.env.MAX_CONTEXT_TOKENS || '80000');
const COMPRESSION_THRESHOLD = parseInt(process.env.COMPRESSION_THRESHOLD || '60000');

/** Rough token estimate: ~4 chars per token */
const estimateTokens = (text) => Math.ceil(text.length / 4);

export class ContextManager {
  constructor() {
    this.handoffChain = [];
    this.artifactCache = new Map();
    this.sessionId = null;

    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
  }

  /**
   * Initialize a new orchestration session.
   * @param {string} sessionId - Unique session identifier
   * @param {object} initialContext - Starting context for the session
   */
  initSession(sessionId, initialContext) {
    this.sessionId = sessionId;
    this.handoffChain = [];
    this.persistSession({ sessionId, initialContext, handoffChain: [] });
    logger.info({ sessionId }, 'Context manager: session initialized');
  }

  /**
   * Resume an existing session from disk.
   * @param {string} sessionId
   */
  resumeSession(sessionId) {
    const data = this.loadSession(sessionId);
    if (!data) throw new Error(`Session not found: ${sessionId}`);
    this.sessionId = data.sessionId;
    this.handoffChain = data.handoffChain || [];
    logger.info({ sessionId, handoffs: this.handoffChain.length }, 'Context manager: session resumed');
  }

  /**
   * Add a handoff to the chain.
   * @param {object} handoff - Validated handoff packet
   */
  addHandoff(handoff) {
    this.handoffChain.push({
      ...handoff,
      sequence: this.handoffChain.length,
    });
    this.persistSession({
      sessionId: this.sessionId,
      handoffChain: this.handoffChain,
    });
    logger.info({
      from: handoff.handoff.from_agent,
      to: handoff.handoff.to_agent,
      taskId: handoff.handoff.task_id,
    }, 'Context manager: handoff recorded');
  }

  /**
   * Build compressed context for a sub-agent.
   * Applies compression if context would exceed the threshold.
   *
   * @param {object} options
   * @param {string} options.task - Task description
   * @param {string[]} options.constraints - Technical/business constraints
   * @param {string[]} options.artifactPaths - Paths agent needs to read
   * @param {string} options.agentType - Target agent type
   * @param {number} options.recentHandoffs - How many recent handoffs to include (default: 3)
   * @returns {string} JSON context string ready to inject
   */
  buildAgentContext({ task, constraints = [], artifactPaths = [], agentType, recentHandoffs = 3 }) {
    const recent = this.handoffChain.slice(-recentHandoffs);

    const context = {
      task,
      constraints,
      artifact_paths: artifactPaths,
      quality_gates_already_passed: this.getPassedGates(),
      recent_handoffs: recent.map(h => ({
        from: h.handoff.from_agent,
        summary: h.handoff.context_summary,
        confidence: h.handoff.confidence_score,
        gates: h.handoff.quality_gates_passed,
      })),
    };

    const contextStr = JSON.stringify(context, null, 2);
    const estimatedTokens = estimateTokens(contextStr);

    if (estimatedTokens > COMPRESSION_THRESHOLD) {
      logger.info({
        estimated_tokens: estimatedTokens,
        threshold: COMPRESSION_THRESHOLD,
      }, 'Context manager: compressing context');
      return this.compressContext(context);
    }

    return contextStr;
  }

  /**
   * Compress context to stay within token budget.
   * Removes verbose fields, keeps essential information.
   * @param {object} context
   */
  compressContext(context) {
    const compressed = {
      task: context.task,
      constraints: context.constraints,
      artifact_paths: context.artifact_paths,
      quality_gates_already_passed: context.quality_gates_already_passed,
      // Summarize recent handoffs more aggressively
      recent_handoffs_summary: context.recent_handoffs
        .map(h => `${h.from}: ${h.summary?.slice(0, 200) || ''}`)
        .join('\n'),
    };

    logger.info({
      original_chars: JSON.stringify(context).length,
      compressed_chars: JSON.stringify(compressed).length,
    }, 'Context manager: context compressed');

    return JSON.stringify(compressed, null, 2);
  }

  /**
   * Cache the result of a deterministic subtask.
   * @param {string} cacheKey - Hash of task description + relevant file hashes
   * @param {object} result - Agent output to cache
   */
  cacheResult(cacheKey, result) {
    const cachePath = join(CACHE_DIR, `${cacheKey}.json`);
    writeFileSync(cachePath, JSON.stringify(result, null, 2), 'utf8');
    this.artifactCache.set(cacheKey, result);
    logger.info({ cacheKey }, 'Context manager: result cached');
  }

  /**
   * Retrieve a cached result if available.
   * @param {string} cacheKey
   * @returns {object|null} Cached result or null
   */
  getCachedResult(cacheKey) {
    if (this.artifactCache.has(cacheKey)) {
      return this.artifactCache.get(cacheKey);
    }
    const cachePath = join(CACHE_DIR, `${cacheKey}.json`);
    if (existsSync(cachePath)) {
      const result = JSON.parse(readFileSync(cachePath, 'utf8'));
      this.artifactCache.set(cacheKey, result);
      return result;
    }
    return null;
  }

  /**
   * Compute a cache key for a subtask.
   * @param {string} taskDescription
   * @param {string[]} relevantFilePaths - Paths whose content affects the result
   */
  computeCacheKey(taskDescription, relevantFilePaths = []) {
    const hash = createHash('sha256');
    hash.update(taskDescription);
    for (const filePath of relevantFilePaths.sort()) {
      try {
        const content = readFileSync(filePath, 'utf8');
        hash.update(filePath + ':' + content);
      } catch {
        hash.update(filePath + ':missing');
      }
    }
    return hash.digest('hex').slice(0, 16);
  }

  /**
   * Get all quality gates that have been passed so far in this session.
   * @returns {string[]}
   */
  getPassedGates() {
    const passed = new Set();
    for (const handoff of this.handoffChain) {
      for (const gate of handoff.handoff.quality_gates_passed || []) {
        passed.add(gate);
      }
    }
    return Array.from(passed);
  }

  /**
   * Get the last handoff from a specific agent type.
   * @param {string} agentType
   */
  getLastHandoffFrom(agentType) {
    for (let i = this.handoffChain.length - 1; i >= 0; i--) {
      if (this.handoffChain[i].handoff.from_agent === agentType) {
        return this.handoffChain[i];
      }
    }
    return null;
  }

  // ── Persistence ────────────────────────────────────────────────────

  persistSession(data) {
    if (!this.sessionId) return;
    const sessionPath = join(CACHE_DIR, `session-${this.sessionId}.json`);
    const existing = existsSync(sessionPath)
      ? JSON.parse(readFileSync(sessionPath, 'utf8'))
      : {};
    writeFileSync(sessionPath, JSON.stringify({ ...existing, ...data }, null, 2), 'utf8');
  }

  loadSession(sessionId) {
    const sessionPath = join(CACHE_DIR, `session-${sessionId}.json`);
    if (!existsSync(sessionPath)) return null;
    return JSON.parse(readFileSync(sessionPath, 'utf8'));
  }
}
