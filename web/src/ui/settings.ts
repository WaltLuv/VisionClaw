import {api} from '../api';
import {h} from '../dom';
import {ACCESS_METHOD_LABEL} from '../store';
import type {Ctx} from './ctx';

/**
 * Suppliers are a list, not a single on/off capability. Which ones are
 * connected decides how complete any price comparison can be, so the set is
 * shown plainly rather than reduced to "shopping: ready".
 */
function suppliersCard(ctx: Ctx): HTMLElement {
  const suppliers = ctx.connections?.suppliers ?? [];
  const connected = suppliers.filter(s => s.connected);
  return h('section', {class: 'card'},
    h('h3', {text: 'Suppliers'}),
    h('p', {class: 'note', text: connected.length
      ? `${connected.length} of ${suppliers.length} connected. Every search asks all connected suppliers at once.`
      : 'No suppliers connected yet. Prices cannot be compared until at least one is.'}),
    ...suppliers.map(s => h('div', {class: 'row-item'},
      h('p', {class: 'task', text: s.name}),
      h('span', {class: `pill ${s.connected ? 'ok' : 'warn'}`, text: s.connected ? ACCESS_METHOD_LABEL[s.method] : 'Not connected'}),
      s.connected ? null : h('p', {class: 'note', text: `Needs ${s.requires.join(', ')}`}))),
  );
}

// Capabilities are described by what they let the employee do. Provider and
// model names stay out of the product surface: which engine runs the work is a
// server-side decision, and naming vendors here would invite the impression it
// is a user setting.
const CAPABILITIES: {key: 'realtime' | 'sms' | 'voice' | 'browser'; label: string; blurb: string}[] = [
  {key: 'realtime', label: 'Voice and camera conversation', blurb: 'Talk to it and let it see what you see.'},
  {key: 'sms', label: 'Text messages', blurb: 'Drafts a message and sends it only after you approve.'},
  {key: 'voice', label: 'Phone calls', blurb: 'Places a call with an objective you approve first.'},

  {key: 'browser', label: 'Using a browser', blurb: 'Works through sites on your behalf, with the session under your control.'},
];

let installPrompt: (Event & {prompt(): Promise<void>}) | null = null;
window.addEventListener('beforeinstallprompt', e => {e.preventDefault(); installPrompt = e as Event & {prompt(): Promise<void>};});

export function settings(ctx: Ctx): HTMLElement {
  const c = ctx.connections;
  const engineReady = !!c && (c.hermes || c.anthropic);

  return h('div', {class: 'screen'},
    h('section', {class: 'card'},
      h('h3', {text: 'This device'}),
      h('p', {class: 'note', text: `Signed in as ${ctx.owner}.`}),
      installPrompt ? h('button', {class: 'primary', onclick: async () => {await installPrompt?.prompt(); installPrompt = null; ctx.rerender();}}, 'Add to home screen') : h('p', {class: 'note', text: 'Add this page to your home screen from your browser menu to use it like an app.'}),
      h('p', {class: 'note', text: ctx.streamOnline ? 'Connected to your employee.' : 'Offline. Anything you send will fail until the connection returns.'}),
    ),
    h('section', {class: 'card'},
      h('h3', {text: 'What it can do'}),
      h('div', {class: 'row-item'},
        h('p', {class: 'task', text: 'Carrying out tasks'}),
        h('span', {class: `pill ${engineReady ? 'ok' : 'warn'}`, text: engineReady ? 'Ready' : 'Not set up'})),
      ...CAPABILITIES.map(cap => h('div', {class: 'row-item'},
        h('p', {class: 'task', text: cap.label}),
        h('span', {class: `pill ${c?.[cap.key] ? 'ok' : 'warn'}`, text: c?.[cap.key] ? 'Ready' : 'Not set up'}),
        h('p', {class: 'note', text: cap.blurb}))),
      c?.mcp?.length ? h('p', {class: 'note', text: `Connected tools: ${c.mcp.map(m => m.id).join(', ')}`}) : null,
      // The gateway reports a tool-config problem here; it is an operator fault,
      // not something the person did, so it is phrased that way.
      c?.mcpError ? h('p', {class: 'note', text: 'Some connected tools are misconfigured on the server.'}) : null,
    ),
    suppliersCard(ctx),
    h('section', {class: 'card'},
      h('h3', {text: 'Account'}),
      h('div', {class: 'row wrap'},
        h('button', {class: 'ghost', onclick: () => void ctx.signOut()}, 'Sign out'),
        h('button', {class: 'ghost danger', onclick: () => void wipe(ctx)}, 'Delete everything'),
      ),
      h('p', {class: 'note', text: 'Deleting removes your tasks, files, memory and conversations from the server. It cannot be undone.'}),
    ),
  );
}

async function wipe(ctx: Ctx) {
  if (!confirm('Delete all of your tasks, files, memory and conversations? This cannot be undone.')) return;
  try {
    await api.deleteEverything();
    location.reload();
  } catch (err) {
    ctx.toast(err instanceof Error ? err.message : 'That could not be deleted.');
  }
}
