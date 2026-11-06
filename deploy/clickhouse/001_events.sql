CREATE TABLE IF NOT EXISTS s2g.events (
  at DateTime64(3),
  name LowCardinality(String),
  value Float64,
  room_id String,
  user_id String,
  source LowCardinality(String),
  detail String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(at)
ORDER BY (name, at)
TTL toDateTime(at) + INTERVAL 30 DAY;
