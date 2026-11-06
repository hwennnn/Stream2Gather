// Package testenv points integration tests at their services.
package testenv

import (
	"os"
	"testing"
)

const composeRedis = "127.0.0.1:63809"

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
