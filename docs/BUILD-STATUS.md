# Build status

In progress. Not production complete and not deployed.

The phone client now exists and is served by the gateway; the Hermes runtime
path works against the official runtime; deployment builds and ships both.
Nothing here has run against live commercial providers or a physical phone.

Exact commands, results and per-criterion labels are in `docs/TESTING.md`.

## Verified in this checkout

- Gateway typecheck clean; **78/78 tests pass, 0 skipped** across 10 files
  (77 with 1 skipped when the Hermes runtime is not installed).
- Web client typechecks and builds; **88/88 tests pass** across 7 files.
- **66/66 end-to-end checks pass** against a real gateway in a real browser at a
  phone viewport, with a synthetic camera and microphone and two configured
  suppliers, one of which is deliberately down.

What the end-to-end run establishes on the real path:

- the built bundle boots under the gateway's CSP with no violation;
- sign-in, an HttpOnly `SameSite=Strict` cookie, and no access code left in
  browser storage;
- a task running through the gateway to Hermes and a governed tool, with
  evidence stored and shown;
- the camera opening, showing live frames, freezing by muting the outgoing
  track, capturing a still that becomes owned evidence attached to a task, and
  releasing the device on stop;
- with no realtime credentials, a 503 and an honest "not set up" rather than a
  dead control, with typing still working;
- a sensitive tool stopping the run to ask, the exact question on screen, and
  the answer releasing it;
- stopping a task ending the work, not just the view — still cancelled, with no
  result, after the model would have finished;
- a long task surviving its page and context being closed mid-flight and
  completing with no client attached;
- a second signed-in owner seeing none of the first's records and getting 404
  rather than a detailed refusal;
- a multi-supplier price comparison where one supplier fails: the working
  supplier's offers survive, the failed one is named on screen, the phone says
  "1 of 2 suppliers answered" and warns there may be better prices, and eBay
  stays out of the search even with its credentials present;
- idempotent resubmission, CSRF rejection, and server-side sign-out.

## Fixed since the last checkpoint

- **The Hermes path could not have worked.** The bridge passed
  `skip_background_review=True` to `AIAgent()`, which is not a parameter of the
  official runtime, so every Hermes run died with a `TypeError`. The test that
  would have caught it skips unless `HERMES_CHECKOUT` is set, so the previous
  "all 12 tests pass including a real Hermes subprocess" could not be reproduced
  here. Runtime under test is now pinned and named: **hermes-agent 0.19.0**.
- **The phone client did not exist.** `server.ts` had always served
  `web/dist`, but `web/` was absent from this checkout and from the entire branch
  history. It is rebuilt from the gateway's own route contracts.
- **The client could never have shipped.** The Dockerfile did not include
  `web/` in its build context, and the static path resolved outside the image
  root, so a deployed gateway answered `/` with 404 while its API worked.
- **Secrets were not redacted anywhere.** No redaction existed in the gateway;
  provider error text reached API clients verbatim.
- Runtime selection was inline and untestable, and an unrecognised value would
  fail a run with a `TypeError` instead of falling back.

## Acceptance table

Labels are the handoff's: **IMPLEMENTED + VERIFIED**, **IMPLEMENTED + BLOCKED ON
OWNER CREDENTIAL**, **SCAFFOLDED**, **NOT IMPLEMENTED**. "Verified" means a test
in this repository exercises the real path; it never means a live account was
used. Per-criterion detail and how to reproduce each suite is in
`docs/TESTING.md`.

