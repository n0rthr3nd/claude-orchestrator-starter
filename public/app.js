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

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const log          = $('log');
const agentsList   = $('agents-list');
const gatesList    = $('gates-list');
const cpList       = $('checkpoints-list');
const statusBadge  = $('status-badge');
const sessionLabel = $('session-id');
const connDot      = $('conn-dot');
const btnOrch      = $('btn-orchestrate');
const btnCp        = $('btn-checkpoint');
const taskInput    = $('task-input');

// ── Initial render ────────────────────────────────────────────────────────────
renderAgents();
renderGates();

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

  // Full state sync (sent on connect)
  if (type === 'sync') {
    state = { ...state, ...event.state };
    renderAll();
    // Replay logs
    log.innerHTML = '';
    (event.state.logs || []).forEach(addLogEntry);
    return;
  }

  if (type === 'checkpoints:update') {
    loadCheckpoints();
    return;
  }

  // Update state
  if (type === 'orchestration:start') {
    state.status = 'running';
    state.agents = {};
    state.gates  = Object.fromEntries(GATES.map(g => [g, 'pending']));
    log.innerHTML = ''; // fresh log for new run
  }
  if (type === 'orchestration:complete') {
    state.status = 'complete';
    state.metrics = event.result?.metrics || {};
    loadCheckpoints();
  }
  if (type === 'orchestration:error') {
    state.status = 'error';
  }
  if (type === 'agent:start')    state.agents[event.agent] = 'running';
  if (type === 'agent:complete') state.agents[event.agent] = 'complete';
  if (type === 'agent:fail')     state.agents[event.agent] = 'fail';
  if (type === 'gate:pass')      state.gates[event.gate]   = 'pass';
  if (type === 'gate:fail')      state.gates[event.gate]   = 'fail';
  if (type === 'checkpoint')     loadCheckpoints();

  // Add log line
  if (event.message) addLogEntry(event);

  // Re-render reactive parts
  renderStatus();
  renderAgents();
  renderGates();
  renderMetrics();
}

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
  // Remove empty-state placeholder
  const placeholder = log.querySelector('.log-empty');
  if (placeholder) placeholder.remove();

  const ts   = new Date(event.timestamp || Date.now()).toLocaleTimeString('en', { hour12: false });
  const icon = EVENT_ICONS[event.type] || '·';

  const div = document.createElement('div');
  // Escape backslashes in class name for CSS selector safety (done in CSS with \\:)
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

// Allow Ctrl+Enter to submit from textarea
taskInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) btnOrch.click();
});

// Load initial checkpoint list
loadCheckpoints();
