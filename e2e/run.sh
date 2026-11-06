#!/usr/bin/env bash
# Runs an e2e script, sync.mjs unless told otherwise, against a private server and a fresh web build, so it never
# touches a server in use or tests stale code. Needs `make up` and Google Chrome.
#   E2E_PORT    port for the private server (18082)
#   E2E_SAMPLE  the test video, made here if missing (.data/sample.mp4)
#   E2E_OUT     where sync.mjs leaves its screenshots (a temporary folder)
#   E2E_SCRIPT  which script to run (sync.mjs)
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
port=${E2E_PORT:-18082}
sample=${E2E_SAMPLE:-$root/.data/sample.mp4}
work=$(mktemp -d)
web=$work/web
out=${E2E_OUT:-$work}
base=http://127.0.0.1:$port

server=
stop() {
  if [ -n "$server" ]; then kill "$server" 2>/dev/null && wait "$server" 2>/dev/null || true; fi
  rm -rf "$work"
}
trap stop EXIT

[ -d "$root/web/node_modules" ] || (cd "$root/web" && npm ci)
(cd "$root/web" && npx vite build --outDir "$web" --emptyOutDir)
if [ ! -f "$sample" ]; then
  mkdir -p "$(dirname "$sample")"
  make -C "$root" sample SAMPLE="$sample"
fi
cp "$sample" "$web/sample.mp4"
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
BASE=$base node "${E2E_SCRIPT:-sync.mjs}" "$out"
