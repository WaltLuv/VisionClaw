# Owner actions

Only genuine external prerequisites are listed here — things no amount of code
in this repository can supply. Everything else is either done or tracked in
`docs/BUILD-STATUS.md`.

Each item says what stays unavailable until it is done, so nothing here reads as
blocking more than it does.

## Required for the phone to hold a conversation

- **LiveKit project**: set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
  on the gateway. Until then `/livekit-token` returns 503 and the PWA hides the
  conversation control and says voice is not set up. Typing, photos and tasks all
  still work.
- **Realtime model credential** for the voice worker (`agent/`), per its own
  configuration. Without it a room is created but nothing joins it.
- **A physical phone on HTTPS.** `getUserMedia` does not exist in an insecure
  context, so camera and microphone cannot be tested over plain HTTP on a LAN
  address. The PWA detects this and says so rather than reporting a permission
  error.

## Required for tasks to run at all

Exactly one of:

- **Hosted runtime**: `ANTHROPIC_API_KEY`. This is the preserved default.
- **Hermes runtime**: install the official runtime on the server and set
  `HERMES_CHECKOUT` (the directory containing `run_agent.py`) and
  `HERMES_PYTHON`, plus the model provider credential it should use. To route
  Codex through Hermes, configure it as a supported Hermes provider; the gateway
  forwards `OPENAI_API_KEY` and no other service credential into the runtime.

With neither, a submitted task is recorded and then fails with a message saying
the employee is not connected.

## Required per capability

Each is independent; the rest of the product works without it, and the Settings
screen shows the capability as "Not set up" rather than offering a control that
cannot work.

- **Text messages**: Twilio `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_FROM`, and the status webhook pointed at
  `${PUBLIC_BASE_URL}/webhooks/sms/status`.
- **Phone calls**: Retell `RETELL_API_KEY`, `RETELL_FROM`, `RETELL_AGENT_ID`,
  with its webhook pointed at `${PUBLIC_BASE_URL}/webhooks/voice`.
- **Shopping and materials**: eBay `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`.
- **Browser use**: `BROWSER_USE_API_KEY`.
- **Connected tools (MCP)**: per-server configuration and its credentials.
- **Google sign-in**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
  `PUBLIC_BASE_URL` registered as an authorised redirect URI on that OAuth
  client.

## Required before anyone is messaged or called

- **Consent and real destinations.** A test number you control, and permission
  from anyone who will receive a message or call. The gateway requires a
  matching contact and an explicit approval per action, but it cannot obtain
  consent on your behalf.

## Required for production hosting

- **A domain with HTTPS** and `PUBLIC_BASE_URL` set to it. The gateway refuses to
  start in production with a non-HTTPS `PUBLIC_BASE_URL`, and session cookies are
  only marked `secure` when `NODE_ENV=production`.
- **A persistent volume** mounted at `/data`. It holds the store file, the SQLite
  database, uploaded artifacts and the per-owner Hermes homes. Losing it strands
  hosted sessions and silently re-provisions empty ones.
- **`STATE_SECRET`** and **`GATEWAY_TOKENS`** (or approved self-registered
  accounts) set as secrets, never committed.
