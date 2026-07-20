import { getDb } from './db.js'
import { pathToFileURL } from 'node:url'

async function firstId(db, sql, params) {
  const [rows] = await db.query(sql, params)
  return rows[0]?.id
}

async function ensureUser(db, openid, name, role) {
  await db.query(
    'INSERT INTO users (wechat_openid, display_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)',
    [openid, name]
  )
  const id = await firstId(db, 'SELECT id FROM users WHERE wechat_openid = ?', [openid])
  await db.query('INSERT IGNORE INTO user_roles (user_id, role) VALUES (?, ?)', [id, role])
  return id
}

async function ensureChild(db, name) {
  let id = await firstId(db, 'SELECT id FROM children WHERE name = ? LIMIT 1', [name])
  if (!id) {
    const [result] = await db.query('INSERT INTO children (name) VALUES (?)', [name])
    id = result.insertId
  }
  return id
}

async function ensureCourse(db, name, ageRange, lessonCount, price, description) {
  let id = await firstId(db, 'SELECT id FROM courses WHERE name = ? LIMIT 1', [name])
  if (!id) {
    const [result] = await db.query(
      'INSERT INTO courses (name, age_range, default_lesson_count, price, description, status) VALUES (?, ?, ?, ?, ?, ?)',
      [name, ageRange, lessonCount, price, description, 'ON_SALE']
    )
    id = result.insertId
  }
  return id
}

export async function seedDatabase() {
  const db = getDb()
  const parentId = await ensureUser(db, 'demo-parent-001', '李女士', 'PARENT')
  const teacherId = await ensureUser(db, 'demo-teacher-001', '王老师', 'TEACHER')
  const adminId = await ensureUser(db, 'demo-admin-001', '画室管理员', 'ADMIN')
  const leleId = await ensureChild(db, '乐乐')
  const ananId = await ensureChild(db, '安安')
  const xiaomiId = await ensureChild(db, '小米')
  await db.query('INSERT IGNORE INTO parent_children (parent_user_id, child_id, relationship) VALUES (?, ?, ?)', [parentId, leleId, '母亲'])

  const artCourseId = await ensureCourse(db, '创意美术启蒙班', '6-8岁', 12, 1680, '通过色彩、构图和手作创作，帮助孩子建立观察力、表达力与创造力。')
  await ensureCourse(db, '少儿创作进阶班', '8-11岁', 16, 2280, '从主题表达、材料探索到作品展示，持续发展孩子的创作能力。')

  let classId = await firstId(db, 'SELECT id FROM classes WHERE name = ? LIMIT 1', ['创意美术启蒙班 · 周六班'])
  if (!classId) {
    const [result] = await db.query(
      'INSERT INTO classes (course_id, teacher_user_id, name, campus, room, capacity) VALUES (?, ?, ?, ?, ?, ?)',
      [artCourseId, teacherId, '创意美术启蒙班 · 周六班', 'A校区', '201', 12]
    )
    classId = result.insertId
  }

  for (const childId of [leleId, ananId, xiaomiId]) {
    await db.query('INSERT IGNORE INTO enrollments (child_id, class_id) VALUES (?, ?)', [childId, classId])
  }
  const enrollmentId = await firstId(db, 'SELECT id FROM enrollments WHERE child_id = ? AND class_id = ?', [leleId, classId])

  let sessionId = await firstId(db, 'SELECT id FROM class_sessions WHERE class_id = ? AND sequence_no = 4', [classId])
  if (!sessionId) {
    const [result] = await db.query(
      'INSERT INTO class_sessions (class_id, sequence_no, starts_at, ends_at, campus, room) VALUES (?, ?, ?, ?, ?, ?)',
      [classId, 4, '2026-07-25 10:00:00', '2026-07-25 11:30:00', 'A校区', '201']
    )
    sessionId = result.insertId
  }
  const nextSession = await firstId(db, 'SELECT id FROM class_sessions WHERE class_id = ? AND sequence_no = 5', [classId])
  if (!nextSession) {
    await db.query(
      'INSERT INTO class_sessions (class_id, sequence_no, starts_at, ends_at, campus, room) VALUES (?, ?, ?, ?, ?, ?)',
      [classId, 5, '2026-08-01 10:00:00', '2026-08-01 11:30:00', 'A校区', '201']
    )
  }

  await db.query(
    'INSERT IGNORE INTO lesson_ledger (child_id, enrollment_id, type, quantity, balance_after, reason, idempotency_key, operator_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [leleId, enrollmentId, 'PURCHASE', 12, 12, '演示课程包购买', 'seed-lele-purchase', adminId]
  )

  let productId = await firstId(db, 'SELECT id FROM products WHERE name = ? LIMIT 1', ['儿童创作画材套装'])
  if (!productId) {
    const [result] = await db.query('INSERT INTO products (name, description, status) VALUES (?, ?, ?)', ['儿童创作画材套装', '基础画笔、颜料与画册组合', 'ON_SALE'])
    productId = result.insertId
  }
  await db.query('INSERT IGNORE INTO product_skus (product_id, name, sku_code, price, stock_quantity) VALUES (?, ?, ?, ?, ?)', [productId, '标准套装', 'ART-KIT-STD', 99, 100])
  let bagId = await firstId(db, 'SELECT id FROM products WHERE name = ? LIMIT 1', ['画室原创帆布袋'])
  if (!bagId) {
    const [result] = await db.query('INSERT INTO products (name, description, status) VALUES (?, ?, ?)', ['画室原创帆布袋', '课堂日常与作品收纳', 'ON_SALE'])
    bagId = result.insertId
  }
  await db.query('INSERT IGNORE INTO product_skus (product_id, name, sku_code, price, stock_quantity) VALUES (?, ?, ?, ?, ?)', [bagId, '帆布袋', 'ART-BAG-STD', 49, 200])

  return { parentId, teacherId, adminId, leleId, ananId, xiaomiId, classId, sessionId }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedDatabase().then(result => {
    console.log(JSON.stringify(result))
    process.exit(0)
  }).catch(error => {
    console.error(error)
    process.exit(1)
  })
}
