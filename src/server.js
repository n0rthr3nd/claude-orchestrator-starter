#!/usr/bin/env node
/**
 * Web Dashboard Server — Express + SSE
 *
 * Expone el orquestador a través de una interfaz web con:
 * - POST /api/orchestrate  → lanza una tarea
 * - GET  /api/stream       → SSE: eventos en tiempo real
 * - GET  /api/checkpoints  → lista de checkpoints
 * - POST /api/checkpoint   → checkpoint manual
 * - POST /api/rollback     → rollback a un checkpoint
 * - GET  /api/status       → estado actual de la sesión
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Orchestrator } from './orchestrator.js';
import { CheckpointManager } from './checkpoint-manager.js';
import { createLogger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = createLogger('server');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

// ── SSE client registry ───────────────────────────────────────────────────────
const sseClients = new Set();

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch { sseClients.delete(res); }
  }
}

// ── Session state ─────────────────────────────────────────────────────────────
let currentOrchestrator = null;
let sessionState = {
  status: 'idle',          // idle | running | complete | error
  task: null,
  agents: {},              // { architect: 'running'|'complete'|'fail'|'pending' }
  gates: {                 // gate name → 'pending'|'pass'|'fail'
    static_analysis: 'pending',
    tests: 'pending',
    security: 'pending',
    documentation: 'pending',
    code_review: 'pending',
  },
  metrics: {},
  logs: [],               // últimas 200 líneas
};

function pushLog(event) {
  sessionState.logs.push(event);
  if (sessionState.logs.length > 200) sessionState.logs.shift();
}

function resetSession(task) {
  sessionState = {
    status: 'running',
    task,
    agents: {},
    gates: {
      static_analysis: 'pending',
      tests: 'pending',
      security: 'pending',
      documentation: 'pending',
      code_review: 'pending',
    },
    metrics: {},
    logs: [],
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** SSE stream — el frontend se conecta aquí para recibir eventos */
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Enviar estado actual al nuevo cliente
  res.write(`data: ${JSON.stringify({ type: 'sync', state: sessionState })}\n\n`);

  sseClients.add(res);
  logger.info({ clients: sseClients.size }, 'SSE client connected');

  // Ping cada 25s para mantener la conexión viva
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 25000);

  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(ping);
    logger.info({ clients: sseClients.size }, 'SSE client disconnected');
  });
});

/** Lanzar una nueva tarea de orquestación */
app.post('/api/orchestrate', async (req, res) => {
  const { task } = req.body;

  if (!task?.trim()) {
    return res.status(400).json({ error: 'task is required' });
  }
  if (sessionState.status === 'running') {
    return res.status(409).json({ error: 'An orchestration is already running' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  resetSession(task);
  res.json({ ok: true, sessionId: currentOrchestrator?.sessionId });

  // Ejecutar en background
  (async () => {
    currentOrchestrator = new Orchestrator();

    // Conectar eventos del orquestador → SSE + estado local
    currentOrchestrator.on('event', (event) => {
      pushLog(event);

      // Actualizar estado local según tipo de evento
      if (event.type === 'agent:start')    sessionState.agents[event.agent] = 'running';
      if (event.type === 'agent:complete') sessionState.agents[event.agent] = 'complete';
      if (event.type === 'agent:fail')     sessionState.agents[event.agent] = 'fail';
      if (event.type === 'gate:pass')      sessionState.gates[event.gate]   = 'pass';
      if (event.type === 'gate:fail')      sessionState.gates[event.gate]   = 'fail';
      if (event.type === 'checkpoint')     broadcast({ type: 'checkpoints:update' });

      broadcast(event);
    });

    try {
      const result = await currentOrchestrator.orchestrate(task);
      sessionState.status = 'complete';
      sessionState.metrics = result.metrics;
      broadcast({ type: 'orchestration:complete', message: 'Orchestration complete ✅', result });
    } catch (err) {
      sessionState.status = 'error';
      const errEvent = { type: 'orchestration:error', message: `Error: ${err.message}` };
      pushLog(errEvent);
      broadcast(errEvent);
      logger.error({ err: err.message }, 'Orchestration failed');
    }
  })();
});

/** Estado actual de la sesión */
app.get('/api/status', (_req, res) => {
  res.json({
    ...sessionState,
    logs: sessionState.logs.slice(-50), // últimas 50 para el endpoint
  });
});

/** Listar checkpoints */
app.get('/api/checkpoints', (_req, res) => {
  try {
    const manager = new CheckpointManager();
    res.json(manager.list());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Checkpoint manual */
app.post('/api/checkpoint', async (req, res) => {
  const { label = 'manual' } = req.body;
  try {
    const manager = new CheckpointManager();
    const id = await manager.save({
      label,
      taskTree: currentOrchestrator?.taskTree || {},
      handoffHistory: currentOrchestrator?.handoffHistory || [],
      metrics: currentOrchestrator?.metrics || {},
    });
    broadcast({ type: 'checkpoint', message: `Checkpoint saved: ${label}`, checkpointId: id, label });
    res.json({ ok: true, checkpointId: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Rollback a un checkpoint */
app.post('/api/rollback', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });
  if (sessionState.status === 'running') {
    return res.status(409).json({ error: 'Cannot rollback while orchestration is running' });
  }
  try {
    const manager = new CheckpointManager();
    const cp = manager.restore(id);
    sessionState.status = 'idle';
    broadcast({ type: 'rollback', message: `Rolled back to: ${cp.label} (${cp.timestamp})`, checkpoint: cp });
    res.json({ ok: true, checkpoint: cp });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const server = createServer(app);
server.listen(PORT, () => {
  logger.info({ port: PORT }, 'Dashboard server running');
  console.log(`\n  🤖 Claude Orchestrator Dashboard`);
  console.log(`  ➜  http://localhost:${PORT}\n`);
});
