# Build status

In progress. Not production complete and not deployed.

The phone client now exists and is served by the gateway; the Hermes runtime
path works against the official runtime; deployment builds and ships both.
Nothing here has run against live commercial providers or a physical phone.

Exact commands, results and per-criterion labels are in `docs/TESTING.md`.

## Verified in this checkout

- Gateway typecheck clean; **49/49 tests pass, 0 skipped** across 9 files
  (48 with 1 skipped when the Hermes runtime is not installed).
- Web client typechecks and builds; **70/70 tests pass** across 6 files.
- **54/54 end-to-end checks pass** against a real gateway in a real browser at a
  phone viewport, with a synthetic camera and microphone.

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

## Fixed in this pass

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
- `npm run lint` in `gateway/` fails on 25 files. It already failed on 20 at the
  `a62fb16` checkpoint; the codebase's dense style does not match its own
  prettier config, and reformatting is a separate decision.
- `gateway/package.json` declares `engines: >=24` while the tree is tested and
  imaged on Node 22, so `npm ci` prints `EBADENGINE`.