### Core criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Phone visual question through the realtime layer, spoken result | IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL |
| 2 | Visual context → execute → gateway → runtime → governed tool → evidence | IMPLEMENTED + VERIFIED |
| 3 | Long task acknowledged fast, survives disconnect, completes later | IMPLEMENTED + VERIFIED |
| 4 | Cancellation prevents hidden continuation | IMPLEMENTED + VERIFIED |
| 5 | Hermes selection through the official runtime | IMPLEMENTED + VERIFIED |
| 5b | Codex through a supported server-side provider path | IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL — only the credential boundary is verified |
| 6 | SMS draft / approval / send / inbound status | IMPLEMENTED + VERIFIED against fixtures; live account BLOCKED ON OWNER CREDENTIAL |
| 7 | Outbound call objective / status / transcript / outcome | IMPLEMENTED + VERIFIED against fixtures; live account BLOCKED ON OWNER CREDENTIAL |
| 8 | Multi-supplier comparison with price and availability timestamps | IMPLEMENTED + VERIFIED against fixtures; live accounts BLOCKED ON OWNER CREDENTIAL |
| 9 | Purchase approval blocks unauthorised checkout | IMPLEMENTED + VERIFIED |
| 10 | Unauthorised access returns 403/404 without leaking | IMPLEMENTED + VERIFIED |
| 11 | Reconnect does not duplicate messages, calls or purchases | IMPLEMENTED + VERIFIED |
| 12 | Phone fully usable without glasses | IMPLEMENTED + VERIFIED |

### Supplier adapters

Every adapter below normalizes into one offer model, is searched in parallel,
reports its own failure without erasing other suppliers' offers, and has fixture
tests. None has run against a live account in this repository.

| Supplier | Access method | Status |
|---|---|---|
| Home Depot | Partner catalog | IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL — `HOME_DEPOT_ENDPOINT`, `HOME_DEPOT_API_KEY` |
| Lowe's | Partner catalog | IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL — `LOWES_ENDPOINT`, `LOWES_API_KEY` |
| Amazon | Official API (Product Advertising 5.0 shape) | IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL — `AMAZON_ENDPOINT`, `AMAZON_API_KEY`; PA-API needs SigV4 signing, so the endpoint points at an entitled gateway or signing proxy |
| Walmart | Official API (product search shape) | IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL — `WALMART_ENDPOINT`, `WALMART_API_KEY`; Walmart I/O needs signed requests |
| Local suppliers | Owner-configured catalog | IMPLEMENTED + VERIFIED — configured through `SUPPLIER_CONFIG_PATH` and exercised end to end against a live local endpoint |
| Specialty vendors | Owner-configured catalog | IMPLEMENTED + VERIFIED — same connection model; nothing is hardcoded to one vendor |
| eBay | Official API, optional | IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL — off unless `EBAY_ENABLED=true`; never a default or only supplier |
| MCP-backed supplier | Connected tool | SCAFFOLDED — a connector may expose catalog tools and an exact-quote checkout, but no supplier has been run this way here |
| Browserbase/Stagehand supplier | Browser | NOT IMPLEMENTED as a supplier adapter — browser use exists as a governed capability, but no supplier is reached through it |

The field mappings for Home Depot and Lowe's are defaults against partner
catalog shapes and should be confirmed against the endpoint an owner is granted.
Every mapping is overridable per deployment.

## Fixed in this pass

- Procurement was eBay and nothing else, instantiated by default. It is now a
  provider-neutral registry over Home Depot, Lowe's, Amazon, Walmart and any
  number of owner-configured local and specialty suppliers, with eBay demoted to
  an optional connection that is not constructed unless switched on.
- Communications had no test at all — the adapter that messages and calls real
  people. It now has ten, covering the approval gate, a changed destination, a
  blocked contact, the never-retried uncertain send, and webhook signature,
  account, replay and ordering rules.
- MCP and browser use had none either. A malformed connector file now provably
  costs only the connectors, a plaintext connector URL is refused, and a
  connector cannot expose its own checkout tools as a second ungoverned path to
  spending money.

## Still open

- The realtime conversation itself needs LiveKit and realtime model credentials.
  The camera and microphone are verified in a browser against a synthetic
  device; a physical phone is still the only way to confirm real hardware.
- Communications, voice, procurement, browser and MCP adapters are verified
  against fixtures, which proves the contract the gateway enforces, not that
  each provider behaves as documented. None has run against a live account.
- The Codex-through-Hermes provider path is unverified beyond its credential
  boundary.
- The container image is not built here: this sandbox has a docker client but no
  daemon.
- `npm run lint` in `gateway/` fails on 27 files. It already failed on 20 at the
  `a62fb16` checkpoint; the codebase's dense style does not match its own
  prettier config, and reformatting is a separate decision.
- `gateway/package.json` declares `engines: >=24` while the tree is tested and
  imaged on Node 22, so `npm ci` prints `EBADENGINE`.
