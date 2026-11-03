import 'dotenv/config'
import { getDb } from './db.js'
import { passwordHash } from './auth.js'
import { pathToFileURL } from 'node:url'

function seedAdminPassword() {
  const password = String(process.env.ADMIN_PASSWORD || '').trim()
  if (password.length < 12 || /replace|change.?me|your_|example|placeholder/i.test(password)) {
    throw new Error('Set a unique ADMIN_PASSWORD of at least 12 characters in backend/.env before seeding.')
  }
  return password
}

async function firstId(db, sql, params) {
  const [rows] = await db.query(sql, params)
  return rows[0]?.id
}

async function count(db, sql, params = []) {
  const [rows] = await db.query(sql, params)
  return Number(rows[0]?.total || 0)
}

async function ensureUser(db, openid, name, role, mobile) {
  await db.query(
    'INSERT INTO users (wechat_openid, display_name, mobile) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), mobile = COALESCE(users.mobile, VALUES(mobile))',
    [openid, name, mobile || null]
  )
  const id = await firstId(db, 'SELECT id FROM users WHERE wechat_openid = ?', [openid])
  await db.query('INSERT IGNORE INTO user_roles (user_id, role) VALUES (?, ?)', [id, role])
  return id
}

async function ensureChild(db, name, gender) {
  let id = await firstId(db, 'SELECT id FROM children WHERE name = ? LIMIT 1', [name])
  if (!id) {
    const [result] = await db.query('INSERT INTO children (name, gender) VALUES (?, ?)', [name, gender || 'UNKNOWN'])
    id = result.insertId
  }
  return id
}

async function ensureCourse(db, fields) {
  let id = await firstId(db, 'SELECT id FROM courses WHERE name = ? LIMIT 1', [fields.name])
  if (!id) {
    const [result] = await db.query(
      'INSERT INTO courses (name, age_range, default_lesson_count, price, description, status) VALUES (?, ?, ?, ?, ?, ?)',
      [fields.name, fields.ageRange, fields.lessonCount, fields.price, fields.description, 'ON_SALE']
    )
    id = result.insertId
  }
  await db.query(
    'UPDATE courses SET category = COALESCE(category, ?), schedule_text = COALESCE(schedule_text, ?), campus = COALESCE(campus, ?), room = COALESCE(room, ?), teacher_name = COALESCE(teacher_name, ?) WHERE id = ?',
    [fields.category, fields.schedule, fields.campus, fields.room, fields.teacherName, id]
  )
  return id
}

async function ensureSession(db, classId, sequenceNo, startsAt, endsAt) {
  let id = await firstId(db, 'SELECT id FROM class_sessions WHERE class_id = ? AND sequence_no = ?', [classId, sequenceNo])
  if (!id) {
    const [result] = await db.query(
      'INSERT INTO class_sessions (class_id, sequence_no, starts_at, ends_at, campus, room) VALUES (?, ?, ?, ?, ?, ?)',
      [classId, sequenceNo, startsAt, endsAt, 'A校区', '201']
    )
    id = result.insertId
  }
  return id
}

async function ensureProduct(db, name, description, category, skuName, skuCode, price, stock) {
  let id = await firstId(db, 'SELECT id FROM products WHERE name = ? LIMIT 1', [name])
  if (!id) {
    const [result] = await db.query('INSERT INTO products (name, description, category, status) VALUES (?, ?, ?, ?)', [name, description, category, 'ON_SALE'])
    id = result.insertId
  }
  await db.query('INSERT IGNORE INTO product_skus (product_id, name, sku_code, price, stock_quantity) VALUES (?, ?, ?, ?, ?)', [id, skuName, skuCode, price, stock])
  const skuId = await firstId(db, 'SELECT id FROM product_skus WHERE sku_code = ?', [skuCode])
  return { id, skuId }
}

