import { all, first, run, batch, changedRows, lastInsertId, bodyOf, id, text, ok, HttpError, isoNow, requireAdmin, requirePermission, passwordHash, passwordMatches, sessionFor, serializeCourse, serializeProduct, serializeUser, serializeOrder, statusToDb, loadActiveUser, normalizeRole, roleCode, roleName, ROLE_DEFINITIONS, DEFAULT_ROLE_PERMISSIONS, bytesToHex, encodeBase64Url } from './core.js'
import { balanceOf, applyLedger } from './lessons.js'
import { canTransition, payOrder, cancelOrder } from './orders.js'
import { createUploadUrl } from './storage.js'
import { notifyUsers } from './notifications.js'

const COURSE_FIELDS = [
  [['title', 'name'], 'name'], [['category'], 'category'], [['ageRange', 'age_range'], 'age_range'],
  [['sessions', 'defaultLessonCount'], 'default_lesson_count'], [['price'], 'price'], [['schedule', 'scheduleText'], 'schedule_text'],
  [['campus'], 'campus'], [['room'], 'room'], [['teacherName', 'teacher_name'], 'teacher_name'],
  [['description'], 'description'], [['coverUrl', 'cover_url'], 'cover_url']
]

function placeholders(values) { return values.map(() => '?').join(',') }

function pickFields(body, fields) {
  const patch = {}
  for (const [keys, column] of fields) for (const key of keys) if (Object.hasOwn(body, key)) { patch[column] = body[key]; break }
  if (Object.hasOwn(body, 'status')) patch.status = statusToDb(body.status)
  return patch
}

async function rolesByUser(db, userIds) {
  if (!userIds.length) return {}
  const rows = await all(db, `SELECT user_id, role FROM user_roles WHERE user_id IN (${placeholders(userIds)}) ORDER BY id`, userIds)
  const map = {}
  for (const row of rows) (map[Number(row.user_id)] ||= []).push(row.role)
  return map
}

async function loadAdminProducts(db) {
  const products = await all(db, 'SELECT * FROM products ORDER BY id DESC')
  if (!products.length) return []
  const skus = await all(db, `SELECT * FROM product_skus WHERE product_id IN (${placeholders(products.map(product => product.id))}) ORDER BY id`, products.map(product => product.id))
  return products.map(product => serializeProduct(product, skus.filter(sku => Number(sku.product_id) === Number(product.id))))
}

function dbError(error, fallback = '操作失败') {
  const message = String(error?.message || '')
  if (/unique|constraint/i.test(message)) return new HttpError(409, fallback)
  return error
}

function rolesFromBody(body) {
  const values = Array.isArray(body.roles) ? body.roles : [body.role || 'VISITOR']
  return [...new Set(values.map(normalizeRole).filter(Boolean))]
}

function optionalMobile(value, name = 'mobile') {
  const mobile = String(value ?? '').trim()
  if (!mobile) return null
  if (!/^1[3-9]\d{9}$/.test(mobile)) throw new HttpError(400, `${name} 格式不正确，请输入 11 位手机号`)
  return mobile
}

function boundedText(value, name, maxLength = 200) {
  const result = text(value, name)
  if (result.length > maxLength) throw new HttpError(400, `${name} 不能超过 ${maxLength} 个字符`)
  return result
}

function normalizedEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new HttpError(400, '请输入正确的邮箱地址')
  return email
}

async function tokenHash(token) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return bytesToHex(new Uint8Array(bytes))
}

function tokenValue() { return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32))) }

function accountLink(ctx, key, token) {
  const url = new URL(ctx.request.url)
  url.pathname = '/admin/'
  url.search = `${key}=${encodeURIComponent(token)}`
  return url.toString()
}

async function issueAccountEmail(ctx, user, purpose, email) {
  if (!ctx.env.EMAIL || !ctx.env.EMAIL_FROM) throw new HttpError(503, '邮件服务尚未配置，请联系系统管理员')
  const token = tokenValue()
  const tokenHashValue = await tokenHash(token)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString()
  await run(ctx.db, 'DELETE FROM admin_account_tokens WHERE user_id = ? AND purpose = ?', [user.id, purpose])
  await run(ctx.db, 'INSERT INTO admin_account_tokens (user_id, purpose, email, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)', [user.id, purpose, email, tokenHashValue, expiresAt, now.toISOString()])
  const isReset = purpose === 'PASSWORD_RESET'
  const link = accountLink(ctx, isReset ? 'reset' : 'verifyEmail', token)
  const subject = isReset ? '重置纯粹艺术文化后台密码' : '验证纯粹艺术文化后台邮箱'
  const title = isReset ? '重置后台密码' : '验证邮箱地址'
  const action = isReset ? '设置新密码' : '确认绑定邮箱'
  try {
    await ctx.env.EMAIL.send({
      to: email,
      from: { email: String(ctx.env.EMAIL_FROM), name: String(ctx.env.INSTITUTION_NAME || '纯粹艺术文化') },
      subject,
      text: `${title}\n\n请在 30 分钟内打开以下链接${action}：\n${link}\n\n若非本人操作，请忽略此邮件。`,
      html: `<p>${title}</p><p>请在 30 分钟内点击以下链接${action}：</p><p><a href="${link}">${action}</a></p><p>若非本人操作，请忽略此邮件。</p>`
    })
  } catch (error) {
    await run(ctx.db, 'DELETE FROM admin_account_tokens WHERE token_hash = ?', [tokenHashValue])
    console.error('admin account email delivery failed', error)
    throw new HttpError(503, '邮件服务未开通或发件域名未验证，请在 Cloudflare Email Sending 中验证 murphycai.top 后重试')
  }
}

async function activeAccountToken(ctx, token, purpose) {
  const value = String(token || '').trim()
  if (!value || value.length > 256) throw new HttpError(400, '链接无效或已过期')
  const record = await first(ctx.db, `
    SELECT admin_account_tokens.*, users.id AS account_id, users.display_name, users.status
    FROM admin_account_tokens JOIN users ON users.id = admin_account_tokens.user_id
    WHERE admin_account_tokens.token_hash = ? AND admin_account_tokens.purpose = ?
      AND admin_account_tokens.used_at IS NULL AND admin_account_tokens.expires_at > ?
    LIMIT 1
  `, [await tokenHash(value), purpose, new Date().toISOString()])
  if (!record || record.status !== 'ACTIVE') throw new HttpError(400, '链接无效或已过期')
  return record
}

function assertStaffSelfProtection(operator, targetUserId, roles) {
  if (Number(operator.id) === Number(targetUserId) && !roles.some(role => ['ADMIN', 'OPERATOR'].includes(role))) throw new HttpError(403, '不能移除当前账号的后台身份')
}

function fallbackRoleRows() {
  return Object.entries(ROLE_DEFINITIONS).map(([code, meta]) => ({ code, name: meta.name, status: 'ACTIVE', permissions: DEFAULT_ROLE_PERMISSIONS[code] || [] }))
}

function permissionForAdminRequest(ctx) {
  const path = ctx.url.pathname
  if (path.includes('/roles') || path.includes('/permissions') || path.includes('/access')) return 'identity.manage'
  if (path.endsWith('/password') || path.endsWith('/email/begin')) return 'settings.manage'
  if (path.endsWith('/overview')) return 'dashboard.read'
  if (path.endsWith('/analytics')) return 'report.read'
  if (path.includes('/leave-requests') && ctx.request.method !== 'GET') return 'leave.review'
  const resources = [
    ['/users', 'user'], ['/parents', 'user'], ['/guardians', 'child'], ['/children', 'child'],
    ['/courses', 'course'], ['/classes', 'schedule'], ['/enrollments', 'child'], ['/artworks', 'artwork'], ['/products', 'product'],
    ['/skus', 'product'], ['/resources', 'resource'], ['/uploads', 'resource'], ['/orders', 'order'],
    ['/leave-requests', 'leave'], ['/announcements', 'announcement'], ['/trial-appointments', 'trial']
  ]
  const resource = resources.find(([prefix]) => path.includes(`/api/admin${prefix}`))?.[1]
  if (!resource) return 'admin.access'
  return `${resource}.${ctx.request.method === 'GET' ? 'read' : 'write'}`
}

