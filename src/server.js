#!/usr/bin/env node
/**
 * Web Dashboard Server — Express + SSE
 *
 * - POST /api/orchestrate  → lanza una tarea
 * - GET  /api/stream       → SSE: eventos en tiempo real
 * - GET  /api/checkpoints  → lista de checkpoints
 * - POST /api/checkpoint   → checkpoint manual
 * - POST /api/rollback     → rollback a un checkpoint
 * - GET  /api/status       → estado actual de la sesión
 * - GET  /api/config       → configuración del orquestador
 * - PUT  /api/config       → actualizar configuración
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { Orchestrator } from './orchestrator.js';
import { CheckpointManager } from './checkpoint-manager.js';
import { createLogger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = createLogger('server');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_PATH = join(__dirname, '..', 'orchestrator.config.json');
const CONFIG_EXAMPLE_PATH = join(__dirname, '..', 'orchestrator.config.example.json');

// ── Config management ─────────────────────────────────────────────────────────

function loadConfig() {
  const src = existsSync(CONFIG_PATH) ? CONFIG_PATH : CONFIG_EXAMPLE_PATH;
  try {
    return JSON.parse(readFileSync(src, 'utf8'));
  } catch {
    return {
      projects: [],
      activeProject: -1,
      defaultModel: 'claude-sonnet-4-6',
      orchestratorModel: 'claude-opus-4-6',
      maxParallelAgents: 3,
      confidenceThreshold: 80,
    };
  }
}

function saveConfig(cfg) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function getActiveProject(cfg) {
  if (!cfg.projects?.length) return null;
  const idx = cfg.activeProject ?? 0;
  return cfg.projects[idx] ?? cfg.projects[0] ?? null;
}

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
  status: 'idle',
  task: null,
  projectPath: null,
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

function pushLog(event) {
  sessionState.logs.push(event);
  if (sessionState.logs.length > 200) sessionState.logs.shift();
}

function resetSession(task, projectPath, additionalPaths = []) {
  sessionState = {
    status: 'running',
    task,
    projectPath,
    additionalPaths,
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

/** SSE stream */
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'sync', state: sessionState })}\n\n`);

  sseClients.add(res);
  logger.info({ clients: sseClients.size }, 'SSE client connected');

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 25000);

  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(ping);
    logger.info({ clients: sseClients.size }, 'SSE client disconnected');
  });
});

/** Leer configuración */
app.get('/api/config', (_req, res) => {
  const cfg = loadConfig();
  res.json(cfg);
});

/** Actualizar configuración */
app.put('/api/config', (req, res) => {
  try {
    const current = loadConfig();
    const updated = { ...current, ...req.body };
    saveConfig(updated);
    broadcast({ type: 'config:update', config: updated });
    res.json({ ok: true, config: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Lanzar orquestación */
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

  const cfg = loadConfig();
  const project = getActiveProject(cfg);

  if (!project) {
    return res.status(400).json({
      error: 'No project configured. Edit orchestrator.config.json and set at least one project with a valid path.',
    });
  }

  const projectPath      = project.path;
  const additionalPaths  = project.additionalPaths ?? [];
  resetSession(task, projectPath, additionalPaths);

  const sessionId = `ses_${Date.now()}`;
  res.json({ ok: true, sessionId, projectPath, additionalPaths });

  // Ejecutar en background
  (async () => {
    currentOrchestrator = new Orchestrator({ cwd: projectPath, additionalPaths, config: cfg });

    currentOrchestrator.on('event', (event) => {
      pushLog(event);
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

/** Estado actual */
app.get('/api/status', (_req, res) => {
  res.json({ ...sessionState, logs: sessionState.logs.slice(-50) });
});

/** Listar checkpoints */
app.get('/api/checkpoints', (_req, res) => {
  try {
    res.json(new CheckpointManager().list());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Checkpoint manual */
app.post('/api/checkpoint', async (req, res) => {
  const { label = 'manual' } = req.body;
  try {
    const id = await new CheckpointManager().save({
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

/** Rollback */
app.post('/api/rollback', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });
  if (sessionState.status === 'running') {
    return res.status(409).json({ error: 'Cannot rollback while orchestration is running' });
  }
  try {
    const cp = new CheckpointManager().restore(id);
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
  const cfg = loadConfig();
  const project = getActiveProject(cfg);

  logger.info({ port: PORT }, 'Dashboard server running');
  console.log(`\n  🤖 Claude Orchestrator Dashboard`);
  console.log(`  ➜  http://localhost:${PORT}`);
  if (project) {
    console.log(`  📁 Project: ${project.name} → ${project.path}`);
  } else {
    console.log(`  ⚠️  No project configured — edit orchestrator.config.json`);
  }
  console.log();
});
