# Architecture

VisionClaw is one AI employee per owner, reached from a phone. The phone is the
senses and the voice; the gateway is the employee; a swappable runtime is the
brain for each task; governed tools are its hands.

```
 web/  phone PWA ──────────┐        samples/  native iOS/Android (glasses)
   camera, mic, speaker,   │          same LiveKit session, same gateway
   task cards, approvals   │
        │ LiveKit room (audio + video tracks)
        ▼
 agent/  voice worker: Gemini Live (or OpenAI Realtime)
        │ one tool: execute(task, context)       ▲ result spoken back
        ▼                                        │
 gateway/  Express 5 + TypeScript
   /api/*          employee API for the PWA (cookie session + CSRF)
   /v1/*, /tasks   OpenAI-shaped and legacy task API (native apps, worker)
   employee core   runs · approvals · memory · contacts · evidence · events
        │ selectRuntime(owner, run)
        ├── HermesProvider          official Hermes (Codex/OpenAI, OpenRouter, Gemini, ...)
        ├── ClaudeCodeProvider      unmodified Claude Code on the owner's own subscription
        └── AnthropicManagedRuntime Anthropic Managed Agents
        │ every tool call, whichever runtime
        ▼
 ToolGateway  typed schema · effect class · policy · approval · receipt
   web read/search · Browserbase / Browser Use · MCP · memory · files
   SMS (Twilio) · calls (Retell) · suppliers, carts, checkout · workflows
```

## Components

| Path | What it is |
|---|---|
| `web/` | Phone-first PWA (Vite + TypeScript, no framework). Camera with freeze-frame and capture, LiveKit voice, typed tasks, task cards, approvals, memory, contacts, supplier status, the live browser screen. Served by the gateway. |
| `agent/` | Python LiveKit worker. Joins the owner's room, runs the realtime conversation, and calls the gateway for anything that takes work. The room identity is the gateway user, so tasks land in that owner's employee. |
| `gateway/src/` | Upstream gateway: accounts, Google sign-in, access-code tokens, LiveKit room tickets, app connections (OAuth), Browser Use jobs, the OpenAI-shaped and legacy task endpoints. |
| `gateway/src/employee/` | The employee: durable runs, runtimes, tool gateway, approvals, capabilities. Described below. |
| `samples/` | Native iOS and Android apps, the way to use Ray-Ban Meta glasses. Same LiveKit session and gateway. |
| `deploy/` | `install.sh` (asks for credentials, writes `.env`, installs services) and `doctor.sh` (plain-language health check). |

## The life of a task

1. The owner speaks, types, or a scheduled workflow fires. The worker (voice),
   the PWA (`POST /api/execute`) or a native app submits `task` plus `context`
   (for example the selected camera frame).
2. The gateway records a **run** (`queued`) in SQLite and returns at once. The
   run queue (`runs.ts`) runs up to `RUN_CAPACITY` at a time and moves each run
   through `working`, `verifying`, `needs_user`, and one of `completed`,
   `failed`, `cancelled`.
3. `selectRuntime` picks the brain: a runtime chosen for the run, else the one
   the owner chose, else `AGENT_RUNTIME`. The runtime gets the task, the
   employee's context (profile and instructions, relevant memory, enabled
   skills, recent conversation) and the
   selected images -- and nothing that lets it act except the tools below.
4. Every action the runtime wants goes through the **ToolGateway**. Reads run;
   anything that sends, spends, deletes or touches a computer is checked
   against policy and, when it needs approval, the run waits in `needs_user`
   with an approval that shows the exact arguments.
5. Each tool call leaves a **receipt** (an artifact) and consequential ones an
   **action** in the ledger, so the owner can see what happened and reconcile
   an action whose outcome is uncertain (`POST /api/actions/:id/reconcile`).
6. Progress streams to the phone as server-sent events (`GET /api/events`,
   replayable with `Last-Event-ID`), and the result comes back through the
   worker as speech.

A restart does not lose work: runs that were in flight come back as
`needs_user` with a note, and the owner resumes or cancels them.

## Runtime boundary

All three runtimes implement one interface, `run(owner, run, signal)`, and see
the same tools through the ToolGateway. None of them holds a service
credential.

