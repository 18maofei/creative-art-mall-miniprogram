ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED'));
ALTER TABLE users ADD COLUMN admin_password_hash TEXT;

ALTER TABLE courses ADD COLUMN category TEXT;
ALTER TABLE courses ADD COLUMN schedule_text TEXT;
ALTER TABLE courses ADD COLUMN campus TEXT;
ALTER TABLE courses ADD COLUMN room TEXT;
ALTER TABLE courses ADD COLUMN teacher_name TEXT;
ALTER TABLE courses ADD COLUMN cover_url TEXT;

ALTER TABLE products ADD COLUMN category TEXT;
ALTER TABLE order_items ADD COLUMN course_id INTEGER REFERENCES courses(id);
ALTER TABLE artworks ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0, 1));

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT NOT NULL,
  role TEXT,
  user_id INTEGER,
  page TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT,
  url TEXT,
  size_bytes INTEGER,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'ALL' CHECK (audience IN ('ALL', 'PARENT', 'TEACHER')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  child_id INTEGER REFERENCES children(id),
  teacher_user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  homework TEXT,
  images_json TEXT,
  status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_session_feedback_child_created ON session_feedback(child_id, created_at);
