/**
 * Structured logger using pino.
 * All agent and orchestrator actions produce JSON-structured logs.
 */

import pino from 'pino';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const IS_DEV = process.env.NODE_ENV !== 'production';

const transport = IS_DEV
  ? pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    })
  : undefined;

const baseLogger = pino(
  {
    level: LOG_LEVEL,
    base: {
      service: 'claude-orchestrator',
      version: process.env.npm_package_version || '1.0.0',
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport
);

/**
 * Create a child logger with a fixed component name.
 * @param {string} component - Component/module name
 * @param {object} [bindings] - Additional fixed bindings
 */
export function createLogger(component, bindings = {}) {
  return baseLogger.child({ component, ...bindings });
}

export { baseLogger as logger };
