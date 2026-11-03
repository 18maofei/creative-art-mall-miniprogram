ALTER TABLE artworks ADD COLUMN description TEXT;

INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
  SELECT 'OPERATOR', code FROM permission_catalog WHERE code IN ('artwork.read', 'artwork.write');

CREATE TABLE IF NOT EXISTS artwork_likes (
  artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (artwork_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_artwork_likes_user
  ON artwork_likes(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS artwork_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'REJECTED')),
  moderated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  moderated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artwork_comments_public
  ON artwork_comments(artwork_id, status, id DESC);
CREATE INDEX IF NOT EXISTS idx_artwork_comments_review
  ON artwork_comments(status, id DESC);
