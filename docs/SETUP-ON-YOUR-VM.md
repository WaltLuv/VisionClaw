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
turns on https. It asks you for three things only you know:

- the web address you will open on your phone
- your Google Gemini API key
- your LiveKit details, if you want to talk out loud (you can skip and add later)

It is safe to run again — it keeps what you have already answered.

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
- **Only you can sign in.** The installer sets `REGISTRATION_OPEN=false`. Do not
  set `AUTO_APPROVE_ALL=true` on a public address — anyone who found it could
  sign themselves up.
- **Your keys live in `.env`** next to this folder, readable only by you. It is
  never committed.

## If something breaks

```bash
sudo journalctl -u fieldagent -n 50        # the app
sudo journalctl -u fieldagent-voice -n 50  # talking out loud
sudo systemctl restart fieldagent
```

A 404 on the home page with everything else working means the phone app was not
built: `cd web && npm ci && npm run build`.
