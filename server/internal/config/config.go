// Package config reads process configuration.
package config

import (
	"bufio"
	"fmt"
	"net"
	"net/url"
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
	LookupDailyBudget int
	LiveKit           LiveKit
	VAPID             VAPID
	// NotifierHealthAddr is where s2g notifier answers health checks.
	NotifierHealthAddr string
	EnableVimeo        bool
	EnableTwitch       bool
	TwitchParent       string
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
		PublicOrigin:      namedOrigin(env("PUBLIC_ORIGIN", "http://localhost:5273")),
		SessionKey:        os.Getenv("SESSION_KEY"),
		YouTubeAPIKey:     os.Getenv("YOUTUBE_API_KEY"),
		YouTubeBaseURL:    env("YOUTUBE_BASE_URL", "https://www.googleapis.com/youtube/v3"),
		AllowDirectMedia:  os.Getenv("ALLOW_DIRECT_MEDIA") == "true",
		TrustedProxy:      os.Getenv("TRUSTED_PROXY") == "true",
		ClerkPublishable:  os.Getenv("CLERK_PUBLISHABLE_KEY"),
		ClerkSecret:       os.Getenv("CLERK_SECRET_KEY"),
		SearchDailyBudget: 90,
		// A search costs 101 of the key's 10,000 units, so 90 of them leave about 900.
		LookupDailyBudget: 800,
		LiveKit: LiveKit{
			URL:       os.Getenv("LIVEKIT_URL"),
			APIKey:    os.Getenv("LIVEKIT_API_KEY"),
			APISecret: os.Getenv("LIVEKIT_API_SECRET"),
		},
		NotifierHealthAddr: env("NOTIFIER_HEALTH_ADDR", "127.0.0.1:18090"),
		VAPID: VAPID{
			PublicKey:  os.Getenv("VAPID_PUBLIC_KEY"),
			PrivateKey: os.Getenv("VAPID_PRIVATE_KEY"),
			Subject:    os.Getenv("VAPID_SUBJECT"),
		},
		EnableVimeo:  os.Getenv("ENABLE_VIMEO") == "true",
		EnableTwitch: os.Getenv("ENABLE_TWITCH") == "true",
		TwitchParent: env("TWITCH_PARENT", "localhost"),
	}
	if err := cfg.check(os.Getenv("TRUSTED_PROXY")); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// namedOrigin gives a loopback address its name. On a page whose address is an
// IP, YouTube refuses many videos with error 150, the code an owner's own embed
// block gives, while the same videos play on localhost.
func namedOrigin(origin string) string {
	link, err := url.Parse(origin)
	if err != nil {
		return origin
	}
	ip := net.ParseIP(link.Hostname())
	if ip == nil || !ip.IsLoopback() {
		return origin
	}
	port := link.Port()
	link.Host = "localhost"
	if port != "" {
		link.Host += ":" + port
	}
	return link.String()
}

// IPOrigin reports whether a site's address is an IP, so YouTube's refusals there
// say nothing about the video.
func IPOrigin(origin string) bool {
	link, err := url.Parse(origin)
	return err == nil && net.ParseIP(link.Hostname()) != nil
}

// check refuses to start a server whose settings would quietly be unsafe. dev
// means cookies without Secure and a key on disk, so it stays on this machine.
// Anywhere else a wrong guess about the proxy puts every viewer on one address,
// sharing one set of limits, so it has to be stated.
func (c Config) check(trustedProxy string) error {
	if trustedProxy != "" && trustedProxy != "true" && trustedProxy != "false" {
		return fmt.Errorf("TRUSTED_PROXY must be true or false, not %q", trustedProxy)
	}
	origin, err := url.Parse(c.PublicOrigin)
	if err != nil {
		return fmt.Errorf("PUBLIC_ORIGIN is not a URL: %w", err)
	}
	if c.Env == "dev" {
		if !localHost(origin.Hostname()) {
			return fmt.Errorf("APP_ENV is dev but PUBLIC_ORIGIN %s is not local: set APP_ENV=production", c.PublicOrigin)
		}
		if host, _, err := net.SplitHostPort(c.HTTPAddr); err != nil || !localHost(host) {
			return fmt.Errorf("APP_ENV is dev but HTTP_ADDR %s is not loopback: set APP_ENV=production", c.HTTPAddr)
		}
		return nil
	}
	if c.SessionKey == "" {
		return fmt.Errorf("SESSION_KEY is required outside dev")
	}
	if origin.Scheme != "https" {
		return fmt.Errorf("PUBLIC_ORIGIN must be https outside dev, or Secure cookies never come back: %s", c.PublicOrigin)
	}
	if trustedProxy == "" {
		return fmt.Errorf("TRUSTED_PROXY must be set outside dev: true behind exactly one proxy, otherwise false")
	}
	return nil
}

// localHost reports whether a name can only mean this machine or a test domain.
func localHost(host string) bool {
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".test") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
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
