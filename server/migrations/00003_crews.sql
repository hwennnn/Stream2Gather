-- +goose Up
-- Closed rooms never open again, so nothing justifies keeping their titles.
UPDATE rooms SET snapshot = NULL WHERE closed_at IS NOT NULL;

-- When a permanent room's saved titles were last checked against media.
ALTER TABLE rooms ADD COLUMN snapshot_checked_at timestamptz;

CREATE TABLE crews (
  id           text PRIMARY KEY,
  room_id      text NOT NULL UNIQUE REFERENCES rooms (id) ON DELETE CASCADE,
  invite_token text NOT NULL UNIQUE,
  guest_access boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crew_members (
  crew_id      text NOT NULL REFERENCES crews (id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  notify       text NOT NULL DEFAULT 'all' CHECK (notify IN ('all', 'off')),
  PRIMARY KEY (crew_id, user_id)
);
CREATE INDEX crew_members_user ON crew_members (user_id);

-- Only ids live here. Titles are joined from media on every read.
CREATE TABLE watchlist_items (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  crew_id            text NOT NULL REFERENCES crews (id) ON DELETE CASCADE,
  source             text NOT NULL,
  source_id          text NOT NULL,
  added_by           text REFERENCES users (id) ON DELETE SET NULL,
  added_at           timestamptz NOT NULL DEFAULT now(),
  watched_session_id text,
  removed_at         timestamptz
);
CREATE UNIQUE INDEX watchlist_items_live ON watchlist_items (crew_id, source, source_id) WHERE removed_at IS NULL;

-- +goose Down
DROP TABLE watchlist_items;
DROP TABLE crew_members;
DROP TABLE crews;
ALTER TABLE rooms DROP COLUMN snapshot_checked_at;
