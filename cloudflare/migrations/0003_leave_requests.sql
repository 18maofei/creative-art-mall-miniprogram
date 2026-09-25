CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id),
  session_id INTEGER NOT NULL REFERENCES class_sessions(id),
  requested_by_user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reviewed_by_user_id INTEGER REFERENCES users(id),
  review_note TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (child_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_child_status ON leave_requests(child_id, status);
