-- +goose Up
CREATE TABLE users (
  id           text PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('guest', 'clerk')),
  clerk_id     text UNIQUE,
  display_name text NOT NULL,
  avatar_url   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rooms (
  id           text PRIMARY KEY,
  slug         text NOT NULL UNIQUE,
  name         text NOT NULL,
  owner_id     text NOT NULL REFERENCES users (id),
  max_members  integer NOT NULL DEFAULT 50,
  is_temporary boolean NOT NULL DEFAULT true,
  expires_at   timestamptz,
  closed_at    timestamptz,
  snapshot     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rooms_owner ON rooms (owner_id, updated_at DESC);
CREATE INDEX rooms_expiry ON rooms (expires_at) WHERE closed_at IS NULL;

CREATE TABLE messages (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id     text NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES users (id),
  author_name text NOT NULL,
  body        varchar(500) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_room ON messages (room_id, id DESC);

CREATE TABLE media (
  source           text NOT NULL,
  source_id        text NOT NULL,
  url              text NOT NULL,
  title            text NOT NULL,
  author           text NOT NULL,
  thumbnail_url    text NOT NULL,
  duration_ms      bigint NOT NULL DEFAULT 0,
  is_live          boolean NOT NULL DEFAULT false,
  embed_blocked_at timestamptz,
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_id)
);
CREATE INDEX media_refresh ON media (fetched_at);

CREATE TABLE search_cache (
  source     text NOT NULL,
  query_norm text NOT NULL,
  region     text NOT NULL,
  media_ids  text[] NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, query_norm, region)
);

CREATE TABLE quota_usage (
  day    date NOT NULL,
  bucket text NOT NULL,
  used   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, bucket)
);

-- +goose Down
DROP TABLE quota_usage;
DROP TABLE search_cache;
DROP TABLE media;
DROP TABLE messages;
DROP TABLE rooms;
DROP TABLE users;
