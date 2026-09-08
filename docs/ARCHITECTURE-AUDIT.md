# Architecture audit

Audited upstream: `Intent-Lab/VisionClaw`, commit `b06ed115cc139453e748b689432cf711819837d7`.

The upstream is substantially newer than the README's original direct Gemini/OpenClaw diagram. Preserve its hosted infrastructure.

| Area | Repository truth | Migration boundary |
|---|---|---|
| Gateway | Express 5/TypeScript, Anthropic Managed Agents, OpenAI-shaped HTTP and protocol-3 WebSocket compatibility | Extend this gateway; introduce runtime adapter behind it |
| Voice/vision | Python LiveKit worker (`agent/main.py`), Gemini and OpenAI realtime plugins | Keep LiveKit and Gemini; PWA publishes the same tracks |
| Audio | Native clients publish microphone tracks, worker consumes and emits speech | Reuse transport, interruption and worker completion relay |
| iPhone | SwiftUI/AVFoundation phone mode and Meta DAT sources, shared LiveKit session | Retain native implementation for glasses |
| Android | Kotlin/CameraX phone mode, DAT glasses, shared LiveKit session | Retain native implementation for glasses |
| Camera | Phone or glasses stream to worker; selected JPEG frame accompanies delegated tasks | Preserve selected evidence; never save continuous live frames |
| Execution | Worker calls gateway `/v1/chat/completions`; `runTurn` drives Managed session events | Durable run queue fronts all runtime adapters |
| Hosted agent | Anthropic sessions, vaults, MCP connections, OAuth | Preserve as initial default until Hermes parity is verified |
| Browser | Browser Use Cloud v4 start/await, live view and recording | Retain adapter with ownership, bounded polling and action permissions |
| Authentication | Google nonce sign-in, approved accounts, hashed bearer tokens; static/service tokens | Reuse authentication; add revocable HttpOnly browser sessions and CSRF |
| Persistence | JSON file for accounts/resources, recent 20 tasks, notes and pending notifications | Retain credentials/resources; use transactional SQLite for operational records beside existing volume |
| Realtime | Native LiveKit plus gateway WS/SSE; late-result delivery | Add replayable owner-scoped task events without duplicating media infrastructure |
| Missing guarantees | No durable run state machine, action ledger, exact approvals, upload ownership, recovery, automated tests or CI | Implement and verify these before production claims |

## Reusable and prototype components

Native camera/audio/glasses and hosted worker/gateway are implemented integrations. Their existence does not prove production readiness. The original JSON file save can race, browser await polls indefinitely, browser run lookup lacks owner binding, and pending tool confirmation is automatically allowed. These need repair. Live hardware, model credentials and hosted services are not available as acceptance evidence in this environment.

The README names old direct Gemini configuration files and OpenClaw as a dependency. It does not accurately describe the current hosted path. Preserve provenance and native documentation while updating the primary product setup.

## Target and dependency graph

Phone PWA/native sources → existing LiveKit worker → Gemini realtime conversation → simple `execute(task, context)` → existing gateway → durable owner-scoped run → Hermes or preserved Managed runtime → governed tools → exact approval when required → receipt/artifact → event and voice completion.

1. Audit and preserve upstream boundaries.
2. Transactional run/identity/transcript/memory/evidence state and browser authentication.
3. Runtime adapters with scoped tools, cancellation and restart reconciliation.
4. PWA camera/audio and voice task delivery through existing LiveKit.
5. Communications, procurement, browser/computer, MCP and reusable workflows.
6. Security/adversarial tests, builds, deployment packaging and accurate setup/status docs.

The model is replaceable. The employee, transcript, memory, tasks, permissions and artifacts remain outside model prompts. Personal and work tasks use the same core; property capabilities are optional skills.

## Recovery note

Workspace maintenance removed the first unpushed checkout during a usage interruption. This checkout is reconstructed from the audited upstream and retained implementation context. Earlier local test results are historical, not verification of the reconstructed files. Current checks are recorded in TESTING.md.
