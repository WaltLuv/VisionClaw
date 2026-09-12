import './styles.css';
import {api, setCsrf, subscribe, type Connections, type State} from './api';
import {Camera} from './camera';
import {h, mount} from './dom';
import {emptyState} from './store';
import {RealtimeSession, type Card, type SessionState, type TranscriptEntry} from './realtime';
import type {Ctx, Tab} from './ui/ctx';
import {login} from './ui/login';
import {today} from './ui/today';
import {tasks} from './ui/tasks';
import {employee} from './ui/employee';
import {settings} from './ui/settings';

const root = document.getElementById('app')!;
let stopStream: (() => void) | null = null;

const ctx: Ctx = {
  state: emptyState(),
  connections: null,
  streamOnline: false,
  sessionState: 'idle',
  camera: new Camera(),
  cameraMultiple: false,
  transcript: [],
  cards: [],
  tab: 'today',
  busy: false,
  owner: '',
  session: null as unknown as RealtimeSession,
  go(tab) {ctx.tab = tab; render();},
  async refresh() {
    const [state, connections] = await Promise.all([api.state(), api.connections().catch(() => ctx.connections)]);
    ctx.state = state as State;
    ctx.connections = (connections ?? null) as Connections | null;
    render();
  },
  rerender: () => render(),
  toast,
  async signOut() {
    await api.logout().catch(() => {});
    stopStream?.();
    await ctx.session.disconnect().catch(() => {});
    ctx.camera.stop();
    location.reload();
  },
};

ctx.session = new RealtimeSession({
  onState(state: SessionState, detail?: string) {ctx.sessionState = state; ctx.sessionDetail = detail; render();},
  onTranscript(entry: TranscriptEntry) {
    // Segments arrive repeatedly as speech is refined; replace by id so an
    // interim line is corrected in place instead of duplicated.
    const at = ctx.transcript.findIndex(t => t.id === entry.id);
    if (at >= 0) ctx.transcript[at] = entry; else ctx.transcript.push(entry);
    render();
  },
  onCard(card: Card) {
    const at = ctx.cards.findIndex(c => c.uuid === card.uuid);
    if (at >= 0) ctx.cards[at] = card; else ctx.cards.push(card);
    render();
  },
  onDismissCard(uuid: string) {ctx.cards = ctx.cards.filter(c => c.uuid !== uuid); render();},
});

const TABS: {id: Tab; label: string}[] = [
  {id: 'today', label: 'Today'},
  {id: 'tasks', label: 'Tasks'},
  {id: 'employee', label: 'Employee'},
  {id: 'settings', label: 'Settings'},
];

function shell(): HTMLElement {
  const screen = ctx.tab === 'tasks' ? tasks(ctx) : ctx.tab === 'employee' ? employee(ctx) : ctx.tab === 'settings' ? settings(ctx) : today(ctx);
  return h('div', {class: 'app'},
    !ctx.streamOnline ? h('div', {class: 'banner', role: 'status', text: 'Offline — reconnecting…'}) : null,
    h('main', {class: 'main'}, screen),
    h('nav', {class: 'tabs', role: 'tablist'}, ...TABS.map(t =>
      h('button', {class: `tab ${ctx.tab === t.id ? 'on' : ''}`, role: 'tab', 'aria-selected': String(ctx.tab === t.id), onclick: () => ctx.go(t.id)}, t.label))),
  );
}

function render() {
  mount(root, shell());
}

function toast(message: string) {
  const node = h('div', {class: 'toast', role: 'status', text: message});
  document.body.append(node);
  setTimeout(() => node.remove(), 4000);
}

async function start(owner: string) {
  ctx.owner = owner;
  ctx.cameraMultiple = await ctx.camera.hasMultipleCameras();
  await ctx.refresh();
  stopStream = subscribe(
    event => {
      // The event says something changed and names the run; the authoritative
      // record is refetched rather than patched locally, so the UI can never
      // drift from the server's view of a run's status.
      if (event.type) void ctx.refresh();
    },
    online => {ctx.streamOnline = online; render();},
  );
  render();
}

async function boot() {
  mount(root, h('div', {class: 'screen centered'}, h('p', {class: 'note', text: 'Loading…'})));
  try {
    const session = await api.session();
    setCsrf(session.csrf);
    await start(session.owner);
  } catch {
    mount(root, login(owner => void start(owner)));
  }
}

// Registered from the built bundle, so it is an external script under the
// gateway's script-src 'self' policy.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

void boot();
