# Claude Code Handoff — VisionClaw Phone-First AI Employee

Repository: https://github.com/WaltLuv/VisionClaw
Branch: feat/phone-first-employee
Upstream: https://github.com/Intent-Lab/VisionClaw
Baseline checkpoint already saved: a62fb16897c1daf2927c271e5d4199b1ebf76bae

## Mission

Finish the VisionClaw migration into a phone-first general personal/work AI employee.

Binding architecture:

Phone/PWA camera + microphone + touch
→ existing Gemini Live/LiveKit realtime layer
→ execute(task, context)
→ existing hosted gateway
→ provider-neutral agent runtime
→ Hermes (target default), Anthropic Managed Agents (preserve working implementation), optional Codex path
→ governed tools: browser, MCP/APIs, computer use, files, communications, procurement, workflows.

Gemini Live is the realtime perception/conversation layer. It must not be replaced merely because Anthropic Managed Agents exists. Anthropic is an action/runtime provider. Do not delete or bypass working gateway, task history, browser automation, Google authentication, LiveKit, or realtime event infrastructure.

## Rules

- Reuse first; refactor at boundaries; replace only with evidence.
- The employee identity, transcript, memory, runs, tools, permissions, artifacts, communications, and procurement state live outside model prompts.
- No secrets in browser/mobile code, commits, logs, screenshots, fixtures, or docs.
- Financial actions, external messages/calls, destructive actions, and checkout require explicit server-side approval.
- Never claim a feature is complete because a button/table/provider interface exists. Require a real execution path or label it blocked/scaffolded.
- Never expose private chain-of-thought; expose concise operational status and evidence.
- Keep Anthropic runtime functional until Hermes reaches parity on the same acceptance tests.
- Do not invent Hermes APIs. Use the installed official Hermes runtime/API and document the exact version/commit.
- Do not silently resubmit after reconnect. Use durable run IDs, idempotency, cancellation, ownership checks, and restart recovery.

## What is already saved at the checkpoint

The gateway/backend work includes:

- owner-scoped durable SQLite employee records, events, sessions, runs, approvals, artifacts, contacts, memories and workflows;
- queue/lifecycle states, deduplication, cancellation, restart recovery and per-owner capacity;
- typed tool gateway with side-effect classes, permission checks, approval gates, audit events and idempotency;
- official Hermes subprocess bridge using a per-owner HERMES_HOME and JSON-lines protocol; Hermes tool search is disabled and only gateway-governed tools are exposed;
- preserved Anthropic Managed Agents integration;
- HTTP auth/cookies/CSRF, SSE events, legacy visual delegation with image evidence, task cancellation/resume, artifact ownership and deletion;
- MCP Streamable HTTP adapter;
- Browser Use Cloud v4 adapter with bounded queue/cancel/evidence;
- Twilio SMS and Retell voice adapters with webhook verification paths;
- eBay Browse procurement search/offer/cart/purchase adapter with approval and repricing checks;
- LiveKit voice worker now delegates durable work through the gateway and polls runs instead of losing work when a call ends;
- 12 gateway tests previously passed, including an installed Hermes subprocess fixture, HTTP auth/CSRF/image delegation/SSE/ownership, cancel/recovery, approval safeguards and scheduler concurrency.

This is not a production-complete claim. Live commercial credentials, phone hardware, full PWA build, deployment packaging and external provider E2E remain to be verified.

## Do this first

