import Fastify from 'fastify'
import { checkDatabase, getDb } from './db.js'

const app = Fastify({ logger: true })

function badRequest(reply, message) {
  return reply.code(400).send({ message })
}

function makeOrderNo() {
  return `ART${Date.now()}${Math.floor(Math.random() * 900 + 100)}`
}

async function lessonBalance(db, childId) {
  const [rows] = await db.query('SELECT balance_after FROM lesson_ledger WHERE child_id = ? ORDER BY id DESC LIMIT 1', [childId])
  return Number(rows[0]?.balance_after || 0)
}

async function requireAdmin(db, adminUserId) {
  if (!adminUserId) throw new Error('adminUserId is required')
  const [rows] = await db.query(
    'SELECT 1 FROM user_roles WHERE user_id = ? AND role = ? LIMIT 1',
    [adminUserId, 'ADMIN']
  )
  if (!rows.length) throw new Error('admin access denied')
}

function positiveInteger(value, field) {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${field} must be a positive integer`)
  return number
}

app.get('/health', async () => {
  if (process.env.DATABASE_ENABLED !== 'true') return { ok: true, service: 'art-studio-api', database: 'disabled' }
  try {
    await checkDatabase()
    return { ok: true, service: 'art-studio-api', database: 'connected' }
  } catch (error) {
    return { ok: false, service: 'art-studio-api', database: 'unavailable', message: error.message }
  }
})

app.get('/api/courses', async () => {
  const [rows] = await getDb().query('SELECT id, name, age_range, default_lesson_count, price, description FROM courses WHERE status = ? ORDER BY id', ['ON_SALE'])
  return { data: rows }
})

app.get('/api/dev/context', async () => {
  const db = getDb()
  const [[parent]] = await db.query('SELECT id FROM users WHERE wechat_openid = ?', ['demo-parent-001'])
  const [[teacher]] = await db.query('SELECT id FROM users WHERE wechat_openid = ?', ['demo-teacher-001'])
  const [[admin]] = await db.query('SELECT id FROM users WHERE wechat_openid = ?', ['demo-admin-001'])
  const [[child]] = await db.query('SELECT c.id FROM children c JOIN parent_children pc ON pc.child_id = c.id WHERE pc.parent_user_id = ? ORDER BY c.id LIMIT 1', [parent.id])
  return { data: { parentUserId: parent.id, teacherUserId: teacher.id, adminUserId: admin.id, childId: child.id } }
})

app.get('/api/products', async () => {
  const [rows] = await getDb().query(`
    SELECT p.id AS product_id, p.name, p.description, p.cover_url, s.id AS sku_id, s.name AS sku_name, s.sku_code, s.price, s.stock_quantity
    FROM products p JOIN product_skus s ON s.product_id = p.id
    WHERE p.status = ? ORDER BY p.id, s.id`, ['ON_SALE'])
  return { data: rows }
})

app.get('/api/parent/dashboard', async (request, reply) => {
  const { parentUserId, childId } = request.query || {}
  if (!parentUserId || !childId) return badRequest(reply, 'parentUserId and childId are required')
  const db = getDb()
  const [access] = await db.query('SELECT 1 FROM parent_children WHERE parent_user_id = ? AND child_id = ?', [parentUserId, childId])
  if (!access.length) return reply.code(403).send({ message: 'child access denied' })
  const [children] = await db.query('SELECT id, name FROM children WHERE id = ?', [childId])
  const [sessions] = await db.query(`
    SELECT cs.id, cs.sequence_no, cs.starts_at, cs.ends_at, cs.campus, cs.room, cs.status, c.name AS class_name, co.name AS course_name, u.display_name AS teacher_name
    FROM enrollments e
    JOIN classes c ON c.id = e.class_id
    JOIN courses co ON co.id = c.course_id
    JOIN class_sessions cs ON cs.class_id = c.id
    LEFT JOIN users u ON u.id = c.teacher_user_id
    WHERE e.child_id = ? AND e.status = 'ACTIVE' AND cs.status = 'SCHEDULED'
    ORDER BY cs.starts_at`, [childId])
  return { data: { child: { ...children[0], remainingLessons: await lessonBalance(db, childId) }, sessions } }
})

app.get('/api/teacher/sessions', async (request, reply) => {
  const { teacherUserId } = request.query || {}
  if (!teacherUserId) return badRequest(reply, 'teacherUserId is required')
  const [rows] = await getDb().query(`
    SELECT cs.id, cs.sequence_no, cs.starts_at, cs.ends_at, cs.campus, cs.room, cs.status, c.name AS class_name, co.name AS course_name
    FROM class_sessions cs JOIN classes c ON c.id = cs.class_id JOIN courses co ON co.id = c.course_id
    WHERE c.teacher_user_id = ? ORDER BY cs.starts_at`, [teacherUserId])
  return { data: rows }
})

app.get('/api/sessions/:sessionId/attendance', async (request, reply) => {
  const { sessionId } = request.params
  const [rows] = await getDb().query(`
    SELECT ch.id AS child_id, ch.name, COALESCE(a.status, 'PRESENT') AS status,
      COALESCE((SELECT ll.balance_after FROM lesson_ledger ll WHERE ll.child_id = ch.id ORDER BY ll.id DESC LIMIT 1), 0) AS remaining_lessons
    FROM class_sessions cs JOIN enrollments e ON e.class_id = cs.class_id AND e.status = 'ACTIVE'
    JOIN children ch ON ch.id = e.child_id LEFT JOIN attendance a ON a.session_id = cs.id AND a.child_id = ch.id
    WHERE cs.id = ? ORDER BY ch.id`, [sessionId])
  if (!rows.length) return reply.code(404).send({ message: 'session not found or no enrolled children' })
  return { data: rows }
})

app.post('/api/sessions/:sessionId/attendance/confirm', async (request, reply) => {
  const { sessionId } = request.params
  const { teacherUserId, records } = request.body || {}
  if (!teacherUserId || !Array.isArray(records) || !records.length) return badRequest(reply, 'teacherUserId and records are required')
  const db = getDb()
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    const [sessions] = await connection.query('SELECT c.id AS class_id FROM class_sessions cs JOIN classes c ON c.id = cs.class_id WHERE cs.id = ? AND c.teacher_user_id = ? FOR UPDATE', [sessionId, teacherUserId])
    if (!sessions.length) throw new Error('session not found or teacher access denied')
    const result = []
    for (const record of records) {
      const state = record.status === 'LEAVE' ? 'LEAVE' : record.status === 'ABSENT' ? 'ABSENT' : 'PRESENT'
      const childId = Number(record.childId)
      if (!childId) throw new Error('record.childId is required')
      await connection.query(`INSERT INTO attendance (session_id, child_id, status, confirmed_by_user_id, confirmed_at)
        VALUES (?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE status = VALUES(status), confirmed_by_user_id = VALUES(confirmed_by_user_id), confirmed_at = NOW()`, [sessionId, childId, state, teacherUserId])
      if (state === 'PRESENT') {
        const key = `attendance:${sessionId}:${childId}`
        const [existing] = await connection.query('SELECT id FROM lesson_ledger WHERE idempotency_key = ?', [key])
        if (!existing.length) {
          const [enrollments] = await connection.query('SELECT id FROM enrollments WHERE child_id = ? AND class_id = ? AND status = ? FOR UPDATE', [childId, sessions[0].class_id, 'ACTIVE'])
          if (!enrollments.length) throw new Error(`child ${childId} is not actively enrolled`)
          const [latest] = await connection.query('SELECT balance_after FROM lesson_ledger WHERE child_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE', [childId])
          const balance = Number(latest[0]?.balance_after || 0)
          if (balance < 1) throw new Error(`child ${childId} has insufficient lessons`)
          await connection.query('INSERT INTO lesson_ledger (child_id, enrollment_id, session_id, type, quantity, balance_after, reason, idempotency_key, operator_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [childId, enrollments[0].id, sessionId, 'DEDUCT', -1, balance - 1, '教师确认出勤扣课', key, teacherUserId])
          result.push({ childId, deducted: 1, balanceAfter: balance - 1 })
        }
      }
    }
    await connection.commit()
    return { data: { sessionId: Number(sessionId), records: result } }
  } catch (error) {
    await connection.rollback()
    return badRequest(reply, error.message)
  } finally {
    connection.release()
  }
})

app.post('/api/orders', async (request, reply) => {
  const { buyerUserId, items } = request.body || {}
  if (!buyerUserId || !Array.isArray(items) || !items.length) return badRequest(reply, 'buyerUserId and items are required')
  const db = getDb()
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    let total = 0
    const lines = []
    for (const item of items) {
      const quantity = Number(item.quantity || 1)
      const [skus] = await connection.query(`SELECT s.id, s.name, s.price, s.stock_quantity, p.name AS product_name
        FROM product_skus s JOIN products p ON p.id = s.product_id WHERE s.id = ? AND p.status = 'ON_SALE' FOR UPDATE`, [item.skuId])
      if (!skus.length || quantity < 1 || skus[0].stock_quantity < quantity) throw new Error('product unavailable or insufficient stock')
      const sku = skus[0]
      const subtotal = Number(sku.price) * quantity
      total += subtotal
      lines.push({ sku, quantity, subtotal })
      await connection.query('UPDATE product_skus SET stock_quantity = stock_quantity - ? WHERE id = ?', [quantity, sku.id])
    }
    const orderNo = makeOrderNo()
    const [order] = await connection.query('INSERT INTO orders (order_no, buyer_user_id, total_amount) VALUES (?, ?, ?)', [orderNo, buyerUserId, total])
    for (const line of lines) {
      await connection.query('INSERT INTO order_items (order_id, product_sku_id, name_snapshot, unit_price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?)', [order.insertId, line.sku.id, `${line.sku.product_name} · ${line.sku.name}`, line.sku.price, line.quantity, line.subtotal])
    }
    await connection.commit()
    return { data: { id: order.insertId, orderNo, totalAmount: total, status: 'PENDING_PAYMENT' } }
  } catch (error) {
    await connection.rollback()
    return badRequest(reply, error.message)
  } finally {
    connection.release()
  }
})

app.get('/api/admin/overview', async (request, reply) => {
  const { adminUserId } = request.query || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const [[children]] = await db.query('SELECT COUNT(*) AS total FROM children')
    const [[activeClasses]] = await db.query("SELECT COUNT(*) AS total FROM classes WHERE status = 'ACTIVE'")
    const [[scheduledSessions]] = await db.query("SELECT COUNT(*) AS total FROM class_sessions WHERE status = 'SCHEDULED'")
    const [[pendingOrders]] = await db.query("SELECT COUNT(*) AS total FROM orders WHERE status = 'PENDING_PAYMENT'")
    return { data: { children: Number(children.total), activeClasses: Number(activeClasses.total), scheduledSessions: Number(scheduledSessions.total), pendingOrders: Number(pendingOrders.total) } }
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.get('/api/admin/children', async (request, reply) => {
  const { adminUserId } = request.query || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const [rows] = await db.query(`
      SELECT c.id, c.name, c.birthday, c.gender, c.remark,
        COALESCE((SELECT ll.balance_after FROM lesson_ledger ll WHERE ll.child_id = c.id ORDER BY ll.id DESC LIMIT 1), 0) AS remaining_lessons,
        COUNT(DISTINCT e.id) AS active_enrollments
      FROM children c
      LEFT JOIN enrollments e ON e.child_id = c.id AND e.status = 'ACTIVE'
      GROUP BY c.id
      ORDER BY c.id DESC`)
    return { data: rows }
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.post('/api/admin/children', async (request, reply) => {
  const { adminUserId, name, birthday, gender = 'UNKNOWN', remark } = request.body || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    if (!String(name || '').trim()) throw new Error('name is required')
    if (!['UNKNOWN', 'MALE', 'FEMALE'].includes(gender)) throw new Error('invalid gender')
    const [result] = await db.query('INSERT INTO children (name, birthday, gender, remark) VALUES (?, ?, ?, ?)', [name.trim(), birthday || null, gender, remark || null])
    return reply.code(201).send({ data: { id: result.insertId } })
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.get('/api/admin/classes', async (request, reply) => {
  const { adminUserId } = request.query || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const [rows] = await db.query(`
      SELECT c.id, c.name, c.campus, c.room, c.capacity, c.status, co.id AS course_id, co.name AS course_name,
        u.id AS teacher_user_id, u.display_name AS teacher_name, COUNT(e.id) AS enrolled_count
      FROM classes c
      JOIN courses co ON co.id = c.course_id
      LEFT JOIN users u ON u.id = c.teacher_user_id
      LEFT JOIN enrollments e ON e.class_id = c.id AND e.status = 'ACTIVE'
      GROUP BY c.id
      ORDER BY c.id DESC`)
    return { data: rows }
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.post('/api/admin/classes', async (request, reply) => {
  const { adminUserId, courseId, teacherUserId, name, campus, room, capacity = 20 } = request.body || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const normalizedCourseId = positiveInteger(courseId, 'courseId')
    const normalizedCapacity = positiveInteger(capacity, 'capacity')
    if (!String(name || '').trim()) throw new Error('name is required')
    const [courses] = await db.query('SELECT id FROM courses WHERE id = ?', [normalizedCourseId])
    if (!courses.length) throw new Error('course not found')
    if (teacherUserId) {
      const [teachers] = await db.query('SELECT 1 FROM user_roles WHERE user_id = ? AND role = ?', [teacherUserId, 'TEACHER'])
      if (!teachers.length) throw new Error('teacher not found')
    }
    const [result] = await db.query('INSERT INTO classes (course_id, teacher_user_id, name, campus, room, capacity) VALUES (?, ?, ?, ?, ?, ?)', [normalizedCourseId, teacherUserId || null, name.trim(), campus || null, room || null, normalizedCapacity])
    return reply.code(201).send({ data: { id: result.insertId } })
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.post('/api/admin/classes/:classId/sessions', async (request, reply) => {
  const { classId } = request.params
  const { adminUserId, sequenceNo, startsAt, endsAt, campus, room } = request.body || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const normalizedClassId = positiveInteger(classId, 'classId')
    const normalizedSequenceNo = positiveInteger(sequenceNo, 'sequenceNo')
    if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) throw new Error('startsAt and endsAt must form a valid time range')
    const [classes] = await db.query('SELECT id FROM classes WHERE id = ? AND status = ?', [normalizedClassId, 'ACTIVE'])
    if (!classes.length) throw new Error('active class not found')
    const [result] = await db.query('INSERT INTO class_sessions (class_id, sequence_no, starts_at, ends_at, campus, room) VALUES (?, ?, ?, ?, ?, ?)', [normalizedClassId, normalizedSequenceNo, startsAt, endsAt, campus || null, room || null])
    return reply.code(201).send({ data: { id: result.insertId } })
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.post('/api/admin/enrollments', async (request, reply) => {
  const { adminUserId, childId, classId } = request.body || {}
  const db = getDb()
  const connection = await db.getConnection()
  try {
    await requireAdmin(connection, adminUserId)
    const normalizedChildId = positiveInteger(childId, 'childId')
    const normalizedClassId = positiveInteger(classId, 'classId')
    await connection.beginTransaction()
    const [classes] = await connection.query(`
      SELECT c.capacity, COUNT(e.id) AS enrolled_count
      FROM classes c LEFT JOIN enrollments e ON e.class_id = c.id AND e.status = 'ACTIVE'
      WHERE c.id = ? AND c.status = 'ACTIVE' GROUP BY c.id FOR UPDATE`, [normalizedClassId])
    if (!classes.length) throw new Error('active class not found')
    if (Number(classes[0].enrolled_count) >= Number(classes[0].capacity)) throw new Error('class is full')
    const [children] = await connection.query('SELECT id FROM children WHERE id = ? FOR UPDATE', [normalizedChildId])
    if (!children.length) throw new Error('child not found')
    const [result] = await connection.query(`INSERT INTO enrollments (child_id, class_id, status) VALUES (?, ?, 'ACTIVE')
      ON DUPLICATE KEY UPDATE status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP`, [normalizedChildId, normalizedClassId])
    await connection.commit()
    return reply.code(201).send({ data: { id: result.insertId || null, childId: normalizedChildId, classId: normalizedClassId, status: 'ACTIVE' } })
  } catch (error) {
    await connection.rollback()
    return badRequest(reply, error.message)
  } finally {
    connection.release()
  }
})

app.get('/api/admin/children/:childId/lesson-ledger', async (request, reply) => {
  const { childId } = request.params
  const { adminUserId } = request.query || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const [rows] = await db.query(`
      SELECT id, type, quantity, balance_after, reason, session_id, enrollment_id, operator_user_id, created_at
      FROM lesson_ledger WHERE child_id = ? ORDER BY id DESC`, [positiveInteger(childId, 'childId')])
    return { data: rows }
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.post('/api/admin/children/:childId/lesson-adjustments', async (request, reply) => {
  const { childId } = request.params
  const { adminUserId, type = 'ADJUST', quantity, reason, idempotencyKey } = request.body || {}
  const db = getDb()
  const connection = await db.getConnection()
  try {
    await requireAdmin(connection, adminUserId)
    const normalizedChildId = positiveInteger(childId, 'childId')
    const normalizedQuantity = Number(quantity)
    if (!Number.isFinite(normalizedQuantity) || normalizedQuantity === 0) throw new Error('quantity must be non-zero')
    if (!['PURCHASE', 'GIFT', 'REFUND', 'ADJUST', 'FREEZE', 'UNFREEZE'].includes(type)) throw new Error('invalid adjustment type')
    if (!String(reason || '').trim() || !String(idempotencyKey || '').trim()) throw new Error('reason and idempotencyKey are required')
    await connection.beginTransaction()
    const [children] = await connection.query('SELECT id FROM children WHERE id = ? FOR UPDATE', [normalizedChildId])
    if (!children.length) throw new Error('child not found')
    const [existing] = await connection.query('SELECT id, balance_after FROM lesson_ledger WHERE idempotency_key = ? FOR UPDATE', [idempotencyKey])
    if (existing.length) {
      await connection.commit()
      return { data: { id: existing[0].id, balanceAfter: Number(existing[0].balance_after), duplicate: true } }
    }
    const [latest] = await connection.query('SELECT balance_after FROM lesson_ledger WHERE child_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE', [normalizedChildId])
    const nextBalance = Number(latest[0]?.balance_after || 0) + normalizedQuantity
    if (nextBalance < 0) throw new Error('lesson balance cannot be negative')
    const [result] = await connection.query('INSERT INTO lesson_ledger (child_id, type, quantity, balance_after, reason, idempotency_key, operator_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [normalizedChildId, type, normalizedQuantity, nextBalance, reason.trim(), idempotencyKey.trim(), adminUserId])
    await connection.commit()
    return reply.code(201).send({ data: { id: result.insertId, balanceAfter: nextBalance, duplicate: false } })
  } catch (error) {
    await connection.rollback()
    return badRequest(reply, error.message)
  } finally {
    connection.release()
  }
})

app.listen({ port: Number(process.env.PORT || 3000), host: process.env.HOST || '0.0.0.0' })
