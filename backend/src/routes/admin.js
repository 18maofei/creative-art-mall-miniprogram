import { db } from '../knex.js'
import { failWith, id, text } from '../http.js'
import { passwordHash, passwordMatches, sessionFor, requireAdmin, requirePermission, loadActiveUser, normalizeRole, roleCode, ROLE_DEFINITIONS, DEFAULT_ROLE_PERMISSIONS } from '../auth.js'
import { serializeCourse, serializeProduct, serializeUser, serializeOrder, statusToDb } from '../serialize.js'
import { balanceOf, applyLedger } from '../services/lessons.js'
import { canTransition, payOrder } from '../services/orders.js'
import { createUploadUrl } from '../storage.js'

const COURSE_FIELDS = [
  [['title', 'name'], 'name'],
  [['category'], 'category'],
  [['ageRange', 'age_range'], 'age_range'],
  [['sessions', 'defaultLessonCount'], 'default_lesson_count'],
  [['price'], 'price'],
  [['schedule', 'scheduleText'], 'schedule_text'],
  [['campus'], 'campus'],
  [['room'], 'room'],
  [['teacherName', 'teacher_name'], 'teacher_name'],
  [['description'], 'description'],
  [['coverUrl', 'cover_url'], 'cover_url']
]

function pickFields(body, fields) {
  const patch = {}
  for (const [keys, column] of fields) {
    for (const key of keys) {
      if (Object.hasOwn(body, key)) { patch[column] = body[key]; break }
    }
  }
  if (Object.hasOwn(body, 'status')) patch.status = statusToDb(body.status)
  return patch
}

function rolesFromBody(body) {
  const values = Array.isArray(body.roles) ? body.roles : [body.role || 'VISITOR']
  return [...new Set(values.map(normalizeRole).filter(Boolean))]
}

function assertStaffSelfProtection(operator, targetUserId, roles) {
  if (Number(operator.id) === Number(targetUserId) && !roles.some(role => ['ADMIN', 'OPERATOR'].includes(role))) throw new Error('不能移除当前账号的后台身份')
}

function fallbackRoleRows() {
  return Object.entries(ROLE_DEFINITIONS).map(([code, meta]) => ({ code, name: meta.name, status: 'active', permissions: DEFAULT_ROLE_PERMISSIONS[code] || [] }))
}

function permissionForAdminRequest(request) {
  const path = request.url.split('?')[0]
  if (path.includes('/roles') || path.includes('/permissions') || path.includes('/access')) return 'identity.manage'
  if (path.endsWith('/password')) return 'settings.manage'
  if (path.endsWith('/overview')) return 'dashboard.read'
  if (path.endsWith('/analytics')) return 'report.read'
  if (path.includes('/leave-requests') && request.method !== 'GET') return 'leave.review'
  const resources = [
    ['/users', 'user'], ['/parents', 'user'], ['/guardians', 'child'], ['/children', 'child'],
    ['/courses', 'course'], ['/classes', 'schedule'], ['/enrollments', 'child'], ['/products', 'product'],
    ['/skus', 'product'], ['/resources', 'resource'], ['/uploads', 'resource'], ['/orders', 'order'],
    ['/leave-requests', 'leave'], ['/announcements', 'announcement'], ['/trial-appointments', 'trial']
  ]
  const resource = resources.find(([prefix]) => path.includes(`/api/admin${prefix}`))?.[1]
  if (!resource) return 'admin.access'
  return `${resource}.${request.method === 'GET' ? 'read' : 'write'}`
}

async function rolesByUser(userIds) {
  if (!userIds.length) return {}
  const rows = await db('user_roles').whereIn('user_id', userIds)
  const map = {}
  for (const row of rows) {
    const key = Number(row.user_id)
    if (!map[key]) map[key] = []
    map[key].push(row.role)
  }
  return map
}

async function loadAdminProducts() {
  const products = await db('products').orderBy('id', 'desc')
  const skus = products.length ? await db('product_skus').whereIn('product_id', products.map(p => p.id)).orderBy('id') : []
  return products.map(product => serializeProduct(product, skus.filter(sku => Number(sku.product_id) === Number(product.id))))
}

function boundedText(value, name, maxLength) {
  const result = text(value, name)
  if (result.length > maxLength) throw new Error(`${name} 不能超过 ${maxLength} 个字符`)
  return result
}

