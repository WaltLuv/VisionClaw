# Put it on your VM

Your Hermes agent runs on a VM you control. The app goes on that same machine,
because the gateway starts Hermes as a local program — it has to be able to see
Hermes' files.

Do not use the Docker image for this. A container cannot start a program that
lives on the host, so Hermes would be unreachable from inside it.

## One command

On the VM, from this folder:

```bash
sudo bash deploy/install.sh
```

It finds Hermes, builds the app, writes your settings, installs two services and
turns on https. It asks only for what it cannot know:

- the web address you will open on your phone
- your Google Gemini API key
- an Anthropic API key, if you want hosted Claude (optional)
- which brain does the work, when more than one is set up
- your LiveKit details, if you want to talk out loud (you can skip and add later)
- a Browserbase API key, if you want a browser you can watch and take over (optional)

It is safe to run again. It keeps what you have already answered and anything
you added to `.env` yourself, restarts the app so changes take effect, and stops
with the reason if the app does not start.

Clone it somewhere the services can read, such as your home folder or `/opt`.
They run as the person who ran `sudo` (as root if there is none); to use a
separate account instead: `sudo SERVICE_USER=visionclaw bash deploy/install.sh`.

## Without a terminal (a script or an agent)

A question it cannot ask is left blank, so give the answers first: put them in
`.env` in this folder, readable only by you (with an editor, not on the command
line, where they would stay in your shell history). It reads them back and fills
in the rest:

```
PUBLIC_BASE_URL=https://agent.yourcompany.com
AGENT_RUNTIME=hermes
GOOGLE_API_KEY=...
LIVEKIT_URL=...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
BROWSERBASE_API_KEY=...
```

Then `sudo bash deploy/install.sh < /dev/null`. It generates the access code and
the secrets itself (`STATE_SECRET` among them) and keeps them on later runs.

## Which model Hermes uses

The app gives Hermes a home of its own for each person (under `data/hermes/`),
so the model settings and logins your Hermes uses elsewhere on this machine do
not apply. Name the provider and the model in `.env`, with that provider's key,
then `sudo systemctl restart fieldagent`:

```
HERMES_PROVIDER=anthropic
HERMES_MODEL=claude-sonnet-5
ANTHROPIC_API_KEY=...
```

Hermes' own names apply (`anthropic`, `gemini`, `openai-api`, `openai-codex`,
`xai`, `deepseek`, `nous` and others). For any OpenAI-compatible endpoint,
including a model on this machine through Ollama, LM Studio or vLLM, set
`HERMES_PROVIDER=custom`, `HERMES_BASE_URL` (Ollama's is
`http://127.0.0.1:11434/v1`), `HERMES_MODEL`, and `HERMES_API_KEY` (any value if
the endpoint takes none). That is how the end-to-end suite runs Hermes. Small
local models are often weak at using tools, so try a real task before relying
on one. Besides those settings, the only
keys handed to Hermes are `OPENAI_API_KEY`, `OPENROUTER_API_KEY`,
`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` and `GEMINI_API_KEY` (and proxy settings,
if the machine uses a proxy). Without `HERMES_PROVIDER`,
Hermes may pick a provider from those -- including the Gemini key the installer
writes for voice. `bash deploy/doctor.sh` shows which one is named.

Codex (`openai-codex`) signs in with your ChatGPT account instead of a key, and
Hermes keeps that sign-in in its home. Sign in inside the app's Hermes home for
your account, as the user the services run as:

```bash
HERMES_BIN="$(dirname "$(sudo grep -m1 '^HERMES_PYTHON=' .env | cut -d= -f2-)")/hermes"
sudo -u <that user> HERMES_HOME="$PWD/data/hermes/4c1029697ee358715d3a14a2add817c4b01651440de808371f78165ac90dc581" \
  "$HERMES_BIN" model      # choose OpenAI Codex
```

That folder name belongs to the installer's one account, `owner`: it is the
SHA-256 of the account name.

When it finishes it prints your address and your access code. Open the address
on your phone, type the code, and add it to your home screen.

## Is it working?

```bash
bash deploy/doctor.sh
```

Every line is a ✓ or an ✗, and each ✗ says what to do about it. It checks the
gateway is up and answering, the phone app is built and reachable, Hermes is
found and loads, Gemini has a key, voice is set up, and that nobody but you can
sign in.

## What each piece does

- **The gateway** is the app your phone talks to. It holds your jobs, your
  files and your approvals, and it starts Hermes.
- **Hermes** does the actual work. It is already yours and already running; the
  app just points at it.
- **Gemini** gives it eyes and a voice.
- **LiveKit** carries the live audio and video between your phone and Gemini. It
  is the only piece that is not on your VM. Without it, typing and photos still
  work.

## Things worth knowing

- **https is not optional.** Phones refuse the camera and microphone on a plain
  http address. The installer sets this up with Caddy if Caddy is present;
  otherwise install it (`sudo apt install -y caddy`) and run the installer again.
  Sites Caddy already serves are kept: this one is added beside them, the old
  file is saved as `Caddyfile.before-visionclaw`, and if Caddy would not accept
  the result it is put back and the lines to add are printed. Behind nginx or
  another proxy instead, send the address to `127.0.0.1:8788`, pass WebSocket
  upgrades through (the gateway's event channel is one), and do not buffer
  responses: the phone app's live updates are a stream.
- **Only you can sign in.** The installer sets `REGISTRATION_OPEN=false`. Do not
  set `AUTO_APPROVE_ALL=true` on a public address — anyone who found it could
  sign themselves up.
- **Your keys live in `.env`** in this folder, readable only by the user the
  services run as. It is never committed.
- **Your data lives in `data/`** in this folder: tasks, memory, evidence and
  Hermes' homes. Back it up, with `.env`; nothing else holds them.
- **A restart does not lose work.** Tasks that were running come back as
  needing you ("the server restarted"): tap Resume or Stop on each one. An
  action whose outcome is uncertain has to be checked first; it is never
  repeated on its own. A browser that
  was open is closed, since nothing can drive it any more, and the task opens a
  new one if it needs to.

## If something breaks

```bash
sudo journalctl -u fieldagent -n 50        # the app
sudo journalctl -u fieldagent-voice -n 50  # talking out loud
sudo systemctl restart fieldagent
```

A 404 on the home page with everything else working means the phone app was not
built: `cd web && npm ci && npm run build`.
