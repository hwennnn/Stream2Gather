-- +goose Up
-- A client names each chat line, so that a retry can't store it twice.
ALTER TABLE messages ADD COLUMN client_id text;
CREATE UNIQUE INDEX messages_client_id ON messages (room_id, user_id, client_id) WHERE client_id IS NOT NULL;

-- +goose Down
DROP INDEX messages_client_id;
ALTER TABLE messages DROP COLUMN client_id;
