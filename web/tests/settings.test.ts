import {describe, expect, it} from 'vitest';
import {settings} from '../src/ui/settings';
import type {Ctx} from '../src/ui/ctx';
import type {Connections, State} from '../src/api';

// Which engine carries out tasks is a server-side, per-owner choice. The phone
// must report on THAT engine: credentials for the other one do not make a task
// run, and "Ready" for an engine nobody selected is a lie the owner only finds
// out about when work fails.

const NO_CONNECTIONS: Connections = {
  realtime: false, hermes: false, anthropic: false, sms: false, voice: false,
  products: false, browser: false, suppliers: [], mcp: [],
};

function screen(runtime: 'hermes' | 'anthropic' | undefined, connections: Partial<Connections>) {
  const state = {agent: runtime ? [{id: 'a', runtime}] : [], run: [], skill: [], approval: [], artifact: []} as unknown as State;
  const ctx = {
    state, owner: 'owner', streamOnline: true,
    connections: {...NO_CONNECTIONS, ...connections},
    rerender() {}, toast() {}, async signOut() {},
  } as unknown as Ctx;
  const el = settings(ctx);
  const row = [...el.querySelectorAll('.row-item')].find(r => r.textContent?.includes('Carrying out tasks'))!;
  return {pill: row.querySelector('.pill')!.textContent, note: row.querySelector('.note')!.textContent, classes: row.querySelector('.pill')!.className};
}

describe('settings: who carries out tasks', () => {
  it('names the hosted engine and reports it ready when it is connected', () => {
    const {pill, note, classes} = screen('anthropic', {anthropic: true});
    expect(pill).toBe('Ready');
    expect(classes).toContain('ok');
    expect(note).toContain('Anthropic');
  });

  it('names the self-hosted engine and reports it ready when it is connected', () => {
    const {pill, note} = screen('hermes', {hermes: true});
    expect(pill).toBe('Ready');
    expect(note).toContain('your own server');
  });

  it('does not claim ready when only the engine this owner is NOT set to is connected', () => {
    const hosted = screen('anthropic', {hermes: true});
    expect(hosted.pill).toBe('Not set up');
    expect(hosted.classes).toContain('warn');
    expect(hosted.note).toContain('Anthropic');

    const local = screen('hermes', {anthropic: true});
    expect(local.pill).toBe('Not set up');
    expect(local.note).toContain('your own server');
  });

  it('falls back to the hosted engine before a profile has loaded', () => {
    expect(screen(undefined, {anthropic: true}).pill).toBe('Ready');
    expect(screen(undefined, {hermes: true}).pill).toBe('Not set up');
  });
});
