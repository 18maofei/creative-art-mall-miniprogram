// Worker 通用工具：路由、D1 查询、响应、鉴权和序列化。

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function json(body, status = 200, headers = {}) {
  const responseHeaders = new Headers({ 'content-type': 'application/json; charset=utf-8', ...headers })
  return new Response(JSON.stringify(body), { status, headers: responseHeaders })
}

export function ok(data, status = 200) {
  return json({ data }, status)
}

export function fail(error) {
  const status = Number(error?.status) >= 400 && Number(error?.status) <= 599 ? Number(error.status) : 500
  console.error(error)
  return json({ message: status >= 500 ? '服务暂时不可用，请稍后重试' : (error?.message || 'Request failed') }, status)
}

export function id(value, name = 'id') {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new HttpError(400, `${name} must be a positive integer`)
  return parsed
}

export function text(value, name) {
  const result = String(value ?? '').trim()
  if (!result) throw new HttpError(400, `${name} is required`)
  return result
}

export function isoNow() {
  return new Date().toISOString()
}

export async function bodyOf(ctx) {
  if (ctx.body !== undefined) return ctx.body
  const type = ctx.request.headers.get('content-type') || ''
  if (!type.includes('application/json')) {
    ctx.body = {}
    return ctx.body
  }
  const declaredLength = Number(ctx.request.headers.get('content-length') || 0)
  if (declaredLength > 1024 * 1024) throw new HttpError(413, '请求内容不能超过 1 MB')
  try {
    const raw = await ctx.request.text()
    if (raw.length > 1024 * 1024) throw new HttpError(413, '请求内容不能超过 1 MB')
    ctx.body = raw ? JSON.parse(raw) : {}
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, '请求 JSON 格式不正确')
  }
  if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) throw new HttpError(400, '请求 JSON 必须是对象')
  return ctx.body
}

export function prepare(db, sql, params = []) {
  const statement = db.prepare(sql)
  return params.length ? statement.bind(...params) : statement
}

export async function all(db, sql, params = []) {
  const result = await prepare(db, sql, params).all()
  return result.results || []
}

export async function first(db, sql, params = []) {
  return prepare(db, sql, params).first()
}

export async function run(db, sql, params = []) {
  return prepare(db, sql, params).run()
}

export async function batch(db, statements) {
  return db.batch(statements.map(statement => prepare(db, statement.sql, statement.params || [])))
}

export function lastInsertId(result) {
  return Number(result?.meta?.last_row_id || 0)
}

export function changedRows(result) {
  return Number(result?.meta?.changes || 0)
}

// 角色是服务端控制的业务身份；前端只消费这些字段，不能自行新增或切换任意值。
export const ROLE_DEFINITIONS = {
  PARENT: { code: 'parent', name: '家长' },
  TEACHER: { code: 'teacher', name: '教师' },
  STUDENT: { code: 'student', name: '学生' },
  OPERATOR: { code: 'operator', name: '运营人员' },
  ADMIN: { code: 'admin', name: '超级管理员' }
}

export const ROLE_PRIORITY = ['ADMIN', 'OPERATOR', 'TEACHER', 'PARENT', 'STUDENT']

export const DEFAULT_ROLE_PERMISSIONS = {
  PARENT: ['profile.read', 'profile.write', 'child.read', 'course.read', 'course.enroll', 'leave.create', 'artwork.read', 'order.read', 'address.manage', 'trial.read'],
  TEACHER: ['profile.read', 'profile.write', 'course.read', 'schedule.read', 'attendance.read', 'attendance.write', 'feedback.write', 'artwork.read', 'artwork.write'],
  STUDENT: ['profile.read', 'profile.write', 'course.read', 'schedule.read', 'artwork.read', 'feedback.read'],
  OPERATOR: ['profile.read', 'profile.write', 'admin.access', 'dashboard.read', 'user.read', 'user.write', 'child.read', 'child.write', 'course.read', 'course.write', 'schedule.read', 'schedule.write', 'leave.read', 'leave.review', 'artwork.read', 'artwork.write', 'product.read', 'product.write', 'resource.read', 'resource.write', 'order.read', 'order.write', 'announcement.read', 'announcement.write', 'report.read', 'trial.read', 'trial.write'],
  ADMIN: ['admin.access', 'dashboard.read', 'user.read', 'user.write', 'child.read', 'child.write', 'course.read', 'course.write', 'schedule.read', 'schedule.write', 'leave.read', 'leave.review', 'product.read', 'product.write', 'resource.read', 'resource.write', 'order.read', 'order.write', 'announcement.read', 'announcement.write', 'report.read', 'identity.manage', 'permission.manage', 'settings.manage', 'trial.read', 'trial.write']
}

