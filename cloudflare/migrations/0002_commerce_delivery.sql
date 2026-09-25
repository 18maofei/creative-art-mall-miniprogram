CREATE TABLE IF NOT EXISTS shipping_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  province TEXT NOT NULL,
  city TEXT NOT NULL,
  district TEXT NOT NULL,
  detail TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE orders ADD COLUMN shipping_address_id INTEGER REFERENCES shipping_addresses(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN recipient_name_snapshot TEXT;
ALTER TABLE orders ADD COLUMN recipient_mobile_snapshot TEXT;
ALTER TABLE orders ADD COLUMN shipping_address_snapshot TEXT;
ALTER TABLE orders ADD COLUMN tracking_no TEXT;
ALTER TABLE orders ADD COLUMN shipped_at TEXT;
ALTER TABLE orders ADD COLUMN completed_at TEXT;
ALTER TABLE orders ADD COLUMN cancelled_at TEXT;

CREATE INDEX IF NOT EXISTS idx_shipping_addresses_user_default ON shipping_addresses(user_id, is_default);
