-- 演示数据。生产环境请替换名称、课程和管理员配置。
INSERT OR IGNORE INTO users (id, wechat_openid, display_name, mobile, status) VALUES
  (1, 'demo-parent-001', '李女士', '13800000001', 'ACTIVE'),
  (2, 'demo-teacher-001', '王老师', '13800000002', 'ACTIVE'),
  (3, 'demo-admin-001', '画室管理员', '13800000003', 'ACTIVE'),
  (4, 'demo-student-001', '小画家', NULL, 'ACTIVE'),
  (5, 'demo-operator-001', '运营同学', '13800000005', 'ACTIVE');

INSERT OR IGNORE INTO user_roles (user_id, role) VALUES
  (1, 'PARENT'), (2, 'TEACHER'), (3, 'ADMIN'), (4, 'STUDENT'), (5, 'OPERATOR');

INSERT OR IGNORE INTO children (id, name, gender, birthday, remark) VALUES
  (1, '乐乐', 'FEMALE', '2017-05-20', '示例学员'),
  (2, '安安', 'MALE', '2018-09-12', '示例学员');

INSERT OR IGNORE INTO parent_children (parent_user_id, child_id, relationship) VALUES
  (1, 1, '母亲'), (1, 2, '母亲');

INSERT OR IGNORE INTO courses (id, name, category, age_range, default_lesson_count, price, schedule_text, campus, room, teacher_name, description, status) VALUES
  (1, '创意美术启蒙', '艺术启蒙', '4-6岁', 12, 1280, '周六 09:00-10:30', '中心校区', 'A201', '王老师', '通过游戏和材料探索培养孩子的观察力与表达力。', 'ON_SALE'),
  (2, '少儿绘画基础', '艺术启蒙', '6-9岁', 16, 1680, '周六 14:00-15:30', '中心校区', 'A202', '王老师', '系统学习造型、色彩和构图。', 'ON_SALE'),
  (3, '创作进阶工作坊', '创作进阶', '8-12岁', 10, 1980, '周日 10:00-12:00', '中心校区', 'B101', '王老师', '围绕主题完成连续创作和作品展示。', 'ON_SALE');

INSERT OR IGNORE INTO classes (id, course_id, teacher_user_id, name, campus, room, capacity, status) VALUES
  (1, 1, 2, '周六创意美术班', '中心校区', 'A201', 20, 'ACTIVE');

INSERT OR IGNORE INTO class_sessions (id, class_id, sequence_no, starts_at, ends_at, campus, room, status) VALUES
  (1, 1, 1, datetime('now', '+7 days', '09:00:00'), datetime('now', '+7 days', '10:30:00'), '中心校区', 'A201', 'SCHEDULED');

INSERT OR IGNORE INTO enrollments (child_id, class_id, status) VALUES (1, 1, 'ACTIVE'), (2, 1, 'ACTIVE');

INSERT OR IGNORE INTO lesson_ledger (id, child_id, type, quantity, balance_after, reason, idempotency_key, operator_user_id) VALUES
  (1, 1, 'PURCHASE', 12, 12, '示例课时充值', 'seed-child-1', 3),
  (2, 2, 'PURCHASE', 12, 12, '示例课时充值', 'seed-child-2', 3);

INSERT OR IGNORE INTO products (id, name, category, description, cover_url, status) VALUES
  (1, '拾色画笔套装', '绘画工具', '适合课堂和家庭创作的基础画笔套装。', NULL, 'ON_SALE'),
  (2, '创意手工材料包', '手工材料', '包含纸张、黏土和安全装饰材料。', NULL, 'ON_SALE');

INSERT OR IGNORE INTO product_skus (id, product_id, name, sku_code, price, stock_quantity) VALUES
  (1, 1, '标准款', 'BRUSH-001', 39.90, 100),
  (2, 2, '标准款', 'CRAFT-001', 59.90, 80);

INSERT OR IGNORE INTO announcements (id, title, content, audience, status, published_at) VALUES
  (1, '春季课程报名开放', '新一期课程已开放报名，欢迎家长为孩子选择合适的班级。', 'ALL', 'PUBLISHED', datetime('now')),
  (2, '请假规则提醒', '请至少在课次开始前提交请假申请。', 'PARENT', 'PUBLISHED', datetime('now'));

INSERT OR IGNORE INTO artworks (id, child_id, session_id, image_url, title, kind, status, is_public) VALUES
  (1, 1, 1, 'https://images.unsplash.com/photo-1547891654-e66ed7ebb968?w=800', '春日的树', 'ARTWORK', 'REVIEWED', 1),
  (2, 2, 1, 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=800', '课堂花絮', 'MOMENT', 'REVIEWED', 1);