async function ensureOrder(db, orderNo, fields) {
  let id = await firstId(db, 'SELECT id FROM orders WHERE order_no = ?', [orderNo])
  if (id) return id
  const [result] = await db.query(
    `INSERT INTO orders (order_no, buyer_user_id, total_amount, status, paid_at, shipped_at, completed_at, tracking_no,
      shipping_address_id, recipient_name_snapshot, recipient_mobile_snapshot, shipping_address_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orderNo, fields.buyerUserId, fields.totalAmount, fields.status, fields.paidAt || null, fields.shippedAt || null,
      fields.completedAt || null, fields.trackingNo || null, fields.addressId || null,
      fields.recipientName || null, fields.recipientMobile || null, fields.addressText || null]
  )
  id = result.insertId
  await db.query(
    'INSERT INTO order_items (order_id, product_sku_id, course_id, name_snapshot, unit_price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, fields.skuId || null, fields.courseId || null, fields.itemName, fields.totalAmount, 1, fields.totalAmount]
  )
  if (fields.status !== 'PENDING_PAYMENT') {
    await db.query(
      "INSERT INTO payment_records (order_id, transaction_id, status, amount, raw_payload) VALUES (?, ?, 'SUCCESS', ?, JSON_OBJECT('channel', 'MOCK', 'seed', true))",
      [id, `SEED-${orderNo}`, fields.totalAmount]
    )
  }
  return id
}

export async function seedDatabase() {
  const adminPassword = seedAdminPassword()
  const db = getDb()
  const parentId = await ensureUser(db, 'demo-parent-001', '李女士', 'PARENT', '13800000001')
  const teacherId = await ensureUser(db, 'demo-teacher-001', '王老师', 'TEACHER', '13800000002')
  const adminId = await ensureUser(db, 'demo-admin-001', '画室管理员', 'ADMIN', '13800000003')
  const studentId = await ensureUser(db, 'demo-student-001', '小画家', 'STUDENT', null)
  const operatorId = await ensureUser(db, 'demo-operator-001', '运营同学', 'OPERATOR', '13800000005')
  await db.query('UPDATE users SET admin_password_hash = ? WHERE id = ? AND admin_password_hash IS NULL', [passwordHash(adminPassword), adminId])
  await db.query('UPDATE users SET admin_password_hash = ? WHERE id = ? AND admin_password_hash IS NULL', [passwordHash(adminPassword), operatorId])

  const leleId = await ensureChild(db, '乐乐', 'MALE')
  const ananId = await ensureChild(db, '安安', 'FEMALE')
  const xiaomiId = await ensureChild(db, '小米', 'FEMALE')
  await db.query('INSERT IGNORE INTO parent_children (parent_user_id, child_id, relationship) VALUES (?, ?, ?)', [parentId, leleId, '母亲'])
  await db.query('INSERT IGNORE INTO parent_children (parent_user_id, child_id, relationship) VALUES (?, ?, ?)', [parentId, ananId, '母亲'])

  const artCourseId = await ensureCourse(db, {
    name: '创意美术启蒙班', ageRange: '6-8岁', lessonCount: 12, price: 1680,
    description: '通过色彩、构图和手作创作，帮助孩子建立观察力、表达力与创造力。',
    category: '创意启蒙', schedule: '每周六 10:00-11:30', campus: 'A校区', room: '201', teacherName: '王老师'
  })
  const advCourseId = await ensureCourse(db, {
    name: '少儿创作进阶班', ageRange: '8-11岁', lessonCount: 16, price: 2280,
    description: '从主题表达、材料探索到作品展示，持续发展孩子的创作能力。',
    category: '进阶创作', schedule: '每周日 14:00-15:30', campus: 'A校区', room: '203', teacherName: '王老师'
  })

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

  const sessionId = await ensureSession(db, classId, 4, '2026-07-25 10:00:00', '2026-07-25 11:30:00')
  const nextSessionId = await ensureSession(db, classId, 5, '2026-08-01 10:00:00', '2026-08-01 11:30:00')
  await ensureSession(db, classId, 6, '2026-08-08 10:00:00', '2026-08-08 11:30:00')
  await ensureSession(db, classId, 7, '2026-08-15 10:00:00', '2026-08-15 11:30:00')

  const ledgerSeeds = [
    [leleId, enrollmentId, 12, '演示课程包购买', 'seed-lele-purchase'],
    [ananId, null, 8, '演示课程包购买', 'seed-anan-purchase'],
    [xiaomiId, null, 8, '演示课程包购买', 'seed-xiaomi-purchase']
  ]
  for (const [childId, enrollId, qty, reason, key] of ledgerSeeds) {
    await db.query(
      'INSERT IGNORE INTO lesson_ledger (child_id, enrollment_id, type, quantity, balance_after, reason, idempotency_key, operator_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [childId, enrollId, 'PURCHASE', qty, qty, reason, key, adminId]
    )
  }

  const kit = await ensureProduct(db, '儿童创作画材套装', '基础画笔、颜料与画册组合', '画材工具', '标准套装', 'ART-KIT-STD', 99, 100)
  const bag = await ensureProduct(db, '画室原创帆布袋', '课堂日常与作品收纳', '周边文创', '帆布袋', 'ART-BAG-STD', 49, 200)
  await ensureProduct(db, '水彩颜料 24 色', '安全无毒，适合儿童日常创作', '画材工具', '24色装', 'ART-WC-24', 68, 80)

  // 家长默认收货地址
  let addressId = await firstId(db, 'SELECT id FROM shipping_addresses WHERE user_id = ? LIMIT 1', [parentId])
  if (!addressId) {
    const [result] = await db.query(
      'INSERT INTO shipping_addresses (user_id, recipient_name, mobile, province, city, district, detail, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      [parentId, '李女士', '13800000001', '上海市', '上海市', '徐汇区', '漕溪北路100弄8号302室']
    )
    addressId = result.insertId
  }
  const addressText = '上海市 上海市 徐汇区 漕溪北路100弄8号302室'

  // 三笔演示订单：已完成 / 已支付课程 / 待支付
  await ensureOrder(db, 'ZX-SEED-0001', {
    buyerUserId: parentId, totalAmount: 99, status: 'COMPLETED', skuId: kit.skuId, itemName: '儿童创作画材套装 · 标准套装',
    paidAt: '2026-07-18 09:30:00', shippedAt: '2026-07-19 15:00:00', completedAt: '2026-07-22 18:00:00',
    trackingNo: 'SF1234567890', addressId, recipientName: '李女士', recipientMobile: '13800000001', addressText
  })
  await ensureOrder(db, 'ZX-SEED-0002', {
    buyerUserId: parentId, totalAmount: 1680, status: 'PAID', courseId: artCourseId, itemName: '创意美术启蒙班',
    paidAt: '2026-07-20 10:00:00'
  })
  await ensureOrder(db, 'ZX-SEED-0003', {
    buyerUserId: parentId, totalAmount: 49, status: 'PENDING_PAYMENT', skuId: bag.skuId, itemName: '画室原创帆布袋 · 帆布袋',
    addressId, recipientName: '李女士', recipientMobile: '13800000001', addressText
  })

  // 待审批请假申请（未来课次）
  await db.query(
    'INSERT IGNORE INTO leave_requests (child_id, session_id, requested_by_user_id, reason) VALUES (?, ?, ?, ?)',
    [ananId, nextSessionId, parentId, '家中有事，需要请假一次']
  )

  if (await count(db, 'SELECT COUNT(*) AS total FROM announcements') === 0) {
    const announcements = [
      ['8月暑期创作营开放报名', '8月10日-8月21日暑期创作营开放报名，每期两周，名额有限，欢迎到前台或小程序咨询报名。', 'ALL'],
      ['台风天气停课通知', '受台风影响，7月27日全天课程暂停，课时不扣减，补课安排稍后另行通知。', 'PARENT'],
      ['教师例会提醒', '本周五 18:30 在 A 校区会议室召开教学例会，请各位老师准时参加。', 'TEACHER']
    ]
    for (const [title, content, audience] of announcements) {
      await db.query("INSERT INTO announcements (title, content, audience, status, published_at) VALUES (?, ?, ?, 'PUBLISHED', NOW())", [title, content, audience])
    }
  }

  if (await count(db, 'SELECT COUNT(*) AS total FROM session_feedback') === 0) {
    await db.query(
      "INSERT INTO session_feedback (session_id, child_id, teacher_user_id, content, homework, status) VALUES (?, ?, ?, ?, ?, 'PUBLISHED')",
      [sessionId, leleId, teacherId, '乐乐今天在色彩搭配上很有想法，主动尝试了冷暖对比，作品完成度很高。', '回家用今天学的冷暖对比画一幅“我的房间”，下节课带来分享。']
    )
    await db.query(
      "INSERT INTO session_feedback (session_id, child_id, teacher_user_id, content, status) VALUES (?, NULL, ?, ?, 'PUBLISHED')",
      [sessionId, teacherId, '本节课全班完成了“夏日花园”主题创作，整体氛围很好，请家长提醒孩子保管好作品，下周布展使用。']
    )
  }

  if (await count(db, 'SELECT COUNT(*) AS total FROM artworks') === 0) {
    const artworks = [
      [leleId, '夏日花园', 'https://picsum.photos/seed/art-lele/600/450', 'ARTWORK'],
      [ananId, '星空下的小屋', 'https://picsum.photos/seed/art-anan/600/450', 'ARTWORK'],
      [xiaomiId, '会飞的鲸鱼', 'https://picsum.photos/seed/art-xiaomi/600/450', 'ARTWORK']
    ]
    for (const [childId, title, url, kind] of artworks) {
      await db.query("INSERT INTO artworks (child_id, session_id, image_url, title, kind, status, is_public) VALUES (?, ?, ?, ?, ?, 'REVIEWED', 1)", [childId, sessionId, url, title, kind])
    }
  }
  if (await count(db, "SELECT COUNT(*) AS total FROM artworks WHERE kind = 'MOMENT'") === 0) {
    await db.query(
      "INSERT INTO artworks (child_id, session_id, image_url, title, kind, status, is_public) VALUES (?, ?, ?, ?, 'MOMENT', 'REVIEWED', 1)",
      [leleId, sessionId, 'https://picsum.photos/seed/studio-moment/600/450', '课堂调色花絮']
    )
  }

  if (await count(db, 'SELECT COUNT(*) AS total FROM resources') === 0) {
    await db.query("INSERT INTO resources (title, type, url, size_bytes, created_by) VALUES ('新生家长手册.pdf', 'PDF', 'resources/parent-handbook.pdf', 524288, '画室管理员')")
    await db.query("INSERT INTO resources (title, type, url, size_bytes, created_by) VALUES ('课堂安全须知.docx', 'DOC', 'resources/safety-notes.docx', 65536, '画室管理员')")
  }

  if (await count(db, 'SELECT COUNT(*) AS total FROM analytics_events') === 0) {
    const roles = ['PARENT', 'PARENT', 'PARENT', 'TEACHER', 'VISITOR']
    const pages = ['pages/home/index', 'pages/course/index', 'pages/shop/index', 'pages/parent/index', 'pages/teacher/index']
    const values = []
    for (let day = 6; day >= 0; day--) {
      const perDay = 5 + Math.floor(Math.random() * 8)
      for (let i = 0; i < perDay; i++) {
        const role = roles[Math.floor(Math.random() * roles.length)]
        const page = pages[Math.floor(Math.random() * pages.length)]
        values.push([`page_view`, role, role === 'VISITOR' ? null : parentId, page, day, Math.floor(Math.random() * 12)])
      }
    }
    for (const [eventName, role, userId, page, daysAgo, hoursAgo] of values) {
      await db.query(
        'INSERT INTO analytics_events (event_name, role, user_id, page, created_at) VALUES (?, ?, ?, ?, DATE_SUB(DATE_SUB(NOW(), INTERVAL ? DAY), INTERVAL ? HOUR))',
        [eventName, role, userId, page, daysAgo, hoursAgo]
      )
    }
  }

  return {
    parentUserId: parentId, teacherUserId: teacherId, adminUserId: adminId, operatorUserId: operatorId, studentUserId: studentId,
    leleId, ananId, xiaomiId, classId, sessionId, nextSessionId,
    courseIds: [artCourseId, advCourseId], addressId,
    adminAccount: { name: '画室管理员' }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedDatabase().then(result => {
    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
  }).catch(error => {
    console.error(error)
    process.exit(1)
  })
}
