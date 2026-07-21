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
      const [[previous]] = await connection.query('SELECT status FROM attendance WHERE session_id = ? AND child_id = ? FOR UPDATE', [sessionId, childId])
      await connection.query(`INSERT INTO attendance (session_id, child_id, status, confirmed_by_user_id, confirmed_at)
        VALUES (?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE status = VALUES(status), confirmed_by_user_id = VALUES(confirmed_by_user_id), confirmed_at = NOW()`, [sessionId, childId, state, teacherUserId])
      if (previous?.status === 'PRESENT' && state !== 'PRESENT') {
        // Correcting a confirmed presence must refund the original deduction exactly once.
        const reversalKey = `attendance-reversal:${sessionId}:${childId}`
        const [reversed] = await connection.query('SELECT id FROM lesson_ledger WHERE idempotency_key = ?', [reversalKey])
        if (!reversed.length) {
          const [latest] = await connection.query('SELECT balance_after FROM lesson_ledger WHERE child_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE', [childId])
          const balance = Number(latest[0]?.balance_after || 0)
          await connection.query('INSERT INTO lesson_ledger (child_id, session_id, type, quantity, balance_after, reason, idempotency_key, operator_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [childId, sessionId, 'REFUND', 1, balance + 1, 'Attendance correction refund', reversalKey, teacherUserId])
          result.push({ childId, refunded: 1, balanceAfter: balance + 1 })
        }
      }
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
  const { buyerUserId, items, shippingAddressId } = request.body || {}
  if (!buyerUserId || !Array.isArray(items) || !items.length) return badRequest(reply, 'buyerUserId and items are required')
  const db = getDb()
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    let address = null
    if (shippingAddressId) {
      const [addresses] = await connection.query(
        'SELECT * FROM shipping_addresses WHERE id = ? AND user_id = ? FOR UPDATE',
        [shippingAddressId, buyerUserId]
      )
      if (!addresses.length) throw new Error('shipping address not found')
      address = addresses[0]
    }
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
      // Locking the SKU row above and reducing inside this transaction prevents overselling.
      await connection.query('UPDATE product_skus SET stock_quantity = stock_quantity - ? WHERE id = ?', [quantity, sku.id])
    }
    const orderNo = makeOrderNo()
    const addressSnapshot = address ? `${address.province}${address.city}${address.district}${address.detail}` : null
    const [order] = await connection.query(`INSERT INTO orders (
      order_no, buyer_user_id, total_amount, shipping_address_id, recipient_name_snapshot, recipient_mobile_snapshot, shipping_address_snapshot
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
      orderNo, buyerUserId, total, address?.id || null, address?.recipient_name || null, address?.mobile || null, addressSnapshot
    ])
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

app.get('/api/addresses', async (request, reply) => {
  const { userId } = request.query || {}
  if (!userId) return badRequest(reply, 'userId is required')
  const [rows] = await getDb().query(
    'SELECT id, recipient_name, mobile, province, city, district, detail, is_default FROM shipping_addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC',
    [userId]
  )
  return { data: rows }
})

app.post('/api/addresses', async (request, reply) => {
  const { userId, recipientName, mobile, province, city, district, detail, isDefault = false } = request.body || {}
  const required = [recipientName, mobile, province, city, district, detail]
  if (!userId || required.some(value => !String(value || '').trim())) return badRequest(reply, 'complete address fields are required')
  const db = getDb()
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    const [[existing]] = await connection.query('SELECT id FROM shipping_addresses WHERE user_id = ? LIMIT 1 FOR UPDATE', [userId])
    const defaultValue = Boolean(isDefault) || !existing
    if (defaultValue) await connection.query('UPDATE shipping_addresses SET is_default = FALSE WHERE user_id = ?', [userId])
    const [result] = await connection.query(`INSERT INTO shipping_addresses (
      user_id, recipient_name, mobile, province, city, district, detail, is_default
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [userId, recipientName.trim(), mobile.trim(), province.trim(), city.trim(), district.trim(), detail.trim(), defaultValue])
    await connection.commit()
    return reply.code(201).send({ data: { id: result.insertId, isDefault: defaultValue } })
  } catch (error) {
    await connection.rollback()
    return badRequest(reply, error.message)
  } finally {
    connection.release()
  }
})

