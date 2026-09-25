-- 预约试听与课时流水查询所需的数据结构。D1 使用 SQLite 语义。
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS trial_appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guardian_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  child_name TEXT NOT NULL,
  child_age INTEGER,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  preferred_date TEXT,
  preferred_time TEXT NOT NULL DEFAULT 'ANY' CHECK (preferred_time IN ('ANY', 'MORNING', 'AFTERNOON', 'EVENING')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED')),
  handled_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_note TEXT,
  handled_at TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trial_appointments_status_created
  ON trial_appointments(status, created_at);
CREATE INDEX IF NOT EXISTS idx_trial_appointments_user_created
  ON trial_appointments(user_id, created_at);

INSERT OR IGNORE INTO permission_catalog (code, name, group_name)
VALUES
  ('trial.read', '查看试听预约', '试听预约'),
  ('trial.write', '处理试听预约', '试听预约');

INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
SELECT roles.code, permissions.code
FROM (SELECT 'OPERATOR' AS code UNION ALL SELECT 'ADMIN') AS roles
JOIN (SELECT 'trial.read' AS code UNION ALL SELECT 'trial.write') AS permissions
WHERE EXISTS (SELECT 1 FROM permission_catalog WHERE permission_catalog.code = permissions.code);
