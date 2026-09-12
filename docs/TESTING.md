# Testing

Everything below was run in this checkout. Where a result depends on a
credential this environment does not have, that is stated rather than implied.

## What runs without any credential

```bash
cd gateway && npm ci && npx tsc --noEmit && npm test     # 49 tests
cd web     && npm ci && npm run verify                   # build + 70 tests
```

`npm run verify` in `web/` builds first on purpose: the packaging tests read the
real `web/dist` output rather than a description of it.

Without `HERMES_CHECKOUT` the gateway suite reports 48 passed and 1 skipped --
the skipped one is the Hermes subprocess test.

## Running the Hermes tests

The Hermes tests drive the official runtime in a real subprocess. Install it and
point the two variables at the installation:

```bash
python3 -m venv .hermes-venv
./.hermes-venv/bin/pip install hermes-agent==0.19.0
export HERMES_CHECKOUT="$(./.hermes-venv/bin/python -c 'import sysconfig;print(sysconfig.get_paths()["purelib"])')"
export HERMES_PYTHON="$PWD/.hermes-venv/bin/python"
cd gateway && npm test                                   # 49 passed, 0 skipped
```

`HERMES_CHECKOUT` must be the directory containing `run_agent.py`; for a pip
install that is the environment's `site-packages`. The runtime talks to a local
OpenAI-compatible fixture, so no model credential is used.

Version under test: **hermes-agent 0.19.0**.

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
cd web && npm run e2e                                    # 54 checks
```

Needs `HERMES_CHECKOUT` and `HERMES_PYTHON` as above; it exits 2 with
instructions if they are missing. `CHROMIUM_PATH` overrides the browser binary.

## Current results

| Suite | Command | Result |
|---|---|---|
| Gateway typecheck | `npx tsc --noEmit` | clean |
| Gateway tests | `npm test` | 49 passed, 0 failed, 0 skipped (9 files) |
| Web typecheck + build | `npm run build` | clean; entry 27 kB, 9 kB gzipped |
| Web tests | `npm test` | 70 passed (6 files) |
| End-to-end | `npm run e2e` | 54 passed |

`npm run lint` in `gateway/` (prettier --check) fails on 25 files. It already
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
| 8 | Procurement comparison with timestamped offers | IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL (eBay). Ownership, exact-quote and re-pricing rules verified in `permissions.test.ts`; a connector cannot expose its own checkout tools as ordinary tools (`adapters.test.ts`) |
| 9 | Purchase approval blocks unauthorised checkout | IMPLEMENTED + VERIFIED (`permissions.test.ts`) — a decision is bound to the exact arguments, "always allow" is refused for financial effects, and cancelling during checkout preflight prevents the order |
| 10 | Unauthorised access returns 403/404 without leaking | IMPLEMENTED + VERIFIED (e2e two-owner run, `http.test.ts`, `security.test.ts`) — a second signed-in owner sees none of the first's records, gets 404 for their task and artifact content, and cannot cancel their task |
| 11 | Reconnect does not duplicate messages, calls or purchases | IMPLEMENTED + VERIFIED for run submission (idempotency key, e2e), for uncertain external effects (`permissions.test.ts`), for message sends (`communications.test.ts`: the provider is called once and never again on its own), and for the event stream (`realtime.test.ts`: reconnect resumes from the last event rather than replaying). Duplicate suppression against a live provider: BLOCKED ON OWNER CREDENTIAL |
| 12 | Phone fully usable without glasses | IMPLEMENTED + VERIFIED — the PWA has no glasses dependency; the whole e2e run is a phone viewport with a phone user agent |

### Adapters

| Adapter | Status |
|---|---|
| Hermes runtime | IMPLEMENTED + VERIFIED against the official runtime in a subprocess |
| Anthropic Managed Agents | IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL — preserved; governance (always_ask toolsets, listed reads only) and its unconfigured refusal verified in `parity.test.ts` |
| Twilio SMS | Contract VERIFIED against fixtures; live account BLOCKED ON OWNER CREDENTIAL |
| Retell voice | Contract VERIFIED against fixtures; live account BLOCKED ON OWNER CREDENTIAL |
| eBay procurement | Contract VERIFIED against fixtures; live account BLOCKED ON OWNER CREDENTIAL |
| Browser Use | Approval gate, unconfigured refusal, cancel, cleanup and cross-owner safety VERIFIED; live account BLOCKED ON OWNER CREDENTIAL |
| MCP connectors | Config handling, https-only, owner scoping, credential requirement and the checkout-tool prohibition VERIFIED; a live connector BLOCKED ON OWNER CREDENTIAL |
| Deployment packaging | IMPLEMENTED + VERIFIED locally — the gateway serves the built PWA, warns when it is missing, and `/health` stays up. The container image is NOT built here: this sandbox has a docker client but no daemon |

## What no test here can establish

Live camera, microphone and realtime conversation need a real phone and
configured credentials. Every provider integration is exercised against a
fixture, which proves the contract the gateway enforces, not that the provider
behaves as documented. The container image is not built here: this sandbox has a
docker client but no daemon.