export function normalizeRole(value) {
  const role = String(value ?? '').trim().toUpperCase()
  return Object.hasOwn(ROLE_DEFINITIONS, role) ? role : null
}

export function roleCode(value) {
  const role = normalizeRole(value)
  return role ? ROLE_DEFINITIONS[role].code : 'visitor'
}

export function roleName(value) {
  const role = normalizeRole(value)
  return role ? ROLE_DEFINITIONS[role].name : '访客'
}

function staticPermissions(roles) {
  const result = new Set()
  for (const role of roles) for (const permission of DEFAULT_ROLE_PERMISSIONS[role] || []) result.add(permission)
  return [...result].sort()
}

function placeholders(values) { return values.map(() => '?').join(',') }

async function accessForUser(db, userId, roles) {
  let permissions = staticPermissions(roles)
  let roleMeta = roles.map(role => ({ code: roleCode(role), name: roleName(role), status: 'active' }))
  try {
    const roleRows = roles.length
      ? await all(db, `SELECT code, name, status FROM role_catalog WHERE code IN (${placeholders(roles)})`, roles)
      : []
    const roleMap = Object.fromEntries(roleRows.map(row => [String(row.code).toUpperCase(), row]))
    roleMeta = roles
      .filter(role => roleMap[role]?.status !== 'DISABLED')
      .map(role => ({ code: roleCode(role), name: roleMap[role]?.name || roleName(role), status: 'active' }))
    const rolePermissions = roles.length
      ? await all(db, `SELECT DISTINCT role_permissions.permission_code AS code
          FROM role_permissions JOIN permission_catalog ON permission_catalog.code = role_permissions.permission_code
          WHERE role_permissions.role_code IN (${placeholders(roles)}) AND permission_catalog.status = 'ACTIVE'`, roles)
      : []
    const merged = new Set(rolePermissions.map(row => row.code))
    if (merged.size) permissions = [...merged].sort()
    const overrides = await all(db, 'SELECT permission_code, effect FROM user_permissions WHERE user_id = ?', [userId])
    for (const override of overrides) {
      if (override.effect === 'DENY') permissions = permissions.filter(code => code !== override.permission_code)
      if (override.effect === 'ALLOW' && !permissions.includes(override.permission_code)) permissions.push(override.permission_code)
    }
    permissions.sort()
  } catch {
    // 旧环境尚未执行新迁移时使用内置只读映射，部署迁移后以数据库配置为准。
  }
  return { roleMeta, permissions }
}

export async function parseToken(request, secret) {
  const token = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = await sign(payload, secret)
  if (!constantTimeEqual(signature, expected)) throw new HttpError(401, '登录已失效，请重新登录')
  let data
  try { data = JSON.parse(decodeBase64Url(payload)) } catch { throw new HttpError(401, '登录已失效，请重新登录') }
  if (!Number.isInteger(data.id) || !Number.isInteger(data.exp) || data.exp <= Date.now()) throw new HttpError(401, '登录已失效，请重新登录')
  return data
}

export async function sessionFor(user, secret, activeRole = user.currentRole || primaryRole(user.roles || [])) {
  const payload = encodeBase64Url(JSON.stringify({ id: Number(user.id), activeRole: normalizeRole(activeRole), exp: Date.now() + 8 * 60 * 60 * 1000 }))
  return `${payload}.${await sign(payload, secret)}`
}

export async function sessionClaims(ctx) {
  const secret = String(ctx.env.SESSION_SECRET || '')
  if (!secret) throw new HttpError(500, '服务端未配置 SESSION_SECRET')
  const claims = await parseToken(ctx.request, secret)
  if (!claims) throw new HttpError(401, '请先登录')
  return claims
}

