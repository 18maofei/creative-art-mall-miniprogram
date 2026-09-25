-- 初始业务表。D1 使用 SQLite 语义，金额使用 REAL，日期使用 ISO 文本。
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wechat_openid TEXT UNIQUE,
  unionid TEXT UNIQUE,
  mobile TEXT,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'TEACHER', 'PARENT')),
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS children (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  birthday TEXT,
  gender TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (gender IN ('UNKNOWN', 'MALE', 'FEMALE')),
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parent_children (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT '监护人',
  UNIQUE (parent_user_id, child_id)
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  age_range TEXT,
  default_lesson_count INTEGER NOT NULL,
  price REAL NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ON_SALE', 'OFF_SALE')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  teacher_user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  campus TEXT,
  room TEXT,
  capacity INTEGER NOT NULL DEFAULT 20,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS class_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  campus TEXT,
  room TEXT,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (class_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'REFUNDED')),
  enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (child_id, class_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  child_id INTEGER NOT NULL REFERENCES children(id),
  status TEXT NOT NULL DEFAULT 'PRESENT' CHECK (status IN ('PRESENT', 'LEAVE', 'ABSENT')),
  confirmed_by_user_id INTEGER REFERENCES users(id),
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, child_id)
);

CREATE TABLE IF NOT EXISTS lesson_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id),
  enrollment_id INTEGER REFERENCES enrollments(id),
  session_id INTEGER REFERENCES class_sessions(id),
  type TEXT NOT NULL CHECK (type IN ('PURCHASE', 'GIFT', 'DEDUCT', 'REFUND', 'ADJUST', 'FREEZE', 'UNFREEZE')),
  quantity REAL NOT NULL,
  balance_after REAL NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  operator_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  cover_url TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ON_SALE', 'OFF_SALE')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_skus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku_code TEXT UNIQUE NOT NULL,
  price REAL NOT NULL,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,
  buyer_user_id INTEGER NOT NULL REFERENCES users(id),
  total_amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN ('PENDING_PAYMENT', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUNDED')),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_sku_id INTEGER REFERENCES product_skus(id),
  name_snapshot TEXT NOT NULL,
  unit_price REAL NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  transaction_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED')),
  amount REAL NOT NULL,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_user_id INTEGER NOT NULL REFERENCES users(id),
  template_key TEXT NOT NULL,
  business_type TEXT NOT NULL,
  business_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  failure_reason TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artworks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL REFERENCES children(id),
  session_id INTEGER REFERENCES class_sessions(id),
  image_url TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED', 'REVIEWING', 'REVIEWED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_review_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
  model_version TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_review_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES ai_review_tasks(id) ON DELETE CASCADE,
  dimension_scores TEXT,
  tags TEXT,
  feedback TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (task_id)
);

CREATE TABLE IF NOT EXISTS review_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  reviewer_user_id INTEGER NOT NULL REFERENCES users(id),
  feedback TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
