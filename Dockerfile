# Builds the gateway together with the phone client it serves.
#
# The gateway resolves the web build relative to its own source, so the image
# reproduces the repository layout (/app/gateway + /app/web/dist) and the same
# path works in development and in production. Build from the repository root:
#
#   docker build -t visionclaw .
#   fly deploy --config gateway/fly.toml --dockerfile Dockerfile .
#
# Node 22 is what this tree is tested on. gateway/package.json still declares
# engines >= 24, which only makes npm print EBADENGINE; see docs/SETUP.md.

FROM node:22-alpine AS web
WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/tsconfig.json web/vite.config.ts web/index.html ./
COPY web/public ./public
COPY web/src ./src
# Fails the image if the client does not typecheck or build, rather than
# shipping a gateway that serves nothing on '/'.
RUN npm run build

FROM node:22-alpine
WORKDIR /app/gateway

COPY gateway/package.json gateway/package-lock.json ./
# tsx is a devDependency and `npm start` runs through it, so dev deps ship too.
RUN npm ci --include=dev

COPY gateway/tsconfig.json ./
COPY gateway/src ./src
COPY gateway/public ./public
COPY --from=web /build/dist /app/web/dist

ENV NODE_ENV=production
ENV PORT=8788
EXPOSE 8788

# Operational data (store file, SQLite database, artifacts, per-owner Hermes
# homes) belongs on a mounted volume, not in the image layer.
VOLUME ["/data"]

CMD ["npm", "start"]
