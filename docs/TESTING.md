# Testing

Everything below was run in this checkout. Where a result depends on a
credential this environment does not have, that is stated rather than implied.

## What runs without any credential

```bash
cd gateway && npm ci && npx tsc --noEmit && npm test     # 28 tests
cd web     && npm ci && npm run verify                   # build + 40 tests
```

`npm run verify` in `web/` builds first on purpose: the packaging tests read the
real `web/dist` output rather than a description of it.

Without `HERMES_CHECKOUT` the gateway suite reports 27 passed and 1 skipped --
the skipped one is the Hermes subprocess test.

## Running the Hermes tests

The Hermes tests drive the official runtime in a real subprocess. Install it and
point the two variables at the installation:

```bash
python3 -m venv .hermes-venv
./.hermes-venv/bin/pip install hermes-agent==0.19.0
export HERMES_CHECKOUT="$(./.hermes-venv/bin/python -c 'import sysconfig;print(sysconfig.get_paths()["purelib"])')"
export HERMES_PYTHON="$PWD/.hermes-venv/bin/python"
cd gateway && npm test                                   # 28 passed, 0 skipped
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

```bash
cd web && npm run build
cd web && npm run e2e                                    # 23 checks
```

Needs `HERMES_CHECKOUT` and `HERMES_PYTHON` as above; it exits 2 with
instructions if they are missing. `CHROMIUM_PATH` overrides the browser binary.

## Current results

| Suite | Command | Result |
|---|---|---|
| Gateway typecheck | `npx tsc --noEmit` | clean |
| Gateway tests | `npm test` | 28 passed, 0 failed, 0 skipped |
| Web typecheck + build | `npm run build` | clean; entry 27 kB, 9 kB gzipped |
| Web tests | `npm test` | 40 passed |
| End-to-end | `npm run e2e` | 23 passed |

`npm run lint` in `gateway/` (prettier --check) fails on 23 files. It already
failed on 20 at the `a62fb16` checkpoint, before any of this work: the
codebase's deliberate dense style does not match its own prettier config.
Reformatting it is a separate decision, so new files follow the surrounding
style and are reported too.

## Acceptance criteria

Labels are the handoff's: **VERIFIED**, **BLOCKED ON OWNER CREDENTIAL**,
**SCAFFOLDED**, **NOT IMPLEMENTED**.

| # | Criterion | Status |
|---|---|---|
| 1 | Phone visual question through the realtime layer, spoken result | IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL — needs LiveKit and realtime model credentials and a physical phone |
| 2 | Visual context → execute → gateway → runtime → governed tool → evidence | IMPLEMENTED + VERIFIED (e2e) — image synthesised in-browser, so everything after the camera is covered, not the camera |
| 3 | Long task acknowledged fast, survives disconnect, completes later | IMPLEMENTED + VERIFIED for durability (`/execute` returns 202 before work starts; restart recovery and resume covered by `core.test.ts`). Survival across a dropped *realtime call* is BLOCKED ON OWNER CREDENTIAL |
| 4 | Cancellation prevents hidden continuation | IMPLEMENTED + VERIFIED (`core.test.ts`, `permissions.test.ts`) |
| 5 | Hermes selection, Codex through Hermes, controlled fixture | Hermes: IMPLEMENTED + VERIFIED against the official runtime. Codex specifically: only the credential boundary is verified (`parity.test.ts`); the Codex provider path itself is BLOCKED ON OWNER CREDENTIAL |
| 6 | SMS draft / approval / send / inbound status | IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL (Twilio) |
| 7 | Outbound call objective / status / transcript | IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL (Retell) |
| 8 | Procurement comparison with timestamped offers | IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL (eBay); ownership and quote rules covered by `permissions.test.ts` |
| 9 | Purchase approval blocks unauthorised checkout | IMPLEMENTED + VERIFIED (`permissions.test.ts`) |
| 10 | Unauthorised access returns 403/404 without leaking | IMPLEMENTED + VERIFIED (`http.test.ts`, `security.test.ts`, e2e) |
| 11 | Reconnect does not duplicate messages, calls or purchases | IMPLEMENTED + VERIFIED for run submission (idempotency key, e2e) and for uncertain external effects (`permissions.test.ts`). Duplicate suppression against a live SMS/call provider is BLOCKED ON OWNER CREDENTIAL |
| 12 | Phone fully usable without glasses | IMPLEMENTED + VERIFIED — the PWA has no glasses dependency; e2e runs at a phone viewport |

## What no test here can establish

Live camera, microphone and realtime conversation need a real phone and
configured credentials. Every provider integration is exercised against a
fixture, which proves the contract the gateway enforces, not that the provider
behaves as documented. The container image is not built here: this sandbox has a
docker client but no daemon.
