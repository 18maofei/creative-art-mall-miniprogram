-- 后台账号邮箱绑定与找回密码。令牌仅保存哈希，链接 30 分钟内且仅能使用一次。
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS admin_account_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('EMAIL_VERIFY', 'PASSWORD_RESET')),
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_account_tokens_lookup
  ON admin_account_tokens(token_hash, purpose, expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_account_tokens_user
  ON admin_account_tokens(user_id, purpose, created_at);
