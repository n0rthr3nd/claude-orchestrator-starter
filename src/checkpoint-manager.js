/**
 * Checkpoint Manager — Save and restore complete orchestration state.
 *
 * Checkpoints capture: task tree, handoff history, artifact hashes,
 * quality gate results, and git state. They enable /rollback functionality.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from './logger.js';

const logger = createLogger('checkpoint-manager');
const CHECKPOINT_DIR = process.env.CHECKPOINT_DIR || '.orchestrator/checkpoints';
const INDEX_PATH = join(CHECKPOINT_DIR, 'index.json');

export class CheckpointManager {
  constructor() {
    if (!existsSync(CHECKPOINT_DIR)) {
      mkdirSync(CHECKPOINT_DIR, { recursive: true });
    }
    this.index = this.loadIndex();
  }

  /**
   * Save current state as a checkpoint.
   * @param {object} options
   * @param {string} [options.label] - Human-readable label
   * @param {object} [options.taskTree] - Current task tree
   * @param {object[]} [options.handoffHistory] - Full handoff chain
   * @param {object} [options.metrics] - Token usage, timing, etc.
   * @returns {string} Checkpoint ID
   */
  async save({ label = 'manual', taskTree = {}, handoffHistory = [], metrics = {} } = {}) {
    const checkpointId = `cp_${uuidv4().slice(0, 8)}`;
    const timestamp = new Date().toISOString();

    const gitState = this.captureGitState();

    const checkpoint = {
      checkpoint_id: checkpointId,
      label,
      timestamp,
      git: gitState,
      tasks: taskTree,
      handoff_history: handoffHistory,
      metrics: {
        ...metrics,
        checkpoint_timestamp: timestamp,
      },
      artifact_hashes: this.hashArtifacts(handoffHistory),
    };

    const checkpointPath = join(CHECKPOINT_DIR, `${checkpointId}.json`);
    writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf8');

    // Update index
    this.index.push({
      id: checkpointId,
      label,
      timestamp,
      git_commit: gitState.commit,
    });
    this.saveIndex();

    logger.info({ checkpointId, label, path: checkpointPath }, 'Checkpoint saved');
    return checkpointId;
  }

  /**
   * Restore from a checkpoint by ID or label.
   * @param {string} idOrLabel - Checkpoint ID (cp_xxx) or label string
   * @returns {object} The restored checkpoint data
   */
  restore(idOrLabel) {
    const entry = this.index.find(
      c => c.id === idOrLabel || c.label === idOrLabel
    );
    if (!entry) {
      const available = this.index.map(c => `${c.id} (${c.label})`).join(', ');
      throw new Error(`Checkpoint not found: ${idOrLabel}. Available: ${available}`);
    }

    const checkpointPath = join(CHECKPOINT_DIR, `${entry.id}.json`);
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'));

    logger.info({
      checkpointId: entry.id,
      label: entry.label,
      gitCommit: checkpoint.git?.commit,
    }, 'Checkpoint loaded for restore');

    return checkpoint;
  }

  /**
   * List all available checkpoints.
   * @returns {object[]} List of checkpoint summaries
   */
  list() {
    return [...this.index].reverse(); // Most recent first
  }

  /**
   * Get the most recent checkpoint.
   * @returns {object|null}
   */
  getLatest() {
    if (this.index.length === 0) return null;
    const latest = this.index[this.index.length - 1];
    return this.restore(latest.id);
  }

  // ── Internal helpers ──────────────────────────────────────────────

  captureGitState() {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
      const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      const statusOutput = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
      return {
        branch,
        commit,
        clean: statusOutput === '',
        modified_files: statusOutput ? statusOutput.split('\n').length : 0,
      };
    } catch {
      logger.warn('Failed to capture git state — not in a git repository?');
      return { branch: 'unknown', commit: 'unknown', clean: true, modified_files: 0 };
    }
  }

  hashArtifacts(handoffHistory) {
    const hashes = {};
    for (const handoff of handoffHistory) {
      for (const artifact of handoff?.handoff?.artifacts || []) {
        if (artifact.path) {
          try {
            const { createHash } = require('crypto');
            const content = readFileSync(artifact.path, 'utf8');
            hashes[artifact.path] = createHash('sha256').update(content).digest('hex').slice(0, 16);
          } catch {
            hashes[artifact.path] = 'unreadable';
          }
        }
      }
    }
    return hashes;
  }

  loadIndex() {
    if (!existsSync(INDEX_PATH)) return [];
    try {
      return JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
    } catch {
      return [];
    }
  }

  saveIndex() {
    writeFileSync(INDEX_PATH, JSON.stringify(this.index, null, 2), 'utf8');
  }
}

// ── CLI interface ─────────────────────────────────────────────────────────────

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [, , command, ...args] = process.argv;
  const manager = new CheckpointManager();

  switch (command) {
    case 'save':
      manager.save({ label: args[0] || 'manual' }).then(id => {
        console.log(`✅ Checkpoint saved: ${id}`);
      });
      break;
    case 'restore':
      if (!args[0]) {
        console.error('Usage: checkpoint-manager restore <id-or-label>');
        process.exit(1);
      }
      try {
        const cp = manager.restore(args[0]);
        console.log(`✅ Checkpoint ${cp.checkpoint_id} loaded (${cp.label} @ ${cp.timestamp})`);
        console.log('Git state:', cp.git);
      } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
      }
      break;
    case 'list':
      const checkpoints = manager.list();
      if (checkpoints.length === 0) {
        console.log('No checkpoints found.');
      } else {
        console.table(checkpoints);
      }
      break;
    default:
      console.error('Usage: checkpoint-manager [save|restore|list]');
      process.exit(1);
  }
}
