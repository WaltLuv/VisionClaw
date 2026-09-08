# Implementation plan

Preserve Anthropic Managed Agents as the current default. Hermes becomes default only after live parity acceptance; no silent runtime switching during an active task. Keep Gemini/LiveKit as realtime eyes, ears and voice.

Acceptance order:

1. Durable task submission, owner isolation, replayable events, cancellation and restart recovery.
2. Governed typed tools with exact approvals, idempotency, per-owner connections and evidence.
3. Same employee through Managed and official Hermes Python library, model routing including Hermes openai-codex authentication.
4. Mobile PWA camera switching, explicit capture/upload, microphone/speaker, transcript, text fallback and reconnect. Worker returns completed runs during the same call.
5. Contacts, Twilio SMS, Retell voice, verified/deduplicated webhooks and outcomes.
6. Supplier offers/comparison, carts, exact quote validation and authorized checkout. No fabricated retailer APIs.
7. Browser/MCP/workflows/skills with bounded capacity and controlled external effects.
8. Runtime tests, security tests, PWA build, native environment checks, deployment and docs.

Every claim requires execution evidence. Fixture tests prove contract behavior; live provider success requires actual credentials. No fake successes, no permanently inferred spending authority, no provider secrets in clients.
