# Build status

In progress. Not production complete and not deployed.

Upstream baseline is preserved. The first unpushed implementation was removed by workspace maintenance and is being reconstructed with the independent review findings applied. Do not treat past tests as proof of this checkout.

Review regressions to verify: voice result delivery and image handoff; cancelled checkout; tenant-scoped supplier quotes; per-tool Managed permission overrides; custom tool result/idle event ordering; browser session revocation; restart reconciliation; persisted volume paths; PWA packaging and content security policy compatibility.

2026-09-09 checkpoint: gateway TypeScript check passes. All 12 gateway tests pass, including a real installed Hermes subprocess using a local OpenAI-compatible streaming model fixture, exact approval/cancel/ownership rules, real HTTP login/CSRF/image delegation/SSE, restart recovery, and scheduled work progressing while another owner has a long task. These are not live commercial-provider or phone-hardware acceptance results. Python 3.11 was restored after the earlier workspace interruption removed its executable.

Hermes tool search is explicitly disabled using its supported per-user configuration so only gateway-governed tools are exposed. Anthropic remains the default pending live parity. Phone PWA work is underway; it is not yet built or deployed. Communications, supplier, MCP, and browser adapters still need their complete fixture/security matrix and live account verification.
