import { run } from './turso.js'

const statements = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, openid TEXT UNIQUE, name TEXT NOT NULL, mobile TEXT, avatar_url TEXT, role TEXT NOT NULL DEFAULT 'VISITOR', status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY AUTOINCREMENT, guardian_user_id INTEGER NOT NULL, name TEXT NOT NULL, age INTEGER, avatar_url TEXT, remaining_lessons INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (guardian_user_id) REFERENCES users(id))`,
  `CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL, age_range TEXT, sessions INTEGER NOT NULL, price INTEGER NOT NULL, schedule TEXT, campus TEXT, room TEXT, teacher_name TEXT, description TEXT, cover_url TEXT, status TEXT NOT NULL DEFAULT 'DRAFT', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL, stock INTEGER NOT NULL DEFAULT 0, sales INTEGER NOT NULL DEFAULT 0, description TEXT, cover_url TEXT, status TEXT NOT NULL DEFAULT 'DRAFT', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS resources (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, type TEXT NOT NULL, url TEXT NOT NULL, size_bytes INTEGER, created_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (created_by) REFERENCES users(id))`,
  `CREATE TABLE IF NOT EXISTS artworks (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, title TEXT NOT NULL, image_url TEXT NOT NULL, category TEXT, status TEXT NOT NULL DEFAULT 'PUBLISHED', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (student_id) REFERENCES students(id))`,
  `CREATE TABLE IF NOT EXISTS enrollments (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, course_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(student_id, course_id), FOREIGN KEY (student_id) REFERENCES students(id), FOREIGN KEY (course_id) REFERENCES courses(id))`,
  `CREATE TABLE IF NOT EXISTS class_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, teacher_user_id INTEGER, starts_at TEXT NOT NULL, ends_at TEXT, campus TEXT, room TEXT, status TEXT NOT NULL DEFAULT 'SCHEDULED', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (course_id) REFERENCES courses(id), FOREIGN KEY (teacher_user_id) REFERENCES users(id))`,
  `CREATE TABLE IF NOT EXISTS attendance (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, student_id INTEGER NOT NULL, status TEXT NOT NULL, confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(session_id, student_id), FOREIGN KEY (session_id) REFERENCES class_sessions(id), FOREIGN KEY (student_id) REFERENCES students(id))`,
  `CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, student_id INTEGER, content TEXT NOT NULL, homework TEXT, images_json TEXT, status TEXT NOT NULL DEFAULT 'DRAFT', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (session_id) REFERENCES class_sessions(id), FOREIGN KEY (student_id) REFERENCES students(id))`,
  `CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT NOT NULL UNIQUE, buyer_user_id INTEGER NOT NULL, type TEXT NOT NULL, subject_id INTEGER, subject_title TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (buyer_user_id) REFERENCES users(id))`,
  `CREATE TABLE IF NOT EXISTS announcements (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT NOT NULL, audience TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', published_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS analytics_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_name TEXT NOT NULL, role TEXT, user_id INTEGER, page TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`,
  `CREATE INDEX IF NOT EXISTS idx_events_created_at ON analytics_events(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_courses_status ON courses(status)`,
  `CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)`
]

export async function ensureSchema() {
  for (const sql of statements) await run(sql)
  const columns = await run('PRAGMA table_info(users)')
  if (!columns.rows.some(column => column.name === 'admin_password_hash')) {
    await run('ALTER TABLE users ADD COLUMN admin_password_hash TEXT')
  }
}
