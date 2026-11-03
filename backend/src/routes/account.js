import { randomBytes } from 'node:crypto'
import { db } from '../knex.js'
import { failWith, id, text } from '../http.js'
import { assertSelfOrAdmin, requireUser, requirePermission, loadActiveUser } from '../auth.js'
import { serializeAddress, serializeOrder, serializeUser } from '../serialize.js'
import { balanceOf } from '../services/lessons.js'
import { createOrder, payOrder } from '../services/orders.js'
import { assetPath, writeObject } from '../storage.js'

async function ordersWithItems(query) {
  const orders = await query
  const items = orders.length ? await db('order_items').whereIn('order_id', orders.map(order => order.id)) : []
  return orders.map(order => serializeOrder(order, items.filter(item => Number(item.order_id) === Number(order.id))))
}

function mobileOf(value) {
  const mobile = text(value, 'mobile')
  if (!/^1[3-9]\d{9}$/.test(mobile)) throw new Error('手机号格式不正确，请输入 11 位手机号')
  return mobile
}

function profileNameOf(value) {
  const name = String(value ?? '').trim()
  if (!name) throw new Error('昵称不能为空')
  if (name.length > 80) throw new Error('昵称不能超过 80 个字符')
  return name
}

const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

function avatarExtension(contentType) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[contentType] || 'jpg'
}

function requireProfileAccess(user) {
  if (!user.roles.length || user.permissions.includes('profile.read')) return user
  throw new Error('当前账号没有个人资料权限')
}

async function profileForm(request) {
  const contentType = String(request.headers['content-type'] || '')
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) throw new Error('头像上传格式不正确')
  if (!Buffer.isBuffer(request.body) || !request.body.length) throw new Error('头像上传内容为空')
  try {
    return await new Request('http://localhost/api/users/profile/avatar', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: request.body
    }).formData()
  } catch {
    throw new Error('头像上传内容不正确')
  }
}

// 模拟支付只能在显式开启开发认证的本地环境使用，线上请求直接返回 404。
function mockPaymentEnabled() {
  return String(process.env.NODE_ENV || 'development').toLowerCase() !== 'production'
    && String(process.env.ALLOW_DEV_AUTH || '').toLowerCase() === 'true'
    && String(process.env.PAYMENT_MODE || 'mock').toLowerCase() === 'mock'
}

function orderCreationEnabled() {
  const mode = String(process.env.PAYMENT_MODE || 'disabled').toLowerCase()
  if (mode === 'mock') return mockPaymentEnabled()
  if (mode === 'wechat') return String(process.env.WECHAT_PAY_ENABLED || '').toLowerCase() === 'true'
  return false
}

async function childIdsOf(userId) {
  const rows = await db('parent_children').where('parent_user_id', userId).select('child_id')
  return rows.map(row => Number(row.child_id))
}

function serializeLessonEntry(row) {
  return {
    id: Number(row.id), child_id: Number(row.child_id), child_name: row.child_name,
    type: row.type, quantity: Number(row.quantity || 0), balance_after: Number(row.balance_after || 0),
    reason: row.reason, course_title: row.course_title || null, operator_name: row.operator_name || null,
    created_at: row.created_at
  }
}

function serializeTrialAppointment(row) {
  return {
    id: Number(row.id), guardian_name: row.guardian_name, mobile: row.mobile, child_name: row.child_name,
    child_age: row.child_age === null || row.child_age === undefined ? null : Number(row.child_age),
    course_id: row.course_id ? Number(row.course_id) : null, course_title: row.course_title || null,
    preferred_date: row.preferred_date || null, preferred_time: row.preferred_time || 'ANY',
    note: row.note || '', status: row.status, handled_note: row.handled_note || '',
    handled_by_name: row.handled_by_name || null, handled_at: row.handled_at || null,
    created_at: row.created_at, updated_at: row.updated_at
  }
}