function serializeTrialAppointment(row) {
  return {
    id: Number(row.id), user_id: row.user_id ? Number(row.user_id) : null,
    guardian_name: row.guardian_name, mobile: row.mobile, child_name: row.child_name,
    child_age: row.child_age === null || row.child_age === undefined ? null : Number(row.child_age),
    course_id: row.course_id ? Number(row.course_id) : null, course_title: row.course_title || null,
    preferred_date: row.preferred_date || null, preferred_time: row.preferred_time || 'ANY',
    note: row.note || '', status: row.status, handled_note: row.handled_note || '',
    handled_by_name: row.handled_by_name || null, handled_at: row.handled_at || null,
    created_at: row.created_at, updated_at: row.updated_at
  }
}

export default async function adminRoutes(app) {
  const fail = failWith(app)
  const guard = handler => async (request, reply) => {
    try {
      const operator = await requireAdmin(request)
      requirePermission(operator, permissionForAdminRequest(request))
      return await handler(request, reply, operator)
    } catch (error) {
      const message = error.message || ''
      const unauthenticated = /请先登录|登录已失效/.test(message)
      const forbidden = /access denied|缺少权限|无权|只有超级管理员|不能移除/.test(message)
      return fail(reply, error, unauthenticated ? 401 : forbidden ? 403 : 400)
    }
  }

  app.post('/api/admin/login', async (request, reply) => {
    try {
      const body = request.body || {}
      const name = text(body.name, 'name')
      const password = text(body.password, 'password')
      const user = await db('users')
        .join('user_roles', 'user_roles.user_id', 'users.id')
        .where('users.display_name', name)
        .whereIn('user_roles.role', ['ADMIN', 'OPERATOR'])
        .first('users.id', 'users.display_name AS name', 'users.status', 'users.admin_password_hash')
      if (!user || user.status !== 'ACTIVE' || !passwordMatches(password, user.admin_password_hash)) throw new Error('账号或密码错误')
      const current = await loadActiveUser(user.id)
      return { data: { token: sessionFor(current), user: serializeUser(current.row, current.roles, current) } }
    } catch (error) { return fail(reply, error, 401) }
  })

  app.post('/api/admin/password', guard(async (request, _reply, operator) => {
    const body = request.body || {}
    const currentPassword = text(body.currentPassword, 'currentPassword')
    const newPassword = text(body.newPassword, 'newPassword')
    if (newPassword.length < 12) throw new Error('新密码至少需要 12 位')
    if (newPassword === currentPassword) throw new Error('新密码不能与当前密码相同')
    const record = await db('users').where('id', operator.id).first('admin_password_hash')
    if (!record || !passwordMatches(currentPassword, record.admin_password_hash)) throw new Error('当前密码错误')
    await db('users').where('id', operator.id).update({ admin_password_hash: passwordHash(newPassword), updated_at: db.fn.now() })
    return { data: { changed: true } }
  }))

  app.get('/api/admin/overview', guard(async () => {
    const [users, children, teachers, visits, pendingOrders, activeClasses, scheduledSessions] = await Promise.all([
      db('users').count('id AS total').first(),
      db('children').count('id AS total').first(),
      db('user_roles').join('users', 'users.id', 'user_roles.user_id').where('user_roles.role', 'TEACHER').where('users.status', 'ACTIVE').count('user_roles.id AS total').first(),
      db('analytics_events').where('created_at', '>=', db.raw('DATE_SUB(NOW(), INTERVAL 1 DAY)')).count('id AS total').first(),
      db('orders').where('status', 'PENDING_PAYMENT').count('id AS total').first(),
      db('classes').where('status', 'ACTIVE').count('id AS total').first(),
      db('class_sessions').where('status', 'SCHEDULED').where('starts_at', '>=', db.fn.now()).count('id AS total').first()
    ])
    return {
      data: {
        users: Number(users.total),
        students: Number(children.total),
        children: Number(children.total),
        teachers: Number(teachers.total),
        visits: Number(visits.total),
        pendingOrders: Number(pendingOrders.total),
        activeClasses: Number(activeClasses.total),
        scheduledSessions: Number(scheduledSessions.total)
      }
    }
  }))

  app.get('/api/admin/analytics', guard(async () => {
    const roles = await db('analytics_events')
      .where('created_at', '>=', db.raw('DATE_SUB(NOW(), INTERVAL 7 DAY)'))
      .select(db.raw("COALESCE(role, 'VISITOR') AS role"))
      .count('id AS total')
      .groupBy('role')
    const daily = await db('analytics_events')
      .where('created_at', '>=', db.raw('DATE_SUB(NOW(), INTERVAL 7 DAY)'))
      .select(db.raw("DATE_FORMAT(created_at, '%Y-%m-%d') AS day"))
      .count('id AS total')
      .groupByRaw("DATE_FORMAT(created_at, '%Y-%m-%d')")
      .orderBy('day')
    return { data: { roles, daily } }
  }))

  // ---------- 试听预约 ----------
  app.get('/api/admin/trial-appointments', guard(async request => {
    const status = String(request.query?.status || '').trim().toUpperCase()
    const rows = await db('trial_appointments')
      .leftJoin('courses', 'courses.id', 'trial_appointments.course_id')
      .leftJoin('users AS handled_user', 'handled_user.id', 'trial_appointments.handled_by_user_id')
      .modify(query => { if (['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].includes(status)) query.where('trial_appointments.status', status) })
      .orderBy('trial_appointments.id', 'desc')
      .limit(200)
      .select('trial_appointments.*', 'courses.name AS course_title', 'handled_user.display_name AS handled_by_name')
    return { data: rows.map(serializeTrialAppointment) }
  }))

  app.patch('/api/admin/trial-appointments/:id', guard(async (request, _reply, operator) => {
    const appointmentId = id(request.params.id, 'id')
    const body = request.body || {}
    const status = String(body.status || '').trim().toUpperCase()
    if (!['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].includes(status)) throw new Error('预约状态不正确')
    const appointment = await db('trial_appointments').where('id', appointmentId).first('id')
    if (!appointment) throw new Error('试听预约不存在')
    const handledNote = body.handledNote === null || body.handledNote === undefined || String(body.handledNote).trim() === '' ? null : boundedText(body.handledNote, 'handledNote', 500)
    await db('trial_appointments').where('id', appointmentId).update({
      status,
      handled_by_user_id: status === 'PENDING' ? null : operator.id,
      handled_note: handledNote,
      handled_at: status === 'PENDING' ? null : db.fn.now(),
      updated_at: db.fn.now()
    })
    return { data: { id: appointmentId, status } }
  }))

  // ---------- 用户 ----------
  app.get('/api/admin/users', guard(async request => {
    const role = String(request.query?.role || '').toUpperCase()
    const keyword = String(request.query?.keyword || '').trim()
    let query = db('users').orderBy('id', 'desc')
    if (keyword) query = query.where(builder => builder.where('display_name', 'like', `%${keyword}%`).orWhere('mobile', 'like', `%${keyword}%`))
    if (['ADMIN', 'OPERATOR', 'TEACHER', 'PARENT', 'STUDENT'].includes(role)) query = query.whereIn('id', db('user_roles').where('role', role).select('user_id'))
    else if (role === 'VISITOR') query = query.whereNotIn('id', db('user_roles').select('user_id'))
    const users = await query
    const roles = await rolesByUser(users.map(user => Number(user.id)))
    const snapshots = await Promise.all(users.map(async user => {
      const snapshot = await loadActiveUser(user.id, undefined, true)
      return serializeUser(user, roles[Number(user.id)] || [], snapshot)
    }))
    return { data: snapshots }
  }))

  app.post('/api/admin/users', guard(async (request, reply, operator) => {
    const body = request.body || {}
    const roles = rolesFromBody(body)
    const role = roles[0] || 'VISITOR'
    if (roles.length) requirePermission(operator, 'identity.manage')
    if (roles.includes('ADMIN') && operator.currentRole !== 'ADMIN') throw new Error('只有超级管理员可以授予超级管理员身份')
    const password = String(body.password || '')
    if (['ADMIN', 'OPERATOR'].includes(role) && password.length < 8) throw new Error('后台账号需设置至少 8 位登录密码')
    if (password && password.length < 8) throw new Error('登录密码至少 8 位')
    const userId = await db.transaction(async trx => {
      const [insertId] = await trx('users').insert({
        wechat_openid: body.openid || null,
        display_name: text(body.name || body.displayName, 'name'),
        mobile: body.mobile || null,
        avatar_url: body.avatarUrl || null,
        admin_password_hash: password ? passwordHash(password) : null,
        status: body.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE'
      })
      for (const assignedRole of roles) await trx('user_roles').insert({ user_id: insertId, role: assignedRole })
      return insertId
    })
    return reply.code(201).send({ data: { id: Number(userId) } })
  }))

  app.patch('/api/admin/users/:userId', guard(async (request, _reply, operator) => {
    const userId = id(request.params.userId, 'userId')
    const body = request.body || {}
    const requestedRoles = Object.hasOwn(body, 'role') || Object.hasOwn(body, 'roles') ? rolesFromBody(body) : null
    if (requestedRoles) {
      requirePermission(operator, 'identity.manage')
      if (requestedRoles.includes('ADMIN') && operator.currentRole !== 'ADMIN') throw new Error('只有超级管理员可以授予超级管理员身份')
      assertStaffSelfProtection(operator, userId, requestedRoles)
    }
    await db.transaction(async trx => {
      const patch = { updated_at: trx.fn.now() }
      if (Object.hasOwn(body, 'name')) patch.display_name = text(body.name, 'name')
      if (Object.hasOwn(body, 'mobile')) patch.mobile = body.mobile || null
      if (Object.hasOwn(body, 'avatarUrl')) patch.avatar_url = body.avatarUrl || null
      if (Object.hasOwn(body, 'status')) patch.status = body.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE'
      if (body.password) {
        if (String(body.password).length < 8) throw new Error('登录密码至少 8 位')
        patch.admin_password_hash = passwordHash(String(body.password))
      }
      await trx('users').where('id', userId).update(patch)
      if (Object.hasOwn(body, 'permissions')) requirePermission(operator, 'identity.manage')
      if (requestedRoles) {
        await trx('user_roles').where('user_id', userId).delete()
        for (const role of requestedRoles) await trx('user_roles').insert({ user_id: userId, role })
      }
    })
    return { data: { id: userId } }
  }))

  // ---------- 身份与权限配置 ----------
  app.get('/api/admin/roles', guard(async (_request, _reply, operator) => {
    requirePermission(operator, 'identity.manage')
    try {
      const roles = await db('role_catalog').orderBy('sort_order').orderBy('code')
      const permissions = await db('role_permissions').orderBy(['role_code', 'permission_code'])
      return { data: roles.map(role => ({ code: roleCode(role.code), name: role.name, status: String(role.status).toLowerCase(), permissions: permissions.filter(item => item.role_code === role.code).map(item => item.permission_code) })) }
    } catch {
      return { data: fallbackRoleRows() }
    }
  }))

  app.get('/api/admin/permissions', guard(async (_request, _reply, operator) => {
    requirePermission(operator, 'identity.manage')
    try {
      return { data: await db('permission_catalog').where('status', 'ACTIVE').orderBy('group_name').orderBy('code') }
    } catch {
      const codes = [...new Set(Object.values(DEFAULT_ROLE_PERMISSIONS).flat())].sort()
      return { data: codes.map(code => ({ code, name: code, group_name: '业务权限', status: 'ACTIVE' })) }
    }
  }))

  app.get('/api/admin/users/:userId/access', guard(async (request, _reply, operator) => {
    requirePermission(operator, 'identity.manage')
    const userId = id(request.params.userId, 'userId')
    const target = await loadActiveUser(userId, undefined, true)
    let overrides = []
    try { overrides = await db('user_permissions').where('user_id', userId).select('permission_code AS code', 'effect').orderBy('permission_code') } catch { /* 旧数据库没有覆盖权限表 */ }
    return { data: { user: serializeUser(target.row, target.roles, target), overrides } }
  }))

  app.patch('/api/admin/users/:userId/access', guard(async (request, _reply, operator) => {
    requirePermission(operator, 'identity.manage')
    const userId = id(request.params.userId, 'userId')
    const body = request.body || {}
    const roles = [...new Set((Array.isArray(body.roles) ? body.roles : []).map(normalizeRole).filter(Boolean))]
    if (roles.includes('ADMIN') && operator.currentRole !== 'ADMIN') throw new Error('只有超级管理员可以授予超级管理员身份')
    assertStaffSelfProtection(operator, userId, roles)
    const overrides = Array.isArray(body.overrides) ? body.overrides.filter(item => item && typeof item.code === 'string' && ['ALLOW', 'DENY'].includes(item.effect)).map(item => ({ code: item.code.trim(), effect: item.effect })) : []
    await db.transaction(async trx => {
      await trx('user_roles').where('user_id', userId).delete()
      for (const role of roles) await trx('user_roles').insert({ user_id: userId, role })
      await trx('user_permissions').where('user_id', userId).delete()
      if (overrides.length) await trx('user_permissions').insert(overrides.map(item => ({ user_id: userId, permission_code: item.code, effect: item.effect })))
    })
    const updated = await loadActiveUser(userId, undefined, true)
    return { data: { user: serializeUser(updated.row, updated.roles, updated) } }
  }))

  // ---------- 课程 ----------
  app.get('/api/admin/courses', guard(async () => ({ data: (await db('courses').orderBy('id', 'desc')).map(serializeCourse) })))

  app.post('/api/admin/courses', guard(async (request, reply) => {
    const body = request.body || {}
    const record = pickFields(body, COURSE_FIELDS)
    record.name = text(record.name, 'name')
    record.default_lesson_count = Number(record.default_lesson_count || 12)
    record.price = Number(record.price || 0)
    if (!record.status) record.status = 'DRAFT'
    const [insertId] = await db('courses').insert(record)
    return reply.code(201).send({ data: { id: Number(insertId) } })
  }))

  app.patch('/api/admin/courses/:id', guard(async request => {
    const courseId = id(request.params.id)
    const patch = pickFields(request.body || {}, COURSE_FIELDS)
    if (!Object.keys(patch).length) throw new Error('no fields to update')
    await db('courses').where('id', courseId).update({ ...patch, updated_at: db.fn.now() })
    return { data: { id: courseId } }
  }))

  // ---------- 商品与 SKU ----------
  app.get('/api/admin/products', guard(async () => ({ data: await loadAdminProducts() })))

  app.post('/api/admin/products', guard(async (request, reply) => {
    const body = request.body || {}
    const productId = await db.transaction(async trx => {
      const [insertId] = await trx('products').insert({
        name: text(body.title || body.name, 'name'),
        category: body.category || null,
        description: body.description || null,
        cover_url: body.coverUrl || null,
        status: statusToDb(body.status || 'DRAFT')
      })
      await trx('product_skus').insert({
        product_id: insertId,
        name: body.skuName || '标准款',
        sku_code: `SKU-${insertId}-${Date.now()}`,
        price: Number(body.price || 0),
        stock_quantity: Number(body.stock || 0)
      })
      return insertId
    })
    return reply.code(201).send({ data: { id: Number(productId) } })
  }))

  app.patch('/api/admin/products/:id', guard(async request => {
    const productId = id(request.params.id)
    const body = request.body || {}
    await db.transaction(async trx => {
      const patch = { updated_at: trx.fn.now() }
      if (Object.hasOwn(body, 'title') || Object.hasOwn(body, 'name')) patch.name = text(body.title || body.name, 'name')
      if (Object.hasOwn(body, 'category')) patch.category = body.category || null
      if (Object.hasOwn(body, 'description')) patch.description = body.description || null
      if (Object.hasOwn(body, 'coverUrl')) patch.cover_url = body.coverUrl || null
      if (Object.hasOwn(body, 'status')) patch.status = statusToDb(body.status)
      await trx('products').where('id', productId).update(patch)
      if (Object.hasOwn(body, 'price') || Object.hasOwn(body, 'stock')) {
        const sku = await trx('product_skus').where('product_id', productId).orderBy('id').first()
        const skuPatch = {}
        if (Object.hasOwn(body, 'price')) skuPatch.price = Number(body.price)
        if (Object.hasOwn(body, 'stock')) skuPatch.stock_quantity = Number(body.stock)
        if (sku) await trx('product_skus').where('id', sku.id).update(skuPatch)
        else await trx('product_skus').insert({ product_id: productId, name: '标准款', sku_code: `SKU-${productId}-${Date.now()}`, price: Number(body.price || 0), stock_quantity: Number(body.stock || 0) })
      }
    })
    return { data: { id: productId } }
  }))

  app.post('/api/admin/skus/:skuId/stock', guard(async (request, _reply, operator) => {
    const skuId = id(request.params.skuId, 'skuId')
    const body = request.body || {}
    const quantity = Number(body.quantity)
    if (!Number.isInteger(quantity) || !quantity) throw new Error('quantity must be a non-zero integer')
    text(body.reason, 'reason')
    const stock = await db.transaction(async trx => {
      const sku = await trx('product_skus').where('id', skuId).forUpdate().first()
      if (!sku) throw new Error('SKU 不存在')
      const next = Number(sku.stock_quantity) + quantity
      if (next < 0) throw new Error('库存不足，无法扣减')
      await trx('product_skus').where('id', skuId).update({ stock_quantity: next, updated_at: trx.fn.now() })
      return next
    })
    app.log.info({ skuId, quantity, operator: operator.id, reason: body.reason }, 'stock adjusted')
    return { data: { id: skuId, stock_quantity: stock } }
  }))

  // ---------- 资源 ----------
  app.get('/api/admin/resources', guard(async () => ({ data: await db('resources').orderBy('id', 'desc') })))

  app.post('/api/admin/resources', guard(async (request, reply) => {
    const body = request.body || {}
    const [insertId] = await db('resources').insert({
      title: text(body.title, 'title'),
      type: body.type || null,
      url: body.url || null,
      size_bytes: body.sizeBytes || null,
      created_by: body.createdBy || null
    })
    return reply.code(201).send({ data: { id: Number(insertId) } })
  }))

  app.delete('/api/admin/resources/:resourceId', guard(async request => {
    const resourceId = id(request.params.resourceId, 'resourceId')
    const deleted = await db('resources').where('id', resourceId).delete()
    if (!deleted) throw new Error('资源不存在')
    return { data: { id: resourceId } }
  }))

  // ---------- 订单 ----------
  app.get('/api/admin/orders', guard(async () => {
    const orders = await db('orders').join('users', 'users.id', 'orders.buyer_user_id').orderBy('orders.id', 'desc').select('orders.*', 'users.display_name AS buyer_name')
    const items = orders.length ? await db('order_items').whereIn('order_id', orders.map(order => order.id)) : []
    return { data: orders.map(order => serializeOrder(order, items.filter(item => Number(item.order_id) === Number(order.id)))) }
  }))

  app.patch('/api/admin/orders/:id', guard(async (request, _reply, operator) => {
    const orderId = id(request.params.id)
    const body = request.body || {}
    const status = text(body.status, 'status')
    await db.transaction(async trx => {
      const order = await trx('orders').where('id', orderId).forUpdate().first()
      if (!order) throw new Error('订单不存在')
      if (status === 'REFUNDED') throw new Error('退款需要接入支付渠道退款接口，不能手动标记为已退款')
      if (!canTransition(order.status, status)) throw new Error(`订单不能从 ${order.status} 变更为 ${status}`)
      if (status === 'PAID') {
        await payOrder(trx, orderId, `ADMIN-${orderId}-${Date.now()}`, operator.id)
        return
      }
      const patch = { status, updated_at: trx.fn.now() }
      if (status === 'SHIPPED') {
        const shippable = await trx('order_items').where('order_id', orderId).whereNotNull('product_sku_id').first('id')
        if (!shippable) throw new Error('课程订单不能进入发货状态')
        patch.tracking_no = text(body.trackingNo, 'trackingNo')
        patch.shipped_at = trx.fn.now()
      }
      if (status === 'COMPLETED') patch.completed_at = trx.fn.now()
      if (status === 'CANCELLED') {
        patch.cancelled_at = trx.fn.now()
        const items = await trx('order_items').where('order_id', orderId).whereNotNull('product_sku_id')
        for (const item of items) await trx('product_skus').where('id', item.product_sku_id).increment('stock_quantity', item.quantity)
      }
      await trx('orders').where('id', orderId).update(patch)
    })
    return { data: { id: orderId, status } }
  }))

  // ---------- 学员档案与课时 ----------
  app.get('/api/admin/children', guard(async () => {
    const children = await db('children').orderBy('id', 'desc')
    const guardians = await db('parent_children').join('users', 'users.id', 'parent_children.parent_user_id').select('parent_children.child_id', 'users.display_name', 'parent_children.relationship')
    const enrollments = await db('enrollments').join('classes', 'classes.id', 'enrollments.class_id').where('enrollments.status', 'ACTIVE').select('enrollments.child_id', 'classes.name AS class_name')
    const data = []
    for (const child of children) {
      const childId = Number(child.id)
      const linked = guardians.filter(row => Number(row.child_id) === childId)
      const active = enrollments.filter(row => Number(row.child_id) === childId)
      data.push({
        id: childId,
        name: child.name,
        gender: child.gender,
        birthday: child.birthday,
        remark: child.remark,
        remaining_lessons: await balanceOf(db, childId),
        active_enrollments: active.length,
        class_names: active.map(row => row.class_name),
        guardians: linked.map(row => `${row.display_name}(${row.relationship})`).join('、')
      })
    }
    return { data }
  }))

  app.post('/api/admin/children', guard(async (request, reply) => {
    const body = request.body || {}
    const [insertId] = await db('children').insert({
      name: text(body.name, 'name'),
      gender: ['MALE', 'FEMALE'].includes(body.gender) ? body.gender : 'UNKNOWN',
      birthday: body.birthday || null,
      remark: body.remark || null
    })
    return reply.code(201).send({ data: { id: Number(insertId) } })
  }))

  app.post('/api/admin/children/:childId/lessons', guard(async (request, _reply, operator) => {
    const childId = id(request.params.childId, 'childId')
    const body = request.body || {}
    const result = await db.transaction(trx => applyLedger(trx, {
      childId,
      type: ['PURCHASE', 'GIFT', 'DEDUCT', 'REFUND', 'ADJUST'].includes(body.type) ? body.type : 'ADJUST',
      quantity: Number(body.quantity),
      reason: text(body.reason, 'reason'),
      idempotencyKey: body.idempotencyKey || null,
      operatorUserId: operator.id
    }))
    return { data: { id: childId, remaining_lessons: result.balance } }
  }))

  app.get('/api/admin/children/:childId/lesson-ledger', guard(async request => {
    const childId = id(request.params.childId, 'childId')
    if (!await db('children').where('id', childId).first('id')) throw new Error('学员不存在')
    const rows = await db('lesson_ledger')
      .join('children', 'children.id', 'lesson_ledger.child_id')
      .leftJoin('class_sessions', 'class_sessions.id', 'lesson_ledger.session_id')
      .leftJoin('classes', 'classes.id', 'class_sessions.class_id')
      .leftJoin('courses', 'courses.id', 'classes.course_id')
      .leftJoin('users AS ledger_operator', 'ledger_operator.id', 'lesson_ledger.operator_user_id')
      .where('lesson_ledger.child_id', childId)
      .orderBy('lesson_ledger.id', 'desc')
      .limit(200)
      .select('lesson_ledger.*', 'children.name AS child_name', 'courses.name AS course_title', 'ledger_operator.display_name AS operator_name')
    return { data: rows.map(row => ({
      id: Number(row.id), child_id: Number(row.child_id), child_name: row.child_name,
      type: row.type, quantity: Number(row.quantity || 0), balance_after: Number(row.balance_after || 0),
      reason: row.reason, course_title: row.course_title || null, operator_name: row.operator_name || null,
      created_at: row.created_at
    })) }
  }))

  // ---------- 家长与监护 ----------
  app.post('/api/admin/parents', guard(async (request, reply) => {
    const body = request.body || {}
    const userId = await db.transaction(async trx => {
      const [insertId] = await trx('users').insert({ display_name: text(body.displayName || body.name, 'displayName'), mobile: body.mobile || null })
      await trx('user_roles').insert({ user_id: insertId, role: 'PARENT' })
      return insertId
    })
    return reply.code(201).send({ data: { id: Number(userId) } })
  }))

  app.post('/api/admin/guardians', guard(async (request, reply) => {
    const body = request.body || {}
    const childId = id(body.childId, 'childId')
    const parentUserId = id(body.parentUserId, 'parentUserId')
    try {
      const [insertId] = await db('parent_children').insert({ parent_user_id: parentUserId, child_id: childId, relationship: body.relationship || '监护人' })
      return reply.code(201).send({ data: { id: Number(insertId) } })
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw new Error('该监护关系已存在')
      throw error
    }
  }))

  // ---------- 班级与排课 ----------
  app.get('/api/admin/classes', guard(async () => {
    const rows = await db('classes')
      .join('courses', 'courses.id', 'classes.course_id')
      .leftJoin('users', 'users.id', 'classes.teacher_user_id')
      .orderBy('classes.id', 'desc')
      .select('classes.*', 'courses.name AS course_name', 'users.display_name AS teacher_name',
        db('enrollments').whereRaw('enrollments.class_id = classes.id').where('enrollments.status', 'ACTIVE').count('id').as('enrolled_count'))
    return { data: rows.map(row => ({ ...row, id: Number(row.id), enrolled_count: Number(row.enrolled_count) })) }
  }))

  app.post('/api/admin/classes', guard(async (request, reply) => {
    const body = request.body || {}
    const [insertId] = await db('classes').insert({
      course_id: id(body.courseId, 'courseId'),
      teacher_user_id: body.teacherUserId ? id(body.teacherUserId, 'teacherUserId') : null,
      name: text(body.name, 'name'),
      campus: body.campus || null,
      room: body.room || null,
      capacity: Number(body.capacity || 20)
    })
    return reply.code(201).send({ data: { id: Number(insertId) } })
  }))

  app.post('/api/admin/classes/:classId/sessions', guard(async (request, reply) => {
    const classId = id(request.params.classId, 'classId')
    const body = request.body || {}
    const startsAt = new Date(text(body.startsAt, 'startsAt'))
    const endsAt = new Date(text(body.endsAt, 'endsAt'))
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new Error('时间格式不正确')
    if (endsAt <= startsAt) throw new Error('结束时间必须晚于开始时间')
    const klass = await db('classes').where('id', classId).first('campus', 'room')
    if (!klass) throw new Error('班级不存在')
    try {
      const [insertId] = await db('class_sessions').insert({
        class_id: classId,
        sequence_no: Number(body.sequenceNo || 1),
        starts_at: startsAt,
        ends_at: endsAt,
        campus: body.campus || klass.campus,
        room: body.room || klass.room
      })
      return reply.code(201).send({ data: { id: Number(insertId) } })
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw new Error('该班级已存在相同节次的课次')
      throw error
    }
  }))

  // ---------- 报名 ----------
  app.post('/api/admin/enrollments', guard(async (request, reply) => {
    const body = request.body || {}
    const childId = id(body.childId, 'childId')
    const classId = id(body.classId, 'classId')
    const enrollmentId = await db.transaction(async trx => {
      const klass = await trx('classes').where('id', classId).forUpdate().first()
      if (!klass || klass.status !== 'ACTIVE') throw new Error('班级不存在或已归档')
      const enrolled = await trx('enrollments').where({ class_id: classId, status: 'ACTIVE' }).count('id AS total').first()
      if (Number(enrolled.total) >= Number(klass.capacity)) throw new Error('班级名额已满')
      try {
        const [insertId] = await trx('enrollments').insert({ child_id: childId, class_id: classId })
        return insertId
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw new Error('该学员已报名此班级')
        throw error
      }
    })
    return reply.code(201).send({ data: { id: Number(enrollmentId) } })
  }))

  // ---------- 请假审批 ----------
  app.get('/api/admin/leave-requests', guard(async request => {
    const status = String(request.query?.status || '').toUpperCase()
    const rows = await db('leave_requests')
      .join('children', 'children.id', 'leave_requests.child_id')
      .join('class_sessions', 'class_sessions.id', 'leave_requests.session_id')
      .join('classes', 'classes.id', 'class_sessions.class_id')
      .join('courses', 'courses.id', 'classes.course_id')
      .join('users', 'users.id', 'leave_requests.requested_by_user_id')
      .modify(q => { if (['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) q.where('leave_requests.status', status) })
      .orderBy('leave_requests.id', 'desc')
      .select('leave_requests.*', 'children.name AS child_name', 'class_sessions.starts_at', 'class_sessions.ends_at',
        'courses.name AS course_title', 'classes.name AS class_name', 'users.display_name AS requested_by_name')
    return { data: rows }
  }))

  app.patch('/api/admin/leave-requests/:id', guard(async (request, _reply, operator) => {
    const requestId = id(request.params.id)
    const body = request.body || {}
    const status = text(body.status, 'status')
    if (!['APPROVED', 'REJECTED'].includes(status)) throw new Error('status must be APPROVED or REJECTED')
    await db.transaction(async trx => {
      const record = await trx('leave_requests').where('id', requestId).forUpdate().first()
      if (!record) throw new Error('请假申请不存在')
      if (record.status !== 'PENDING') throw new Error('该申请已处理')
      await trx('leave_requests').where('id', requestId).update({
        status,
        reviewed_by_user_id: operator.id,
        review_note: body.reviewNote || null,
        reviewed_at: trx.fn.now(),
        updated_at: trx.fn.now()
      })
      // 批准请假：预写考勤为 LEAVE，考勤确认时不会扣课时。
      if (status === 'APPROVED') {
        await trx('attendance')
          .insert({ session_id: record.session_id, child_id: record.child_id, status: 'LEAVE', confirmed_by_user_id: operator.id, confirmed_at: trx.fn.now() })
          .onConflict(['session_id', 'child_id'])
          .merge({ status: 'LEAVE', confirmed_by_user_id: operator.id, confirmed_at: trx.fn.now(), updated_at: trx.fn.now() })
      }
    })
    return { data: { id: requestId, status } }
  }))

  // ---------- 公告 ----------
  app.get('/api/admin/announcements', guard(async () => ({ data: await db('announcements').orderBy('id', 'desc') })))

  app.post('/api/admin/announcements', guard(async (request, reply) => {
    const body = request.body || {}
    const status = body.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT'
    const [insertId] = await db('announcements').insert({
      title: text(body.title, 'title'),
      content: text(body.content, 'content'),
      audience: ['PARENT', 'TEACHER'].includes(body.audience) ? body.audience : 'ALL',
      status,
      published_at: status === 'PUBLISHED' ? db.fn.now() : null
    })
    return reply.code(201).send({ data: { id: Number(insertId) } })
  }))

  app.patch('/api/admin/announcements/:id', guard(async request => {
    const announcementId = id(request.params.id)
    const body = request.body || {}
    const patch = { updated_at: db.fn.now() }
    if (Object.hasOwn(body, 'title')) patch.title = text(body.title, 'title')
    if (Object.hasOwn(body, 'content')) patch.content = text(body.content, 'content')
    if (Object.hasOwn(body, 'audience')) patch.audience = ['PARENT', 'TEACHER'].includes(body.audience) ? body.audience : 'ALL'
    if (Object.hasOwn(body, 'status')) {
      patch.status = body.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT'
      if (patch.status === 'PUBLISHED') patch.published_at = db.fn.now()
    }
    await db('announcements').where('id', announcementId).update(patch)
    return { data: { id: announcementId } }
  }))

  // ---------- 上传 ----------
  app.post('/api/admin/uploads/presign', guard(async request => {
    const body = request.body || {}
    return { data: await createUploadUrl({ name: text(body.name, 'name'), contentType: body.contentType, folder: body.folder || 'uploads' }) }
  }))
}
