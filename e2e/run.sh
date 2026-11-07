#!/usr/bin/env bash
# Runs e2e scripts against a private server and a fresh web build, so it never touches
# a server in use or tests stale code. Needs `make up` and Google Chrome.
#   E2E_PORT    port for the private server (18082)
#   E2E_SAMPLE  the test video, made here if missing (.data/sample.mp4)
#   E2E_OUT     where the scripts leave their screenshots (a temporary folder)
#   E2E_SCRIPT  which scripts to run ("sync.mjs crews.mjs recaps.mjs catchup.mjs")
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
port=${E2E_PORT:-18082}
sample=${E2E_SAMPLE:-$root/.data/sample.mp4}
work=$(mktemp -d)
web=$work/web
out=${E2E_OUT:-$work}
base=http://localhost:$port
scripts=${E2E_SCRIPT:-sync.mjs crews.mjs recaps.mjs catchup.mjs}
# crews.mjs signs its own cookies, so the server needs a key it knows. Nothing else uses this one.
export SESSION_KEY=${SESSION_KEY:-$(openssl rand -base64 32)}
export DATABASE_URL=${DATABASE_URL:-postgres://s2g:s2g@127.0.0.1:54339/s2g?sslmode=disable}

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
# Only sync.mjs plays HLS, and CI's runners have no ffmpeg for the rest to wait on.
if [[ " $scripts " == *" sync.mjs "* ]]; then
  mkdir -p "$web/hls"
  ffmpeg -loglevel error -y -i "$sample" -t 60 -c copy -hls_time 4 -hls_playlist_type vod \
    -hls_segment_filename "$web/hls/%03d.ts" "$web/hls/index.m3u8"
fi
[ -d "$root/e2e/node_modules" ] || (cd "$root/e2e" && npm ci)
(cd "$root/server" && go build -o "$work/s2g" ./cmd/s2g && go build -o "$work/mint-account" ./cmd/mint-account)

# It runs from server/ so that a YOUTUBE_API_KEY in .env.local applies, as with `make serve`.
# Clerk stays off, because it would sign out the accounts crews.mjs makes.
(cd "$root/server" && HTTP_ADDR=127.0.0.1:$port PUBLIC_ORIGIN=$base ALLOW_DIRECT_MEDIA=true WEB_DIR=$web \
  CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= \
  exec "$work/s2g" serve) >"$work/server.log" 2>&1 &
server=$!

for _ in $(seq 1 100); do
  curl -sf "$base/readyz" >/dev/null && break
  kill -0 "$server" 2>/dev/null || { cat "$work/server.log"; exit 1; }
  sleep 0.1
done

cd "$root/e2e"
for script in $scripts; do
  BASE=$base S2G=$work/s2g E2E_NOTIFIER=$work/s2g E2E_MINT=$work/mint-account E2E_SERVER_DIR=$root/server node "$script" "$out"
done
