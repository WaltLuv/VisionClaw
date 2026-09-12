# Build status

In progress. Not production complete and not deployed.

The phone client now exists and is served by the gateway; the Hermes runtime
path works against the official runtime; deployment builds and ships both.
Nothing here has run against live commercial providers or a physical phone.

Exact commands, results and per-criterion labels are in `docs/TESTING.md`.

## Verified in this checkout

- Gateway typecheck clean; **28/28 tests pass, 0 skipped** (was 12 with 1
  skipped, and the skipped one failed when first actually run).
- Web client typechecks and builds; **40/40 tests pass**.
- **23/23 end-to-end checks pass** against a real gateway in a real browser at a
  phone viewport: sign-in, a typed task and an attached image both running
  through the gateway to Hermes and a governed tool, evidence stored and shown,
  idempotent resubmission, CSRF rejection, and server-side sign-out.

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

## Still open

- Live camera, microphone and realtime conversation need a physical phone and
  LiveKit plus realtime model credentials.
- Communications, voice, procurement, browser and MCP adapters are implemented
  and fixture-tested; none has run against a live account.
- The Codex-through-Hermes provider path is unverified beyond its credential
  boundary.
- The container image is not built here: this sandbox has a docker client but no
  daemon.
- `npm run lint` in `gateway/` fails on 23 files. It already failed on 20 at the
  `a62fb16` checkpoint; the codebase's dense style does not match its own
  prettier config, and reformatting is a separate decision.
- `gateway/package.json` declares `engines: >=24` while the tree is tested and
  imaged on Node 22, so `npm ci` prints `EBADENGINE`.
