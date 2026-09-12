import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';

// Packaging checks against the real build output. The gateway serves web/dist
// behind a fixed CSP, so these assert the things that would ship a blank page
// or a stale-data bug rather than a visible test failure.
const dist = join(import.meta.dirname, '..', 'dist');
const built = existsSync(join(dist, 'index.html'));
const read = (p: string) => readFileSync(join(dist, p), 'utf8');

describe('web/dist packaging', () => {
  it('has been built (run `npm run build` first)', () => {
    expect(built, 'web/dist/index.html is missing - run `npm run build`').toBe(true);
  });

  // The gateway sends script-src 'self' with no 'unsafe-inline' for '/' and
  // '/assets/'. Any inline script -- including Vite's module preload polyfill --
  // is blocked outright, which shows up as a blank page and no error.
  it('ships no inline script, matching the gateway CSP', () => {
    const html = read('index.html');
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(m => m[2]!.trim().length > 0);
    expect(inline.map(m => m[0])).toEqual([]);
    expect(html).toMatch(/<script type="module"[^>]+src="\/assets\//);
  });

  it('loads styles from a file rather than a blocked inline <style>', () => {
    expect(read('index.html')).toMatch(/<link rel="stylesheet"[^>]+href="\/assets\//);
  });

  it('references only same-origin assets, which connect-src and script-src allow', () => {
    const external = [...read('index.html').matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)];
    expect(external.map(m => m[0])).toEqual([]);
  });

  it('ships the installable manifest and both icon sizes', () => {
    const manifest = JSON.parse(read('manifest.webmanifest'));
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    const sizes = manifest.icons.map((i: {sizes: string}) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((i: {purpose?: string}) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) expect(existsSync(join(dist, icon.src.replace(/^\//, '')))).toBe(true);
  });

  // Caching an owner-scoped API response would let one person's data survive a
  // sign-out and reappear for the next.
  it('never lets the service worker cache gateway data', () => {
    const sw = read('sw.js');
    expect(sw).toContain("url.pathname.startsWith('/api/')");
    expect(sw).toContain("url.pathname === '/livekit-token'");
  });

  it('keeps the first load small enough for a phone on mobile data', () => {
    const entry = readdirSync(join(dist, 'assets')).filter((f: string) => f.startsWith('index-') && f.endsWith('.js'));
    expect(entry).toHaveLength(1);
    const bytes = readFileSync(join(dist, 'assets', entry[0]!)).byteLength;
    // The realtime SDK is a separate chunk fetched only when a conversation
    // starts; if it ever collapses back into the entry this jumps ~20x.
    expect(bytes).toBeLessThan(120_000);
  });
});
