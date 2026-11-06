-- +goose Up
CREATE TABLE crew_sessions (
  id text PRIMARY KEY,
  crew_id text NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  started_by text REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz);
CREATE UNIQUE INDEX crew_sessions_open ON crew_sessions (crew_id) WHERE ended_at IS NULL;
CREATE INDEX crew_sessions_history ON crew_sessions (crew_id, started_at DESC);

CREATE TABLE session_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id text NOT NULL REFERENCES crew_sessions(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_id text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz);
CREATE INDEX session_items_session ON session_items (session_id);
CREATE INDEX session_items_video ON session_items (source, source_id);

CREATE TABLE session_people (
  session_id text NOT NULL REFERENCES crew_sessions(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  display_name text NOT NULL,
  is_guest boolean NOT NULL,
  joined_at timestamptz NOT NULL,
  left_at timestamptz,
  PRIMARY KEY (session_id, user_id));
CREATE INDEX session_people_user ON session_people (user_id);

CREATE TABLE moments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  crew_id text NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  session_id text REFERENCES crew_sessions(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_id text NOT NULL,
  pos_ms bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reaction','chat')),
  origin text NOT NULL DEFAULT 'live' CHECK (origin IN ('live','catchup')),
  user_id text,
  author_name text NOT NULL,
  emoji text,
  message_id bigint REFERENCES messages(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now());
CREATE INDEX moments_video ON moments (crew_id, source, source_id, pos_ms);
CREATE INDEX moments_message ON moments (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX moments_session ON moments (session_id);
CREATE INDEX moments_user ON moments (user_id);

-- Written here, drained by the notifier.
CREATE TABLE outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('session.started','recap.ready')),
  ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz);
CREATE INDEX outbox_waiting ON outbox (id) WHERE done_at IS NULL;

-- +goose Down
DROP TABLE outbox;
DROP TABLE moments;
DROP TABLE session_people;
DROP TABLE session_items;
DROP TABLE crew_sessions;
