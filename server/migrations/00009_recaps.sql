-- +goose Up
-- doc holds no title, thumbnail, author or duration from any source. Those are
-- joined from media when it's read.
CREATE TABLE session_recaps (
  session_id text PRIMARY KEY REFERENCES crew_sessions(id) ON DELETE CASCADE,
  doc jsonb NOT NULL,
  share_token text UNIQUE,
  built_at timestamptz NOT NULL DEFAULT now());

-- +goose Down
DROP TABLE session_recaps;
