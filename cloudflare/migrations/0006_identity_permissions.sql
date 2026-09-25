-- 统一身份与权限模型：角色、权限、角色默认权限，以及单用户覆盖权限。
PRAGMA foreign_keys = OFF;

CREATE TABLE user_roles_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR', 'TEACHER', 'PARENT', 'STUDENT')),
  UNIQUE (user_id, role)
);
INSERT INTO user_roles_new (id, user_id, role)
  SELECT id, user_id, role FROM user_roles;
DROP TABLE user_roles;
ALTER TABLE user_roles_new RENAME TO user_roles;
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS role_catalog (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permission_catalog (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '业务权限',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_code TEXT NOT NULL REFERENCES role_catalog(code) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permission_catalog(code) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permission_catalog(code) ON DELETE CASCADE,
  effect TEXT NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, permission_code)
);

INSERT OR IGNORE INTO role_catalog (code, name, sort_order) VALUES
  ('PARENT', '家长', 10),
  ('TEACHER', '教师', 20),
  ('STUDENT', '学生', 30),
  ('OPERATOR', '运营人员', 40),
  ('ADMIN', '超级管理员', 50);

INSERT OR IGNORE INTO permission_catalog (code, name, group_name) VALUES
  ('profile.read', '查看个人资料', '小程序'),
  ('child.read', '查看学员档案', '小程序'),
  ('course.read', '查看课程', '小程序'),
  ('course.enroll', '报名课程', '小程序'),
  ('leave.create', '提交请假', '小程序'),
  ('artwork.read', '查看课堂作品', '小程序'),
  ('artwork.write', '上传课堂作品', '小程序'),
  ('feedback.read', '查看课程反馈', '小程序'),
  ('feedback.write', '发布课程反馈', '小程序'),
  ('order.read', '查看订单', '小程序'),
  ('address.manage', '管理收货地址', '小程序'),
  ('schedule.read', '查看排课', '小程序'),
  ('attendance.read', '查看考勤', '小程序'),
  ('attendance.write', '确认考勤', '小程序'),
  ('admin.access', '进入管理台', '后台'),
  ('dashboard.read', '查看运营仪表盘', '后台'),
  ('user.read', '查看用户', '后台'),
  ('user.write', '编辑用户', '后台'),
  ('child.write', '编辑学员', '后台'),
  ('course.write', '编辑课程', '后台'),
  ('schedule.write', '编辑排课', '后台'),
  ('leave.read', '查看请假', '后台'),
  ('leave.review', '审批请假', '后台'),
  ('product.read', '查看商品', '后台'),
  ('product.write', '编辑商品', '后台'),
  ('resource.read', '查看资源', '后台'),
  ('resource.write', '编辑资源', '后台'),
  ('order.write', '处理订单', '后台'),
  ('announcement.read', '查看公告', '后台'),
  ('announcement.write', '编辑公告', '后台'),
  ('report.read', '查看报表', '后台'),
  ('identity.manage', '配置身份与权限', '后台'),
  ('permission.manage', '维护权限目录', '后台'),
  ('settings.manage', '维护系统设置', '后台');

INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
  SELECT 'PARENT', code FROM permission_catalog WHERE code IN ('profile.read', 'child.read', 'course.read', 'course.enroll', 'leave.create', 'artwork.read', 'order.read', 'address.manage');
INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
  SELECT 'TEACHER', code FROM permission_catalog WHERE code IN ('profile.read', 'course.read', 'schedule.read', 'attendance.read', 'attendance.write', 'feedback.write', 'artwork.read', 'artwork.write');
INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
  SELECT 'STUDENT', code FROM permission_catalog WHERE code IN ('profile.read', 'course.read', 'schedule.read', 'artwork.read', 'feedback.read');
INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
  SELECT 'OPERATOR', code FROM permission_catalog WHERE code IN ('admin.access', 'dashboard.read', 'user.read', 'user.write', 'child.read', 'child.write', 'course.read', 'course.write', 'schedule.read', 'schedule.write', 'leave.read', 'leave.review', 'product.read', 'product.write', 'resource.read', 'resource.write', 'order.read', 'order.write', 'announcement.read', 'announcement.write', 'report.read');
INSERT OR IGNORE INTO role_permissions (role_code, permission_code)
  SELECT 'ADMIN', code FROM permission_catalog;
