# Testing

Everything below was run in this checkout. Where a result depends on a
credential this environment does not have, that is stated rather than implied.

## What runs without any credential

```bash
cd gateway && npm ci && npx tsc --noEmit && npm test     # 97 tests
cd web     && npm ci && npm run verify                   # build + 92 tests
```

`npm run verify` in `web/` builds first on purpose: the packaging tests read the
real `web/dist` output rather than a description of it.

Without `HERMES_CHECKOUT` the gateway suite reports 96 passed and 1 skipped --
the skipped one is the Hermes subprocess test. Nothing else needs a credential,
including the Anthropic runtime tests (see below).

## Running the Hermes tests

The Hermes tests drive the official runtime in a real subprocess. Install it and
point the two variables at the installation:

```bash
python3 -m venv .hermes-venv
./.hermes-venv/bin/pip install hermes-agent==0.19.0
export HERMES_CHECKOUT="$(./.hermes-venv/bin/python -c 'import sysconfig;print(sysconfig.get_paths()["purelib"])')"
export HERMES_PYTHON="$PWD/.hermes-venv/bin/python"
cd gateway && npm test                                   # 97 passed, 0 skipped
```

`HERMES_CHECKOUT` must be the directory containing `run_agent.py`; for a pip
install that is the environment's `site-packages`. The runtime talks to a local
OpenAI-compatible fixture, so no model credential is used.

Version under test: **hermes-agent 0.19.0**.

## Verifying the Anthropic runtime

`tests/managed.test.ts` drives the preserved Anthropic Managed Agents path end
to end. The gateway uses the real `@anthropic-ai/sdk`; only the far end is a
fixture that speaks the Managed Agents wire protocol over loopback, selected
with `ANTHROPIC_BASE_URL`. Provisioning, the session tool slate, the SSE event
drain, the custom-tool round trip, approvals and cancellation all run for real.

```bash
cd gateway && npm test -- tests/managed.test.ts           # 7 passed
```

No credential is used and nothing leaves the machine. What it establishes:

- one shared agent and environment, one vault and session per owner, and the
  model, system prompt and toolsets living on the **agent** -- a session that
  carried its own model would silently diverge from it;
- an unchanged app surface does not bump the agent version on every task;
- the hosted agent's own toolsets are forced to `always_ask`, the gateway's
  capabilities are added as custom tools, and the employee's standing
  instructions travel as the one `system.message` the API allows;
- a governed read runs and its result is returned on the tool channel, with a
  receipt stored against the run;
- a financial action stops the run at `needs_user`, tells the hosted agent
  nothing until the owner decides, and is charged only after approval;
- a declined action is never executed and the refusal is returned to the model,
  so it reports the refusal instead of inventing a delivered result;
- built-in and MCP tool confirmations are answered by policy, not by the model:
  a shell and an unlisted MCP write are denied, a listed read is allowed, and
  every decision is recorded against the run;
- an action left pending by a previous process is answered as an error and
  never replayed under a new run;
- cancelling interrupts the hosted session and closes the stream rather than
  leaving it draining;
- a missing `ANTHROPIC_API_KEY` refuses before any hosted call is made.

These tests were checked by mutation: weakening the `always_ask` policy,
removing the approval gate, auto-allowing hosted built-ins and dropping the
stale-action error flag each fail exactly the test that covers them.

What this does **not** establish: that Anthropic's own service behaves as
documented, or that a real key works. That is one `deploy/doctor.sh` run away
on a machine that has one.

## End-to-end

Drives the built PWA in Chromium against a real gateway process -- real
database, run queue, tool gateway, approval gate and Hermes subprocess. Only the
model is a fixture, so assertions are about system behaviour rather than a live
model's wording.

Chromium supplies a synthetic camera and microphone, so the capture path runs
for real: `getUserMedia`, a live preview, freeze-frame as track mute, and a
still that travels to the gateway as owned evidence. `getUserMedia` exists only
in a secure context, which `http://127.0.0.1` is, so this is the same path a
phone takes over https.

Covered: sign-in and session hardening; a governed task through the runtime;
camera capture to evidence; honest degradation with no realtime credentials;
the approval gate; cancellation; a task surviving the page being closed
mid-flight; isolation between two signed-in owners; idempotency, CSRF and
sign-out.

```bash
cd web && npm run build
cd web && npm run e2e                                    # 90 checks
```

Needs `HERMES_CHECKOUT` and `HERMES_PYTHON` as above; it exits 2 with
instructions if they are missing. `CHROMIUM_PATH` overrides the browser binary.

The suite is timing-sensitive on a loaded machine. Of three runs here, two
passed 90/90 and one stopped at 52/53, having waited the full 150s for the
Hermes subprocess to return supplier results while other suites were running.
Nothing in the gateway or the client differed between those runs. Treat a
single timeout on a busy machine as a result to reproduce on an idle one, not
as a pass.

## Current results

| Suite | Command | Result |
|---|---|---|
| Gateway typecheck | `npx tsc --noEmit` | clean |
| Gateway tests | `npm test` | 97 passed, 0 failed, 0 skipped (11 files) |
| Web typecheck + build | `npm run build` | clean; entry 34.8 kB, 11.7 kB gzipped |
| Web tests | `npm test` | 92 passed (8 files) |
| End-to-end | `npm run e2e` | 90 passed |

`npm run lint` in `gateway/` (prettier --check) fails on 30 files. It already
failed on 20 at the `a62fb16` checkpoint, before any of this work: the
codebase's deliberate dense style does not match its own prettier config.
Reformatting it is a separate decision, so new files follow the surrounding
style and are reported too.

## Acceptance criteria

Labels are the handoff's: **VERIFIED**, **BLOCKED ON OWNER CREDENTIAL**,
**SCAFFOLDED**, **NOT IMPLEMENTED**.

