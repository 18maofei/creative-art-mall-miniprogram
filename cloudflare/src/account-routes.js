import { all, first, run, batch, changedRows, lastInsertId, bodyOf, id, text, ok, json, assertSelfOrAdmin, requireUser, requirePermission, serializeAddress, serializeOrder, serializeUser, HttpError, isoNow, loadActiveUser } from './core.js'
import { balanceOf } from './lessons.js'
import { createOrder, payOrder, cancelOrder } from './orders.js'
import { createJsapiPayment, verifyWechatNotification, wechatPayConfigReady, wechatPayEnabled } from './wechat-pay.js'

function placeholders(values) { return values.map(() => '?').join(',') }

async function ordersWithItems(db, orders) {
  if (!orders.length) return []
  const items = await all(db, `SELECT * FROM order_items WHERE order_id IN (${placeholders(orders.map(order => order.id))}) ORDER BY id`, orders.map(order => order.id))
  return orders.map(order => serializeOrder(order, items.filter(item => Number(item.order_id) === Number(order.id))))
}

function mobileOf(value) {
  const mobile = text(value, 'mobile')
  if (!/^1[3-9]\d{9}$/.test(mobile)) throw new HttpError(400, '手机号格式不正确，请输入 11 位手机号')
  return mobile
}

function profileNameOf(value) {
  const name = String(value ?? '').trim()
  if (!name) throw new HttpError(400, '昵称不能为空')
  if (name.length > 80) throw new HttpError(400, '昵称不能超过 80 个字符')
  return name
}

const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

function avatarExtension(contentType) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[contentType] || 'jpg'
}

function requireProfileAccess(user) {
  // 首次登录且尚未分配业务身份的用户也需要能完善自己的基础资料。
  if (!user.roles.length || user.permissions.includes('profile.read')) return user
  throw new HttpError(403, '当前账号没有个人资料权限')
}

// 模拟支付只能在显式开启开发认证的本地环境使用，线上即使误传请求也不会改变订单状态。
function mockPaymentEnabled(env) {
  return String(env.ALLOW_DEV_AUTH || '').toLowerCase() === 'true'
    && String(env.PAYMENT_MODE || 'mock').toLowerCase() === 'mock'
}

function orderCreationEnabled(env) {
  const mode = String(env.PAYMENT_MODE || 'disabled').toLowerCase()
  if (mode === 'mock') return mockPaymentEnabled(env)
  // 正式支付配置不完整时不创建占库存的待支付订单，避免用户拿到无法支付的订单。
  if (mode === 'wechat') return wechatPayConfigReady(env)
  return false
}

async function childIdsOf(db, userId) {
  return (await all(db, 'SELECT child_id FROM parent_children WHERE parent_user_id = ?', [userId])).map(row => Number(row.child_id))
}

function serializeLessonEntry(row) {
  return {
    id: Number(row.id), child_id: Number(row.child_id), child_name: row.child_name,
    type: row.type, quantity: Number(row.quantity || 0), balance_after: Number(row.balance_after || 0),
    reason: row.reason, course_title: row.course_title || null, operator_name: row.operator_name || null,
    created_at: row.created_at
  }
}

