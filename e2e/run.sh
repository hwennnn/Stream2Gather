#!/usr/bin/env bash
# Runs sync.mjs against a private server, so it never touches one in use, and
# builds whatever is missing first. Needs `make up` and Google Chrome.
#   E2E_PORT  port for the private server (18082)
#   E2E_WEB   a web build to serve, built here if empty (web/dist)
#   E2E_OUT   where sync.mjs leaves its screenshots (a temporary folder)
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
port=${E2E_PORT:-18082}
web=${E2E_WEB:-$root/web/dist}
work=$(mktemp -d)
out=${E2E_OUT:-$work}
base=http://127.0.0.1:$port

server=
stop() {
  if [ -n "$server" ]; then kill "$server" 2>/dev/null && wait "$server" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap stop EXIT

if [ ! -f "$web/index.html" ]; then
  (cd "$root/web" && npm ci && npx vite build --outDir "$web")
fi
if [ ! -f "$web/sample.mp4" ]; then
  make -C "$root" sample SAMPLE="$web/sample.mp4"
fi
[ -d "$root/e2e/node_modules" ] || (cd "$root/e2e" && npm ci)
(cd "$root/server" && go build -o "$work/s2g" ./cmd/s2g)

# It runs from server/ so that a YOUTUBE_API_KEY in .env.local applies, as with `make serve`.
(cd "$root/server" && HTTP_ADDR=127.0.0.1:$port PUBLIC_ORIGIN=$base ALLOW_DIRECT_MEDIA=true WEB_DIR=$web \
  exec "$work/s2g" serve) >"$work/server.log" 2>&1 &
server=$!

for _ in $(seq 1 100); do
  curl -sf "$base/readyz" >/dev/null && break
  kill -0 "$server" 2>/dev/null || { cat "$work/server.log"; exit 1; }
  sleep 0.1
done

cd "$root/e2e"
BASE=$base node sync.mjs "$out"
