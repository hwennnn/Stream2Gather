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
	SearchDailyBudget int
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
		SearchDailyBudget: 90,
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