export async function requireUser(ctx) {
  const secret = String(ctx.env.SESSION_SECRET || '')
  if (!secret) throw new HttpError(500, '服务端未配置 SESSION_SECRET')
  const claims = await parseToken(ctx.request, secret)
  const devAllowed = String(ctx.env.ALLOW_DEV_AUTH || '').toLowerCase() === 'true'
  const userId = claims?.id || (devAllowed ? Number(ctx.request.headers.get('x-user-id')) : 0)
  if (!Number.isInteger(userId) || userId < 1) throw new HttpError(401, '请先登录')
  return loadActiveUser(ctx.env.DB, userId, claims?.activeRole)
}

export async function requireAdmin(ctx) {
  const secret = String(ctx.env.SESSION_SECRET || '')
  if (!secret) throw new HttpError(500, '服务端未配置 SESSION_SECRET')
  const claims = await parseToken(ctx.request, secret)
  const devAllowed = String(ctx.env.ALLOW_DEV_AUTH || '').toLowerCase() === 'true'
  const devUserId = devAllowed ? Number(ctx.request.headers.get('x-admin-user-id')) : 0
  const userId = claims?.id || devUserId
  if (!Number.isInteger(userId) || userId < 1) throw new HttpError(401, '请先登录后台管理系统')
  const user = await loadActiveUser(ctx.env.DB, userId, claims?.activeRole || (devUserId ? 'ADMIN' : undefined))
  if (!['ADMIN', 'OPERATOR'].includes(user.currentRole) || !hasPermission(user, 'admin.access')) throw new HttpError(403, 'admin access denied')
  return user
}

export async function requireTeacher(ctx) {
  const user = await requireUser(ctx)
  if (!['TEACHER', 'ADMIN'].includes(user.currentRole)) throw new HttpError(403, '需要教师身份')
  return user
}

export function assertSelfOrAdmin(user, userId) {
  if (user.id !== Number(userId) && !['ADMIN', 'OPERATOR'].includes(user.currentRole)) throw new HttpError(403, '无权访问该用户数据')
}

export function hasPermission(user, permission) {
  return Array.isArray(user?.permissions) && user.permissions.includes(String(permission))
}

export function requirePermission(user, permission) {
  if (!hasPermission(user, permission)) throw new HttpError(403, `缺少权限：${permission}`)
  return user
}

export async function loadActiveUser(db, userId, requestedRole, allowDisabled = false) {
  const user = await first(db, 'SELECT id, display_name, mobile, email, avatar_url, status, created_at, updated_at FROM users WHERE id = ?', [userId])
  if (!user || (!allowDisabled && user.status !== 'ACTIVE')) throw new HttpError(401, '请先登录')
  const storedRoles = (await all(db, 'SELECT role FROM user_roles WHERE user_id = ? ORDER BY id', [userId])).map(row => normalizeRole(row.role)).filter(Boolean)
  const access = await accessForUser(db, userId, storedRoles)
  const roles = storedRoles.filter(role => access.roleMeta.some(item => item.code === roleCode(role)))
  const currentRole = normalizeRole(requestedRole) && roles.includes(normalizeRole(requestedRole)) ? normalizeRole(requestedRole) : primaryRole(roles)
  return { id: Number(user.id), name: user.display_name, mobile: user.mobile, email: user.email, avatarUrl: user.avatar_url, roles, roleDetails: access.roleMeta.filter(item => roles.some(role => roleCode(role) === item.code)), currentRole, permissions: access.permissions, row: user }
}

let wechatAccessTokenCache = null

