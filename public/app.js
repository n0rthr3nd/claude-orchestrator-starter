/* ── Claude Orchestrator Dashboard ── app.js ─────────────────────────────── */

const AGENTS = ['architect', 'developer', 'reviewer', 'tester', 'security', 'documenter'];
const GATES  = ['static_analysis', 'tests', 'security', 'documentation', 'code_review'];

const GATE_LABELS = {
  static_analysis: 'Static Analysis',
  tests:           'Tests',
  security:        'Security',
  documentation:   'Documentation',
  code_review:     'Code Review',
};

const EVENT_ICONS = {
  'orchestration:start':    '🚀',
  'orchestration:complete': '✅',
  'orchestration:error':    '❌',
  'analysis:complete':      '🔍',
  'stage:start':            '▶',
  'stage:complete':         '✔',
  'agent:start':            '⟳',
  'agent:complete':         '✓',
  'agent:fail':             '✗',
  'gate:pass':              '🔒',
  'gate:fail':              '🔓',
  'checkpoint':             '📸',
  'rollback':               '↩',
};

// ── State ─────────────────────────────────────────────────────────────────────
let state = {
  status: 'idle',
  agents: {},
  gates:  Object.fromEntries(GATES.map(g => [g, 'pending'])),
  metrics: {},
  sessionId: null,
};

let config = { projects: [], activeProject: 0 };

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const log           = $('log');
const agentsList    = $('agents-list');
const gatesList     = $('gates-list');
const cpList        = $('checkpoints-list');
const statusBadge   = $('status-badge');
const sessionLabel  = $('session-id');
const connDot       = $('conn-dot');
const btnOrch       = $('btn-orchestrate');
const btnCp         = $('btn-checkpoint');
const taskInput     = $('task-input');
const projectSelect = $('project-select');
const dirTree       = $('dir-tree');
const configModal   = $('config-modal');
const configEditor  = $('config-editor');

// ── Initial render ────────────────────────────────────────────────────────────
renderAgents();
renderGates();
loadConfig();

// ── SSE connection ────────────────────────────────────────────────────────────
let es;

function connectSSE() {
  es = new EventSource('/api/stream');

  es.onopen = () => {
    connDot.className = 'connected';
    connDot.title = 'Connected';
  };

  es.onerror = () => {
    connDot.className = 'disconnected';
    connDot.title = 'Disconnected — retrying…';
  };

  es.onmessage = (e) => {
    const event = JSON.parse(e.data);
    handleEvent(event);
  };
}

connectSSE();

// ── Event handler ─────────────────────────────────────────────────────────────
function handleEvent(event) {
  const { type } = event;

  if (type === 'sync') {
    state = { ...state, ...event.state };
    renderAll();
    log.innerHTML = '';
    (event.state.logs || []).forEach(addLogEntry);
    return;
  }

  if (type === 'checkpoints:update') { loadCheckpoints(); return; }
  if (type === 'config:update')      { config = event.config; renderProjectSelector(); return; }

  if (type === 'orchestration:start') {
    state.status = 'running';
    state.agents = {};
    state.gates  = Object.fromEntries(GATES.map(g => [g, 'pending']));
    log.innerHTML = '';
  }
  if (type === 'orchestration:complete') {
    state.status = 'complete';
    state.metrics = event.result?.metrics || {};
    loadCheckpoints();
  }
  if (type === 'orchestration:error') state.status = 'error';
  if (type === 'agent:start')    state.agents[event.agent] = 'running';
  if (type === 'agent:complete') state.agents[event.agent] = 'complete';
  if (type === 'agent:fail')     state.agents[event.agent] = 'fail';
  if (type === 'gate:pass')      state.gates[event.gate]   = 'pass';
  if (type === 'gate:fail')      state.gates[event.gate]   = 'fail';
  if (type === 'checkpoint')     loadCheckpoints();

  if (event.message) addLogEntry(event);

  renderStatus();
  renderAgents();
  renderGates();
  renderMetrics();
}

// ── Config & project selector ─────────────────────────────────────────────────
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    config = await res.json();
    renderProjectSelector();
  } catch { /* server not ready yet */ }
}

