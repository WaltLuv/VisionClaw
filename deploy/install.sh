#!/usr/bin/env bash
# Set up the field agent on the machine that already runs Hermes.
#
# Run this on your VM, from the repository root:
#
#     sudo bash deploy/install.sh
#
# It is safe to run again: it keeps any answers you have already given and only
# fills in what is missing.
#
# Why on the same machine: the gateway runs Hermes as a local process, so it has
# to be able to see Hermes' files. That is also why it is not run in Docker
# here -- a container cannot start a program that lives on the host.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
SERVICE_USER="${SERVICE_USER:-$(logname 2>/dev/null || echo root)}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
bad()  { printf '\n\033[31m%s\033[0m\n' "$*" >&2; }

# --- what must already be here -------------------------------------------

say "Checking this machine"

command -v node >/dev/null || { bad "Node is not installed. Install Node 22 or newer, then run this again."; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || { bad "Node $NODE_MAJOR is too old. Install Node 22 or newer, then run this again."; exit 1; }
info "Node $(node -v)"

PY="${HERMES_PYTHON:-}"
command -v python3 >/dev/null || { bad "Python 3 is not installed."; exit 1; }
info "Python $(python3 -V 2>&1 | cut -d' ' -f2)"

# --- find Hermes ----------------------------------------------------------

say "Finding your Hermes agent"

find_hermes() {
  # An installed Hermes has run_agent.py at the root of its package directory.
  for base in "${HERMES_CHECKOUT:-}" "$HOME" /opt /srv /home/*; do
    [ -n "$base" ] && [ -d "$base" ] || continue
    if [ -f "$base/run_agent.py" ]; then echo "$base"; return; fi
    found="$(find "$base" -maxdepth 6 -name run_agent.py -not -path '*/node_modules/*' 2>/dev/null | head -1 || true)"
    [ -n "$found" ] && { dirname "$found"; return; }
  done
}

HERMES_DIR="${HERMES_CHECKOUT:-$(find_hermes || true)}"
if [ -z "$HERMES_DIR" ]; then
  bad "Could not find Hermes on this machine."
  info "It is the folder containing run_agent.py."
  info "Run this again with the path, for example:"
  info "  sudo HERMES_CHECKOUT=/opt/hermes/.venv/lib/python3.11/site-packages bash deploy/install.sh"
  exit 1
fi
info "Hermes: $HERMES_DIR"

if [ -z "$PY" ]; then
  # Prefer the interpreter of the environment Hermes is installed into.
  for candidate in "$HERMES_DIR/../../../bin/python" "$HERMES_DIR/.venv/bin/python" "$(command -v python3)"; do
    [ -x "$candidate" ] && { PY="$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")"; break; }
  done
fi
"$PY" -c "import sys; sys.path.insert(0, '$HERMES_DIR'); import run_agent" 2>/dev/null \
  && info "Hermes loads with $PY" \
  || { bad "Hermes is at $HERMES_DIR but will not load with $PY."; info "Set HERMES_PYTHON to the interpreter Hermes is installed for and run again."; exit 1; }

# --- answers only you have ------------------------------------------------

ask() { # ask VAR "Question" [default]
  local var="$1" prompt="$2" default="${3:-}" current existing
  current="$(grep -E "^${var}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  if [ -n "$current" ]; then echo "$current"; return; fi
  if [ -n "${!var:-}" ]; then echo "${!var}"; return; fi
  existing="$default"
  printf '  %s' "$prompt" >&2
  [ -n "$existing" ] && printf ' [%s]' "$existing" >&2
  printf ': ' >&2
  read -r answer < /dev/tty || answer=""
  echo "${answer:-$existing}"
}

say "A few things only you know"
DOMAIN="$(ask PUBLIC_DOMAIN 'The web address you will open on your phone (e.g. agent.yourcompany.com)')"
[ -n "$DOMAIN" ] || { bad "A web address is required: phones only allow the camera and microphone over https."; exit 1; }
GEMINI_KEY="$(ask GOOGLE_API_KEY 'Your Google Gemini API key (for seeing and talking)')"
LK_URL="$(ask LIVEKIT_URL 'LiveKit URL (leave blank to set up voice later)')"
LK_KEY="$(ask LIVEKIT_API_KEY 'LiveKit API key (blank to skip)')"
LK_SECRET="$(ask LIVEKIT_API_SECRET 'LiveKit API secret (blank to skip)')"

# --- write the settings ---------------------------------------------------

say "Writing settings"

keep() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }
ACCESS_CODE="$(keep GATEWAY_TOKENS)"; ACCESS_CODE="${ACCESS_CODE%%:*}"
[ -n "$ACCESS_CODE" ] || ACCESS_CODE="$(openssl rand -hex 8)"
STATE_SECRET="$(keep STATE_SECRET)"; [ -n "$STATE_SECRET" ] || STATE_SECRET="$(openssl rand -hex 32)"
SERVICE_TOKEN="$(keep GATEWAY_SERVICE_TOKEN)"; [ -n "$SERVICE_TOKEN" ] || SERVICE_TOKEN="$(openssl rand -hex 32)"

umask 077
cat > "$ENV_FILE" <<ENVEOF
# Written by deploy/install.sh. Keep this file private: it holds your keys.

# Your access code. This is what you type into the app on your phone.
GATEWAY_TOKENS=$ACCESS_CODE:owner
PUBLIC_BASE_URL=https://$DOMAIN
PORT=8788
NODE_ENV=production

# Nobody else can sign themselves up.
REGISTRATION_OPEN=false

STATE_SECRET=$STATE_SECRET
GATEWAY_SERVICE_TOKEN=$SERVICE_TOKEN
STORE_PATH=$ROOT/data/store.json
EMPLOYEE_DATA_DIR=$ROOT/data

# Your Hermes agent does the work.
AGENT_RUNTIME=hermes
HERMES_CHECKOUT=$HERMES_DIR
HERMES_PYTHON=$PY

# Gemini gives it eyes and a voice.
GOOGLE_API_KEY=$GEMINI_KEY
GEMINI_API_KEY=$GEMINI_KEY

LIVEKIT_URL=$LK_URL
LIVEKIT_API_KEY=$LK_KEY
LIVEKIT_API_SECRET=$LK_SECRET

# How the voice worker calls back in.
GATEWAY_URL=http://127.0.0.1:8788
ENVEOF
chmod 600 "$ENV_FILE"
info "Saved to $ENV_FILE"

# --- build ----------------------------------------------------------------

say "Building the app"
(cd "$ROOT/gateway" && npm ci --omit=optional --no-audit --no-fund >/dev/null 2>&1 && info "gateway ready")
(cd "$ROOT/web" && npm ci --no-audit --no-fund >/dev/null 2>&1 && npm run build >/dev/null 2>&1 && info "phone app built")

if [ -n "$LK_URL" ]; then
  say "Setting up the voice worker"
  "$PY" -m venv "$ROOT/agent/.venv" 2>/dev/null || true
  "$ROOT/agent/.venv/bin/pip" install -q -r "$ROOT/agent/requirements.txt" && info "voice worker ready"
fi

mkdir -p "$ROOT/data"
chown -R "$SERVICE_USER" "$ROOT/data" 2>/dev/null || true

# --- run it on boot -------------------------------------------------------

say "Installing services"

unit() { # unit NAME DESCRIPTION WORKDIR COMMAND
  cat > "/etc/systemd/system/$1.service" <<UNITEOF
[Unit]
Description=$2
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$3
EnvironmentFile=$ENV_FILE
ExecStart=$4
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNITEOF
}

unit fieldagent "Field agent gateway" "$ROOT/gateway" "$(command -v npm) start"
systemctl daemon-reload
systemctl enable --now fieldagent >/dev/null 2>&1
info "gateway running"

if [ -n "$LK_URL" ]; then
  unit fieldagent-voice "Field agent voice worker" "$ROOT/agent" "$ROOT/agent/.venv/bin/python main.py start"
  systemctl daemon-reload
  systemctl enable --now fieldagent-voice >/dev/null 2>&1
  info "voice worker running"
fi

# --- https ----------------------------------------------------------------

if command -v caddy >/dev/null; then
  say "Turning on https"
  cat > /etc/caddy/Caddyfile <<CADDYEOF
$DOMAIN {
  reverse_proxy 127.0.0.1:8788
}
CADDYEOF
  systemctl reload caddy 2>/dev/null || systemctl restart caddy 2>/dev/null || true
  info "https on for $DOMAIN"
else
  say "One thing left: https"
  info "Phones only allow the camera and microphone over https."
  info "Install Caddy and run this again, and it will do the rest:"
  info "  sudo apt install -y caddy"
fi

# --- done -----------------------------------------------------------------

say "Done"
printf '  Open   https://%s on your phone\n' "$DOMAIN"
printf '  Code   %s\n\n' "$ACCESS_CODE"
info "Check everything is connected:  bash deploy/doctor.sh"