export function registerAccountRoutes(router) {
  // 资料更新只使用当前 Bearer 会话，不接受前端传入 userId，避免越权修改他人资料。
  router.patch('/api/users/profile', async ctx => {
    const current = await requireUser(ctx)
    requireProfileAccess(current)
    const body = await bodyOf(ctx)
    const fields = []
    const params = []
    if (Object.hasOwn(body, 'nickname') || Object.hasOwn(body, 'name')) {
      fields.push('display_name = ?')
      params.push(profileNameOf(Object.hasOwn(body, 'nickname') ? body.nickname : body.name))
    }
    if (!fields.length) return ok({ user: serializeUser(current.row, current.roles, current) })
    fields.push('updated_at = ?')
    params.push(isoNow(), current.id)
    await run(ctx.db, `UPDATE users SET ${fields.join(', ')} WHERE id = ? AND status = 'ACTIVE'`, params)
    const updated = await loadActiveUser(ctx.db, current.id, current.currentRole)
    return ok({ user: serializeUser(updated.row, updated.roles, updated) })
  })

  // chooseAvatar 返回的是临时本地文件，小程序通过 multipart 上传后再保存永久 R2 地址。
  router.post('/api/users/profile/avatar', async ctx => {
    const current = await requireUser(ctx)
    requireProfileAccess(current)
    if (!ctx.env.ASSETS) throw new HttpError(503, '头像存储暂未配置')
    const contentType = String(ctx.request.headers.get('content-type') || '').toLowerCase()
    if (!contentType.startsWith('multipart/form-data')) throw new HttpError(400, '头像上传格式不正确')
    const declaredLength = Number(ctx.request.headers.get('content-length') || 0)
    if (declaredLength > MAX_AVATAR_BYTES + 256 * 1024) throw new HttpError(413, '头像不能超过 5 MB')
    let form
    try { form = await ctx.request.formData() } catch { throw new HttpError(400, '头像上传内容不正确') }
    const file = form.get('file')
    if (!file || typeof file.stream !== 'function' || !Number.isFinite(Number(file.size))) throw new HttpError(400, '请选择头像文件')
    if (Number(file.size) < 1) throw new HttpError(400, '头像文件为空')
    if (Number(file.size) > MAX_AVATAR_BYTES) throw new HttpError(413, '头像不能超过 5 MB')
    const fileType = String(file.type || '').split(';')[0].trim().toLowerCase()
    if (!AVATAR_TYPES.has(fileType)) throw new HttpError(400, '头像只支持 JPG、PNG 或 WEBP 图片')
    const key = `avatars/${current.id}/${Date.now()}-${crypto.randomUUID()}.${avatarExtension(fileType)}`
    await ctx.env.ASSETS.put(key, file.stream(), { httpMetadata: { contentType: fileType, cacheControl: 'public, max-age=31536000, immutable' } })
    const fields = ['avatar_url = ?']
    const params = [`/api/assets/${key}`]
    const nickname = form.get('nickname')
    if (nickname !== null && String(nickname).trim()) {
      fields.unshift('display_name = ?')
      params.unshift(profileNameOf(nickname))
    }
    fields.push('updated_at = ?')
    params.push(isoNow(), current.id)
    await run(ctx.db, `UPDATE users SET ${fields.join(', ')} WHERE id = ? AND status = 'ACTIVE'`, params)
    const updated = await loadActiveUser(ctx.db, current.id, current.currentRole)
    return ok({ user: serializeUser(updated.row, updated.roles, updated), avatarUrl: `/api/assets/${key}` })
  })

  router.get('/api/users/:userId/dashboard', async ctx => {
    const userId = id(ctx.params.userId, 'userId')
    const current = await requireUser(ctx)
    assertSelfOrAdmin(current, userId)
    requirePermission(current, 'child.read')
    const user = await first(ctx.db, 'SELECT * FROM users WHERE id = ?', [userId])
    if (!user) throw new HttpError(404, 'user not found')
    const roles = current.roles
    const children = await all(ctx.db, `
      SELECT children.*, parent_children.relationship
      FROM children JOIN parent_children ON parent_children.child_id = children.id
      WHERE parent_children.parent_user_id = ? ORDER BY children.id
    `, [userId])
    const students = []
    for (const child of children) students.push({ id: Number(child.id), name: child.name, gender: child.gender, remaining_lessons: await balanceOf(ctx.db, child.id), relationship: child.relationship })
    const childIds = students.map(item => item.id)
    let sessions = []
    if (childIds.length) {
      sessions = await all(ctx.db, `
        SELECT class_sessions.*, courses.name AS course_title, classes.name AS class_name,
               GROUP_CONCAT(DISTINCT enrollments.child_id) AS child_ids
        FROM class_sessions
        JOIN classes ON classes.id = class_sessions.class_id
        JOIN courses ON courses.id = classes.course_id
        JOIN enrollments ON enrollments.class_id = classes.id
        WHERE enrollments.child_id IN (${placeholders(childIds)})
          AND enrollments.status = 'ACTIVE' AND class_sessions.status = 'SCHEDULED'
        GROUP BY class_sessions.id
        ORDER BY class_sessions.starts_at ASC LIMIT 12
      `, childIds)
    }
    return ok({ user: serializeUser(user, roles, current), students, sessions })
  })

  router.get('/api/users/:userId/orders', async ctx => {
    const userId = id(ctx.params.userId, 'userId')
    const current = await requireUser(ctx)
    assertSelfOrAdmin(current, userId)
    if (current.id !== userId) requirePermission(current, 'order.read')
    const orders = await all(ctx.db, 'SELECT orders.*, users.display_name AS buyer_name FROM orders JOIN users ON users.id = orders.buyer_user_id WHERE buyer_user_id = ? ORDER BY orders.id DESC', [userId])
    return ok(await ordersWithItems(ctx.db, orders))
  })

  router.get('/api/users/:userId/trial-appointments', async ctx => {
    const userId = id(ctx.params.userId, 'userId')
    const current = await requireUser(ctx)
    assertSelfOrAdmin(current, userId)
    if (current.id !== userId) requirePermission(current, 'trial.read')
    const rows = await all(ctx.db, `
      SELECT trial_appointments.*, courses.name AS course_title, users.display_name AS handled_by_name
      FROM trial_appointments
      LEFT JOIN courses ON courses.id = trial_appointments.course_id
      LEFT JOIN users ON users.id = trial_appointments.handled_by_user_id
      WHERE trial_appointments.user_id = ? ORDER BY trial_appointments.id DESC LIMIT 50
    `, [userId])
    return ok(rows.map(row => ({
      id: Number(row.id), guardian_name: row.guardian_name, mobile: row.mobile, child_name: row.child_name,
      child_age: row.child_age === null || row.child_age === undefined ? null : Number(row.child_age),
      course_id: row.course_id ? Number(row.course_id) : null, course_title: row.course_title || null,
      preferred_date: row.preferred_date || null, preferred_time: row.preferred_time || 'ANY',
      note: row.note || '', status: row.status, handled_note: row.handled_note || '',
      handled_by_name: row.handled_by_name || null, handled_at: row.handled_at || null,
      created_at: row.created_at, updated_at: row.updated_at
    })))
  })

  // 家长端只可查询自己监护的学员；后台身份查询其他账号时仍由服务端权限控制。
  router.get('/api/users/:userId/lesson-ledger', async ctx => {
    const userId = id(ctx.params.userId, 'userId')
    const current = await requireUser(ctx)
    assertSelfOrAdmin(current, userId)
    requirePermission(current, 'child.read')
    const requestedChildId = ctx.url.searchParams.get('childId') ? id(ctx.url.searchParams.get('childId'), 'childId') : null
    const privileged = current.roles.some(role => ['ADMIN', 'OPERATOR'].includes(role))
    let childIds = await childIdsOf(ctx.db, userId)
    if (requestedChildId) {
      if (!privileged && !childIds.includes(requestedChildId)) throw new HttpError(403, '该学员不在您的监护列表中')
      childIds = [requestedChildId]
    }
    if (!childIds.length) return ok([])
    const rows = await all(ctx.db, `
      SELECT lesson_ledger.*, children.name AS child_name,
             courses.name AS course_title, users.display_name AS operator_name
      FROM lesson_ledger
      JOIN children ON children.id = lesson_ledger.child_id
      LEFT JOIN class_sessions ON class_sessions.id = lesson_ledger.session_id
      LEFT JOIN classes ON classes.id = class_sessions.class_id
      LEFT JOIN courses ON courses.id = classes.course_id
      LEFT JOIN users ON users.id = lesson_ledger.operator_user_id
      WHERE lesson_ledger.child_id IN (${placeholders(childIds)})
      ORDER BY lesson_ledger.id DESC LIMIT 100
    `, childIds)
    return ok(rows.map(serializeLessonEntry))
  })

  // 微信支付回调可能晚于 wx.requestPayment 成功返回，前端用这个接口确认最终订单状态。
  router.get('/api/orders/:orderId/status', async ctx => {
    const orderId = id(ctx.params.orderId, 'orderId')
    const current = await requireUser(ctx)
    // 客户可操作自己的订单；下方查询始终校验 buyer_user_id。
    const order = await first(ctx.db, 'SELECT orders.*, users.display_name AS buyer_name FROM orders JOIN users ON users.id = orders.buyer_user_id WHERE orders.id = ? AND orders.buyer_user_id = ?', [orderId, current.id])
    if (!order) throw new HttpError(404, '订单不存在')
    const items = await all(ctx.db, 'SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [orderId])
    return ok(serializeOrder(order, items))
  })

  router.post('/api/orders', async ctx => {
    if (!orderCreationEnabled(ctx.env)) throw new HttpError(503, '支付通道尚未配置，暂不能下单')
    const body = await bodyOf(ctx)
    const buyer = await requireUser(ctx)
    const items = Array.isArray(body.items) && body.items.length ? body.items.map(item => ({ type: text(item.type || body.type, 'type').toUpperCase(), subjectId: id(item.subjectId, 'subjectId'), quantity: item.quantity || 1 })) : null
    const hasCourse = (items || [{ type: body.type }]).some(item => String(item.type || '').toUpperCase() === 'COURSE')
    const hasProduct = (items || [{ type: body.type }]).some(item => String(item.type || '').toUpperCase() === 'PRODUCT')
    if (hasCourse) requirePermission(buyer, 'course.enroll')
    if (!hasCourse && !hasProduct) throw new HttpError(400, '订单商品类型不正确')
    const idempotencyKey = String(body.idempotencyKey || ctx.request.headers.get('Idempotency-Key') || '').trim() || null
    const order = await createOrder(ctx.db, {
      buyerUserId: buyer.id, type: body.type ? text(body.type, 'type').toUpperCase() : undefined,
      subjectId: body.subjectId ? id(body.subjectId, 'subjectId') : undefined,
      quantity: body.quantity || 1, addressId: body.addressId ? id(body.addressId, 'addressId') : null,
      courseChildId: body.courseChildId ? id(body.courseChildId, 'courseChildId') : null, idempotencyKey, items
    })
    return ok(order, 201)
  })

  router.post('/api/orders/:orderId/mock-pay', async ctx => {
    if (!mockPaymentEnabled(ctx.env)) throw new HttpError(404, 'not found')
    const orderId = id(ctx.params.orderId, 'orderId')
    const current = await requireUser(ctx)
    // 客户可操作自己的订单；下方查询始终校验 buyer_user_id。
    const userId = current.id
    const order = await first(ctx.db, 'SELECT buyer_user_id FROM orders WHERE id = ?', [orderId])
    if (!order || Number(order.buyer_user_id) !== userId) throw new HttpError(404, '订单不存在')
    return ok(await payOrder(ctx.db, orderId, `MOCK-${orderId}-${Date.now()}`, userId))
  })

  // 正式微信支付：服务端生成 JSAPI 预支付参数，小程序只拿到可公开的签名参数。
  router.post('/api/orders/:orderId/pay', async ctx => {
    if (!wechatPayConfigReady(ctx.env)) throw new HttpError(404, 'not found')
    const orderId = id(ctx.params.orderId, 'orderId')
    const current = await requireUser(ctx)
    // 客户可操作自己的订单；下方查询始终校验 buyer_user_id。
    const order = await first(ctx.db, 'SELECT orders.*, users.wechat_openid AS buyer_openid FROM orders JOIN users ON users.id = orders.buyer_user_id WHERE orders.id = ? AND orders.buyer_user_id = ?', [orderId, current.id])
    if (!order) throw new HttpError(404, '订单不存在')
    if (order.status !== 'PENDING_PAYMENT') throw new HttpError(400, '订单当前状态不可支付')
    const firstItem = await first(ctx.db, 'SELECT name_snapshot, course_id FROM order_items WHERE order_id = ? ORDER BY id LIMIT 1', [orderId])
    return ok(await createJsapiPayment(ctx.env, {
      order: {
        order_no: order.order_no,
        total_amount: order.total_amount,
        type: firstItem?.course_id ? 'COURSE' : 'PRODUCT',
        subject_title: firstItem?.name_snapshot || '纯粹艺术文化订单'
      },
      openid: order.buyer_openid
    }))
  })

  // 微信支付平台回调无需用户令牌，先验签和解密，再按订单号幂等更新订单与课时。
  router.post('/api/payments/wechat/notify', async ctx => {
    if (!wechatPayEnabled(ctx.env) || !wechatPayConfigReady(ctx.env)) return json({ code: 'FAIL', message: 'payment unavailable' }, 503)
    const rawBody = await ctx.request.text()
    try {
      const payload = await verifyWechatNotification(ctx.env, ctx.request, rawBody)
      if (payload.trade_state !== 'SUCCESS') return json({ code: 'SUCCESS', message: 'ignored' })
      const transactionId = text(payload.transaction_id, 'transaction_id')
      const order = await first(ctx.db, 'SELECT * FROM orders WHERE order_no = ?', [text(payload.out_trade_no, 'out_trade_no')])
      if (!order) throw new HttpError(404, '订单不存在')
      if (String(payload.appid || '') !== String(ctx.env.WECHAT_APP_ID || '') || String(payload.mchid || '') !== String(ctx.env.WECHAT_PAY_MCH_ID || '')) throw new HttpError(400, '微信支付商户信息不匹配')
      const expectedAmount = Math.round(Number(order.total_amount || 0) * 100)
      if (Number(payload.amount?.total) !== expectedAmount) throw new HttpError(400, '微信支付金额不匹配')
      await payOrder(ctx.db, Number(order.id), transactionId, null, 'WECHAT', { channel: 'WECHAT', transactionId, successTime: payload.success_time || null })
      return json({ code: 'SUCCESS', message: '成功' })
    } catch (error) {
      console.error('wechat payment notify failed', error)
      const status = Number(error?.status) >= 400 && Number(error?.status) < 500 ? Number(error.status) : 500
      return json({ code: 'FAIL', message: status === 400 ? '签名或订单校验失败' : '回调处理失败' }, status)
    }
  })

  router.post('/api/orders/:orderId/confirm-receipt', async ctx => {
    const orderId = id(ctx.params.orderId, 'orderId')
    const current = await requireUser(ctx)
    // 客户可操作自己的订单；下方查询始终校验 buyer_user_id。
    const userId = current.id
    const order = await first(ctx.db, 'SELECT buyer_user_id, status FROM orders WHERE id = ?', [orderId])
    if (!order || Number(order.buyer_user_id) !== userId) throw new HttpError(404, '订单不存在')
    if (order.status !== 'SHIPPED') throw new HttpError(400, '订单尚未发货，无法确认收货')
    const now = isoNow()
    const result = await run(ctx.db, "UPDATE orders SET status = 'COMPLETED', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'SHIPPED'", [now, now, orderId])
    if (!changedRows(result)) {
      const latest = await first(ctx.db, 'SELECT status FROM orders WHERE id = ?', [orderId])
      if (latest?.status !== 'COMPLETED') throw new HttpError(409, '订单状态已变化，请刷新后重试')
    }
    return ok({ id: orderId, status: 'COMPLETED' })
  })

  router.post('/api/orders/:orderId/cancel', async ctx => {
    const orderId = id(ctx.params.orderId, 'orderId')
    const current = await requireUser(ctx)
    // 客户可操作自己的订单；下方查询始终校验 buyer_user_id。
    const userId = current.id
    const order = await first(ctx.db, 'SELECT buyer_user_id, status FROM orders WHERE id = ?', [orderId])
    if (!order || Number(order.buyer_user_id) !== userId) throw new HttpError(404, '订单不存在')
    return ok(await cancelOrder(ctx.db, orderId))
  })

  router.get('/api/users/:userId/addresses', async ctx => {
    const userId = id(ctx.params.userId, 'userId')
    const current = await requireUser(ctx)
    assertSelfOrAdmin(current, userId)
    if (current.id !== userId) requirePermission(current, 'address.manage')
    const rows = await all(ctx.db, 'SELECT * FROM shipping_addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC', [userId])
    return ok(rows.map(serializeAddress))
  })

  router.post('/api/users/:userId/addresses', async ctx => {
    const userId = id(ctx.params.userId, 'userId')
    const current = await requireUser(ctx)
    assertSelfOrAdmin(current, userId)
    if (current.id !== userId) requirePermission(current, 'address.manage')
    const body = await bodyOf(ctx)
    const existing = await first(ctx.db, 'SELECT id FROM shipping_addresses WHERE user_id = ? LIMIT 1', [userId])
    const wantsDefault = body.isDefault === true || body.isDefault === 1 || String(body.isDefault).toLowerCase() === 'true'
    const record = { user_id: userId, recipient_name: text(body.recipientName, 'recipientName'), mobile: mobileOf(body.mobile), province: text(body.province, 'province'), city: text(body.city, 'city'), district: text(body.district, 'district'), detail: text(body.detail, 'detail'), is_default: wantsDefault || !existing ? 1 : 0 }
    const now = isoNow()
    const results = await batch(ctx.db, [
      ...(record.is_default ? [{ sql: 'UPDATE shipping_addresses SET is_default = 0, updated_at = ? WHERE user_id = ?', params: [now, userId] }] : []),
      { sql: 'INSERT INTO shipping_addresses (user_id, recipient_name, mobile, province, city, district, detail, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', params: [record.user_id, record.recipient_name, record.mobile, record.province, record.city, record.district, record.detail, record.is_default, now, now] }
    ])
    return ok({ id: lastInsertId(results[results.length - 1]) }, 201)
  })

  router.patch('/api/users/:userId/addresses/:addressId', async ctx => {
    const userId = id(ctx.params.userId, 'userId')
    const current = await requireUser(ctx)
    assertSelfOrAdmin(current, userId)
    if (current.id !== userId) requirePermission(current, 'address.manage')
    const addressId = id(ctx.params.addressId, 'addressId')
    const body = await bodyOf(ctx)
    const address = await first(ctx.db, 'SELECT * FROM shipping_addresses WHERE id = ? AND user_id = ?', [addressId, userId])
    if (!address) throw new HttpError(404, '地址不存在')
    const fields = []
    const params = []
    for (const [key, column] of [['recipientName', 'recipient_name'], ['province', 'province'], ['city', 'city'], ['district', 'district'], ['detail', 'detail']]) {
      if (Object.hasOwn(body, key)) { fields.push(`${column} = ?`); params.push(text(body[key], key)) }
    }
    if (Object.hasOwn(body, 'mobile')) { fields.push('mobile = ?'); params.push(mobileOf(body.mobile)) }
    const isDefault = Object.hasOwn(body, 'isDefault') ? (body.isDefault === true || body.isDefault === 1 || String(body.isDefault).toLowerCase() === 'true' ? 1 : 0) : null
    let replacement = null
    if (isDefault === 0 && address.is_default) {
      replacement = await first(ctx.db, 'SELECT id FROM shipping_addresses WHERE user_id = ? AND id <> ? ORDER BY id DESC LIMIT 1', [userId, addressId])
      if (!replacement) throw new HttpError(400, '至少需要保留一个默认地址')
    }
    const now = isoNow()
    const statements = []
    if (isDefault === 1) statements.push({ sql: 'UPDATE shipping_addresses SET is_default = 0, updated_at = ? WHERE user_id = ?', params: [now, userId] })
    if (isDefault !== null) { fields.push('is_default = ?'); params.push(isDefault) }
    if (fields.length) {
      fields.push('updated_at = ?'); params.push(now, addressId, userId)
      statements.push({ sql: `UPDATE shipping_addresses SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, params })
      if (replacement) statements.push({ sql: 'UPDATE shipping_addresses SET is_default = 1, updated_at = ? WHERE id = ? AND user_id = ?', params: [now, replacement.id, userId] })
      await batch(ctx.db, statements)
    }
    return ok({ id: addressId })
  })

  router.delete('/api/users/:userId/addresses/:addressId', async ctx => {
    const userId = id(ctx.params.userId, 'userId')
    const current = await requireUser(ctx)
    assertSelfOrAdmin(current, userId)
    if (current.id !== userId) requirePermission(current, 'address.manage')
    const addressId = id(ctx.params.addressId, 'addressId')
    const address = await first(ctx.db, 'SELECT is_default FROM shipping_addresses WHERE id = ? AND user_id = ?', [addressId, userId])
    if (!address) throw new HttpError(404, '地址不存在')
    await run(ctx.db, 'DELETE FROM shipping_addresses WHERE id = ? AND user_id = ?', [addressId, userId])
    if (address.is_default) {
      const replacement = await first(ctx.db, 'SELECT id FROM shipping_addresses WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId])
      if (replacement) await run(ctx.db, 'UPDATE shipping_addresses SET is_default = 1, updated_at = ? WHERE id = ?', [isoNow(), replacement.id])
    }
    return ok({ id: addressId })
  })

  router.get('/api/users/:userId/leave-requests', async ctx => {
    const userId = id(ctx.params.userId, 'userId')
    const current = await requireUser(ctx)
    assertSelfOrAdmin(current, userId)
    requirePermission(current, 'leave.create')
    const childIds = await childIdsOf(ctx.db, userId)
    if (!childIds.length) return ok([])
    const rows = await all(ctx.db, `
      SELECT leave_requests.*, children.name AS child_name, class_sessions.starts_at, class_sessions.ends_at,
             courses.name AS course_title, classes.name AS class_name
      FROM leave_requests JOIN children ON children.id = leave_requests.child_id
      JOIN class_sessions ON class_sessions.id = leave_requests.session_id
      JOIN classes ON classes.id = class_sessions.class_id JOIN courses ON courses.id = classes.course_id
      WHERE leave_requests.child_id IN (${placeholders(childIds)}) ORDER BY leave_requests.id DESC
    `, childIds)
    return ok(rows)
  })

  router.post('/api/leave-requests', async ctx => {
    const body = await bodyOf(ctx)
    const current = await requireUser(ctx)
    requirePermission(current, 'leave.create')
    const userId = current.id
    const childId = id(body.childId, 'childId')
    const sessionId = id(body.sessionId, 'sessionId')
    const reason = text(body.reason, 'reason')
    if (reason.length > 300) throw new HttpError(400, '请假事由不能超过 300 个字符')
    const bound = await first(ctx.db, 'SELECT id FROM parent_children WHERE parent_user_id = ? AND child_id = ?', [userId, childId])
    if (!bound) throw new HttpError(403, '该学员不在您的监护列表中')
    const session = await first(ctx.db, `SELECT class_sessions.status, class_sessions.starts_at
      FROM class_sessions JOIN enrollments ON enrollments.class_id = class_sessions.class_id
      WHERE class_sessions.id = ? AND enrollments.child_id = ? AND enrollments.status = 'ACTIVE'`, [sessionId, childId])
    if (!session || session.status !== 'SCHEDULED') throw new HttpError(400, '课次不存在或已结束')
    if (new Date(session.starts_at) <= new Date()) throw new HttpError(400, '课次已开始，无法请假')
    try {
      const result = await run(ctx.db, 'INSERT INTO leave_requests (child_id, session_id, requested_by_user_id, reason) VALUES (?, ?, ?, ?)', [childId, sessionId, userId, reason])
      return ok({ id: lastInsertId(result), status: 'PENDING' }, 201)
    } catch (error) {
      if (String(error?.message || '').toLowerCase().includes('unique')) throw new HttpError(409, '该课次已提交过请假申请')
      throw error
    }
  })

  router.get('/api/users/:userId/feedback', async ctx => {
    const userId = id(ctx.params.userId, 'userId')
    const current = await requireUser(ctx)
    assertSelfOrAdmin(current, userId)
    requirePermission(current, 'artwork.read')
    const childIds = await childIdsOf(ctx.db, userId)
    if (!childIds.length) return ok([])
    const rows = await all(ctx.db, `
      SELECT session_feedback.*, courses.name AS course_title, classes.name AS class_name,
             class_sessions.starts_at, users.display_name AS teacher_name, children.name AS child_name
      FROM session_feedback JOIN class_sessions ON class_sessions.id = session_feedback.session_id
      JOIN classes ON classes.id = class_sessions.class_id JOIN courses ON courses.id = classes.course_id
      JOIN users ON users.id = session_feedback.teacher_user_id LEFT JOIN children ON children.id = session_feedback.child_id
      WHERE session_feedback.status = 'PUBLISHED'
        AND (session_feedback.child_id IN (${placeholders(childIds)}) OR session_feedback.child_id IS NULL)
      ORDER BY session_feedback.id DESC
    `, childIds)
    return ok(rows)
  })
}