function renderProjectSelector() {
  projectSelect.innerHTML = '';

  if (!config.projects?.length) {
    projectSelect.innerHTML = '<option value="">— no projects configured —</option>';
    dirTree.innerHTML = '<div class="dir-empty">Edit orchestrator.config.json to add a project</div>';
    return;
  }

  config.projects.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name || p.path;
    if (i === (config.activeProject ?? 0)) opt.selected = true;
    projectSelect.appendChild(opt);
  });

  renderDirTree();
}

function renderDirTree() {
  const idx = parseInt(projectSelect.value, 10);
  const p   = config.projects?.[idx];
  if (!p) { dirTree.innerHTML = ''; return; }

  const additional = p.additionalPaths ?? [];

  let html = `
    <div class="dir-entry root" title="${escapeHtml(p.path)}">
      <span class="dir-icon">📁</span>
      <span class="dir-label">${escapeHtml(p.path)}</span>
      <span class="dir-badge">root</span>
    </div>`;

  additional.forEach((ap, i) => {
    html += `
    <div class="dir-entry extra" title="${escapeHtml(ap)}">
      <span class="dir-icon">📂</span>
      <span class="dir-label">${escapeHtml(ap)}</span>
      <button class="dir-remove" onclick="removeAdditionalPath(${idx}, ${i})" title="Remove">✕</button>
    </div>`;
  });

  html += `
    <button class="dir-add-btn" onclick="promptAddPath(${idx})">+ add directory</button>`;

  if (p.description) {
    html = `<div class="dir-desc">${escapeHtml(p.description)}</div>` + html;
  }

  dirTree.innerHTML = html;
}

async function promptAddPath(projectIdx) {
  const newPath = prompt('Enter the absolute path to add:')?.trim();
  if (!newPath) return;

  const project = config.projects[projectIdx];
  const additional = [...(project.additionalPaths ?? []), newPath];

  await patchProjectConfig(projectIdx, { additionalPaths: additional });
}

async function removeAdditionalPath(projectIdx, pathIdx) {
  const project = config.projects[projectIdx];
  const additional = (project.additionalPaths ?? []).filter((_, i) => i !== pathIdx);

  await patchProjectConfig(projectIdx, { additionalPaths: additional });
}

async function patchProjectConfig(projectIdx, patch) {
  const updatedProjects = config.projects.map((p, i) =>
    i === projectIdx ? { ...p, ...patch } : p
  );
  const res = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projects: updatedProjects }),
  });
  if (res.ok) {
    config = (await res.json()).config;
    renderDirTree();
  }
}

projectSelect.addEventListener('change', async () => {
  const idx = parseInt(projectSelect.value, 10);
  renderDirTree();
  await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activeProject: idx }),
  });
});

// ── Config modal ──────────────────────────────────────────────────────────────
$('btn-edit-config').addEventListener('click', async () => {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  configEditor.value = JSON.stringify(cfg, null, 2);
  configModal.classList.remove('hidden');
});

$('btn-close-modal').addEventListener('click', () => {
  configModal.classList.add('hidden');
});

configModal.addEventListener('click', (e) => {
  if (e.target === configModal) configModal.classList.add('hidden');
});

$('btn-reload-config').addEventListener('click', async () => {
  await loadConfig();
  const res = await fetch('/api/config');
  configEditor.value = JSON.stringify(await res.json(), null, 2);
});

$('btn-save-config').addEventListener('click', async () => {
  let parsed;
  try {
    parsed = JSON.parse(configEditor.value);
  } catch (e) {
    alert(`Invalid JSON: ${e.message}`);
    return;
  }
  const res = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed),
  });
  if (res.ok) {
    config = (await res.json()).config;
    renderProjectSelector();
    configModal.classList.add('hidden');
  } else {
    const err = await res.json();
    alert(`Save failed: ${err.error}`);
  }
});

// ── Render helpers ────────────────────────────────────────────────────────────
function renderAll() {
  renderStatus();
  renderAgents();
  renderGates();
  renderMetrics();
  loadCheckpoints();
}

function renderStatus() {
  statusBadge.textContent = state.status.charAt(0).toUpperCase() + state.status.slice(1);
  statusBadge.className = state.status;
  btnOrch.disabled = state.status === 'running';
  sessionLabel.textContent = state.sessionId ? `Session ${state.sessionId.slice(0, 8)}` : '—';
}