export function registerAdminRoutes(router) {
  const guard = handler => async ctx => {
    const operator = await requireAdmin(ctx)
    requirePermission(operator, permissionForAdminRequest(ctx))
    return handler(ctx, operator)
  }

  router.post('/api/admin/login', async ctx => {
    const body = await bodyOf(ctx)
    const name = text(body.name, 'name')
    const password = text(body.password, 'password')
    const user = await first(ctx.db, `
      SELECT users.id, users.display_name AS name, users.status, users.admin_password_hash
      FROM users JOIN user_roles ON user_roles.user_id = users.id
      WHERE (users.display_name = ? OR users.mobile = ?) AND user_roles.role IN ('ADMIN', 'OPERATOR') LIMIT 1
    `, [name, name])
    const matchesStoredHash = user?.admin_password_hash ? await passwordMatches(password, user.admin_password_hash) : false
    const matchesBootstrapSecret = user?.status === 'ACTIVE' && !user?.admin_password_hash && String(ctx.env.ADMIN_PASSWORD || '') && password === String(ctx.env.ADMIN_PASSWORD)
    if (!user || user.status !== 'ACTIVE' || (!matchesStoredHash && !matchesBootstrapSecret)) throw new HttpError(401, '账号或密码错误')
    // 首次使用 ADMIN_PASSWORD 登录后写入 Worker 兼容的 PBKDF2 哈希，后续不再依赖明文 Secret。
    if (matchesBootstrapSecret) await run(ctx.db, 'UPDATE users SET admin_password_hash = ?, updated_at = ? WHERE id = ? AND admin_password_hash IS NULL', [await passwordHash(password), isoNow(), user.id])
    const current = await loadActiveUser(ctx.db, user.id)
    if (!['ADMIN', 'OPERATOR'].includes(current.currentRole)) throw new HttpError(403, '该账号没有后台身份')
    return ok({ token: await sessionFor(current.row, String(ctx.env.SESSION_SECRET || ''), current.currentRole), user: serializeUser(current.row, current.roles, current) })
  })

  router.post('/api/admin/password', guard(async (ctx, operator) => {
    const body = await bodyOf(ctx)
    const currentPassword = text(body.currentPassword, 'currentPassword')
    const newPassword = text(body.newPassword, 'newPassword')
    if (newPassword.length < 12) throw new HttpError(400, '新密码至少需要 12 位')
    if (newPassword === currentPassword) throw new HttpError(400, '新密码不能与当前密码相同')
    const record = await first(ctx.db, 'SELECT admin_password_hash FROM users WHERE id = ?', [operator.id])
    if (!record || !await passwordMatches(currentPassword, record.admin_password_hash)) throw new HttpError(400, '当前密码错误')
    await run(ctx.db, 'UPDATE users SET admin_password_hash = ?, updated_at = ? WHERE id = ?', [await passwordHash(newPassword), isoNow(), operator.id])
    return ok({ changed: true })
  }))

  router.post('/api/admin/email/begin', guard(async (ctx, operator) => {
    const body = await bodyOf(ctx)
    const email = normalizedEmail(body.email)
    const existing = await first(ctx.db, 'SELECT id FROM users WHERE email = ? AND id <> ?', [email, operator.id])
    if (existing) throw new HttpError(409, '该邮箱已绑定其他账号')
    await issueAccountEmail(ctx, operator, 'EMAIL_VERIFY', email)
    return ok({ sent: true })
  }))

  router.post('/api/admin/email/confirm', async ctx => {
    const body = await bodyOf(ctx)
    const record = await activeAccountToken(ctx, body.token, 'EMAIL_VERIFY')
    const existing = await first(ctx.db, 'SELECT id FROM users WHERE email = ? AND id <> ?', [record.email, record.account_id])
    if (existing) throw new HttpError(409, '该邮箱已绑定其他账号')
    await batch(ctx.db, [
      ctx.db.prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?').bind(record.email, isoNow(), record.account_id),
      ctx.db.prepare('UPDATE admin_account_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(isoNow(), record.id)
    ])
    return ok({ verified: true })
  })

  router.post('/api/admin/password-reset/request', async ctx => {
    const body = await bodyOf(ctx)
    const email = normalizedEmail(body.email)
    const user = await first(ctx.db, `
      SELECT users.id, users.display_name FROM users JOIN user_roles ON user_roles.user_id = users.id
      WHERE users.email = ? AND users.status = 'ACTIVE' AND user_roles.role IN ('ADMIN', 'OPERATOR') LIMIT 1
    `, [email])
    // 即使邮箱不存在也返回相同结果，防止接口被用于枚举后台账号。
    if (user) await issueAccountEmail(ctx, user, 'PASSWORD_RESET', email)
    return ok({ accepted: true })
  })

  router.post('/api/admin/password-reset/confirm', async ctx => {
    const body = await bodyOf(ctx)
    const password = text(body.newPassword, 'newPassword')
    if (password.length < 12) throw new HttpError(400, '新密码至少需要 12 位')
    const record = await activeAccountToken(ctx, body.token, 'PASSWORD_RESET')
    await batch(ctx.db, [
      ctx.db.prepare('UPDATE users SET admin_password_hash = ?, updated_at = ? WHERE id = ?').bind(await passwordHash(password), isoNow(), record.account_id),
      ctx.db.prepare('UPDATE admin_account_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(isoNow(), record.id),
      ctx.db.prepare("UPDATE admin_account_tokens SET used_at = ? WHERE user_id = ? AND purpose = 'PASSWORD_RESET' AND used_at IS NULL").bind(isoNow(), record.account_id)
    ])
    return ok({ changed: true })
  })

  router.get('/api/admin/overview', guard(async ctx => {
    const [users, children, teachers, visits, pendingOrders, activeClasses, scheduledSessions] = await Promise.all([
      first(ctx.db, 'SELECT COUNT(*) AS total FROM users'), first(ctx.db, 'SELECT COUNT(*) AS total FROM children'),
      first(ctx.db, "SELECT COUNT(*) AS total FROM user_roles JOIN users ON users.id = user_roles.user_id WHERE user_roles.role = 'TEACHER' AND users.status = 'ACTIVE'"),
      first(ctx.db, "SELECT COUNT(*) AS total FROM analytics_events WHERE created_at >= datetime('now', '-1 day')"),
      first(ctx.db, "SELECT COUNT(*) AS total FROM orders WHERE status = 'PENDING_PAYMENT'"),
      first(ctx.db, "SELECT COUNT(*) AS total FROM classes WHERE status = 'ACTIVE'"),
      first(ctx.db, "SELECT COUNT(*) AS total FROM class_sessions WHERE status = 'SCHEDULED' AND starts_at >= datetime('now')")
    ])
    return ok({ users: Number(users?.total || 0), students: Number(children?.total || 0), children: Number(children?.total || 0), teachers: Number(teachers?.total || 0), visits: Number(visits?.total || 0), pendingOrders: Number(pendingOrders?.total || 0), activeClasses: Number(activeClasses?.total || 0), scheduledSessions: Number(scheduledSessions?.total || 0) })
  }))

  router.get('/api/admin/analytics', guard(async ctx => {
    const roles = await all(ctx.db, "SELECT COALESCE(role, 'VISITOR') AS role, COUNT(*) AS total FROM analytics_events WHERE created_at >= datetime('now', '-7 day') GROUP BY COALESCE(role, 'VISITOR')")
    const daily = await all(ctx.db, "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS total FROM analytics_events WHERE created_at >= datetime('now', '-7 day') GROUP BY substr(created_at, 1, 10) ORDER BY day")
    return ok({ roles, daily })
  }))

  // ---------- 试听预约 ----------
  router.get('/api/admin/notifications', guard(async (ctx, operator) => {
    const rows = await all(ctx.db, `
      SELECT id, type, title, body, data_json, related_type, related_id, read_at, created_at
      FROM notifications WHERE recipient_user_id = ? ORDER BY id DESC LIMIT 50
    `, [operator.id])
    const unread = await first(ctx.db, 'SELECT COUNT(*) AS total FROM notifications WHERE recipient_user_id = ? AND read_at IS NULL', [operator.id])
    return ok({ unreadCount: Number(unread?.total || 0), items: rows.map(row => ({
      id: Number(row.id), type: row.type, title: row.title, body: row.body,
      data: row.data_json ? JSON.parse(row.data_json) : {}, relatedId: row.related_id ? Number(row.related_id) : null,
      read: Boolean(row.read_at), createdAt: row.created_at
    })) })
  }))

  router.get('/api/admin/trial-appointments', guard(async ctx => {
    const status = String(ctx.url.searchParams.get('status') || '').trim().toUpperCase()
    const params = []
    const condition = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].includes(status) ? 'WHERE trial_appointments.status = ?' : ''
    if (condition) params.push(status)
    const rows = await all(ctx.db, `
      SELECT trial_appointments.*, courses.name AS course_title,
             users.display_name AS handled_by_name
      FROM trial_appointments
      LEFT JOIN courses ON courses.id = trial_appointments.course_id
      LEFT JOIN users ON users.id = trial_appointments.handled_by_user_id
      ${condition} ORDER BY trial_appointments.id DESC LIMIT 200
    `, params)
    return ok(rows.map(row => ({
      id: Number(row.id), user_id: row.user_id ? Number(row.user_id) : null,
      guardian_name: row.guardian_name, mobile: row.mobile, child_name: row.child_name,
      child_age: row.child_age === null || row.child_age === undefined ? null : Number(row.child_age),
      course_id: row.course_id ? Number(row.course_id) : null, course_title: row.course_title || null,
      preferred_date: row.preferred_date || null, preferred_time: row.preferred_time || 'ANY',
      note: row.note || '', status: row.status, handled_note: row.handled_note || '',
      handled_by_name: row.handled_by_name || null, handled_at: row.handled_at || null,
      created_at: row.created_at, updated_at: row.updated_at
    })))
  }))

  router.patch('/api/admin/trial-appointments/:id', guard(async (ctx, operator) => {
    const appointmentId = id(ctx.params.id, 'id')
    const body = await bodyOf(ctx)
    const status = String(body.status || '').trim().toUpperCase()
    if (!['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].includes(status)) throw new HttpError(400, '预约状态不正确')
    const appointment = await first(ctx.db, `
      SELECT trial_appointments.*, courses.name AS course_title
      FROM trial_appointments LEFT JOIN courses ON courses.id = trial_appointments.course_id
      WHERE trial_appointments.id = ?
    `, [appointmentId])
    if (!appointment) throw new HttpError(404, '试听预约不存在')
    const handledNote = body.handledNote === null || body.handledNote === undefined || String(body.handledNote).trim() === ''
      ? null : boundedText(body.handledNote, 'handledNote', 500)
    const now = isoNow()
    const handledBy = status === 'PENDING' ? null : operator.id
    const handledAt = status === 'PENDING' ? null : now
    await run(ctx.db, `
      UPDATE trial_appointments
      SET status = ?, handled_by_user_id = ?, handled_note = ?, handled_at = ?, updated_at = ?
      WHERE id = ?
    `, [status, handledBy, handledNote, handledAt, now, appointmentId])
    if (appointment.status !== status && appointment.user_id) {
      const label = status === 'CONFIRMED' ? '已确认' : status === 'CANCELLED' ? '已取消' : status === 'COMPLETED' ? '已完成' : '待确认'
      const note = handledNote ? ` 备注：${handledNote}` : ''
      await notifyUsers(ctx.db, [appointment.user_id], {
        type: 'TRIAL_APPOINTMENT_UPDATED',
        title: `试听预约${label}`,
        body: `${appointment.course_title ? `“${appointment.course_title}”` : '试听预约'}的审核状态已更新为${label}。${note}`,
        data: { page: 'trial-appointments', appointmentId },
        relatedType: 'TRIAL_APPOINTMENT', relatedId: appointmentId,
        dedupeKey: `trial-status:${appointmentId}:${status}:${now}`
      })
    }
    return ok({ id: appointmentId, status })
  }))

  // ---------- 用户 ----------
  router.get('/api/admin/users', guard(async ctx => {
    const role = String(ctx.url.searchParams.get('role') || '').toUpperCase()
    const keyword = String(ctx.url.searchParams.get('keyword') || '').trim()
    const clauses = []
    const params = []
    if (keyword) { clauses.push('(display_name LIKE ? OR mobile LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
    if (['ADMIN', 'OPERATOR', 'TEACHER', 'PARENT', 'STUDENT'].includes(role)) { clauses.push(`id IN (SELECT user_id FROM user_roles WHERE role = ?)`); params.push(role) }
    else if (role === 'VISITOR') clauses.push('id NOT IN (SELECT user_id FROM user_roles)')
    const users = await all(ctx.db, `SELECT * FROM users${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY id DESC`, params)
    const roles = await rolesByUser(ctx.db, users.map(user => Number(user.id)))
    const snapshots = await Promise.all(users.map(async user => {
      const snapshot = await loadActiveUser(ctx.db, user.id, undefined, true)
      return serializeUser(user, roles[Number(user.id)] || [], snapshot)
    }))
    return ok(snapshots)
  }))

  router.post('/api/admin/users', guard(async (ctx, operator) => {
    const body = await bodyOf(ctx)
    const roles = rolesFromBody(body)
    const role = roles[0] || 'VISITOR'
    if (roles.length) requirePermission(operator, 'identity.manage')
    if (roles.includes('ADMIN') && operator.currentRole !== 'ADMIN') throw new HttpError(403, '只有超级管理员可以授予超级管理员身份')
    const password = String(body.password || '')
    if (['ADMIN', 'OPERATOR'].includes(role) && password.length < 12) throw new HttpError(400, '后台账号需设置至少 12 位登录密码')
    if (password && password.length < 12) throw new HttpError(400, '登录密码至少 12 位')
    const result = await run(ctx.db, 'INSERT INTO users (wechat_openid, display_name, mobile, avatar_url, admin_password_hash, status) VALUES (?, ?, ?, ?, ?, ?)', [body.openid || null, boundedText(body.name || body.displayName, 'name', 80), optionalMobile(body.mobile), body.avatarUrl || null, password ? await passwordHash(password) : null, body.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE'])
    const userId = lastInsertId(result)
    for (const assignedRole of roles) await run(ctx.db, 'INSERT INTO user_roles (user_id, role) VALUES (?, ?)', [userId, assignedRole])
    return ok({ id: userId }, 201)
  }))

  router.patch('/api/admin/users/:userId', guard(async (ctx, operator) => {
    const userId = id(ctx.params.userId, 'userId')
    const body = await bodyOf(ctx)
    const target = await first(ctx.db, 'SELECT id, status FROM users WHERE id = ?', [userId])
    if (!target) throw new HttpError(404, '用户不存在')
    if (Number(operator.id) === userId && body.status === 'DISABLED') throw new HttpError(400, '不能停用当前登录账号')
    const requestedRoles = Object.hasOwn(body, 'role') || Object.hasOwn(body, 'roles') ? rolesFromBody(body) : null
    if (requestedRoles) {
      requirePermission(operator, 'identity.manage')
      if (requestedRoles.includes('ADMIN') && operator.currentRole !== 'ADMIN') throw new HttpError(403, '只有超级管理员可以授予超级管理员身份')
      assertStaffSelfProtection(operator, userId, requestedRoles)
    }
    const fields = []
    const params = []
    if (Object.hasOwn(body, 'name')) { fields.push('display_name = ?'); params.push(boundedText(body.name, 'name', 80)) }
    if (Object.hasOwn(body, 'mobile')) { fields.push('mobile = ?'); params.push(optionalMobile(body.mobile)) }
    if (Object.hasOwn(body, 'avatarUrl')) { fields.push('avatar_url = ?'); params.push(body.avatarUrl || null) }
    if (Object.hasOwn(body, 'status')) { fields.push('status = ?'); params.push(body.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE') }
    if (body.password) { if (String(body.password).length < 12) throw new HttpError(400, '登录密码至少 12 位'); fields.push('admin_password_hash = ?'); params.push(await passwordHash(String(body.password))) }
    if (fields.length) { fields.push('updated_at = ?'); params.push(isoNow(), userId); await run(ctx.db, `UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params) }
    if (Object.hasOwn(body, 'permissions')) requirePermission(operator, 'identity.manage')
    if (requestedRoles) {
      const statements = [{ sql: 'DELETE FROM user_roles WHERE user_id = ?', params: [userId] }]
      for (const role of requestedRoles) statements.push({ sql: 'INSERT INTO user_roles (user_id, role) VALUES (?, ?)', params: [userId, role] })
      await batch(ctx.db, statements)
    }
    return ok({ id: userId })
  }))

  // ---------- 身份与权限配置 ----------
  router.get('/api/admin/roles', guard(async (ctx, operator) => {
    requirePermission(operator, 'identity.manage')
    try {
      const rows = await all(ctx.db, 'SELECT code, name, status FROM role_catalog ORDER BY sort_order, code')
      const permissions = await all(ctx.db, 'SELECT role_code, permission_code FROM role_permissions ORDER BY role_code, permission_code')
      return ok(rows.map(row => ({ code: roleCode(row.code), name: row.name, status: String(row.status).toLowerCase(), permissions: permissions.filter(item => item.role_code === row.code).map(item => item.permission_code) })))
    } catch {
      return ok(fallbackRoleRows().map(row => ({ code: roleCode(row.code), name: row.name, status: 'active', permissions: row.permissions })))
    }
  }))

  router.get('/api/admin/permissions', guard(async (ctx, operator) => {
    requirePermission(operator, 'identity.manage')
    try {
      return ok(await all(ctx.db, 'SELECT code, name, group_name, status FROM permission_catalog WHERE status = \'ACTIVE\' ORDER BY group_name, code'))
    } catch {
      const codes = [...new Set(Object.values(DEFAULT_ROLE_PERMISSIONS).flat())].sort()
      return ok(codes.map(code => ({ code, name: code, group_name: '业务权限', status: 'ACTIVE' })))
    }
  }))

  router.get('/api/admin/users/:userId/access', guard(async (ctx, operator) => {
    requirePermission(operator, 'identity.manage')
    const userId = id(ctx.params.userId, 'userId')
    const target = await loadActiveUser(ctx.db, userId, undefined, true)
    let overrides = []
    try { overrides = await all(ctx.db, 'SELECT permission_code AS code, effect FROM user_permissions WHERE user_id = ? ORDER BY permission_code', [userId]) } catch { /* 旧数据库没有覆盖权限表 */ }
    return ok({ user: serializeUser(target.row, target.roles, target), overrides })
  }))

  router.patch('/api/admin/users/:userId/access', guard(async (ctx, operator) => {
    requirePermission(operator, 'identity.manage')
    const userId = id(ctx.params.userId, 'userId')
    const body = await bodyOf(ctx)
    const roles = [...new Set((Array.isArray(body.roles) ? body.roles : []).map(normalizeRole).filter(Boolean))]
    if (roles.includes('ADMIN') && operator.currentRole !== 'ADMIN') throw new HttpError(403, '只有超级管理员可以授予超级管理员身份')
    assertStaffSelfProtection(operator, userId, roles)
    const overrides = Array.isArray(body.overrides) ? body.overrides.filter(item => item && typeof item.code === 'string' && ['ALLOW', 'DENY'].includes(item.effect)).map(item => ({ code: item.code.trim(), effect: item.effect })) : []
    const statements = [{ sql: 'DELETE FROM user_roles WHERE user_id = ?', params: [userId] }, ...roles.map(role => ({ sql: 'INSERT INTO user_roles (user_id, role) VALUES (?, ?)', params: [userId, role] }))]
    try {
      statements.push({ sql: 'DELETE FROM user_permissions WHERE user_id = ?', params: [userId] })
      for (const item of overrides) statements.push({ sql: 'INSERT INTO user_permissions (user_id, permission_code, effect) VALUES (?, ?, ?)', params: [userId, item.code, item.effect] })
    } catch { /* 语句将在下方执行时提示需要先迁移数据库 */ }
    await batch(ctx.db, statements)
    const updated = await loadActiveUser(ctx.db, userId, undefined, true)
    return ok({ user: serializeUser(updated.row, updated.roles, updated) })
  }))

  // ---------- 课程 ----------
  router.get('/api/admin/courses', guard(async ctx => ok((await all(ctx.db, 'SELECT * FROM courses ORDER BY id DESC')).map(serializeCourse))))

  router.post('/api/admin/courses', guard(async ctx => {
    const body = await bodyOf(ctx)
    const record = pickFields(body, COURSE_FIELDS)
    record.name = text(record.name, 'name')
    record.default_lesson_count = Number(record.default_lesson_count || 12)
    record.price = Number(record.price || 0)
    if (!record.status) record.status = 'DRAFT'
    if (!Number.isInteger(record.default_lesson_count) || record.default_lesson_count < 1 || record.default_lesson_count > 1000) throw new HttpError(400, '课时数必须为 1-1000 的整数')
    if (!Number.isFinite(record.price) || record.price < 0 || record.price > 1000000) throw new HttpError(400, '课程价格不正确')
    if (!['DRAFT', 'ON_SALE', 'OFF_SALE'].includes(record.status)) throw new HttpError(400, '课程状态不正确')
    const columns = Object.keys(record)
    const result = await run(ctx.db, `INSERT INTO courses (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, columns.map(column => record[column]))
    return ok({ id: lastInsertId(result) }, 201)
  }))

  router.patch('/api/admin/courses/:id', guard(async ctx => {
    const courseId = id(ctx.params.id)
    const patch = pickFields(await bodyOf(ctx), COURSE_FIELDS)
    if (!Object.keys(patch).length) throw new HttpError(400, 'no fields to update')
    if (Object.hasOwn(patch, 'default_lesson_count')) { patch.default_lesson_count = Number(patch.default_lesson_count); if (!Number.isInteger(patch.default_lesson_count) || patch.default_lesson_count < 1 || patch.default_lesson_count > 1000) throw new HttpError(400, '课时数必须为 1-1000 的整数') }
    if (Object.hasOwn(patch, 'price')) { patch.price = Number(patch.price); if (!Number.isFinite(patch.price) || patch.price < 0 || patch.price > 1000000) throw new HttpError(400, '课程价格不正确') }
    if (Object.hasOwn(patch, 'status') && !['DRAFT', 'ON_SALE', 'OFF_SALE'].includes(patch.status)) throw new HttpError(400, '课程状态不正确')
    const columns = Object.keys(patch)
    await run(ctx.db, `UPDATE courses SET ${columns.map(column => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...columns.map(column => patch[column]), isoNow(), courseId])
    return ok({ id: courseId })
  }))

  // ---------- 商品与 SKU ----------
  router.get('/api/admin/products', guard(async ctx => ok(await loadAdminProducts(ctx.db))))

  router.post('/api/admin/products', guard(async ctx => {
    const body = await bodyOf(ctx)
    const status = statusToDb(body.status || 'DRAFT')
    const price = Number(Object.hasOwn(body, 'price') ? body.price : 0)
    const stock = Number(Object.hasOwn(body, 'stock') ? body.stock : 0)
    if (!['DRAFT', 'ON_SALE', 'OFF_SALE'].includes(status)) throw new HttpError(400, '商品状态不正确')
    if (!Number.isFinite(price) || price < 0 || price > 1000000) throw new HttpError(400, '商品价格不正确')
    if (!Number.isInteger(stock) || stock < 0 || stock > 100000000) throw new HttpError(400, '库存数量不正确')
    const result = await run(ctx.db, 'INSERT INTO products (name, category, description, cover_url, status) VALUES (?, ?, ?, ?, ?)', [boundedText(body.title || body.name, 'name', 120), body.category || null, body.description || null, body.coverUrl || null, status])
    const productId = lastInsertId(result)
    await run(ctx.db, 'INSERT INTO product_skus (product_id, name, sku_code, price, stock_quantity) VALUES (?, ?, ?, ?, ?)', [productId, body.skuName ? boundedText(body.skuName, 'skuName', 80) : '标准款', `SKU-${productId}-${Date.now()}`, price, stock])
    return ok({ id: productId }, 201)
  }))

  router.patch('/api/admin/products/:id', guard(async ctx => {
    const productId = id(ctx.params.id)
    const body = await bodyOf(ctx)
    const product = await first(ctx.db, 'SELECT id FROM products WHERE id = ?', [productId])
    if (!product) throw new HttpError(404, '商品不存在')
    if (Object.hasOwn(body, 'status') && !['DRAFT', 'ON_SALE', 'OFF_SALE'].includes(statusToDb(body.status))) throw new HttpError(400, '商品状态不正确')
    if (Object.hasOwn(body, 'price')) {
      const price = Number(body.price)
      if (!Number.isFinite(price) || price < 0 || price > 1000000) throw new HttpError(400, '商品价格不正确')
    }
    if (Object.hasOwn(body, 'stock')) {
      const stock = Number(body.stock)
      if (!Number.isInteger(stock) || stock < 0 || stock > 100000000) throw new HttpError(400, '库存数量不正确')
    }
    const fields = []
    const params = []
    if (Object.hasOwn(body, 'title') || Object.hasOwn(body, 'name')) { fields.push('name = ?'); params.push(boundedText(body.title || body.name, 'name', 120)) }
    if (Object.hasOwn(body, 'category')) { fields.push('category = ?'); params.push(body.category || null) }
    if (Object.hasOwn(body, 'description')) { fields.push('description = ?'); params.push(body.description || null) }
    if (Object.hasOwn(body, 'coverUrl')) { fields.push('cover_url = ?'); params.push(body.coverUrl || null) }
    if (Object.hasOwn(body, 'status')) { fields.push('status = ?'); params.push(statusToDb(body.status)) }
    if (fields.length) { fields.push('updated_at = ?'); params.push(isoNow(), productId); await run(ctx.db, `UPDATE products SET ${fields.join(', ')} WHERE id = ?`, params) }
    if (Object.hasOwn(body, 'price') || Object.hasOwn(body, 'stock')) {
      const sku = await first(ctx.db, 'SELECT id FROM product_skus WHERE product_id = ? ORDER BY id LIMIT 1', [productId])
      if (sku) {
        const skuFields = []
        const skuParams = []
        if (Object.hasOwn(body, 'price')) { skuFields.push('price = ?'); skuParams.push(Number(body.price)) }
        if (Object.hasOwn(body, 'stock')) { skuFields.push('stock_quantity = ?'); skuParams.push(Number(body.stock)) }
        if (skuFields.length) { skuFields.push('updated_at = ?'); skuParams.push(isoNow(), sku.id); await run(ctx.db, `UPDATE product_skus SET ${skuFields.join(', ')} WHERE id = ?`, skuParams) }
      } else await run(ctx.db, 'INSERT INTO product_skus (product_id, name, sku_code, price, stock_quantity) VALUES (?, ?, ?, ?, ?)', [productId, '标准款', `SKU-${productId}-${Date.now()}`, Object.hasOwn(body, 'price') ? Number(body.price) : 0, Object.hasOwn(body, 'stock') ? Number(body.stock) : 0])
    }
    return ok({ id: productId })
  }))

  router.post('/api/admin/skus/:skuId/stock', guard(async ctx => {
    const skuId = id(ctx.params.skuId, 'skuId')
    const body = await bodyOf(ctx)
    const quantity = Number(body.quantity)
    if (!Number.isInteger(quantity) || !quantity) throw new HttpError(400, 'quantity must be a non-zero integer')
    text(body.reason, 'reason')
    const sku = await first(ctx.db, 'SELECT stock_quantity FROM product_skus WHERE id = ?', [skuId])
    if (!sku) throw new HttpError(404, 'SKU 不存在')
    const next = Number(sku.stock_quantity) + quantity
    if (next < 0) throw new HttpError(400, '库存不足，无法扣减')
    await run(ctx.db, 'UPDATE product_skus SET stock_quantity = ?, updated_at = ? WHERE id = ?', [next, isoNow(), skuId])
    return ok({ id: skuId, stock_quantity: next })
  }))

  // ---------- 资源 ----------
  router.get('/api/admin/resources', guard(async ctx => ok(await all(ctx.db, 'SELECT * FROM resources ORDER BY id DESC'))))
  router.post('/api/admin/resources', guard(async ctx => {
    const body = await bodyOf(ctx)
    const result = await run(ctx.db, 'INSERT INTO resources (title, type, url, size_bytes, created_by) VALUES (?, ?, ?, ?, ?)', [text(body.title, 'title'), body.type || null, body.url || null, body.sizeBytes || null, body.createdBy || null])
    return ok({ id: lastInsertId(result) }, 201)
  }))
  router.delete('/api/admin/resources/:resourceId', guard(async ctx => {
    const resourceId = id(ctx.params.resourceId, 'resourceId')
    const result = await run(ctx.db, 'DELETE FROM resources WHERE id = ?', [resourceId])
    if (!changedRows(result)) throw new HttpError(404, '资源不存在')
    return ok({ id: resourceId })
  }))

  // ---------- 订单 ----------
  router.get('/api/admin/orders', guard(async ctx => {
    const orders = await all(ctx.db, 'SELECT orders.*, users.display_name AS buyer_name FROM orders JOIN users ON users.id = orders.buyer_user_id ORDER BY orders.id DESC')
    const items = orders.length ? await all(ctx.db, `SELECT * FROM order_items WHERE order_id IN (${placeholders(orders.map(order => order.id))}) ORDER BY id`, orders.map(order => order.id)) : []
    return ok(orders.map(order => serializeOrder(order, items.filter(item => Number(item.order_id) === Number(order.id)))))
  }))

  router.patch('/api/admin/orders/:id', guard(async ctx => {
    const orderId = id(ctx.params.id)
    const body = await bodyOf(ctx)
    const status = text(body.status, 'status')
    const order = await first(ctx.db, 'SELECT * FROM orders WHERE id = ?', [orderId])
    if (!order) throw new HttpError(404, '订单不存在')
    if (status === 'REFUNDED') throw new HttpError(501, '退款需要接入微信支付退款接口，不能手动标记为已退款')
    if (status === 'SHIPPED') {
      const shippable = await first(ctx.db, 'SELECT id FROM order_items WHERE order_id = ? AND product_sku_id IS NOT NULL LIMIT 1', [orderId])
      if (!shippable) throw new HttpError(400, '课程订单不能进入发货状态')
    }
    if (!canTransition(order.status, status)) throw new HttpError(400, `订单不能从 ${order.status} 变更为 ${status}`)
    if (status === 'PAID') {
      // 正式微信支付必须等待验签后的平台回调，后台不能绕过支付直接发放课时或确认收款。
      if (String(ctx.env.PAYMENT_MODE || '').toLowerCase() === 'wechat') throw new HttpError(409, '微信支付模式下只能由支付回调确认订单，不能后台手动标记已支付')
      return ok(await payOrder(ctx.db, orderId, `ADMIN-${orderId}-${Date.now()}`, (await requireAdmin(ctx)).id, 'ADMIN'))
    }
    if (status === 'CANCELLED') return ok(await cancelOrder(ctx.db, orderId))
    const now = isoNow()
    const fields = ['status = ?', 'updated_at = ?']
    const params = [status, now]
    if (status === 'SHIPPED') { fields.push('tracking_no = ?', 'shipped_at = ?'); params.push(text(body.trackingNo, 'trackingNo'), now) }
    if (status === 'COMPLETED') { fields.push('completed_at = ?'); params.push(now) }
    if (status === 'CANCELLED') { fields.push('cancelled_at = ?'); params.push(now) }
    params.push(orderId)
    await run(ctx.db, `UPDATE orders SET ${fields.join(', ')} WHERE id = ?`, params)
    return ok({ id: orderId, status })
  }))

  // ---------- 学员档案与课时 ----------
  router.get('/api/admin/children', guard(async ctx => {
    const children = await all(ctx.db, 'SELECT * FROM children ORDER BY id DESC')
    const guardians = await all(ctx.db, 'SELECT parent_children.child_id, users.display_name, parent_children.relationship FROM parent_children JOIN users ON users.id = parent_children.parent_user_id')
    const enrollments = await all(ctx.db, "SELECT enrollments.child_id, classes.name AS class_name FROM enrollments JOIN classes ON classes.id = enrollments.class_id WHERE enrollments.status = 'ACTIVE'")
    const data = []
    for (const child of children) {
      const linked = guardians.filter(row => Number(row.child_id) === Number(child.id))
      const active = enrollments.filter(row => Number(row.child_id) === Number(child.id))
      data.push({ id: Number(child.id), name: child.name, gender: child.gender, birthday: child.birthday, remark: child.remark, remaining_lessons: await balanceOf(ctx.db, child.id), active_enrollments: active.length, class_names: active.map(row => row.class_name), guardians: linked.map(row => `${row.display_name}(${row.relationship})`).join('、') })
    }
    return ok(data)
  }))

  router.post('/api/admin/children', guard(async ctx => {
    const body = await bodyOf(ctx)
    const birthday = body.birthday ? String(body.birthday).trim() : null
    if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) throw new HttpError(400, '生日格式必须为 YYYY-MM-DD')
    const result = await run(ctx.db, 'INSERT INTO children (name, gender, birthday, remark) VALUES (?, ?, ?, ?)', [boundedText(body.name, 'name', 80), ['MALE', 'FEMALE'].includes(body.gender) ? body.gender : 'UNKNOWN', birthday, body.remark ? boundedText(body.remark, 'remark', 500) : null])
    return ok({ id: lastInsertId(result) }, 201)
  }))

  router.post('/api/admin/children/:childId/lessons', guard(async ctx => {
    const childId = id(ctx.params.childId, 'childId')
    const body = await bodyOf(ctx)
    const child = await first(ctx.db, 'SELECT id FROM children WHERE id = ?', [childId])
    if (!child) throw new HttpError(404, '学员不存在')
    const quantity = Number(body.quantity)
    if (!Number.isFinite(quantity) || quantity === 0 || Math.abs(quantity) > 100000) throw new HttpError(400, '课时数量不正确')
    const result = await applyLedger(ctx.db, { childId, type: ['PURCHASE', 'GIFT', 'DEDUCT', 'REFUND', 'ADJUST'].includes(body.type) ? body.type : 'ADJUST', quantity: Number(body.quantity), reason: text(body.reason, 'reason'), idempotencyKey: body.idempotencyKey || null, operatorUserId: (await requireAdmin(ctx)).id })
    return ok({ id: childId, remaining_lessons: result.balance })
  }))

  router.get('/api/admin/children/:childId/lesson-ledger', guard(async ctx => {
    const childId = id(ctx.params.childId, 'childId')
    const child = await first(ctx.db, 'SELECT id FROM children WHERE id = ?', [childId])
    if (!child) throw new HttpError(404, '学员不存在')
    const rows = await all(ctx.db, `
      SELECT lesson_ledger.*, children.name AS child_name,
             courses.name AS course_title, users.display_name AS operator_name
      FROM lesson_ledger
      JOIN children ON children.id = lesson_ledger.child_id
      LEFT JOIN class_sessions ON class_sessions.id = lesson_ledger.session_id
      LEFT JOIN classes ON classes.id = class_sessions.class_id
      LEFT JOIN courses ON courses.id = classes.course_id
      LEFT JOIN users ON users.id = lesson_ledger.operator_user_id
      WHERE lesson_ledger.child_id = ? ORDER BY lesson_ledger.id DESC LIMIT 200
    `, [childId])
    return ok(rows.map(row => ({
      id: Number(row.id), child_id: Number(row.child_id), child_name: row.child_name,
      type: row.type, quantity: Number(row.quantity || 0), balance_after: Number(row.balance_after || 0),
      reason: row.reason, course_title: row.course_title || null, operator_name: row.operator_name || null,
      created_at: row.created_at
    })))
  }))

  // ---------- 家长与监护 ----------
  router.post('/api/admin/parents', guard(async ctx => {
    const body = await bodyOf(ctx)
    const result = await run(ctx.db, 'INSERT INTO users (display_name, mobile) VALUES (?, ?)', [boundedText(body.displayName || body.name, 'displayName', 80), optionalMobile(body.mobile)])
    const userId = lastInsertId(result)
    await run(ctx.db, "INSERT INTO user_roles (user_id, role) VALUES (?, 'PARENT')", [userId])
    return ok({ id: userId }, 201)
  }))

  router.post('/api/admin/guardians', guard(async ctx => {
    const body = await bodyOf(ctx)
    const childId = id(body.childId, 'childId')
    const parentUserId = id(body.parentUserId, 'parentUserId')
    const child = await first(ctx.db, 'SELECT id FROM children WHERE id = ?', [childId])
    if (!child) throw new HttpError(404, '学员不存在')
    const parent = await first(ctx.db, "SELECT users.id FROM users JOIN user_roles ON user_roles.user_id = users.id WHERE users.id = ? AND users.status = 'ACTIVE' AND user_roles.role = 'PARENT'", [parentUserId])
    if (!parent) throw new HttpError(400, '绑定对象不是有效的家长账号')
    const relationship = boundedText(body.relationship || '监护人', 'relationship', 30)
    try {
      const result = await run(ctx.db, 'INSERT INTO parent_children (parent_user_id, child_id, relationship) VALUES (?, ?, ?)', [parentUserId, childId, relationship])
      return ok({ id: lastInsertId(result) }, 201)
    } catch (error) { throw dbError(error, '该监护关系已存在') }
  }))

  // ---------- 班级与排课 ----------
  router.get('/api/admin/classes', guard(async ctx => {
    const rows = await all(ctx.db, `
      SELECT classes.*, courses.name AS course_name, users.display_name AS teacher_name,
             (SELECT COUNT(*) FROM enrollments WHERE enrollments.class_id = classes.id AND enrollments.status = 'ACTIVE') AS enrolled_count
      FROM classes JOIN courses ON courses.id = classes.course_id
      LEFT JOIN users ON users.id = classes.teacher_user_id ORDER BY classes.id DESC
    `)
    return ok(rows.map(row => ({ ...row, id: Number(row.id), enrolled_count: Number(row.enrolled_count || 0) })))
  }))

  router.post('/api/admin/classes', guard(async ctx => {
    const body = await bodyOf(ctx)
    const capacity = Number(body.capacity || 20)
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) throw new HttpError(400, '班级容量必须为 1-1000 的整数')
    const course = await first(ctx.db, "SELECT id FROM courses WHERE id = ? AND status <> 'OFF_SALE'", [id(body.courseId, 'courseId')])
    if (!course) throw new HttpError(400, '课程不存在或已下架')
    if (body.teacherUserId) {
      const teacher = await first(ctx.db, "SELECT users.id FROM users JOIN user_roles ON user_roles.user_id = users.id WHERE users.id = ? AND users.status = 'ACTIVE' AND user_roles.role = 'TEACHER'", [id(body.teacherUserId, 'teacherUserId')])
      if (!teacher) throw new HttpError(400, '授课教师账号无效')
    }
    const result = await run(ctx.db, 'INSERT INTO classes (course_id, teacher_user_id, name, campus, room, capacity) VALUES (?, ?, ?, ?, ?, ?)', [course.id, body.teacherUserId ? id(body.teacherUserId, 'teacherUserId') : null, boundedText(body.name, 'name', 120), body.campus || null, body.room || null, capacity])
    return ok({ id: lastInsertId(result) }, 201)
  }))

  router.post('/api/admin/classes/:classId/sessions', guard(async ctx => {
    const classId = id(ctx.params.classId, 'classId')
    const body = await bodyOf(ctx)
    const startsAt = new Date(text(body.startsAt, 'startsAt'))
    const endsAt = new Date(text(body.endsAt, 'endsAt'))
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new HttpError(400, '时间格式不正确')
    if (endsAt <= startsAt) throw new HttpError(400, '结束时间必须晚于开始时间')
    const klass = await first(ctx.db, "SELECT campus, room, status FROM classes WHERE id = ?", [classId])
    if (!klass) throw new HttpError(404, '班级不存在')
    if (klass.status !== 'ACTIVE') throw new HttpError(400, '已归档班级不能继续排课')
    try {
      const sequenceNo = Number(body.sequenceNo || 1)
      if (!Number.isInteger(sequenceNo) || sequenceNo < 1 || sequenceNo > 1000) throw new HttpError(400, '课次序号必须为 1-1000 的整数')
      const result = await run(ctx.db, 'INSERT INTO class_sessions (class_id, sequence_no, starts_at, ends_at, campus, room) VALUES (?, ?, ?, ?, ?, ?)', [classId, sequenceNo, startsAt.toISOString(), endsAt.toISOString(), body.campus || klass.campus, body.room || klass.room])
      return ok({ id: lastInsertId(result) }, 201)
    } catch (error) { throw dbError(error, '该班级已存在相同节次的课次') }
  }))

  // ---------- 报名 ----------
  router.post('/api/admin/enrollments', guard(async ctx => {
    const body = await bodyOf(ctx)
    const childId = id(body.childId, 'childId')
    const classId = id(body.classId, 'classId')
    const klass = await first(ctx.db, 'SELECT status, capacity FROM classes WHERE id = ?', [classId])
    if (!klass || klass.status !== 'ACTIVE') throw new HttpError(400, '班级不存在或已归档')
    const child = await first(ctx.db, 'SELECT id FROM children WHERE id = ?', [childId])
    if (!child) throw new HttpError(404, '学员不存在')
    try {
      // 将容量判断放在 INSERT 条件中，避免并发报名先查后写导致超卖名额。
      const result = await run(ctx.db, `INSERT INTO enrollments (child_id, class_id)
        SELECT ?, ? WHERE (SELECT COUNT(*) FROM enrollments WHERE class_id = ? AND status = 'ACTIVE') < ?`, [childId, classId, classId, Number(klass.capacity)])
      if (!changedRows(result)) throw new HttpError(400, '班级名额已满')
      return ok({ id: lastInsertId(result) }, 201)
    } catch (error) { throw dbError(error, '该学员已报名此班级') }
  }))

  // ---------- 请假审批 ----------
  router.get('/api/admin/leave-requests', guard(async ctx => {
    const status = String(ctx.url.searchParams.get('status') || '').toUpperCase()
    const params = []
    let condition = ''
    if (['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status)) { condition = 'WHERE leave_requests.status = ?'; params.push(status) }
    const rows = await all(ctx.db, `
      SELECT leave_requests.*, children.name AS child_name, class_sessions.starts_at, class_sessions.ends_at,
             courses.name AS course_title, classes.name AS class_name, users.display_name AS requested_by_name
      FROM leave_requests JOIN children ON children.id = leave_requests.child_id
      JOIN class_sessions ON class_sessions.id = leave_requests.session_id JOIN classes ON classes.id = class_sessions.class_id
      JOIN courses ON courses.id = classes.course_id JOIN users ON users.id = leave_requests.requested_by_user_id
      ${condition} ORDER BY leave_requests.id DESC
    `, params)
    return ok(rows)
  }))

  router.patch('/api/admin/leave-requests/:id', guard(async ctx => {
    const requestId = id(ctx.params.id)
    const body = await bodyOf(ctx)
    const status = text(body.status, 'status')
    if (!['APPROVED', 'REJECTED'].includes(status)) throw new HttpError(400, 'status must be APPROVED or REJECTED')
    const operator = await requireAdmin(ctx)
    const record = await first(ctx.db, 'SELECT * FROM leave_requests WHERE id = ?', [requestId])
    if (!record) throw new HttpError(404, '请假申请不存在')
    if (record.status !== 'PENDING') throw new HttpError(400, '该申请已处理')
    const now = isoNow()
    const reviewNote = body.reviewNote ? boundedText(body.reviewNote, 'reviewNote', 300) : null
    const statements = [{ sql: 'UPDATE leave_requests SET status = ?, reviewed_by_user_id = ?, review_note = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = \'PENDING\'', params: [status, operator.id, reviewNote, now, now, requestId] }]
    if (status === 'APPROVED') statements.push({ sql: `
      INSERT INTO attendance (session_id, child_id, status, confirmed_by_user_id, confirmed_at, created_at, updated_at)
      SELECT ?, ?, 'LEAVE', ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM leave_requests WHERE id = ? AND status = 'APPROVED')
      ON CONFLICT(session_id, child_id) DO UPDATE SET status = 'LEAVE', confirmed_by_user_id = excluded.confirmed_by_user_id, confirmed_at = excluded.confirmed_at, updated_at = excluded.updated_at
    `, params: [record.session_id, record.child_id, operator.id, now, now, now, requestId] })
    const results = await batch(ctx.db, statements)
    if (!changedRows(results[0])) throw new HttpError(409, '该申请已被其他管理员处理')
    return ok({ id: requestId, status })
  }))

  // ---------- 公告 ----------
  router.get('/api/admin/announcements', guard(async ctx => ok(await all(ctx.db, 'SELECT * FROM announcements ORDER BY id DESC'))))
  router.post('/api/admin/announcements', guard(async ctx => {
    const body = await bodyOf(ctx)
    const status = body.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT'
    const result = await run(ctx.db, 'INSERT INTO announcements (title, content, audience, status, published_at) VALUES (?, ?, ?, ?, ?)', [text(body.title, 'title'), text(body.content, 'content'), ['PARENT', 'TEACHER'].includes(body.audience) ? body.audience : 'ALL', status, status === 'PUBLISHED' ? isoNow() : null])
    return ok({ id: lastInsertId(result) }, 201)
  }))
  router.patch('/api/admin/announcements/:id', guard(async ctx => {
    const announcementId = id(ctx.params.id)
    const body = await bodyOf(ctx)
    const fields = []
    const params = []
    if (Object.hasOwn(body, 'title')) { fields.push('title = ?'); params.push(text(body.title, 'title')) }
    if (Object.hasOwn(body, 'content')) { fields.push('content = ?'); params.push(text(body.content, 'content')) }
    if (Object.hasOwn(body, 'audience')) { fields.push('audience = ?'); params.push(['PARENT', 'TEACHER'].includes(body.audience) ? body.audience : 'ALL') }
    if (Object.hasOwn(body, 'status')) { fields.push('status = ?'); params.push(body.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT'); fields.push('published_at = ?'); params.push(body.status === 'PUBLISHED' ? isoNow() : null) }
    if (fields.length) { fields.push('updated_at = ?'); params.push(isoNow(), announcementId); await run(ctx.db, `UPDATE announcements SET ${fields.join(', ')} WHERE id = ?`, params) }
    return ok({ id: announcementId })
  }))

  router.post('/api/admin/uploads/presign', guard(async ctx => {
    const body = await bodyOf(ctx)
    return ok(await createUploadUrl(ctx.env, { name: text(body.name, 'name'), contentType: body.contentType, folder: body.folder || 'uploads' }))
  }))

  // ---------- 作品与教学花絮 ----------
  router.get('/api/admin/artworks', guard(async ctx => {
    const rows = await all(ctx.db, `
      SELECT artworks.*, children.name AS child_name, class_sessions.starts_at,
             classes.name AS class_name
      FROM artworks
      JOIN children ON children.id = artworks.child_id
      LEFT JOIN class_sessions ON class_sessions.id = artworks.session_id
      LEFT JOIN classes ON classes.id = class_sessions.class_id
      ORDER BY artworks.id DESC
    `)
    return ok(rows.map(row => ({ ...row, id: Number(row.id), child_id: Number(row.child_id), session_id: row.session_id ? Number(row.session_id) : null, is_public: Boolean(row.is_public) })))
  }))

  router.post('/api/admin/artworks', guard(async ctx => {
    const body = await bodyOf(ctx)
    const childId = id(body.childId, 'childId')
    const child = await first(ctx.db, 'SELECT id FROM children WHERE id = ?', [childId])
    if (!child) throw new HttpError(404, '学员不存在')
    const imageUrl = text(body.imageUrl || body.image_url, 'imageUrl')
    if (imageUrl.length > 2000 || !/^(https:\/\/|\/api\/assets\/artworks\/)/i.test(imageUrl)) throw new HttpError(400, '作品图片地址必须是 HTTPS 或本系统 artworks 资源地址')
    const kind = String(body.kind || 'ARTWORK').toUpperCase()
    if (!['ARTWORK', 'MOMENT'].includes(kind)) throw new HttpError(400, '作品类型不正确')
    const sessionId = body.sessionId ? id(body.sessionId, 'sessionId') : null
    if (sessionId && !await first(ctx.db, 'SELECT id FROM class_sessions WHERE id = ?', [sessionId])) throw new HttpError(404, '课次不存在')
    const title = body.title ? boundedText(body.title, 'title', 120) : (kind === 'MOMENT' ? '教学花絮' : '学员作品')
    const isPublic = body.isPublic === false || body.isPublic === 0 || String(body.isPublic).toLowerCase() === 'false' ? 0 : 1
    const result = await run(ctx.db, 'INSERT INTO artworks (child_id, session_id, image_url, title, kind, status, is_public) VALUES (?, ?, ?, ?, ?, \'REVIEWED\', ?)', [childId, sessionId, imageUrl, title, kind, isPublic])
    return ok({ id: lastInsertId(result) }, 201)
  }))

  router.patch('/api/admin/artworks/:id', guard(async ctx => {
    const artworkId = id(ctx.params.id)
    const current = await first(ctx.db, 'SELECT id FROM artworks WHERE id = ?', [artworkId])
    if (!current) throw new HttpError(404, '作品不存在')
    const body = await bodyOf(ctx)
    const fields = []
    const params = []
    if (Object.hasOwn(body, 'childId')) {
      const childId = id(body.childId, 'childId')
      if (!await first(ctx.db, 'SELECT id FROM children WHERE id = ?', [childId])) throw new HttpError(404, '学员不存在')
      fields.push('child_id = ?'); params.push(childId)
    }
    if (Object.hasOwn(body, 'sessionId')) {
      const sessionId = body.sessionId ? id(body.sessionId, 'sessionId') : null
      if (sessionId && !await first(ctx.db, 'SELECT id FROM class_sessions WHERE id = ?', [sessionId])) throw new HttpError(404, '课次不存在')
      fields.push('session_id = ?'); params.push(sessionId)
    }
    if (Object.hasOwn(body, 'imageUrl') || Object.hasOwn(body, 'image_url')) {
      const imageUrl = text(body.imageUrl || body.image_url, 'imageUrl')
      if (imageUrl.length > 2000 || !/^(https:\/\/|\/api\/assets\/artworks\/)/i.test(imageUrl)) throw new HttpError(400, '作品图片地址必须是 HTTPS 或本系统 artworks 资源地址')
      fields.push('image_url = ?'); params.push(imageUrl)
    }
    if (Object.hasOwn(body, 'title')) fields.push('title = ?'), params.push(body.title ? boundedText(body.title, 'title', 120) : null)
    if (Object.hasOwn(body, 'kind')) {
      const kind = String(body.kind || '').toUpperCase()
      if (!['ARTWORK', 'MOMENT'].includes(kind)) throw new HttpError(400, '作品类型不正确')
      fields.push('kind = ?'); params.push(kind)
    }
    if (Object.hasOwn(body, 'status')) {
      const status = String(body.status || '').toUpperCase()
      if (!['UPLOADED', 'REVIEWING', 'REVIEWED'].includes(status)) throw new HttpError(400, '作品状态不正确')
      fields.push('status = ?'); params.push(status)
    }
    if (Object.hasOwn(body, 'isPublic')) { fields.push('is_public = ?'); params.push(body.isPublic === false || body.isPublic === 0 || String(body.isPublic).toLowerCase() === 'false' ? 0 : 1) }
    if (!fields.length) throw new HttpError(400, 'no fields to update')
    fields.push('updated_at = ?'); params.push(isoNow(), artworkId)
    await run(ctx.db, `UPDATE artworks SET ${fields.join(', ')} WHERE id = ?`, params)
    return ok({ id: artworkId })
  }))

  router.delete('/api/admin/artworks/:id', guard(async ctx => {
    const artworkId = id(ctx.params.id)
    const result = await run(ctx.db, 'DELETE FROM artworks WHERE id = ?', [artworkId])
    if (!changedRows(result)) throw new HttpError(404, '作品不存在')
    return ok({ id: artworkId })
  }))
}
