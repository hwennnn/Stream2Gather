-- +goose Up
-- Every refusal so far came from a page on 127.0.0.1, where YouTube gives error
-- 150 for videos that are fine, so none of them says anything about the video.
UPDATE media SET embed_blocked_at = NULL WHERE embed_blocked_at IS NOT NULL;

-- +goose Down
SELECT 1;
