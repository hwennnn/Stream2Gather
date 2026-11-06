// Package config reads process configuration.
package config

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// Config holds server settings.
type Config struct {
	Env               string
	HTTPAddr          string
	DatabaseURL       string
	RedisAddr         string
	ClickHouseHTTP    string
	TemporalAddr      string
	TemporalNamespace string
	WebDir            string
	PublicOrigin      string
	SessionKey        string
	YouTubeAPIKey     string
	YouTubeBaseURL    string
	AllowDirectMedia  bool
	TrustedProxy      bool
	ClerkPublishable  string
	ClerkSecret       string
	SearchDailyBudget int
	LiveKit           LiveKit
	VAPID             VAPID
	EnableVimeo       bool
	EnableTwitch      bool
	TwitchParent      string
}

// LiveKit is the voice server. The zero value means voice is off.
type LiveKit struct {
	URL       string
	APIKey    string
	APISecret string
}

// minLiveKitSecret is the shortest secret LiveKit accepts.
const minLiveKitSecret = 32

// Enabled reports whether voice can mint tokens.
func (l LiveKit) Enabled() bool {
	return l.URL != "" && l.APIKey != "" && len(l.APISecret) >= minLiveKitSecret
}

// Origins lists the addresses a browser needs to reach: the socket, and the
// plain HTTP address the client probes when that socket fails.
func (l LiveKit) Origins() []string {
	if !l.Enabled() {
		return nil
	}
	if rest, ok := strings.CutPrefix(l.URL, "wss://"); ok {
		return []string{l.URL, "https://" + rest}
	}
	if rest, ok := strings.CutPrefix(l.URL, "ws://"); ok {
		return []string{l.URL, "http://" + rest}
	}
	return []string{l.URL}
}

// VAPID signs web push. Only the notifier holds the private key.
type VAPID struct {
	PublicKey  string
	PrivateKey string
	Subject    string
}

// Load reads the environment. Values in .env.local fill in anything unset, and
// the defaults match deploy/compose.yaml.
func Load() (Config, error) {
	if err := loadFile(".env.local"); err != nil {
		return Config{}, err
	}

	cfg := Config{
		Env:               env("APP_ENV", "dev"),
		HTTPAddr:          env("HTTP_ADDR", "127.0.0.1:18080"),
		DatabaseURL:       env("DATABASE_URL", "postgres://s2g:s2g@127.0.0.1:54339/s2g?sslmode=disable"),
		RedisAddr:         env("REDIS_ADDR", "127.0.0.1:63809"),
		ClickHouseHTTP:    env("CLICKHOUSE_HTTP", "http://s2g:s2g@127.0.0.1:18133/s2g"),
		TemporalAddr:      env("TEMPORAL_ADDR", "127.0.0.1:7235"),
		TemporalNamespace: env("TEMPORAL_NAMESPACE", "s2g"),
		WebDir:            env("WEB_DIR", "../web/dist"),
		PublicOrigin:      env("PUBLIC_ORIGIN", "http://127.0.0.1:5273"),
		SessionKey:        os.Getenv("SESSION_KEY"),
		YouTubeAPIKey:     os.Getenv("YOUTUBE_API_KEY"),
		YouTubeBaseURL:    env("YOUTUBE_BASE_URL", "https://www.googleapis.com/youtube/v3"),
		AllowDirectMedia:  os.Getenv("ALLOW_DIRECT_MEDIA") == "true",
		TrustedProxy:      os.Getenv("TRUSTED_PROXY") == "true",
		ClerkPublishable:  os.Getenv("CLERK_PUBLISHABLE_KEY"),
		ClerkSecret:       os.Getenv("CLERK_SECRET_KEY"),
		SearchDailyBudget: 90,
		LiveKit: LiveKit{
			URL:       os.Getenv("LIVEKIT_URL"),
			APIKey:    os.Getenv("LIVEKIT_API_KEY"),
			APISecret: os.Getenv("LIVEKIT_API_SECRET"),
		},
		VAPID: VAPID{
			PublicKey:  os.Getenv("VAPID_PUBLIC_KEY"),
			PrivateKey: os.Getenv("VAPID_PRIVATE_KEY"),
			Subject:    os.Getenv("VAPID_SUBJECT"),
		},
		EnableVimeo:  os.Getenv("ENABLE_VIMEO") == "true",
		EnableTwitch: os.Getenv("ENABLE_TWITCH") == "true",
		TwitchParent: env("TWITCH_PARENT", "localhost"),
	}
	if cfg.Env != "dev" && cfg.SessionKey == "" {
		return Config{}, fmt.Errorf("SESSION_KEY is required outside dev")
	}
	return cfg, nil
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func loadFile(path string) error {
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		key, value, found := strings.Cut(line, "=")
		if !found || strings.HasPrefix(line, "#") {
			continue
		}
		if _, set := os.LookupEnv(key); !set {
			if err := os.Setenv(key, strings.Trim(value, `"'`)); err != nil {
				return err
			}
		}
	}
	return scanner.Err()
}
