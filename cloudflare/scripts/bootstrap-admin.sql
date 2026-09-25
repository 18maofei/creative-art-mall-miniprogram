-- 生产环境首次初始化：只创建一个可用 ADMIN，不写入课程、商品或演示用户。
-- 执行后使用 Cloudflare Secret ADMIN_PASSWORD 登录一次，系统会自动写入密码哈希。
INSERT INTO users (wechat_openid, display_name, mobile, avatar_url, admin_password_hash, status)
SELECT 'bootstrap-admin', '画室管理员', NULL, NULL, NULL, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE wechat_openid = 'bootstrap-admin');

INSERT OR IGNORE INTO user_roles (user_id, role)
SELECT id, 'ADMIN' FROM users WHERE wechat_openid = 'bootstrap-admin';
