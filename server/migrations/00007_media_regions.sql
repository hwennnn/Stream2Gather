-- +goose Up
-- Where the owner limits a video. Both are empty until its metadata is next fetched.
ALTER TABLE media ADD COLUMN allowed_regions text NOT NULL DEFAULT '',
                  ADD COLUMN blocked_regions text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE media DROP COLUMN allowed_regions, DROP COLUMN blocked_regions;