| Runtime | How it runs | What it receives |
|---|---|---|
| Hermes (`hermes`) | The official Hermes runtime (`run_agent.py`) as a child process with a per-owner `HERMES_HOME`; provider and model from `HERMES_*` or Hermes' own config. | Only model-provider keys (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`) and proxy/TLS settings. |
| Claude Code (`claude`) | The unmodified `claude` CLI, headless, with its own tools switched off and only the gateway's tools allowed, over a per-run MCP bridge on a private socket. | Nothing of the owner's: Claude Code signs in through Anthropic's own flow. Only `CLAUDE_CODE_OWNER`'s tasks may use it. |
| Managed Agents (`anthropic`) | Anthropic Managed Agents sessions; every hosted toolset forced to `always_ask`, so the gateway decides. | The session's own vault for connected apps. |

Hermes is the target runtime. Managed Agents stays the default until Hermes is
verified against a real model provider (the end-to-end suite runs real Hermes
0.19.0 against a fixture model). Changing `AGENT_RUNTIME` and restarting moves
every owner who did not choose an engine on purpose.

## Tool governance

Tools are registered with a Zod schema and an **effect**: `read`, `write`,
`communication`, `destructive`, `financial`, `sensitive` or `computer`.

- By default `read` and `write` run; the others ask. The owner can loosen or
  tighten a tool, but `financial` always needs approval.
- An approval is bound to a hash of the exact arguments. If the runtime changes
  anything -- a recipient, a quantity, a total -- it is a new request.
- Messages and calls go only to a saved contact. A purchase needs the owner's
  approval of an exact quote, and checkout fetches the quote again: any change
  in price, stock or fulfillment needs a new approval.
- Errors the employee API returns pass through `redact.ts`, which removes
  secret-named fields and the process's own secret values.

## Capabilities

- **Web**: read a page; search when `SEARCH_API_KEY` is set.
- **Browsers** (share `COMPUTER_CAPACITY`, first come first served):
  - *Browserbase*: the employee drives a real browser one step at a time
    (`browser_open`, `browser_goto`, `browser_read`, `browser_click`,
    `browser_type`, `browser_screenshot`, `browser_close`) over CDP. When the
    owner takes over, the gateway stops sending steps until it is handed back.
    Code refuses to press purchase buttons or type into password and payment
    fields.
  - *Browser Use*: the employee hands a whole job to Browser Use Cloud. Take-over
    stops the current run and keeps the browser; hand-back starts a follow-up run
    in the same browser session.
  - The live view is framed only from allowlisted https hosts (also enforced by
    the page's Content-Security-Policy), is never given to the model, and is
    dropped when the job ends.
- **Communications**: SMS through Twilio and calls through Retell, both with
  signed webhooks (`x-twilio-signature`, `x-retell-signature`); inbound
  messages are routed to an owner by `COMMUNICATION_ROUTES`.
- **Procurement**: a provider-neutral supplier registry (`suppliers.ts`). Home
  Depot, Lowe's, Amazon, Walmart, and any local or specialty vendor defined in
  `SUPPLIER_CONFIG_PATH`, searched in parallel with a timeout, normalized into
  one offer shape (price, stock, fulfillment, observed time, match quality) and
  compared. Carts are built from offers, and checkout runs only if the
  supplier's fresh quote still matches the one the owner approved. eBay is
  optional and off by default. An offer the employee read on a website
  (`offer_record`) joins the comparison marked as unverified and cannot be
  checked out.
- **MCP**: https servers listed in `MCP_CONFIG_PATH`, exposed as governed tools.
- **Memory, contacts, files, workflows**: owner-scoped records; workflows are
  saved tasks that can run on a schedule.

## Data and identity

- Operational state lives in SQLite (`node:sqlite`) at `EMPLOYEE_DB_PATH`:
  runs, events, approvals, actions, memory, contacts, artifacts, computers,
  material requests. Every query is scoped by owner.
- Accounts and app connections stay in upstream's store file (`STORE_PATH`).
- Evidence and uploads are files under the data folder; nothing continuous from
  the camera is saved, only frames the owner selects or a task needs.
- Sign-in: access codes (`GATEWAY_TOKENS`) or Google; sessions and issued
  tokens are stored as hashes.
  The PWA gets an HttpOnly session cookie and must send a CSRF header on every
  change; native apps use a bearer token; the worker uses the service token and
  names the user per request.
- `DELETE /api/employee-data` removes an owner's employee data.

## What is outside this repository

The model providers, LiveKit, Browserbase, Browser Use, Twilio, Retell, supplier
catalogs and MCP servers are external services reached with the owner's own
credentials. Which are verified live and which only against fixtures is in
`docs/BUILD-STATUS.md`; what each needs from the owner is in
`docs/OWNER-ACTIONS.md`.
