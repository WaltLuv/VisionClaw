// End-to-end check of the real path: a browser loading the built PWA from the
// real gateway, signing in, assigning work, and watching it run through the
// selected runtime and a governed tool to a result with evidence on screen.
//
// Only the model is a fixture. The gateway, its database, the run queue, the
// tool gateway, the approval gate and the Hermes subprocess are the real ones.
//
// Requires: web/dist built, gateway deps installed, and HERMES_CHECKOUT +
// HERMES_PYTHON pointing at an installed official Hermes runtime.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startModelFixture} from './model-fixture.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(path.join(root, 'gateway/package.json'));
const {chromium} = require('playwright');

const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'e2e-access-code';

const results = [];
const check = (name, ok, detail = '') => {results.push({name, ok, detail}); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);};

const waitFor = async (fn, label, timeout = 45000) => {
  const started = Date.now();
  for (;;) {
    try {if (await fn()) return true;} catch {/* keep polling */}
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await new Promise(r => setTimeout(r, 250));
  }
};

if (!process.env.HERMES_CHECKOUT) {
  console.error('HERMES_CHECKOUT is not set. Install the official Hermes runtime and point HERMES_CHECKOUT at the\ndirectory containing run_agent.py (and HERMES_PYTHON at its interpreter). See docs/TESTING.md.');
  process.exit(2);
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'vc-e2e-'));
let model, gateway, browser;

