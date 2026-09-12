# Claude Code Instructions

You are continuing the VisionClaw phone-first AI employee migration on branch `feat/phone-first-employee`.

Read `docs/CLAUDE-CODE-HANDOFF.md` before editing. It is the source of truth for the remaining work and acceptance criteria.

Do not replace Gemini Live/LiveKit. Preserve the existing Anthropic Managed Agents runtime while adding/verifying the provider-neutral boundary and Hermes target runtime. Reuse the existing gateway, auth, task history, browser automation, realtime events and mobile clients. Do not create a parallel backend.

Run the existing gateway tests and typecheck first. Then restore/build the real phone-first `web/` PWA and continue in dependency order. Keep all financial, communication, destructive and external side effects behind server-side approvals. Never commit secrets or claim completion without real verification.

At the end, update the docs, commit logical changes to this branch, and report exact test results and blocked owner-credential actions.
