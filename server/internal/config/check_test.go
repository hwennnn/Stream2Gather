package config

import (
	"strings"
	"testing"
)

const key = "c2Vzc2lvbg=="

func TestSettingsThatWouldBeQuietlyUnsafeAreRefused(t *testing.T) {
	cases := []struct {
		name  string
		cfg   Config
		proxy string
		want  string
	}{
		{"dev on a public origin", Config{Env: "dev", PublicOrigin: "https://s2g.example", HTTPAddr: "127.0.0.1:1"}, "", "not local"},
		{"dev on every interface", Config{Env: "dev", PublicOrigin: "http://localhost:1", HTTPAddr: ":8080"}, "", "not loopback"},
		{"dev on a network address", Config{Env: "dev", PublicOrigin: "http://localhost:1", HTTPAddr: "0.0.0.0:8080"}, "", "not loopback"},
		{"a mistyped proxy setting", Config{Env: "dev", PublicOrigin: "http://localhost:1", HTTPAddr: "127.0.0.1:1"}, "1", "true or false"},
		{"production with no key", Config{Env: "production", PublicOrigin: "https://s2g.example"}, "true", "SESSION_KEY"},
		{"production over http", Config{Env: "production", PublicOrigin: "http://s2g.example", SessionKey: key}, "true", "https"},
		{"production silent on the proxy", Config{Env: "production", PublicOrigin: "https://s2g.example", SessionKey: key}, "", "TRUSTED_PROXY"},
		{"a mistyped environment is not dev", Config{Env: "prod", PublicOrigin: "https://s2g.example"}, "true", "SESSION_KEY"},
	}
	for _, c := range cases {
		if err := c.cfg.check(c.proxy); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: err = %v, want it to mention %q", c.name, err, c.want)
		}
	}
}

func TestSettingsPeopleReallyUseStillStart(t *testing.T) {
	cases := []struct {
		name  string
		cfg   Config
		proxy string
	}{
		{"the defaults", Config{Env: "dev", PublicOrigin: "http://127.0.0.1:5273", HTTPAddr: "127.0.0.1:18080"}, ""},
		{"a named local origin", Config{Env: "dev", PublicOrigin: "http://ta.localhost:18096", HTTPAddr: "127.0.0.1:18096"}, "true"},
		{"plain localhost", Config{Env: "dev", PublicOrigin: "http://localhost:18080", HTTPAddr: "localhost:18080"}, ""},
		{"ipv6 loopback", Config{Env: "dev", PublicOrigin: "http://[::1]:1", HTTPAddr: "[::1]:1"}, ""},
		{"behind one proxy", Config{Env: "production", PublicOrigin: "https://s2g.example", SessionKey: key}, "true"},
		{"no proxy, stated", Config{Env: "production", PublicOrigin: "https://s2g.example", SessionKey: key}, "false"},
	}
	for _, c := range cases {
		if err := c.cfg.check(c.proxy); err != nil {
			t.Errorf("%s: %v", c.name, err)
		}
	}
}