try {
  model = await startModelFixture();

  gateway = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
    cwd: path.join(root, 'gateway'),
    env: {
      ...process.env,
      PORT: String(PORT),
      GATEWAY_TOKENS: `${TOKEN}:alice`,
      STORE_PATH: path.join(dataDir, 'gateway-store.json'),
      EMPLOYEE_DATA_DIR: dataDir,
      STATE_SECRET: 'e2e-only-not-a-secret',
      // Hermes is the runtime under test; the model it talks to is the local
      // fixture, so no provider credential is used anywhere in this run.
      AGENT_RUNTIME: 'hermes',
      HERMES_PROVIDER: 'custom',
      HERMES_MODEL: 'fixture-model',
      HERMES_BASE_URL: `http://127.0.0.1:${model.port}/v1`,
      HERMES_API_KEY: 'fixture-only',
      ANTHROPIC_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  gateway.stdout.on('data', d => {serverLog += d;});
  gateway.stderr.on('data', d => {serverLog += d;});

  await waitFor(async () => (await fetch(`${BASE}/health`).catch(() => null))?.ok, 'gateway to start', 30000);

  // The sandbox ships a Chromium that this Playwright build does not pin, so
  // use it explicitly rather than downloading a second copy.
  const executablePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  browser = await chromium.launch({executablePath, args: ['--no-sandbox']});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'});
  const page = await context.newPage();

  const cspViolations = [];
  page.on('console', m => {if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text());});
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.goto(BASE, {waitUntil: 'networkidle'});

  // 1. The built app actually boots under the gateway's CSP.
  check('PWA loads and renders under the gateway CSP', await page.locator('text=Sign in with the access code').count() > 0);
  check('no CSP violations while loading', cspViolations.length === 0, cspViolations[0] ?? '');
  check('no uncaught page errors while loading', pageErrors.length === 0, pageErrors[0] ?? '');

  // 2. Sign-in through the real cookie/CSRF flow.
  await page.locator('input[aria-label="Access code"]').fill(TOKEN);
  await page.locator('button:has-text("Sign in")').click();
  await waitFor(async () => await page.locator('button:has-text("Today")').count() > 0, 'the app shell after sign-in');
  check('signs in and reaches the phone shell', true);

  const cookies = await context.cookies();
  const sessionCookie = cookies.find(c => c.name === 'vc_session');
  check('session cookie is HttpOnly and SameSite=Strict', !!sessionCookie?.httpOnly && sessionCookie?.sameSite === 'Strict', sessionCookie ? `httpOnly=${sessionCookie.httpOnly} sameSite=${sessionCookie.sameSite}` : 'missing');
  check('access code is not persisted in the browser', await page.evaluate(t => !JSON.stringify({l: {...localStorage}, s: {...sessionStorage}}).includes(t), TOKEN));

  // 3. A typed task runs end to end through Hermes and a governed tool.
  await page.locator('textarea[aria-label="Ask or assign something"]').fill('Write a note about the shelf');
  await page.locator('button:has-text("Send")').click();

  await waitFor(async () => {
    await page.locator('button:has-text("Tasks")').click();
    return (await page.locator('text=Done').count()) > 0;
  }, 'the task to finish', 90000);
  check('task completes through the gateway, Hermes and a governed tool', true);

  const body = await page.locator('.screen').innerText();
  check('the result is shown on the phone', /note is saved as task evidence/i.test(body), body.slice(0, 120));
  check('tool evidence is listed with the task', /Create a document as task evidence|Site note/i.test(body));

  // 4. What the server actually recorded, read back through its own API.
  const state = await page.evaluate(async () => (await fetch('/api/state', {credentials: 'same-origin'})).json());
  const run = state.run[0];
  check('the run was recorded as completed', run?.status === 'completed', `status=${run?.status}`);
  check('the run was executed by the selected runtime', run?.runtime === 'hermes', `runtime=${run?.runtime}`);
  const action = state.action.find(a => a.name === 'document_create');
  check('the governed tool ran and was recorded', action?.status === 'completed', `action=${action?.status}`);
  check('an evidence artifact was stored', state.artifact.some(a => a.kind === 'document' || a.kind === 'tool_receipt'));

  // 5. Resubmitting the same idempotency key must not create a second run.
  const before = state.run.length;
  const replay = await page.evaluate(async csrf => {
    const send = () => fetch('/api/execute', {method: 'POST', credentials: 'same-origin', headers: {'content-type': 'application/json', 'x-csrf-token': csrf, 'idempotency-key': 'fixed-key'}, body: JSON.stringify({task: 'Say hello', context: {source: 'text', attachments: []}})}).then(r => r.json());
    const first = await send();
    const second = await send();
    return {first: first.id, second: second.id};
  }, await page.evaluate(async () => (await fetch('/api/session', {credentials: 'same-origin'})).json().then(s => s.csrf)));
  check('a repeated submission resolves to the same run, not a second one', replay.first === replay.second, `${replay.first} vs ${replay.second}`);

  // 6. CSRF is actually enforced for a cookie-authenticated mutation.
  const csrfStatus = await page.evaluate(async () => (await fetch('/api/execute', {method: 'POST', credentials: 'same-origin', headers: {'content-type': 'application/json', 'idempotency-key': 'no-csrf'}, body: JSON.stringify({task: 'Should be refused', context: {source: 'text', attachments: []}})})).status);
  check('a mutation without the CSRF token is refused', csrfStatus === 403, `status=${csrfStatus}`);

  const after = await page.evaluate(async () => (await fetch('/api/state', {credentials: 'same-origin'})).json());
  check('the refused request created no run', after.run.length === before + 1, `${before} -> ${after.run.length}`);

  // 7. Sign-out clears the session for good.
  await page.locator('button:has-text("Settings")').click();
  await page.locator('button:has-text("Sign out")').click();
  await waitFor(async () => (await page.evaluate(async () => (await fetch('/api/state', {credentials: 'same-origin'})).status)) === 401, 'the session to be revoked');
  check('signing out revokes the session server-side', true);

  console.log(`\n[server log tail]\n${serverLog.split('\n').slice(-6).join('\n')}`);
} finally {
  await browser?.close().catch(() => {});
  gateway?.kill('SIGKILL');
  model?.server.close();
  rmSync(dataDir, {recursive: true, force: true});
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} end-to-end checks passed`);
process.exit(failed.length ? 1 : 0);
