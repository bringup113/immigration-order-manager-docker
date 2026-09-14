CREATE TABLE IF NOT EXISTS order_number_counters (
  prefix TEXT PRIMARY KEY,
  last_sequence INTEGER NOT NULL CHECK (last_sequence > 0),
  updated_at TEXT NOT NULL
);
