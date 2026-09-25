import {afterEach, describe, expect, it, vi} from 'vitest';
import {api, type Computer, type State} from '../src/api';
import {closeLive, updateLive, watchBrowser} from '../src/ui/live';
import type {Ctx} from '../src/ui/ctx';

// The live browser screen. The rules that matter:
//  - the embedded view is never reloaded by an update that doesn't change it;
//  - the cover over it comes down only when the server says the owner has
//    control -- never on the tap alone;
//  - when the job ends, the view is let go.

const LIVE = 'https://live.browser-use.com/view?s=1';
function harness(computer: Partial<Computer>) {
  const toasts: string[] = [];
  const ctx = {
    state: {computer: [{id: 'c1', runId: 'r1', task: 'Find the part', status: 'working', control: 'agent', liveEmbed: LIVE, ...computer}]} as unknown as State,
    toast: (m: string) => toasts.push(m),
    refresh: async () => {updateLive(ctx);},
  } as unknown as Ctx;
  const set = (patch: Partial<Computer>) => {ctx.state.computer[0] = {...ctx.state.computer[0]!, ...patch}; updateLive(ctx);};
  return {ctx, toasts, set};
}
const q = <T extends Element>(s: string) => document.querySelector<T>(s)!;
const visible = (s: string) => !q<HTMLElement>(s).hidden;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.live button')].find(b => b.textContent === label)!;

afterEach(() => {closeLive(); vi.restoreAllMocks();});

describe('live browser screen', () => {
  it('shows the live view behind a cover while the employee drives', () => {
    const {ctx} = harness({});
    watchBrowser(ctx, 'c1');
    expect(visible('.live')).toBe(true);
    expect(q<HTMLIFrameElement>('.live-frame').src).toBe(LIVE);
    expect(q<HTMLIFrameElement>('.live-frame').getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(q<HTMLIFrameElement>('.live-frame').getAttribute('allow')).toBe('autoplay');
    expect(visible('.live-shield')).toBe(true);
    expect(button('Take over').hidden).toBe(false);
    expect(button('Hand back').hidden).toBe(true);
    expect(button('Stop').hidden).toBe(false);
  });

  it('never reloads the view on updates that do not change it', async () => {
    const {ctx, set} = harness({});
    watchBrowser(ctx, 'c1');
    const frame = q<HTMLIFrameElement>('.live-frame');
    const changes: MutationRecord[] = [];
    const watcher = new MutationObserver(m => changes.push(...m));
    watcher.observe(frame, {attributes: true, attributeFilter: ['src']});
    for (let i = 0; i < 5; i++) updateLive(ctx);
    set({task: 'Find the part (still going)'});
    await Promise.resolve();
    expect(changes).toHaveLength(0);
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    set({liveEmbed: LIVE + '&tab=2'});
    await Promise.resolve();
    expect(changes).toHaveLength(1);
    watcher.disconnect();
  });

  it('takes the cover away only once the server says you have control', async () => {
    const {ctx, set} = harness({});
    let answer!: (v: Pick<Computer, 'id' | 'status' | 'control'>) => void;
    const takeOver = vi.spyOn(api, 'takeOver').mockReturnValue(new Promise(r => {answer = r;}));
    watchBrowser(ctx, 'c1');
    button('Take over').click();
    await vi.waitFor(() => expect(takeOver).toHaveBeenCalledWith('c1'));
    // While the provider has not yet paused the employee, the page stays covered.
    expect(visible('.live-shield')).toBe(true);
    expect(button('Take over').disabled).toBe(true);
    answer({id: 'c1', status: 'working', control: 'owner'});
    await vi.waitFor(() => expect(button('Take over').disabled).toBe(false));
    expect(visible('.live-shield')).toBe(true);   // state has not said so yet
    set({control: 'owner'});
    expect(visible('.live-shield')).toBe(false);
    expect(button('Hand back').hidden).toBe(false);
    expect(button('Take over').hidden).toBe(true);
    expect(q('.live-status').textContent).toMatch(/You're in control/);
    expect(q('.live-foot .note').textContent).toMatch(/Anything you type goes to that website/);
  });

  it('a refused take-over keeps the cover and says why', async () => {
    const {ctx, toasts} = harness({});
    vi.spyOn(api, 'takeOver').mockRejectedValue(new Error("Couldn't pause the browser, so your employee is still driving. Try again, or stop it."));
    watchBrowser(ctx, 'c1');
    button('Take over').click();
    await vi.waitFor(() => expect(toasts).toHaveLength(1));
    expect(toasts[0]).toMatch(/still driving/);
    expect(visible('.live-shield')).toBe(true);
  });

  it('hand back calls the server and brings the cover back when it agrees', async () => {
    const {ctx, set} = harness({control: 'owner'});
    const handBack = vi.spyOn(api, 'handBack').mockResolvedValue({id: 'c1', status: 'working', control: 'agent'});
    watchBrowser(ctx, 'c1');
    expect(visible('.live-shield')).toBe(false);
    button('Hand back').click();
    await vi.waitFor(() => expect(handBack).toHaveBeenCalledWith('c1'));
    set({control: 'agent'});
    expect(visible('.live-shield')).toBe(true);
  });

  it('says which host is not allowed instead of showing a blank frame', () => {
    const {ctx} = harness({liveEmbed: null, liveHost: 'cdn.other.net'});
    watchBrowser(ctx, 'c1');
    expect(visible('.live-frame')).toBe(false);
    expect(q('.live-message').textContent).toContain('cdn.other.net');
    expect(button('Take over').hidden).toBe(true);
    expect(button('Stop').hidden).toBe(false);
  });

  it('lets the view go when the job ends, and Back closes the screen', () => {
    const {ctx, set} = harness({});
    watchBrowser(ctx, 'c1');
    set({status: 'completed', liveEmbed: undefined});
    expect(q<HTMLIFrameElement>('.live-frame').src).toBe('about:blank');
    expect(q('.live-status').textContent).toBe('Finished.');
    expect(button('Stop').hidden).toBe(true);
    button('← Back').click();
    expect(visible('.live')).toBe(false);
  });
});
