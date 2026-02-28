#!/usr/bin/env node
/**
 * Stop hook: Auto-checkpoint on session end to preserve all work.
 */

import { createLogger } from '../../src/logger.js';
import { CheckpointManager } from '../../src/checkpoint-manager.js';

const logger = createLogger('auto-checkpoint');

async function main() {
  logger.info('Stop hook: auto-checkpointing session state');

  try {
    const manager = new CheckpointManager();
    const checkpointId = await manager.save({ label: 'auto-session-end' });
    logger.info({ checkpointId }, 'Auto-checkpoint saved successfully');
    console.log(`✅ Session state checkpointed: ${checkpointId}`);
  } catch (err) {
    logger.error({ err: err.message }, 'Auto-checkpoint failed');
    // Don't block session exit on checkpoint failure
  }

  process.exit(0);
}

main();
