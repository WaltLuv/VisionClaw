// Process and browser lifecycle for the end-to-end run. Keeps the scenarios
// free of setup so each one reads as the behaviour it is checking.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
import {startModelFixture} from './model-fixture.mjs';

/**
 * Two owner-configured suppliers: one that answers and one that does not. The
 * pair is what makes a partial comparison real rather than asserted -- the
 * gateway has to keep the working supplier's offers and report the broken one.
 */
function startSupplierFixture() {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.startsWith('/northside')) {res.statusCode = 500; res.end('{"error":"down"}'); return;}
    res.end(JSON.stringify({results: [
      {code: 'RS-118', title: 'M6 bolt 20-pack stainless', link: 'https://riverside.example.test/p/RS-118', price: 7.4, ship: 0, taxes: 0.59, stock: 36, status: 'In stock', pickup: true, store: 'Riverside yard', pickupEta: 'Ready today', delivers: true, deliveryEta: 'Thu, 5 Jun'},
      {code: 'RS-992', title: 'M6 bolt assorted tub', link: 'https://riverside.example.test/p/RS-992', price: 21.5, ship: 4.5, taxes: 1.72, stock: 4, status: 'Low stock', pickup: false, delivers: true, deliveryEta: 'Fri, 6 Jun'},
    ]}));
  });
  server.listen(0);
  return new Promise(resolve => server.on('listening', () => resolve({server, port: server.address().port})));
}

const supplierMapping = {
  items: 'results', sku: 'code', product: 'title', url: 'link', unitPrice: 'price',
  shipping: 'ship', tax: 'taxes', fees: '', inventory: 'stock', availability: 'status',
  pickupAvailable: 'pickup', pickupLocation: 'store', pickupEta: 'pickupEta',
  deliveryAvailable: 'delivers', deliveryEta: 'deliveryEta', specification: '',
};

export const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(path.join(root, 'gateway/package.json'));
export const {chromium} = require('playwright');

export function reporter() {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({name, ok: !!ok, detail});
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  return {results, check};
}

// Polls deliberately slowly: the gateway rate-limits an owner to 240 requests a
// minute, and a tight loop over a long wait spends that budget on nothing.
export async function waitFor(fn, label, timeout = 45000, interval = 750) {
  const started = Date.now();
  for (;;) {
    try {if (await fn()) return true;} catch {/* keep polling */}
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await new Promise(r => setTimeout(r, interval));
  }
}

/**
 * A real gateway process with its real database, run queue, tool gateway and
 * approval gate, pointed at a local model fixture so the employee's decisions
 * are fixed and no provider credential is involved.
 */
export async function startStack({port, tokens}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'vc-e2e-'));
  const model = await startModelFixture();
  const supplier = await startSupplierFixture();
  const supplierConfig = path.join(dataDir, 'suppliers.json');
  writeFileSync(supplierConfig, JSON.stringify([
    {id: 'riverside_supply', name: 'Riverside Building Supply', method: 'partner_api',
     endpoint: `http://127.0.0.1:${supplier.port}/riverside?q={query}`,
     auth: {type: 'bearer', env: 'RIVERSIDE_TOKEN'}, mapping: supplierMapping},
    {id: 'northside_lumber', name: 'Northside Lumber', method: 'partner_api',
     endpoint: `http://127.0.0.1:${supplier.port}/northside?q={query}`,
     auth: {type: 'bearer', env: 'NORTHSIDE_TOKEN'}, mapping: supplierMapping},
  ]));
  const gateway = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
    cwd: path.join(root, 'gateway'),
    env: {
      ...process.env,
      PORT: String(port),
      GATEWAY_TOKENS: tokens,
      STORE_PATH: path.join(dataDir, 'gateway-store.json'),
      EMPLOYEE_DATA_DIR: dataDir,
      STATE_SECRET: 'e2e-only-not-a-secret',
      AGENT_RUNTIME: 'hermes',
      HERMES_PROVIDER: 'custom',
      HERMES_MODEL: 'fixture-model',
      HERMES_BASE_URL: `http://127.0.0.1:${model.port}/v1`,
      HERMES_API_KEY: 'fixture-only',
      ANTHROPIC_API_KEY: '',
      SUPPLIER_CONFIG_PATH: supplierConfig,
      RIVERSIDE_TOKEN: 'fixture-only',
      NORTHSIDE_TOKEN: 'fixture-only',
      SUPPLIER_TIMEOUT_MS: '4000',
      // eBay must stay out of the search even with this whole stack running.
      EBAY_CLIENT_ID: 'fixture-only',
      EBAY_CLIENT_SECRET: 'fixture-only',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  gateway.stdout.on('data', d => {log += d;});
  gateway.stderr.on('data', d => {log += d;});

  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`).catch(() => null))?.ok, 'gateway to start', 30000);

  return {
    base,
    tail: () => log.split('\n').slice(-6).join('\n'),
    async stop() {
      gateway.kill('SIGKILL');
      model.server.close();
      supplier.server.close();
      rmSync(dataDir, {recursive: true, force: true});
    },
  };
}

/**
 * Chromium with synthetic camera and microphone. getUserMedia only exists in a
 * secure context, which http://127.0.0.1 is, so the real capture path runs
 * exactly as it would on a phone over https.
 */
export function launchBrowser() {
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
}

const PHONE = {
  viewport: {width: 390, height: 844},
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  permissions: ['camera', 'microphone'],
};

export async function openPhone(browser, base) {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  const cspViolations = [];
  const pageErrors = [];
  page.on('console', m => {if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text());});
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(base, {waitUntil: 'networkidle'});
  return {context, page, cspViolations, pageErrors};
}

/** The bottom tab bar, addressed by role so it never collides with a button that happens to share its label. */
export const tab = (page, name) => page.getByRole('tab', {name, exact: true});

export async function signIn(page, token) {
  await page.locator('input[aria-label="Access code"]').fill(token);
  await page.locator('button:has-text("Sign in")').click();
  await waitFor(async () => await tab(page, 'Today').count() > 0, 'the app shell after sign-in');
}

/**
 * Read the gateway as the signed-in person, through the page's own session.
 * Returns null rather than throwing when the response is not JSON (a rate-limit
 * or an expired session), so a polling caller keeps waiting instead of failing
 * on a parse error that hides what actually happened.
 */
export const state = page => page.evaluate(async () => {
  // The gateway rate-limits by client address, so a long run of scenarios from
  // one machine can legitimately hit the ceiling. Waiting out the window is the
  // correct response to a 429; the limit is a feature, not something to raise
  // for the convenience of the test.
  for (let attempt = 0; attempt < 16; attempt++) {
    const res = await fetch('/api/state', {credentials: 'same-origin'});
    if (res.status === 429) {await new Promise(r => setTimeout(r, 5000)); continue;}
    try {return await res.json();} catch {return null;}
  }
  return null;
});
export const csrf = page => page.evaluate(async () => (await fetch('/api/session', {credentials: 'same-origin'})).json().then(s => s.csrf));