async function wechatAccessToken(ctx) {
  const appId = String(ctx.env.WECHAT_APP_ID || '')
  const appSecret = String(ctx.env.WECHAT_APP_SECRET || '')
  if (!appId || !appSecret) throw new HttpError(500, '服务端未配置微信 AppID，无法获取手机号')
  if (wechatAccessTokenCache && wechatAccessTokenCache.expiresAt > Date.now()) return wechatAccessTokenCache.value
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`
  const response = await fetch(url)
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.access_token) throw new HttpError(502, `微信服务异常：${result.errmsg || result.errcode || '无法获取访问令牌'}`)
  // 提前五分钟刷新，避免令牌恰好在手机号换取过程中失效。
  wechatAccessTokenCache = { value: result.access_token, expiresAt: Date.now() + Math.max(60, Number(result.expires_in || 7200) - 300) * 1000 }
  return wechatAccessTokenCache.value
}

export async function resolveWechatMobile(ctx, phoneCode) {
  const code = String(phoneCode || '').trim()
  if (!code || code.length > 512) throw new HttpError(400, '微信手机号授权凭证无效，请重新授权')
  const token = await wechatAccessToken(ctx)
  const response = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code })
  })
  const result = await response.json().catch(() => ({}))
  const mobile = String(result?.phone_info?.purePhoneNumber || result?.phone_info?.phoneNumber || '').trim()
  if (!response.ok || !/^1[3-9]\d{9}$/.test(mobile)) throw new HttpError(400, `微信手机号获取失败：${result.errmsg || result.errcode || '请重新授权'}`)
  return mobile
}

export async function resolveWechatOpenid(ctx, code, devOpenid = null) {
  const appId = String(ctx.env.WECHAT_APP_ID || '')
  const appSecret = String(ctx.env.WECHAT_APP_SECRET || '')
  if (appId && appSecret) {
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
    const response = await fetch(url)
    const result = await response.json()
    if (!result.openid) throw new HttpError(400, `微信登录失败：${result.errmsg || result.errcode || '未知错误'}`)
    return result.openid
  }
  if (String(ctx.env.ALLOW_DEV_AUTH || '').toLowerCase() === 'true') return String(devOpenid || '').trim() || 'devtools-visitor'
  throw new HttpError(500, '服务端未配置微信 AppID，无法登录')
}

export async function passwordHash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  // Cloudflare Workers WebCrypto currently supports PBKDF2 up to 100000 iterations.
  const iterations = 100000
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256)
  return `pbkdf2:${iterations}:${bytesToHex(salt)}:${bytesToHex(new Uint8Array(bits))}`
}

export async function passwordMatches(password, encoded) {
  const [scheme, iterationText, saltText, stored] = String(encoded || '').split(':')
  if (scheme !== 'pbkdf2' || !iterationText || !saltText || !stored) return false
  const iterations = Number(iterationText)
  if (!Number.isInteger(iterations) || iterations < 10000 || iterations > 100000) return false
  const salt = hexToBytes(saltText)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256)
  return constantTimeEqual(bytesToHex(new Uint8Array(bits)), stored)
}

export async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(value)))
  return encodeBase64Url(new Uint8Array(signature))
}

export function encodeBase64Url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function decodeBase64Url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function constantTimeEqual(a, b) {
  const left = String(a)
  const right = String(b)
  let diff = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  return diff === 0
}

export function bytesToHex(bytes) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(value) {
  const textValue = String(value)
  if (!/^[0-9a-f]+$/i.test(textValue) || textValue.length % 2) return new Uint8Array()
  const bytes = new Uint8Array(textValue.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(textValue.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

export function statusToApi(status) {
  return status === 'ON_SALE' ? 'PUBLISHED' : status
}

export function statusToDb(status) {
  return status === 'PUBLISHED' ? 'ON_SALE' : status
}

export function serializeCourse(row) {
  if (!row) return null
  return {
    id: Number(row.id), title: row.name, category: row.category || '艺术课程', age_range: row.age_range,
    sessions: Number(row.default_lesson_count || 0), price: Number(row.price || 0), schedule: row.schedule_text,
    campus: row.campus, room: row.room, teacher_name: row.teacher_name, description: row.description,
    cover_url: row.cover_url, status: statusToApi(row.status), created_at: row.created_at, updated_at: row.updated_at
  }
}

export function serializeProduct(row, skus = []) {
  if (!row) return null
  const primary = skus[0] || {}
  return {
    id: Number(row.id), title: row.name, category: row.category || '画室周边', description: row.description,
    cover_url: row.cover_url, status: statusToApi(row.status), price: Number(primary.price || 0),
    stock: skus.reduce((total, sku) => total + Number(sku.stock_quantity || 0), 0), sales: Number(row.sales || 0),
    skus: skus.map(sku => ({ sku_id: Number(sku.id), sku_name: sku.name, sku_code: sku.sku_code, price: Number(sku.price || 0), stock_quantity: Number(sku.stock_quantity || 0) })),
    created_at: row.created_at, updated_at: row.updated_at
  }
}

export function primaryRole(roles) {
  return ROLE_PRIORITY.find(role => roles.includes(role)) || 'VISITOR'
}

export function serializeUser(row, roles = [], options = {}) {
  if (!row) return null
  const codes = roles.map(role => normalizeRole(role)).filter(Boolean)
  const roleDetails = options.roleDetails || codes.map(role => ({ code: roleCode(role), name: roleName(role), status: 'active' }))
  return {
    id: Number(row.id), name: row.display_name, mobile: row.mobile, email: row.email || null, avatar_url: row.avatar_url, avatarUrl: row.avatar_url, avatar: row.avatar_url,
    role: primaryRole(codes), roleCodes: codes, roles: roleDetails,
    currentRole: roleCode(options.currentRole || primaryRole(codes)), permissions: options.permissions || [],
    status: row.status, created_at: row.created_at, updated_at: row.updated_at
  }
}

export function serializeOrder(row, items = []) {
  if (!row) return null
  const firstItem = items[0] || {}
  const type = items.some(item => item.course_id) ? 'COURSE' : 'PRODUCT'
  const title = firstItem.name_snapshot ? (items.length > 1 ? `${firstItem.name_snapshot} 等 ${items.length} 件` : firstItem.name_snapshot) : '订单'
  return {
    id: Number(row.id), order_no: row.order_no, buyer_user_id: Number(row.buyer_user_id), buyer_name: row.buyer_name,
    type, subject_title: title, amount: Number(row.total_amount || 0), total_amount: Number(row.total_amount || 0),
    status: row.status, paid_at: row.paid_at, shipped_at: row.shipped_at, completed_at: row.completed_at,
    cancelled_at: row.cancelled_at, tracking_no: row.tracking_no, recipient_name_snapshot: row.recipient_name_snapshot,
    recipient_mobile_snapshot: row.recipient_mobile_snapshot, shipping_address_snapshot: row.shipping_address_snapshot,
    created_at: row.created_at,
    items: items.map(item => ({ id: Number(item.id), name: item.name_snapshot, unit_price: Number(item.unit_price || 0), quantity: Number(item.quantity || 0), subtotal: Number(item.subtotal || 0), course_id: item.course_id ? Number(item.course_id) : null, product_sku_id: item.product_sku_id ? Number(item.product_sku_id) : null }))
  }
}

export function serializeAddress(row) {
  if (!row) return null
  return { id: Number(row.id), user_id: Number(row.user_id), recipient_name: row.recipient_name, mobile: row.mobile, province: row.province, city: row.city, district: row.district, detail: row.detail, is_default: Boolean(row.is_default), full_address: `${row.province}${row.city}${row.district}${row.detail}` }
}

export class Router {
  constructor() { this.routes = [] }

  add(method, pattern, handler) {
    const names = []
    const parts = pattern.split('/').filter(Boolean)
    let expression = '^'
    for (const part of parts) {
      expression += '/'
      if (part === '*') { names.push('*'); expression += '(.*)'; break }
      if (part.startsWith(':')) { names.push(part.slice(1)); expression += '([^/]+)' } else expression += part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    if (!parts.length) expression += '/'
    expression += '/?$'
    this.routes.push({ method: method.toUpperCase(), regex: new RegExp(expression), names, handler })
    return this
  }

  get(pattern, handler) { return this.add('GET', pattern, handler) }
  post(pattern, handler) { return this.add('POST', pattern, handler) }
  patch(pattern, handler) { return this.add('PATCH', pattern, handler) }
  put(pattern, handler) { return this.add('PUT', pattern, handler) }
  delete(pattern, handler) { return this.add('DELETE', pattern, handler) }

  async dispatch(request, env) {
    const url = new URL(request.url)
    for (const route of this.routes) {
      if (route.method !== request.method) continue
      const match = url.pathname.match(route.regex)
      if (!match) continue
      const params = {}
      route.names.forEach((name, index) => { params[name] = decodeURIComponent(match[index + 1] || '') })
      const ctx = { request, env, url, params, db: env.DB, body: undefined }
      return route.handler(ctx)
    }
    return json({ message: 'not found' }, 404)
  }
}

export function withCors(response, env) {
  const headers = new Headers(response.headers)
  const origin = String(env.CORS_ORIGIN || '*')
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Admin-User-Id, X-User-Id')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
  headers.set('Access-Control-Max-Age', '86400')
  headers.set('Vary', 'Origin')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  headers.set('X-Frame-Options', 'SAMEORIGIN')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
