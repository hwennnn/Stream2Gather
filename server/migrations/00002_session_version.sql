-- +goose Up
-- Sign-out bumps this, which turns away every copy of that person's cookie.
-- Zero matches cookies issued before it existed, which carry no version.
ALTER TABLE users ADD COLUMN session_version bigint NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE users DROP COLUMN session_version;
