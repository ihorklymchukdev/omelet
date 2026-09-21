'use strict';

// The one global Python reaches, and the one place a pushed event lands.
// Handlers register by event kind; an unknown kind is ignored rather than
// thrown, so an older UI paired with a newer bridge degrades quietly.
window.omelet = {
  handlers: {},
  on(event) {
    const handler = this.handlers[event.kind];
    if (handler) handler(event);
  },
};

const api = () => window.pywebview.api;

function show(screen, data) {
  const template = document.querySelector(`template[data-screen="${screen}"]`);
  if (!template) throw new Error(`no template for ${screen}`);
  const root = document.getElementById('screen');
  root.replaceChildren(template.content.cloneNode(true));
  root.dataset.screen = screen;
  fill(root, data || {});
  wire(root);
}

// Every [data-field] is replaced by the matching key. Values are written with
// textContent, never innerHTML: an engine version or a provider's error text
// is data, and some of it comes from a subprocess.
function fill(root, data) {
  root.querySelectorAll('[data-field]').forEach((node) => {
    const value = data[node.dataset.field];
    if (value !== undefined && value !== null) node.textContent = String(value);
  });
  // A section that only makes sense when its field has a value -- the engine
  // version is empty on every machine where the engine never installed, and
  // its separator would otherwise render as a trailing " · ".
  root.querySelectorAll('[data-when]').forEach((node) => {
    node.hidden = !data[node.dataset.when];
  });
}

function wire(root) {
  root.querySelectorAll('[data-action]').forEach((node) => {
    node.addEventListener('click', () => ACTIONS[node.dataset.action](node));
  });
}

const ACTIONS = {
  'open-omelet': () => api().open_omelet(),
  'go-home': () => refresh(),
};

// Ships visible and honest rather than hidden: the board has the tile, and
// there is no update backend behind it yet.
ACTIONS['check-updates'] = async () => show('updates-unavailable', await api().home());

// Rows the install screen fills from start_install()'s row list, keyed by
// step name so a pushed 'step' event can find its <li> again. Rebuilt only
// when a fresh install starts, never on a screen swap.
let rowsByName = {};

ACTIONS['start-install'] = async (node, data) => {
  const started = await api().start_install();
  rowsByName = {};
  show('install:running', Object.assign({ counter: '' }, data));
  const list = document.querySelector('[data-rows]');
  started.rows.forEach((row) => {
    const li = document.createElement('li');
    li.className = 'row-step';
    li.dataset.status = 'waiting';
    li.innerHTML = '<span class="mark"></span><span class="label"></span><span class="state"></span>';
    li.querySelector('.label').textContent = row.label;
    li.querySelector('.state').textContent = 'Waiting';
    list.appendChild(li);
    rowsByName[row.name] = li;
  });
  // "Step N of M" comes from the list the factory returned, never a literal:
  // seven on Lima, nine on WSL2.
  window.omelet.total = started.rows.length;
  window.omelet.done = 0;
};

ACTIONS['reboot-now'] = () => api().reboot_now();

const STATE_WORDS = {
  running: 'Working…', done: 'Done', skipped: 'Done',
  failed: "Didn't work", reboot: 'Needs restart',
};

window.omelet.handlers.install = (event) => {
  if (event.type === 'step') {
    const li = rowsByName[event.step];
    if (li) {
      li.dataset.status = event.status;
      li.querySelector('.state').textContent = STATE_WORDS[event.status] || '';
    }
    if (event.status === 'done' || event.status === 'skipped') {
      window.omelet.done += 1;
      const counter = document.querySelector('[data-field="counter"]');
      if (counter) {
        counter.textContent = `Step ${window.omelet.done + 1} of ${window.omelet.total}`;
      }
    }
    if (event.fraction !== null && event.fraction !== undefined) {
      const bar = document.querySelector('[data-field="fraction"]');
      if (bar) bar.style.width = `${Math.round(event.fraction * 100)}%`;
    }
    return;
  }
  if (event.type === 'done') return refresh();
  if (event.type === 'reboot') return swap('install:reboot');
  if (event.type === 'failed' || event.type === 'dead_end') {
    swap('install:failed', { action: event.action || event.message });
    // DeadEnd means no code can fix it; a retry button there loops forever.
    if (event.type === 'dead_end') {
      document.querySelector('[data-retry]')?.remove();
    }
  }
};

// Swap the left column without rebuilding the row panel, so the rows keep the
// states the stream already put on them.
function swap(screen, data) {
  const rows = document.querySelector('[data-rows]');
  const keep = rows ? rows.cloneNode(true) : null;
  show(screen, data);
  if (keep) document.querySelector('[data-rows]').replaceWith(keep);
}

ACTIONS['start-over'] = async () => { await api().reset_install(); refresh(); };

// Wired in later milestones; present so a click is inert rather than fatal.
// Covers every action name the app will ever use, not just this task's
// screens, so a later template landing without its handler yet still clicks
// safely. 'uninstall' is deliberately left to this same fallback: its real
// handler shows 'uninstall-confirm', a template a later task adds.
['stop-vm', 'start-vm', 'restart-vm', 'doctor', 'repair',
 'import', 'ports', 'uninstall', 'do-import', 'choose-folder',
 'add-port-row', 'do-uninstall']
  .forEach((name) => { if (!ACTIONS[name]) ACTIONS[name] = () => {}; });

async function refresh() {
  const home = await api().home();
  document.title = 'Omelet';
  // A window RunOnce reopened by itself must continue setup, not show Home.
  if (home.resumed) return ACTIONS['start-install'](null, home);
  if (home.first_run) return show('first-run', home);
  show(home.route === 'unreachable' ? 'unreachable' : `home:${home.state}`, home);
}

window.addEventListener('pywebviewready', refresh);
