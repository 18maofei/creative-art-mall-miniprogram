PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wechat_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_id INTEGER NOT NULL REFERENCES trial_appointments(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACCEPTED',
  sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, appointment_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_wechat_subscriptions_appointment
  ON wechat_subscriptions(appointment_id, status);
