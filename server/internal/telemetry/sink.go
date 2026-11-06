// Package telemetry batches client timings into ClickHouse. It is best effort:
// losing samples is better than slowing or failing a viewer.
package telemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"time"
)

const (
	flushEvery = 2 * time.Second
	maxBatch   = 1000
)

// Event is one sample.
type Event struct {
	At     string  `json:"at"`
	Name   string  `json:"name"`
	Value  float64 `json:"value"`
	RoomID string  `json:"room_id"`
	UserID string  `json:"user_id"`
	Source string  `json:"source"`
	Detail string  `json:"detail"`
}

// Sink writes events over ClickHouse's HTTP interface.
type Sink struct {
	endpoint string
	user     string
	password string
	client   *http.Client
	in       chan Event
	log      *slog.Logger
}

// NewSink returns a sink for an HTTP base URL like http://user:pass@host:port/db.
func NewSink(base string, log *slog.Logger) (*Sink, error) {
	parsed, err := url.Parse(base)
	if err != nil {
		return nil, fmt.Errorf("parse clickhouse url: %w", err)
	}
	password, _ := parsed.User.Password()
	query := url.Values{"query": {"INSERT INTO " + parsed.Path[1:] + ".events FORMAT JSONEachRow"}}
	return &Sink{
		endpoint: parsed.Scheme + "://" + parsed.Host + "/?" + query.Encode(),
		user:     parsed.User.Username(),
		password: password,
		client:   &http.Client{Timeout: 5 * time.Second},
		in:       make(chan Event, 8192),
		log:      log,
	}, nil
}

// Add queues an event, dropping it if the queue is full.
func (s *Sink) Add(event Event) {
	select {
	case s.in <- event:
	default:
	}
}

// Run flushes batches until ctx ends.
func (s *Sink) Run(ctx context.Context) {
	ticker := time.NewTicker(flushEvery)
	defer ticker.Stop()

	batch := make([]Event, 0, maxBatch)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		if err := s.write(batch); err != nil {
			s.log.Warn("telemetry dropped", "events", len(batch), "error", err)
		}
		batch = batch[:0]
	}

	for {
		select {
		case <-ctx.Done():
			flush()
			return
		case event := <-s.in:
			batch = append(batch, event)
			if len(batch) >= maxBatch {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func (s *Sink) write(batch []Event) error {
	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	for _, event := range batch {
		if err := encoder.Encode(event); err != nil {
			return err
		}
	}
	request, err := http.NewRequest(http.MethodPost, s.endpoint, &body)
	if err != nil {
		return err
	}
	request.SetBasicAuth(s.user, s.password)
	response, err := s.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		detail, _ := io.ReadAll(io.LimitReader(response.Body, 300))
		return fmt.Errorf("clickhouse status %d: %s", response.StatusCode, detail)
	}
	return nil
}
