.PHONY: up down voice voice-keys push-keys web serve worker notifier temporal test sample e2e e2e-voice e2e-push flows perf

up:
	docker compose -f deploy/compose.yaml up -d --wait

down:
	docker compose -f deploy/compose.yaml down

# Writes local LiveKit keys into server/.env.local once. `make voice` reads them from there.
voice-keys:
	@umask 077; grep -q '^LIVEKIT_API_SECRET=' server/.env.local 2>/dev/null || \
		printf 'LIVEKIT_URL=ws://127.0.0.1:17880\nLIVEKIT_API_KEY=dev%s\nLIVEKIT_API_SECRET=%s\n' \
		"$$(openssl rand -hex 6)" "$$(openssl rand -hex 24)" >> server/.env.local

# Writes local VAPID keys into server/.env.local once. Only `make notifier` needs the private one.
push-keys:
	@cd server && umask 077; grep -q '^VAPID_PRIVATE_KEY=' .env.local 2>/dev/null || go run ./cmd/s2g vapid-keys >> .env.local

voice: voice-keys
	. server/.env.local && LIVEKIT_KEYS="$$LIVEKIT_API_KEY: $$LIVEKIT_API_SECRET" \
		docker compose -f deploy/compose.yaml --profile voice up -d livekit

web:
	cd web && npm ci && npm run build

serve:
	cd server && PUBLIC_ORIGIN=http://localhost:18080 go run ./cmd/s2g serve

temporal:
	mkdir -p server/.data
	temporal server start-dev --port 7235 --ui-port 8235 --db-filename server/.data/temporal.db --namespace s2g --headless

worker:
	cd server && go run ./cmd/s2g worker

notifier:
	cd server && go run ./cmd/s2g notifier

test:
	cd server && go test -race ./...
	cd web && npm test

# The browser test serves this from its own build.
SAMPLE ?= .data/sample.mp4

sample:
	ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=640x360:rate=30:duration=300 \
		-f lavfi -i sine=frequency=330:duration=300 -c:v libx264 -preset veryfast -g 30 \
		-pix_fmt yuv420p -c:a aac -b:a 48k -shortest -movflags +faststart $(SAMPLE)

# Starts its own server. All it needs running first is `make up`.
e2e:
	./e2e/run.sh

e2e-voice:
	E2E_SCRIPT=voice.mjs ./e2e/run.sh

# Needs `make temporal` and `make push-keys`. Runs the notifier itself, and sends only to a fake push service.
e2e-push:
	E2E_SCRIPT=push.mjs ./e2e/run.sh

# Every user flow against a real server, Postgres and Redis. GREP narrows it.
flows:
	cd e2e && npm ci --silent && node flows.mjs $(if $(GREP),--grep '$(GREP)')

# Needs Docker and Google Chrome. Measures a busy room in throttled Chrome on its own databases, and fails over e2e/perf-budgets.json.
perf:
	cd e2e && npm ci --silent && node perf.mjs
