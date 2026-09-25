#!/usr/bin/env bash
# Tells you what is working and what is not, in plain words.
#
#     bash deploy/doctor.sh          (checks only; uses nothing from any plan)
#     bash deploy/doctor.sh --live   (also sends one tiny real task)
set -uo pipefail
LIVE=0; [ "${1:-}" = "--live" ] && LIVE=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
PROBLEMS=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
no()   { printf '  \033[31m✗\033[0m %s\n' "$*"; PROBLEMS=$((PROBLEMS+1)); }
meh()  { printf '  \033[33m–\033[0m %s\n' "$*"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$*"; }

[ -f "$ENV_FILE" ] || { printf '\nNo settings yet. Run: sudo bash deploy/install.sh\n\n'; exit 1; }
# Read it the way systemd reads it for the services: literally, one KEY=value
# per line. Running it as shell would expand any "$" in a key or password.
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in [A-Za-z_]*=*) ;; *) continue ;; esac
  key="${line%%=*}"; val="${line#*=}"
  case "$key" in *[!A-Za-z0-9_]*) continue ;; esac
  case "$val" in \"*\") val="${val#\"}"; val="${val%\"}" ;; \'*\') val="${val#\'}"; val="${val%\'}" ;; esac
  export "$key=$val"
done < "$ENV_FILE"

head_ "Your agent"
if systemctl is-active --quiet fieldagent 2>/dev/null; then ok "running"
else no "not running — start it with: sudo systemctl start fieldagent"; fi

if curl -fsS --max-time 5 --noproxy "127.0.0.1,localhost" "http://127.0.0.1:${PORT:-8788}/health" >/dev/null 2>&1; then ok "answering"
else no "not answering — see what went wrong with: sudo journalctl -u fieldagent -n 40"; fi

head_ "The app on your phone"
if [ -f "$ROOT/web/dist/index.html" ]; then ok "built"
else no "not built — run: cd web && npm ci && npm run build"; fi

if [ -n "${PUBLIC_BASE_URL:-}" ]; then
  if curl -fsS --max-time 8 "$PUBLIC_BASE_URL/health" >/dev/null 2>&1; then ok "reachable at $PUBLIC_BASE_URL"
  else no "cannot reach $PUBLIC_BASE_URL from here — check https and your domain"; fi
  case "$PUBLIC_BASE_URL" in
    https://*) ok "https on (the camera and microphone need this)" ;;
    *) no "not https — phones will refuse the camera and microphone" ;;
  esac
fi

head_ "The brain, which does the work"
# Only the selected one has to be working. Reporting a missing Hermes as a
# problem on a machine that runs Claude sends the owner off fixing nothing.
if [ "${AGENT_RUNTIME:-anthropic}" = "hermes" ]; then
  if [ -n "${HERMES_CHECKOUT:-}" ] && [ -f "$HERMES_CHECKOUT/run_agent.py" ]; then
    ok "set to Hermes, found at $HERMES_CHECKOUT"
    if "${HERMES_PYTHON:-python3}" -c "import sys; sys.path.insert(0,'$HERMES_CHECKOUT'); import run_agent" 2>/dev/null; then ok "it loads"
    else no "it will not load with ${HERMES_PYTHON:-python3} — set HERMES_PYTHON to the right interpreter"; fi
    # Hermes gets its own home per owner here, so its settings elsewhere on this machine do not apply.
    if [ -n "${HERMES_PROVIDER:-}" ]; then ok "model provider: $HERMES_PROVIDER${HERMES_MODEL:+, model $HERMES_MODEL}"
    else meh "no model provider named — set HERMES_PROVIDER and HERMES_MODEL in .env, or Hermes picks one from the keys it is given"; fi
  else
    no "set to Hermes, but it is not on this machine — set HERMES_CHECKOUT to the folder holding run_agent.py"
  fi
  [ -n "${ANTHROPIC_API_KEY:-}" ] && meh "Claude is set up too — switch with AGENT_RUNTIME=anthropic in .env"
