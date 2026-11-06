// Package testenv points integration tests at their services.
package testenv

import (
	"os"
	"testing"
)

const (
	composeRedis    = "127.0.0.1:63809"
	composePostgres = "postgres://s2g:s2g@127.0.0.1:54339/s2g?sslmode=disable"
)

// PostgresURL is TEST_DATABASE_URL, or the Postgres from deploy/compose.yaml. A
// branch that adds a migration needs its own: goose goes by number alone, so two
// branches sharing one database silently skip each other's files.
func PostgresURL() string {
	if url := os.Getenv("TEST_DATABASE_URL"); url != "" {
		return url
	}
	return composePostgres
}

// RedisAddr is TEST_REDIS_ADDR, or the Redis from deploy/compose.yaml.
func RedisAddr() string {
	if addr := os.Getenv("TEST_REDIS_ADDR"); addr != "" {
		return addr
	}
	return composeRedis
}

// OwnRedis skips a test that deletes keys unless TEST_REDIS_ADDR gives it a Redis
// nobody else is using. The compose one may be serving a running app.
func OwnRedis(t testing.TB) {
	t.Helper()
	if os.Getenv("TEST_REDIS_ADDR") == "" {
		t.Skip("deletes Redis keys, so it needs TEST_REDIS_ADDR")
	}
}