function renderAgents() {
  agentsList.innerHTML = AGENTS.map(name => {
    const st = state.agents[name] || 'pending';
    const statusText = { pending: '—', running: 'running…', complete: 'done', fail: 'failed' }[st] || st;
    return `<div class="agent-item">
      <div class="agent-dot ${st}"></div>
      <span class="agent-name ${name}">${name}</span>
      <span class="agent-status">${statusText}</span>
    </div>`;
  }).join('');
}

function renderGates() {
  gatesList.innerHTML = GATES.map(g => {
    const st = state.gates[g] || 'pending';
    const icon = st === 'pass' ? '✅' : st === 'fail' ? '❌' : '⏳';
    return `<div class="gate-item">
      <span class="gate-icon ${st}">${icon}</span>
      <span class="gate-label ${st}">${GATE_LABELS[g]}</span>
    </div>`;
  }).join('');
}

function renderMetrics() {
  const m = state.metrics || {};
  $('m-agents').textContent = m.agents_spawned  ?? 0;
  $('m-ok').textContent     = m.agents_succeeded ?? 0;
  $('m-fail').textContent   = m.agents_failed    ?? 0;
  $('m-gates').textContent  = m.quality_gates_passed ?? 0;
  $('m-cps').textContent    = m.checkpoints_created  ?? 0;
}

// ── Log ───────────────────────────────────────────────────────────────────────
function addLogEntry(event) {
  const placeholder = log.querySelector('.log-empty');
  if (placeholder) placeholder.remove();

  const ts   = new Date(event.timestamp || Date.now()).toLocaleTimeString('en', { hour12: false });
  const icon = EVENT_ICONS[event.type] || '·';

  const div = document.createElement('div');
  div.className = `log-entry ${event.type}`;
  div.innerHTML = `
    <span class="log-ts">${ts}</span>
    <span class="log-icon">${icon}</span>
    <span class="log-msg">${escapeHtml(event.message || event.type)}</span>
  `;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Checkpoints ───────────────────────────────────────────────────────────────
async function loadCheckpoints() {
  try {
    const res = await fetch('/api/checkpoints');
    if (!res.ok) return;
    const cps = await res.json();

    if (!cps.length) {
      cpList.innerHTML = '<p class="cp-empty">No checkpoints yet.</p>';
      return;
    }

    cpList.innerHTML = cps.slice(0, 15).map(cp => `
      <div class="cp-item">
        <span class="cp-icon">📸</span>
        <div class="cp-info">
          <div class="cp-label" title="${cp.id}">${cp.label}</div>
          <div class="cp-time">${formatTime(cp.timestamp)}</div>
        </div>
        <button class="btn-rollback" onclick="doRollback('${cp.id}', '${cp.label}')">↩</button>
      </div>
    `).join('');
  } catch { /* no checkpoints dir yet */ }
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString('en', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return iso; }
}

async function doRollback(id, label) {
  if (state.status === 'running') {
    return alert('Cannot rollback while orchestration is running.');
  }
  if (!confirm(`Rollback to checkpoint "${label}"?\n\nThis restores the orchestrator state.`)) return;

  const res = await fetch('/api/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  if (!res.ok) alert(`Rollback failed: ${data.error}`);
}

// ── Actions ───────────────────────────────────────────────────────────────────
btnOrch.addEventListener('click', async () => {
  const task = taskInput.value.trim();
  if (!task) { taskInput.focus(); return; }

  const idx = parseInt(projectSelect.value, 10);
  const project = config.projects?.[idx];
  if (!project) {
    alert('No project selected.\n\nClick ✎ to configure a project path first.');
    return;
  }

  btnOrch.disabled = true;

  const res = await fetch('/api/orchestrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task }),
  });

  const data = await res.json();

  if (!res.ok) {
    alert(`Error: ${data.error}`);
    btnOrch.disabled = false;
    return;
  }

  state.sessionId = data.sessionId;
  renderStatus();
});

btnCp.addEventListener('click', async () => {
  const label = prompt('Checkpoint label (optional):') ?? 'manual';
  const res = await fetch('/api/checkpoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  const data = await res.json();
  if (!res.ok) alert(`Failed: ${data.error}`);
});

taskInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) btnOrch.click();
});

loadCheckpoints();
