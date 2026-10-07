PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS refund_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  out_refund_no TEXT NOT NULL UNIQUE,
  refund_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'SUCCESS', 'CLOSED', 'ABNORMAL')),
  amount REAL NOT NULL,
  reason TEXT NOT NULL,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  success_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_records_order
  ON refund_records(order_id);
CREATE INDEX IF NOT EXISTS idx_refund_records_status
  ON refund_records(status, updated_at);