elif [ "${AGENT_RUNTIME:-anthropic}" = "claude" ]; then
  # Claude Code keeps its own login in the service user's home, so ask it as
  # that user. The app never reads the login; neither does this script.
  SVC="$(systemctl show -p User --value fieldagent 2>/dev/null)"; SVC="${SVC:-$(id -un)}"
  as_svc() { if [ "$(id -un)" = "$SVC" ]; then "$@"; else sudo -u "$SVC" -H "$@"; fi; }
  BIN="${CLAUDE_CODE_BIN:-claude}"
  if ! as_svc "$BIN" --version >/dev/null 2>&1; then
    no "set to Claude Code, but it is not installed for $SVC — see https://code.claude.com/docs/en/quickstart"
  elif ! as_svc "$BIN" auth status --json 2>/dev/null | grep -q '"loggedIn": *true'; then
    no "set to Claude Code, but it is not signed in — run: sudo -u $SVC -H $BIN auth login"
  else
    ok "set to Claude Code, signed in with your Claude subscription"
    if [ -n "${CLAUDE_CODE_OWNER:-}" ]; then ok "only $CLAUDE_CODE_OWNER's tasks run on it (a subscription is for one person)"
    else no "CLAUDE_CODE_OWNER is not set, so no task can use it — add CLAUDE_CODE_OWNER=owner to .env"; fi
    if [ "$LIVE" = 1 ]; then
      if (cd /tmp && as_svc "$BIN" -p 'Reply with exactly: OK' --tools '' --strict-mcp-config --no-session-persistence --output-format json 2>/dev/null) | grep -q '"result": *"OK'; then ok "answered a live test"
      else no "did not answer a live test — try: sudo -u $SVC -H $BIN -p hello"; fi
    else
      meh "to try it for real (uses a little of your plan): bash deploy/doctor.sh --live"
    fi
  fi
  [ -n "${ANTHROPIC_API_KEY:-}" ] && meh "hosted Claude is set up too — switch with AGENT_RUNTIME=anthropic in .env"
else
  # A key that is merely present is not a key that works. This asks Anthropic.
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    no "set to Claude, but there is no key — add ANTHROPIC_API_KEY to .env, or set AGENT_RUNTIME=hermes"
  elif curl -fsS --max-time 10 -o /dev/null \
         -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
         "${ANTHROPIC_BASE_URL:-https://api.anthropic.com}/v1/models"; then
    ok "set to Claude, hosted by Anthropic"
    ok "the key works"
  else
    no "set to Claude, but the key was refused or Anthropic cannot be reached from this machine"
  fi
  [ -n "${HERMES_CHECKOUT:-}" ] && meh "Hermes is set up too — switch with AGENT_RUNTIME=hermes in .env"
fi

head_ "Gemini, which lets it see and talk"
if [ -n "${GOOGLE_API_KEY:-}" ]; then ok "key set"
else no "no key — add GOOGLE_API_KEY to .env"; fi

head_ "Talking out loud"
if [ -n "${LIVEKIT_URL:-}" ] && [ -n "${LIVEKIT_API_KEY:-}" ] && [ -n "${LIVEKIT_API_SECRET:-}" ]; then
  ok "LiveKit set up"
  if systemctl is-active --quiet fieldagent-voice 2>/dev/null; then ok "voice worker running"
  else no "voice worker not running — sudo systemctl start fieldagent-voice"; fi
else
  meh "not set up yet — typing and photos still work without it"
fi

head_ "Using a browser"
# Read-only calls: listing costs nothing, and a refused key is caught here rather than mid-task.
if [ -n "${BROWSERBASE_API_KEY:-}" ]; then
  if curl -fsS --max-time 10 -o /dev/null -H "X-BB-API-Key: $BROWSERBASE_API_KEY" "${BROWSERBASE_API_BASE:-https://api.browserbase.com}/v1/sessions?status=RUNNING"; then ok "Browserbase: the key works"
  else no "Browserbase refused the key, or cannot be reached from this machine"; fi
fi
if [ -n "${BROWSER_USE_API_KEY:-}" ]; then
  if curl -fsS --max-time 10 -o /dev/null -H "X-Browser-Use-API-Key: $BROWSER_USE_API_KEY" "${BROWSER_USE_API_BASE:-https://api.browser-use.com/api/v4}/runs?limit=1"; then ok "Browser Use: the key works"
  else no "Browser Use refused the key, or cannot be reached from this machine"; fi
fi
[ -z "${BROWSERBASE_API_KEY:-}${BROWSER_USE_API_KEY:-}" ] && meh "not set up — your employee can still read public web pages"

head_ "Who can get in"
if [ "${REGISTRATION_OPEN:-true}" = "false" ]; then ok "only you (nobody can sign themselves up)"
else no "anyone who finds the address can sign up — set REGISTRATION_OPEN=false in .env"; fi
if [ "${AUTO_APPROVE_ALL:-false}" = "true" ]; then no "AUTO_APPROVE_ALL is on — any sign-up is let straight in. Remove it from .env"; fi

head_ "How to get in"
printf '  Open   %s\n' "${PUBLIC_BASE_URL:-not set}"
printf '  Code   %s\n' "${GATEWAY_TOKENS%%:*}"

if [ "$PROBLEMS" -eq 0 ]; then printf '\n\033[32mEverything is connected.\033[0m\n\n'
else printf '\n\033[31m%s thing(s) need fixing — see the ✗ marks above.\033[0m\n\n' "$PROBLEMS"; fi
exit 0
