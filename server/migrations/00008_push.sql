-- +goose Up
CREATE TABLE push_subscriptions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_ok_at timestamptz);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

CREATE TABLE notification_log (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crew_id text NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  kind text NOT NULL,
  ref text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, ref));
CREATE INDEX notification_log_cap ON notification_log (user_id, crew_id, sent_at DESC);

-- +goose Down
DROP TABLE notification_log;
DROP TABLE push_subscriptions;
