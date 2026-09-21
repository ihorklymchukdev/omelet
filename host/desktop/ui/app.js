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

// Wired in later milestones; present so a click is inert rather than fatal.
// Covers every action name the app will ever use, not just this task's
// screens, so a later template landing without its handler yet still clicks
// safely. 'uninstall' is deliberately left to this same fallback: its real
// handler shows 'uninstall-confirm', a template a later task adds.
['start-install', 'stop-vm', 'start-vm', 'restart-vm', 'doctor', 'repair',
 'import', 'ports', 'uninstall', 'check-updates', 'do-import', 'choose-folder',
 'add-port-row', 'do-uninstall', 'start-over', 'reboot-now']
  .forEach((name) => { if (!ACTIONS[name]) ACTIONS[name] = () => {}; });

async function refresh() {
  const home = await api().home();
  document.title = 'Omelet';
  if (home.first_run) return show('first-run', home);
  show(home.route === 'unreachable' ? 'unreachable' : `home:${home.state}`, home);
}

window.addEventListener('pywebviewready', refresh);
