# Setup

Two packages run the phone-first employee: `gateway/` (the server and its API)
and `web/` (the phone client the gateway serves). `agent/` is the existing
realtime voice worker and `samples/` the native glasses apps; neither is
required to run the phone.

## Local

```bash
cd gateway && npm ci
cp .env.example .env          # then fill in at least GATEWAY_TOKENS
cd ../web && npm ci && npm run build
cd ../gateway && npm start
```

Open the gateway's URL. The client is served from `/`.

`GATEWAY_TOKENS` takes `token:userId` pairs; the token is the access code typed
into the sign-in screen. With it empty, nothing can authenticate and the gateway
says so at startup.

For client development with hot reload, run `npm run dev` in `web/` instead; it
proxies `/api`, `/livekit-token` and `/health` to `http://127.0.0.1:8788`.

## Node version

The tree is developed and tested on **Node 22**, and the image is built on
`node:22-alpine`. `gateway/package.json` still declares `engines: >=24`, so
`npm ci` prints an `EBADENGINE` warning on 22. It is a warning only and nothing
here depends on a Node 24 feature; aligning the two is a maintainer decision
rather than something to change silently.

The gateway uses `node:sqlite`, which prints an experimental-feature warning.

## The web build is not optional

The gateway serves the client from the build output, resolved relative to its
own source (`../../web/dist`), overridable with `WEB_DIST_DIR`. If that
directory has no `index.html`, startup logs:

```json
{"event":"web.missing","dir":"…","hint":"Run `npm ci && npm run build` in web/ …"}
```

and `/` returns 404 while the API and `/health` keep working. A 404 on `/` with
a healthy API means the client was not built, not that routing is broken.

## Container

The repository-root `Dockerfile` builds both packages into one image and
reproduces the repository layout inside it (`/app/gateway` and `/app/web/dist`),
so the same static path is correct in development and production. Build from the
repository root, not from `gateway/`:

```bash
docker build -t visionclaw .
```

The web stage runs the client's typecheck and build, so a client that does not
compile fails the image instead of producing a gateway that serves nothing.

## Deployment

`gateway/fly.toml` points at the root Dockerfile and expects a repository-root
context:

```bash
fly deploy --config gateway/fly.toml --dockerfile Dockerfile .
```

It mounts a volume at `/data` for `STORE_PATH`, `EMPLOYEE_DATA_DIR`, uploaded
artifacts and per-owner Hermes homes, and checks `/health` for readiness.

## Environment

Required to do anything:

| Variable | Purpose |
|---|---|
| `GATEWAY_TOKENS` | `token:userId` pairs; the access code for sign-in |
| `STATE_SECRET` | Signing secret for OAuth state |
| `PUBLIC_BASE_URL` | Public origin; must be HTTPS when `NODE_ENV=production` |
| `STORE_PATH` | Store file; its directory is the default data directory |

One runtime is required: `ANTHROPIC_API_KEY`, or `HERMES_CHECKOUT` plus
`HERMES_PYTHON` and a model provider credential. Optional capability
credentials, and what stays unavailable without each, are listed in
`docs/OWNER-ACTIONS.md`.

Useful extras: `EMPLOYEE_DATA_DIR`, `WEB_DIST_DIR`, `RUN_CAPACITY` (1-99,
default 2), `AGENT_RUNTIME` (`anthropic` or `hermes`), `MANAGED_READ_TOOLS`.

Invalid values for `AGENT_RUNTIME`, `RUN_CAPACITY`, `COMPUTER_CAPACITY` and a
non-HTTPS production `PUBLIC_BASE_URL` are rejected at startup rather than
surfacing later as a confusing failure.