| # | Criterion | Status |
|---|---|---|
| 1 | Phone visual question through the realtime layer, spoken result | IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL — camera capture, freeze and upload are verified in a browser; the realtime conversation needs LiveKit and realtime model credentials. With none configured the gateway answers 503 and the app says so instead of offering a dead control (verified) |
| 2 | Visual context → execute → gateway → runtime → governed tool → evidence | IMPLEMENTED + VERIFIED (e2e) — a still captured from a live camera through `getUserMedia` becomes an owned artifact, is attached as authorised context, and the run completes through Hermes with an evidence link |
| 3 | Long task acknowledged fast, survives disconnect, completes later | IMPLEMENTED + VERIFIED (e2e) — acknowledged while still running, the page and its whole context are closed mid-task, the task completes with no client attached, and the result is present and on screen after reconnecting |
| 4 | Cancellation prevents hidden continuation | IMPLEMENTED + VERIFIED (e2e, `core.test.ts`, `permissions.test.ts`) — stopping marks it cancelled at once, and after the model would have finished it is still cancelled with no result and no artifact |
| 5 | Hermes selection, Codex through Hermes, controlled fixture | Hermes: IMPLEMENTED + VERIFIED against the official runtime (hermes-agent 0.19.0) in a real subprocess. Codex: IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL — only the credential boundary is verified (`parity.test.ts`), not the provider path |
| 6 | SMS draft / approval / send / inbound status | Contract IMPLEMENTED + VERIFIED against fixtures (`communications.test.ts`): nothing reaches the provider before approval, the approval names the exact destination and text, a changed destination is refused, an uncertain send is never retried, and inbound webhooks are signature-checked, deduplicated and framed as untrusted. Live Twilio: BLOCKED ON OWNER CREDENTIAL |
| 7 | Outbound call objective / status / transcript / outcome | Contract IMPLEMENTED + VERIFIED against fixtures (`communications.test.ts`): approval names the objective, the webhook is signature-verified, applied once across duplicates and refused when its timestamp is stale. Live Retell: BLOCKED ON OWNER CREDENTIAL |
| 8 | Multi-supplier comparison with timestamped offers | IMPLEMENTED + VERIFIED against fixtures and end to end (`suppliers.test.ts`, `offers.test.ts`, e2e): every connected supplier is searched in parallel, one failing never erases the others, offers normalize into one model, a total is withheld when a component is unquoted, and the phone names who was not included. Live supplier accounts: BLOCKED ON OWNER CREDENTIAL |
| 9 | Purchase approval blocks unauthorised checkout | IMPLEMENTED + VERIFIED (`permissions.test.ts`) — a decision is bound to the exact arguments, "always allow" is refused for financial effects, and cancelling during checkout preflight prevents the order |
| 10 | Unauthorised access returns 403/404 without leaking | IMPLEMENTED + VERIFIED (e2e two-owner run, `http.test.ts`, `security.test.ts`) — a second signed-in owner sees none of the first's records, gets 404 for their task and artifact content, and cannot cancel their task |
| 11 | Reconnect does not duplicate messages, calls or purchases | IMPLEMENTED + VERIFIED for run submission (idempotency key, e2e), for uncertain external effects (`permissions.test.ts`), for message sends (`communications.test.ts`: the provider is called once and never again on its own), and for the event stream (`realtime.test.ts`: reconnect resumes from the last event rather than replaying). Duplicate suppression against a live provider: BLOCKED ON OWNER CREDENTIAL |
| 12 | Phone fully usable without glasses | IMPLEMENTED + VERIFIED — the PWA has no glasses dependency; the whole e2e run is a phone viewport with a phone user agent |

### Adapters

| Adapter | Status |
|---|---|
| Hermes runtime | IMPLEMENTED + VERIFIED against the official runtime in a subprocess |
| Anthropic Managed Agents | IMPLEMENTED + VERIFIED end to end against a protocol fixture over loopback (`managed.test.ts`, 7 checks): provisioning shape, governed tool slate, approval gate, refusal, policy-answered confirmations, stale-action handling and cancellation. Live Anthropic account: BLOCKED ON OWNER CREDENTIAL |
| Twilio SMS | Contract VERIFIED against fixtures; live account BLOCKED ON OWNER CREDENTIAL |
| Retell voice | Contract VERIFIED against fixtures; live account BLOCKED ON OWNER CREDENTIAL |
| Home Depot / Lowe's / Amazon / Walmart | Adapter, mapping, fulfillment and failure handling VERIFIED against fixtures; live accounts BLOCKED ON OWNER CREDENTIAL |
| Local and specialty suppliers | VERIFIED — configured through `SUPPLIER_CONFIG_PATH` and exercised end to end against a live local endpoint |
| eBay | Optional only; VERIFIED that it is not constructed unless `EBAY_ENABLED=true`, even with credentials present. Live account BLOCKED ON OWNER CREDENTIAL |
| Browser Use | Approval gate, unconfigured refusal, cancel, cleanup and cross-owner safety VERIFIED; live account BLOCKED ON OWNER CREDENTIAL |
| MCP connectors | Config handling, https-only, owner scoping, credential requirement and the checkout-tool prohibition VERIFIED; a live connector BLOCKED ON OWNER CREDENTIAL |
| Deployment packaging | IMPLEMENTED + VERIFIED locally — the gateway serves the built PWA, warns when it is missing, and `/health` stays up. The container image is NOT built here: this sandbox has a docker client but no daemon |

## What no test here can establish

Live camera, microphone and realtime conversation need a real phone and
configured credentials. Every provider integration is exercised against a
fixture, which proves the contract the gateway enforces, not that the provider
behaves as documented. The container image is not built here: this sandbox has a
docker client but no daemon.