export default async function accountRoutes(app) {
  const fail = failWith(app)

  app.patch('/api/users/profile', async (request, reply) => {
    try {
      const current = await requireUser(request)
      requireProfileAccess(current)
      const body = request.body || {}
      const patch = {}
      if (Object.hasOwn(body, 'nickname') || Object.hasOwn(body, 'name')) {
        patch.display_name = profileNameOf(Object.hasOwn(body, 'nickname') ? body.nickname : body.name)
      }
      if (Object.keys(patch).length) {
        patch.updated_at = db.fn.now()
        await db('users').where({ id: current.id, status: 'ACTIVE' }).update(patch)
      }
      const updated = await loadActiveUser(current.id, current.currentRole)
      return { data: { user: serializeUser(updated.row, updated.roles, updated) } }
    } catch (error) { return fail(reply, error) }
  })

  app.post('/api/users/profile/avatar', async (request, reply) => {
    try {
      const current = await requireUser(request)
      requireProfileAccess(current)
      const form = await profileForm(request)
      const file = form.get('file')
      if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(Number(file.size))) throw new Error('请选择头像文件')
      if (Number(file.size) < 1) throw new Error('头像文件为空')
      if (Number(file.size) > MAX_AVATAR_BYTES) throw new Error('头像不能超过 5 MB')
      const contentType = String(file.type || '').split(';')[0].trim().toLowerCase()
      if (!AVATAR_TYPES.has(contentType)) throw new Error('头像只支持 JPG、PNG 或 WEBP 图片')
      const key = `avatars/${current.id}/${Date.now()}-${randomBytes(8).toString('hex')}.${avatarExtension(contentType)}`
      await writeObject(key, Buffer.from(await file.arrayBuffer()), contentType)
      const nickname = form.get('nickname')
      const patch = { avatar_url: assetPath(key), updated_at: db.fn.now() }
      if (nickname !== null && String(nickname).trim()) patch.display_name = profileNameOf(nickname)
      await db('users').where({ id: current.id, status: 'ACTIVE' }).update(patch)
      const updated = await loadActiveUser(current.id, current.currentRole)
      return { data: { user: serializeUser(updated.row, updated.roles, updated), avatarUrl: assetPath(key) } }
    } catch (error) { return fail(reply, error) }
  })

  app.get('/api/users/:userId/dashboard', async (request, reply) => {
    try {
      const userId = id(request.params.userId, 'userId')
      const current = await requireUser(request)
      assertSelfOrAdmin(current, userId)
      requirePermission(current, 'child.read')
      const user = await db('users').where('id', userId).first()
      if (!user) throw new Error('user not found')
      const roles = current.roles
      const children = await db('children')
        .join('parent_children', 'parent_children.child_id', 'children.id')
        .where('parent_children.parent_user_id', userId)
        .select('children.*', 'parent_children.relationship')
      const students = []
      for (const child of children) {
        students.push({ id: Number(child.id), name: child.name, gender: child.gender, remaining_lessons: await balanceOf(db, child.id), relationship: child.relationship })
      }
      const childIds = students.map(item => item.id)
      const sessions = childIds.length
        ? await db('class_sessions')
            .join('classes', 'classes.id', 'class_sessions.class_id')
            .join('courses', 'courses.id', 'classes.course_id')
            .join('enrollments', 'enrollments.class_id', 'classes.id')
            .whereIn('enrollments.child_id', childIds)
            .where('enrollments.status', 'ACTIVE')
            .where('class_sessions.status', 'SCHEDULED')
            .orderBy('class_sessions.starts_at', 'asc')
            .limit(12)
            .distinct('class_sessions.id')
            .select('class_sessions.*', 'courses.name AS course_title', 'classes.name AS class_name')
            .select(db('enrollments AS schedule_enrollments')
              .select(db.raw('GROUP_CONCAT(DISTINCT schedule_enrollments.child_id)'))
              .whereColumn('schedule_enrollments.class_id', 'classes.id')
              .where('schedule_enrollments.status', 'ACTIVE')
              .whereIn('schedule_enrollments.child_id', childIds)
              .as('child_ids'))
        : []
      return { data: { user: serializeUser(user, roles, current), students, sessions } }
    } catch (error) { return fail(reply, error) }
  })

  app.get('/api/users/:userId/orders', async (request, reply) => {
    try {
      const userId = id(request.params.userId, 'userId')
      const current = await requireUser(request)
      assertSelfOrAdmin(current, userId)
      requirePermission(current, 'order.read')
      return { data: await ordersWithItems(db('orders').where('buyer_user_id', userId).orderBy('id', 'desc')) }
    } catch (error) { return fail(reply, error) }
  })

  app.get('/api/users/:userId/trial-appointments', async (request, reply) => {
    try {
      const userId = id(request.params.userId, 'userId')
      const current = await requireUser(request)
      assertSelfOrAdmin(current, userId)
      requirePermission(current, 'trial.read')
      const rows = await db('trial_appointments')
        .leftJoin('courses', 'courses.id', 'trial_appointments.course_id')
        .leftJoin('users AS handled_user', 'handled_user.id', 'trial_appointments.handled_by_user_id')
        .where('trial_appointments.user_id', userId)
        .orderBy('trial_appointments.id', 'desc')
        .limit(50)
        .select('trial_appointments.*', 'courses.name AS course_title', 'handled_user.display_name AS handled_by_name')
      return { data: rows.map(serializeTrialAppointment) }
    } catch (error) { return fail(reply, error) }
  })

  app.get('/api/users/:userId/lesson-ledger', async (request, reply) => {
    try {
      const userId = id(request.params.userId, 'userId')
      const current = await requireUser(request)
      assertSelfOrAdmin(current, userId)
      requirePermission(current, 'child.read')
      const requestedChildId = request.query?.childId ? id(request.query.childId, 'childId') : null
      const privileged = current.roles.some(role => ['ADMIN', 'OPERATOR'].includes(role))
      let childIds = await childIdsOf(userId)
      if (requestedChildId) {
        if (!privileged && !childIds.includes(requestedChildId)) throw new Error('该学员不在您的监护列表中')
        childIds = [requestedChildId]
      }
      if (!childIds.length) return { data: [] }
      const rows = await db('lesson_ledger')
        .join('children', 'children.id', 'lesson_ledger.child_id')
        .leftJoin('class_sessions', 'class_sessions.id', 'lesson_ledger.session_id')
        .leftJoin('classes', 'classes.id', 'class_sessions.class_id')
        .leftJoin('courses', 'courses.id', 'classes.course_id')
        .leftJoin('users AS ledger_operator', 'ledger_operator.id', 'lesson_ledger.operator_user_id')
        .whereIn('lesson_ledger.child_id', childIds)
        .orderBy('lesson_ledger.id', 'desc')
        .limit(100)
        .select('lesson_ledger.*', 'children.name AS child_name', 'courses.name AS course_title', 'ledger_operator.display_name AS operator_name')
      return { data: rows.map(serializeLessonEntry) }
    } catch (error) { return fail(reply, error) }
  })

  app.post('/api/orders', async (request, reply) => {
    if (!orderCreationEnabled()) return reply.code(503).send({ message: '支付通道尚未配置，暂不能下单' })
    try {
      const body = request.body || {}
      const buyer = await requireUser(request)
      requirePermission(buyer, request.body?.type === 'COURSE' ? 'course.enroll' : 'order.read')
      const order = await createOrder({
        buyerUserId: buyer.id,
        type: body.type ? text(body.type, 'type') : undefined,
        subjectId: body.subjectId ? id(body.subjectId, 'subjectId') : undefined,
        quantity: body.quantity || 1,
        addressId: body.addressId ? id(body.addressId, 'addressId') : null,
        courseChildId: body.courseChildId ? id(body.courseChildId, 'courseChildId') : null,
        items: Array.isArray(body.items) && body.items.length ? body.items.map(item => ({
          type: text(item.type || body.type, 'type'),
          subjectId: id(item.subjectId, 'subjectId'),
          quantity: item.quantity || 1
        })) : null
      })
      return reply.code(201).send({ data: order })
    } catch (error) { return fail(reply, error) }
  })

  app.post('/api/orders/:orderId/mock-pay', async (request, reply) => {
    if (!mockPaymentEnabled()) return reply.code(404).send({ message: 'not found' })
    try {
      const orderId = id(request.params.orderId, 'orderId')
      const current = await requireUser(request)
      requirePermission(current, 'order.read')
      const userId = current.id
      const result = await db.transaction(async trx => {
        const order = await trx('orders').where('id', orderId).first('buyer_user_id')
        if (!order || Number(order.buyer_user_id) !== userId) throw new Error('订单不存在')
        return payOrder(trx, orderId, `MOCK-${orderId}-${Date.now()}`, userId)
      })
      return { data: result }
    } catch (error) { return fail(reply, error) }
  })

  app.post('/api/orders/:orderId/confirm-receipt', async (request, reply) => {
    try {
      const orderId = id(request.params.orderId, 'orderId')
      const current = await requireUser(request)
      requirePermission(current, 'order.read')
      const userId = current.id
      await db.transaction(async trx => {
        const order = await trx('orders').where('id', orderId).forUpdate().first()
        if (!order || Number(order.buyer_user_id) !== userId) throw new Error('订单不存在')
        if (order.status !== 'SHIPPED') throw new Error('订单尚未发货，无法确认收货')
        await trx('orders').where('id', orderId).update({ status: 'COMPLETED', completed_at: trx.fn.now(), updated_at: trx.fn.now() })
      })
      return { data: { id: orderId, status: 'COMPLETED' } }
    } catch (error) { return fail(reply, error) }
  })

  app.post('/api/orders/:orderId/cancel', async (request, reply) => {
    try {
      const orderId = id(request.params.orderId, 'orderId')
      const current = await requireUser(request)
      requirePermission(current, 'order.read')
      const userId = current.id
      await db.transaction(async trx => {
        const order = await trx('orders').where('id', orderId).forUpdate().first()
        if (!order || Number(order.buyer_user_id) !== userId) throw new Error('订单不存在')
        if (order.status !== 'PENDING_PAYMENT') throw new Error('仅待支付订单可以取消')
        const items = await trx('order_items').where('order_id', orderId).whereNotNull('product_sku_id')
        for (const item of items) await trx('product_skus').where('id', item.product_sku_id).increment('stock_quantity', item.quantity)
        await trx('orders').where('id', orderId).update({ status: 'CANCELLED', cancelled_at: trx.fn.now(), updated_at: trx.fn.now() })
      })
      return { data: { id: orderId, status: 'CANCELLED' } }
    } catch (error) { return fail(reply, error) }
  })

  app.get('/api/users/:userId/addresses', async (request, reply) => {
    try {
      const userId = id(request.params.userId, 'userId')
      const current = await requireUser(request)
      assertSelfOrAdmin(current, userId)
      requirePermission(current, 'address.manage')
      const rows = await db('shipping_addresses').where('user_id', userId).orderBy([{ column: 'is_default', order: 'desc' }, { column: 'id', order: 'desc' }])
      return { data: rows.map(serializeAddress) }
    } catch (error) { return fail(reply, error) }
  })

  app.post('/api/users/:userId/addresses', async (request, reply) => {
    try {
      const userId = id(request.params.userId, 'userId')
      const current = await requireUser(request)
      assertSelfOrAdmin(current, userId)
      requirePermission(current, 'address.manage')
      const body = request.body || {}
      const record = {
        user_id: userId,
        recipient_name: text(body.recipientName, 'recipientName'),
        mobile: mobileOf(body.mobile),
        province: text(body.province, 'province'),
        city: text(body.city, 'city'),
        district: text(body.district, 'district'),
        detail: text(body.detail, 'detail'),
        is_default: Boolean(body.isDefault)
      }
      const addressId = await db.transaction(async trx => {
        const existing = await trx('shipping_addresses').where('user_id', userId).first('id')
        if (!existing) record.is_default = true
        if (record.is_default) await trx('shipping_addresses').where('user_id', userId).update({ is_default: false })
        const [insertId] = await trx('shipping_addresses').insert(record)
        return insertId
      })
      return reply.code(201).send({ data: { id: Number(addressId) } })
    } catch (error) { return fail(reply, error) }
  })

  app.patch('/api/users/:userId/addresses/:addressId', async (request, reply) => {
    try {
      const userId = id(request.params.userId, 'userId')
      const current = await requireUser(request)
      assertSelfOrAdmin(current, userId)
      requirePermission(current, 'address.manage')
      const addressId = id(request.params.addressId, 'addressId')
      const body = request.body || {}
      await db.transaction(async trx => {
        const address = await trx('shipping_addresses').where({ id: addressId, user_id: userId }).first()
        if (!address) throw new Error('地址不存在')
        const patch = {}
        for (const [key, column] of [['recipientName', 'recipient_name'], ['province', 'province'], ['city', 'city'], ['district', 'district'], ['detail', 'detail']]) {
          if (Object.hasOwn(body, key)) patch[column] = text(body[key], key)
        }
        if (Object.hasOwn(body, 'mobile')) patch.mobile = mobileOf(body.mobile)
        if (Object.hasOwn(body, 'isDefault')) {
          patch.is_default = Boolean(body.isDefault)
          if (patch.is_default) await trx('shipping_addresses').where('user_id', userId).update({ is_default: false })
        }
        if (Object.keys(patch).length) await trx('shipping_addresses').where('id', addressId).update({ ...patch, updated_at: trx.fn.now() })
      })
      return { data: { id: addressId } }
    } catch (error) { return fail(reply, error) }
  })

  app.delete('/api/users/:userId/addresses/:addressId', async (request, reply) => {
    try {
      const userId = id(request.params.userId, 'userId')
      const current = await requireUser(request)
      assertSelfOrAdmin(current, userId)
      requirePermission(current, 'address.manage')
      const addressId = id(request.params.addressId, 'addressId')
      const address = await db('shipping_addresses').where({ id: addressId, user_id: userId }).first('is_default')
      if (!address) throw new Error('地址不存在')
      await db.transaction(async trx => {
        await trx('shipping_addresses').where({ id: addressId, user_id: userId }).delete()
        if (address.is_default) {
          const replacement = await trx('shipping_addresses').where('user_id', userId).orderBy('id', 'desc').first('id')
          if (replacement) await trx('shipping_addresses').where('id', replacement.id).update({ is_default: true, updated_at: trx.fn.now() })
        }
      })
      return { data: { id: addressId } }
    } catch (error) { return fail(reply, error) }
  })

  app.get('/api/users/:userId/leave-requests', async (request, reply) => {
    try {
      const userId = id(request.params.userId, 'userId')
      const current = await requireUser(request)
      assertSelfOrAdmin(current, userId)
      requirePermission(current, 'leave.create')
      const childIds = await childIdsOf(userId)
      if (!childIds.length) return { data: [] }
      const rows = await db('leave_requests')
        .join('children', 'children.id', 'leave_requests.child_id')
        .join('class_sessions', 'class_sessions.id', 'leave_requests.session_id')
        .join('classes', 'classes.id', 'class_sessions.class_id')
        .join('courses', 'courses.id', 'classes.course_id')
        .whereIn('leave_requests.child_id', childIds)
        .orderBy('leave_requests.id', 'desc')
        .select('leave_requests.*', 'children.name AS child_name', 'class_sessions.starts_at', 'class_sessions.ends_at', 'courses.name AS course_title', 'classes.name AS class_name')
      return { data: rows }
    } catch (error) { return fail(reply, error) }
  })

  app.post('/api/leave-requests', async (request, reply) => {
    try {
      const body = request.body || {}
      const current = await requireUser(request)
      requirePermission(current, 'leave.create')
      const userId = current.id
      const childId = id(body.childId, 'childId')
      const sessionId = id(body.sessionId, 'sessionId')
      const reason = text(body.reason, 'reason')
      const bound = await db('parent_children').where({ parent_user_id: userId, child_id: childId }).first()
      if (!bound) throw new Error('该学员不在您的监护列表中')
      const session = await db('class_sessions')
        .join('enrollments', 'enrollments.class_id', 'class_sessions.class_id')
        .where('class_sessions.id', sessionId)
        .where('enrollments.child_id', childId)
        .where('enrollments.status', 'ACTIVE')
        .first('class_sessions.status', 'class_sessions.starts_at')
      if (!session || session.status !== 'SCHEDULED') throw new Error('课次不存在或已结束')
      if (new Date(session.starts_at) <= new Date()) throw new Error('课次已开始，无法请假')
      try {
        const [insertId] = await db('leave_requests').insert({ child_id: childId, session_id: sessionId, requested_by_user_id: userId, reason })
        return reply.code(201).send({ data: { id: Number(insertId), status: 'PENDING' } })
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw new Error('该课次已提交过请假申请')
        throw error
      }
    } catch (error) { return fail(reply, error) }
  })

  app.get('/api/users/:userId/feedback', async (request, reply) => {
    try {
      const userId = id(request.params.userId, 'userId')
      const current = await requireUser(request)
      assertSelfOrAdmin(current, userId)
      requirePermission(current, 'artwork.read')
      const childIds = await childIdsOf(userId)
      if (!childIds.length) return { data: [] }
      const rows = await db('session_feedback')
        .join('class_sessions', 'class_sessions.id', 'session_feedback.session_id')
        .join('classes', 'classes.id', 'class_sessions.class_id')
        .join('courses', 'courses.id', 'classes.course_id')
        .join('users', 'users.id', 'session_feedback.teacher_user_id')
        .leftJoin('children', 'children.id', 'session_feedback.child_id')
        .where('session_feedback.status', 'PUBLISHED')
        .where(builder => builder.whereIn('session_feedback.child_id', childIds).orWhereNull('session_feedback.child_id'))
        .orderBy('session_feedback.id', 'desc')
        .select('session_feedback.*', 'courses.name AS course_title', 'classes.name AS class_name', 'class_sessions.starts_at', 'users.display_name AS teacher_name', 'children.name AS child_name')
      return { data: rows }
    } catch (error) { return fail(reply, error) }
  })
}