app.get('/api/orders', async (request, reply) => {
  const { buyerUserId } = request.query || {}
  if (!buyerUserId) return badRequest(reply, 'buyerUserId is required')
  const [orders] = await getDb().query(`
    SELECT id, order_no, total_amount, status, recipient_name_snapshot, shipping_address_snapshot, tracking_no, created_at
    FROM orders WHERE buyer_user_id = ? ORDER BY id DESC`, [buyerUserId])
  return { data: orders }
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

app.get('/api/admin/users', async (request, reply) => {
  const { adminUserId, role } = request.query || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const params = []
    let roleFilter = ''
    if (role) {
      if (!['ADMIN', 'TEACHER', 'PARENT'].includes(role)) throw new Error('invalid role')
      roleFilter = 'HAVING FIND_IN_SET(?, roles)'
      params.push(role)
    }
    const [rows] = await db.query(`
      SELECT u.id, u.display_name, u.mobile, u.avatar_url, GROUP_CONCAT(ur.role ORDER BY ur.role) AS roles
      FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id
      GROUP BY u.id ${roleFilter} ORDER BY u.id DESC`, params)
    return { data: rows }
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.post('/api/admin/parents', async (request, reply) => {
  const { adminUserId, displayName, mobile } = request.body || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    if (!String(displayName || '').trim()) throw new Error('displayName is required')
    const [result] = await db.query('INSERT INTO users (display_name, mobile) VALUES (?, ?)', [displayName.trim(), mobile?.trim() || null])
    await db.query('INSERT INTO user_roles (user_id, role) VALUES (?, ?)', [result.insertId, 'PARENT'])
    return reply.code(201).send({ data: { id: result.insertId } })
  } catch (error) {
    return badRequest(reply, error.code === 'ER_DUP_ENTRY' ? 'mobile already exists' : error.message)
  }
})

app.get('/api/admin/courses', async (request, reply) => {
  const { adminUserId } = request.query || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const [rows] = await db.query(`
      SELECT c.*, COUNT(cl.id) AS class_count
      FROM courses c LEFT JOIN classes cl ON cl.course_id = c.id AND cl.status = 'ACTIVE'
      GROUP BY c.id ORDER BY c.id DESC`)
    return { data: rows }
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.post('/api/admin/courses', async (request, reply) => {
  const { adminUserId, name, ageRange, defaultLessonCount, price, description, status = 'DRAFT' } = request.body || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    if (!String(name || '').trim()) throw new Error('name is required')
    if (!['DRAFT', 'ON_SALE', 'OFF_SALE'].includes(status)) throw new Error('invalid course status')
    const lessons = positiveInteger(defaultLessonCount, 'defaultLessonCount')
    const normalizedPrice = Number(price)
    if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0) throw new Error('price must be non-negative')
    const [result] = await db.query(`INSERT INTO courses (
      name, age_range, default_lesson_count, price, description, status
    ) VALUES (?, ?, ?, ?, ?, ?)`, [name.trim(), ageRange?.trim() || null, lessons, normalizedPrice, description?.trim() || null, status])
    return reply.code(201).send({ data: { id: result.insertId } })
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.patch('/api/admin/courses/:courseId', async (request, reply) => {
  const { courseId } = request.params
  const { adminUserId, name, ageRange, defaultLessonCount, price, description, status } = request.body || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const id = positiveInteger(courseId, 'courseId')
    if (!String(name || '').trim()) throw new Error('name is required')
    if (!['DRAFT', 'ON_SALE', 'OFF_SALE'].includes(status)) throw new Error('invalid course status')
    const lessons = positiveInteger(defaultLessonCount, 'defaultLessonCount')
    const normalizedPrice = Number(price)
    if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0) throw new Error('price must be non-negative')
    const [result] = await db.query(`UPDATE courses SET
      name = ?, age_range = ?, default_lesson_count = ?, price = ?, description = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`, [name.trim(), ageRange?.trim() || null, lessons, normalizedPrice, description?.trim() || null, status, id])
    if (!result.affectedRows) throw new Error('course not found')
    return { data: { id } }
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

app.patch('/api/admin/children/:childId', async (request, reply) => {
  const { childId } = request.params
  const { adminUserId, name, birthday, gender, remark } = request.body || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const id = positiveInteger(childId, 'childId')
    if (!String(name || '').trim()) throw new Error('name is required')
    if (!['UNKNOWN', 'MALE', 'FEMALE'].includes(gender)) throw new Error('invalid gender')
    const [result] = await db.query(`UPDATE children SET
      name = ?, birthday = ?, gender = ?, remark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [name.trim(), birthday || null, gender, remark || null, id])
    if (!result.affectedRows) throw new Error('child not found')
    return { data: { id } }
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.get('/api/admin/children/:childId/guardians', async (request, reply) => {
  const { childId } = request.params
  const { adminUserId } = request.query || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const [rows] = await db.query(`
      SELECT pc.parent_user_id, pc.relationship, u.display_name, u.mobile
      FROM parent_children pc JOIN users u ON u.id = pc.parent_user_id
      WHERE pc.child_id = ? ORDER BY pc.id`, [positiveInteger(childId, 'childId')])
    return { data: rows }
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.post('/api/admin/children/:childId/guardians', async (request, reply) => {
  const { childId } = request.params
  const { adminUserId, parentUserId, relationship = '监护人' } = request.body || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const child = positiveInteger(childId, 'childId')
    const parent = positiveInteger(parentUserId, 'parentUserId')
    const [parents] = await db.query('SELECT 1 FROM user_roles WHERE user_id = ? AND role = ?', [parent, 'PARENT'])
    if (!parents.length) throw new Error('parent user not found')
    await db.query(`INSERT INTO parent_children (parent_user_id, child_id, relationship)
      VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE relationship = VALUES(relationship)`, [parent, child, String(relationship).trim() || '监护人'])
    return reply.code(201).send({ data: { childId: child, parentUserId: parent } })
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.delete('/api/admin/children/:childId/guardians/:parentUserId', async (request, reply) => {
  const { childId, parentUserId } = request.params
  const { adminUserId } = request.query || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    await db.query('DELETE FROM parent_children WHERE child_id = ? AND parent_user_id = ?', [positiveInteger(childId, 'childId'), positiveInteger(parentUserId, 'parentUserId')])
    return reply.code(204).send()
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

app.get('/api/admin/classes/:classId/sessions', async (request, reply) => {
  const { classId } = request.params
  const { adminUserId } = request.query || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const [rows] = await db.query(`SELECT id, sequence_no, starts_at, ends_at, campus, room, status
      FROM class_sessions WHERE class_id = ? ORDER BY sequence_no`, [positiveInteger(classId, 'classId')])
    return { data: rows }
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.patch('/api/admin/sessions/:sessionId', async (request, reply) => {
  const { sessionId } = request.params
  const { adminUserId, startsAt, endsAt, campus, room, status } = request.body || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const id = positiveInteger(sessionId, 'sessionId')
    if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) throw new Error('startsAt and endsAt must form a valid time range')
    if (!['SCHEDULED', 'COMPLETED', 'CANCELLED'].includes(status)) throw new Error('invalid session status')
    const [result] = await db.query(`UPDATE class_sessions SET
      starts_at = ?, ends_at = ?, campus = ?, room = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [startsAt, endsAt, campus || null, room || null, status, id])
    if (!result.affectedRows) throw new Error('session not found')
    return { data: { id } }
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

app.patch('/api/admin/enrollments/:enrollmentId', async (request, reply) => {
  const { enrollmentId } = request.params
  const { adminUserId, status } = request.body || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    if (!['ACTIVE', 'PAUSED', 'COMPLETED', 'REFUNDED'].includes(status)) throw new Error('invalid enrollment status')
    const [result] = await db.query('UPDATE enrollments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, positiveInteger(enrollmentId, 'enrollmentId')])
    if (!result.affectedRows) throw new Error('enrollment not found')
    return { data: { id: Number(enrollmentId), status } }
  } catch (error) {
    return badRequest(reply, error.message)
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

app.get('/api/admin/products', async (request, reply) => {
  const { adminUserId } = request.query || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const [rows] = await db.query(`
      SELECT p.id AS product_id, p.name AS product_name, p.description, p.cover_url, p.status,
        s.id AS sku_id, s.name AS sku_name, s.sku_code, s.price, s.stock_quantity
      FROM products p LEFT JOIN product_skus s ON s.product_id = p.id ORDER BY p.id DESC, s.id`)
    return { data: rows }
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.post('/api/admin/products', async (request, reply) => {
  const { adminUserId, name, description, coverUrl, status = 'DRAFT' } = request.body || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    if (!String(name || '').trim()) throw new Error('name is required')
    if (!['DRAFT', 'ON_SALE', 'OFF_SALE'].includes(status)) throw new Error('invalid product status')
    const [result] = await db.query('INSERT INTO products (name, description, cover_url, status) VALUES (?, ?, ?, ?)', [name.trim(), description?.trim() || null, coverUrl?.trim() || null, status])
    return reply.code(201).send({ data: { id: result.insertId } })
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.patch('/api/admin/products/:productId', async (request, reply) => {
  const { productId } = request.params
  const { adminUserId, name, description, coverUrl, status } = request.body || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const id = positiveInteger(productId, 'productId')
    if (!String(name || '').trim()) throw new Error('name is required')
    if (!['DRAFT', 'ON_SALE', 'OFF_SALE'].includes(status)) throw new Error('invalid product status')
    const [result] = await db.query(`UPDATE products SET
      name = ?, description = ?, cover_url = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [name.trim(), description?.trim() || null, coverUrl?.trim() || null, status, id])
    if (!result.affectedRows) throw new Error('product not found')
    return { data: { id } }
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.post('/api/admin/products/:productId/skus', async (request, reply) => {
  const { productId } = request.params
  const { adminUserId, name, skuCode, price, stockQuantity = 0 } = request.body || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    if (!String(name || '').trim() || !String(skuCode || '').trim()) throw new Error('name and skuCode are required')
    const normalizedPrice = Number(price)
    const stock = Number(stockQuantity)
    if (!Number.isFinite(normalizedPrice) || normalizedPrice < 0 || !Number.isInteger(stock) || stock < 0) throw new Error('invalid price or stockQuantity')
    const [result] = await db.query('INSERT INTO product_skus (product_id, name, sku_code, price, stock_quantity) VALUES (?, ?, ?, ?, ?)', [positiveInteger(productId, 'productId'), name.trim(), skuCode.trim(), normalizedPrice, stock])
    return reply.code(201).send({ data: { id: result.insertId } })
  } catch (error) {
    return badRequest(reply, error.code === 'ER_DUP_ENTRY' ? 'skuCode already exists' : error.message)
  }
})

app.patch('/api/admin/skus/:skuId/stock', async (request, reply) => {
  const { skuId } = request.params
  const { adminUserId, quantity, reason } = request.body || {}
  const db = getDb()
  const connection = await db.getConnection()
  try {
    await requireAdmin(connection, adminUserId)
    const delta = Number(quantity)
    if (!Number.isInteger(delta) || delta === 0 || !String(reason || '').trim()) throw new Error('non-zero integer quantity and reason are required')
    await connection.beginTransaction()
    const [rows] = await connection.query('SELECT stock_quantity FROM product_skus WHERE id = ? FOR UPDATE', [positiveInteger(skuId, 'skuId')])
    if (!rows.length) throw new Error('sku not found')
    const nextStock = Number(rows[0].stock_quantity) + delta
    if (nextStock < 0) throw new Error('stock cannot be negative')
    // A later inventory movement table can record reasons; this check protects stock now.
    await connection.query('UPDATE product_skus SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [nextStock, skuId])
    await connection.commit()
    return { data: { id: Number(skuId), stockQuantity: nextStock, reason: reason.trim() } }
  } catch (error) {
    await connection.rollback()
    return badRequest(reply, error.message)
  } finally {
    connection.release()
  }
})

app.get('/api/admin/orders', async (request, reply) => {
  const { adminUserId, status } = request.query || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const params = []
    let statusFilter = ''
    if (status) {
      if (!['PENDING_PAYMENT', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUNDED'].includes(status)) throw new Error('invalid order status')
      statusFilter = 'WHERE o.status = ?'
      params.push(status)
    }
    const [rows] = await db.query(`
      SELECT o.id, o.order_no, o.total_amount, o.status, o.recipient_name_snapshot, o.shipping_address_snapshot,
        o.tracking_no, o.created_at, u.display_name AS buyer_name
      FROM orders o JOIN users u ON u.id = o.buyer_user_id ${statusFilter} ORDER BY o.id DESC`, params)
    return { data: rows }
  } catch (error) {
    return badRequest(reply, error.message)
  }
})

app.patch('/api/admin/orders/:orderId/status', async (request, reply) => {
  const { orderId } = request.params
  const { adminUserId, status, trackingNo } = request.body || {}
  const db = getDb()
  const connection = await db.getConnection()
  try {
    await requireAdmin(connection, adminUserId)
    const id = positiveInteger(orderId, 'orderId')
    if (!['PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED'].includes(status)) throw new Error('invalid target status')
    await connection.beginTransaction()
    const [orders] = await connection.query('SELECT id, status FROM orders WHERE id = ? FOR UPDATE', [id])
    if (!orders.length) throw new Error('order not found')
    const current = orders[0].status
    const allowed = { PENDING_PAYMENT: ['PAID', 'CANCELLED'], PAID: ['SHIPPED', 'CANCELLED'], SHIPPED: ['COMPLETED'] }
    if (!allowed[current]?.includes(status)) throw new Error(`cannot transition order from ${current} to ${status}`)
    if (status === 'SHIPPED' && !String(trackingNo || '').trim()) throw new Error('trackingNo is required when shipping')
    if (status === 'CANCELLED') {
      // Replenish each SKU exactly once while the order row is locked.
      const [items] = await connection.query('SELECT product_sku_id, quantity FROM order_items WHERE order_id = ?', [id])
      for (const item of items) await connection.query('UPDATE product_skus SET stock_quantity = stock_quantity + ? WHERE id = ?', [item.quantity, item.product_sku_id])
    }
    const timestamps = status === 'SHIPPED' ? 'shipped_at = NOW()' : status === 'COMPLETED' ? 'completed_at = NOW()' : status === 'CANCELLED' ? 'cancelled_at = NOW()' : 'paid_at = NOW()'
    await connection.query(`UPDATE orders SET status = ?, tracking_no = COALESCE(?, tracking_no), ${timestamps}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, trackingNo?.trim() || null, id])
    await connection.commit()
    return { data: { id, status } }
  } catch (error) {
    await connection.rollback()
    return badRequest(reply, error.message)
  } finally {
    connection.release()
  }
})

app.post('/api/leave-requests', async (request, reply) => {
  const { parentUserId, childId, sessionId, reason } = request.body || {}
  const db = getDb()
  try {
    if (!parentUserId || !childId || !sessionId || !String(reason || '').trim()) throw new Error('parentUserId, childId, sessionId and reason are required')
    const [access] = await db.query('SELECT 1 FROM parent_children WHERE parent_user_id = ? AND child_id = ?', [parentUserId, childId])
    if (!access.length) throw new Error('child access denied')
    const [sessions] = await db.query(`SELECT 1 FROM class_sessions cs JOIN enrollments e ON e.class_id = cs.class_id
      WHERE cs.id = ? AND e.child_id = ? AND e.status = 'ACTIVE'`, [sessionId, childId])
    if (!sessions.length) throw new Error('session is not available for this child')
    const [result] = await db.query('INSERT INTO leave_requests (child_id, session_id, requested_by_user_id, reason) VALUES (?, ?, ?, ?)', [childId, sessionId, parentUserId, reason.trim()])
    return reply.code(201).send({ data: { id: result.insertId, status: 'PENDING' } })
  } catch (error) { return badRequest(reply, error.code === 'ER_DUP_ENTRY' ? 'leave request already exists' : error.message) }
})

app.get('/api/admin/leave-requests', async (request, reply) => {
  const { adminUserId, status = 'PENDING' } = request.query || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    const [rows] = await db.query(`SELECT lr.id, lr.status, lr.reason, ch.name AS child_name, cs.starts_at, c.name AS class_name
      FROM leave_requests lr JOIN children ch ON ch.id = lr.child_id JOIN class_sessions cs ON cs.id = lr.session_id
      JOIN classes c ON c.id = cs.class_id WHERE lr.status = ? ORDER BY lr.id DESC`, [status])
    return { data: rows }
  } catch (error) { return badRequest(reply, error.message) }
})

app.patch('/api/admin/leave-requests/:leaveRequestId', async (request, reply) => {
  const { leaveRequestId } = request.params
  const { adminUserId, status, reviewNote } = request.body || {}
  const db = getDb()
  try {
    await requireAdmin(db, adminUserId)
    if (!['APPROVED', 'REJECTED'].includes(status)) throw new Error('invalid leave request status')
    // Approval is recorded separately; attendance remains the teacher's final class record.
    const [result] = await db.query(`UPDATE leave_requests SET status = ?, reviewed_by_user_id = ?, review_note = ?, reviewed_at = NOW(), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'PENDING'`, [status, adminUserId, reviewNote || null, positiveInteger(leaveRequestId, 'leaveRequestId')])
    if (!result.affectedRows) throw new Error('leave request is no longer pending')
    return { data: { id: Number(leaveRequestId), status } }
  } catch (error) { return badRequest(reply, error.message) }
})

app.post('/api/artworks', async (request, reply) => {
  const { parentUserId, childId, sessionId, imageUrl, title } = request.body || {}
  const db = getDb()
  try {
    if (!parentUserId || !childId || !String(imageUrl || '').trim()) throw new Error('parentUserId, childId and imageUrl are required')
    const [access] = await db.query('SELECT 1 FROM parent_children WHERE parent_user_id = ? AND child_id = ?', [parentUserId, childId])
    if (!access.length) throw new Error('child access denied')
    // imageUrl is provider-agnostic so local, Cloudinary and OSS can share this business API.
    const [result] = await db.query('INSERT INTO artworks (child_id, session_id, image_url, title) VALUES (?, ?, ?, ?)', [childId, sessionId || null, imageUrl.trim(), title?.trim() || null])
    return reply.code(201).send({ data: { id: result.insertId, status: 'UPLOADED' } })
  } catch (error) { return badRequest(reply, error.message) }
})

app.get('/api/artworks', async (request, reply) => {
  const { parentUserId, childId } = request.query || {}
  const db = getDb()
  try {
    const [access] = await db.query('SELECT 1 FROM parent_children WHERE parent_user_id = ? AND child_id = ?', [parentUserId, childId])
    if (!access.length) throw new Error('child access denied')
    const [rows] = await db.query('SELECT id, image_url, title, status, created_at FROM artworks WHERE child_id = ? ORDER BY id DESC', [childId])
    return { data: rows }
  } catch (error) { return badRequest(reply, error.message) }
})

app.listen({ port: Number(process.env.PORT || 3000), host: process.env.HOST || '0.0.0.0' })