1. Clone/check out the branch and inspect git status/history.
2. Read README, docs/ARCHITECTURE-AUDIT.md, docs/IMPLEMENTATION-PLAN.md, docs/BUILD-STATUS.md, gateway/src/employee/*, gateway/tests/*, agent/*, and existing LiveKit/Gemini code.
3. Run focused verification before changing anything:
   - `cd gateway && npm ci`
   - `npx tsc --noEmit`
   - `node --import tsx --test tests/*.test.ts`
   - if Hermes source is available, set `HERMES_CHECKOUT` and run the Hermes test too.
4. Check all diffs and existing user changes. Do not reset or overwrite unrelated work.

## Required implementation order

### 1. Restore the mobile-first PWA

Build the real `web/` app, not a mock:

- Vite/TypeScript PWA with install metadata and service worker;
- camera preview with front/rear switching, start/stop, still capture and upload;
- microphone mute/unmute and text fallback;
- existing LiveKit/Gemini session connection using server-issued credentials;
- live transcript/result display and interruption/stop handling;
- current run status, recent activity, approvals and cancellation;
- responsive phone-first Today/Tasks/Employee/Settings surfaces;
- clear permission/offline/reconnect states;
- no provider names/API keys in the primary UX.

Use the gateway’s existing auth and routes; do not create a parallel backend. Add focused tests and build verification. If the old PWA fragments are absent, reconstruct from the existing route/contracts and document any compatibility decisions.

### 2. Verify runtime parity

Add provider-neutral tests proving:

- Anthropic Managed Agents still handles the old working path;
- Hermes executes a governed tool through the official runtime fixture;
- runtime selection is server-side and owner-scoped;
- provider failure becomes a useful run failure, not a crash;
- Codex is only enabled through supported Hermes/provider configuration and never receives browser credentials.

### 3. Close security/reliability gaps

Audit and test:

- approval decisions are validated against the exact approval/action and cannot approve a different amount/item;
- one-time approvals cannot be replayed;
- task/artifact/contact/procurement ownership is enforced on every route;
- webhook signatures and timestamp/replay protection;
- recursive redaction of secrets from nested logs/errors;
- malformed MCP config and tool output handling;
- browser/computer cancel, cleanup, evidence and capacity behavior;
- uncertain SMS/call/order actions are not automatically retried;
- uploads are type/size/ownership validated;
- production cookies/HTTPS/rate limits/CSRF are enforced.

### 4. Integrations and procurement

Keep adapters provider-neutral and implement fixtures/mocks where credentials are unavailable. Do not pretend to have supplier checkout if only search/quote/cart is connected. Purchase approval cards must show exact supplier, items, quantities, price, fees, total, fulfillment and timestamp, then require authorization before checkout.

### 5. Packaging and deployment

Update the actual deployment path after inspecting it:

- web build is served by the existing gateway/deployment;
- Node/Python/Hermes runtime versions are pinned and reproducible;
- persistent data/artifact directories are volumes;
- no server SDK or credential is bundled to the client;
- environment validation is documented;
- health/readiness checks and structured redacted logs exist;
- native/glasses code remains optional and shares the same employee/gateway.

## Required acceptance tests

Prove what credentials permit:

1. phone/PWA visual question through Gemini Live with visible/spoken result;
2. visual context → execute → gateway → selected runtime → governed tool → evidence;
3. long task acknowledges quickly, survives conversation disconnect, completes later;
4. cancellation prevents later hidden continuation;
5. Hermes selection and Codex-through-Hermes path with controlled fixture;
6. SMS draft/approval/send/inbound status;
7. outbound call objective/status/transcript/outcome;
8. procurement comparison with timestamped offers and fulfillment;
9. purchase approval blocks unauthorized checkout and records receipt/order;
10. unauthorized task/artifact/contact access returns 404/403 without data leakage;
11. reconnect does not duplicate messages, calls or purchases;
12. phone remains fully usable without glasses.

Label every result: IMPLEMENTED + VERIFIED, IMPLEMENTED + BLOCKED ON OWNER CREDENTIAL, SCAFFOLDED, or NOT IMPLEMENTED.

## Owner actions only

Put only genuine external prerequisites in docs/OWNER-ACTIONS.md, such as:

- provide Hermes/Codex/OpenAI credentials or OAuth;
- configure Gemini Live/Google auth and LiveKit production credentials;
- create Twilio/Retell accounts and webhook URLs;
- provide Browser Use/MCP/supplier credentials;
- configure production domain, HTTPS, storage and persistent volumes;
- provide test phone/contact/supplier destinations and consent for calls/SMS.

## Final handoff

Before stopping, run lint, typecheck, unit/integration tests, web build, secret scan, and applicable E2E tests. Review git diff for TODO/FIXME/HACK, stale OpenClaw terminology and hardcoded secrets. Update README/docs/SETUP.md/docs/SECURITY.md/docs/TESTING.md/docs/OWNER-ACTIONS.md. Commit logical changes to the same branch and report exact commit SHAs, verified tests, blocked tests and known limitations. Never report “build complete” while the PWA, deployment, or required provider paths remain unverified.
