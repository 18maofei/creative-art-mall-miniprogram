import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { db } from './knex.js'

const sessionSecret = process.env.SESSION_SECRET || randomBytes(32).toString('hex')
const allowDevAuth = process.env.ALLOW_DEV_AUTH === 'true'
const wechatAppId = process.env.WECHAT_APP_ID || ''
const wechatAppSecret = process.env.WECHAT_APP_SECRET || ''

// 角色与权限的默认映射用于迁移期间的兼容；迁移完成后以数据库配置和用户覆盖权限为准。
export const ROLE_DEFINITIONS = {
  PARENT: { code: 'parent', name: '家长' },
  TEACHER: { code: 'teacher', name: '教师' },
  STUDENT: { code: 'student', name: '学生' },
  OPERATOR: { code: 'operator', name: '运营人员' },
  ADMIN: { code: 'admin', name: '超级管理员' }
}
export const ROLE_PRIORITY = ['ADMIN', 'OPERATOR', 'TEACHER', 'PARENT', 'STUDENT']
export const DEFAULT_ROLE_PERMISSIONS = {
  PARENT: ['profile.read', 'child.read', 'course.read', 'course.enroll', 'leave.create', 'artwork.read', 'order.read', 'address.manage', 'trial.read'],
  TEACHER: ['profile.read', 'course.read', 'schedule.read', 'attendance.read', 'attendance.write', 'feedback.write', 'artwork.read', 'artwork.write'],
  STUDENT: ['profile.read', 'course.read', 'schedule.read', 'artwork.read', 'feedback.read'],
  OPERATOR: ['admin.access', 'dashboard.read', 'user.read', 'user.write', 'child.read', 'child.write', 'course.read', 'course.write', 'schedule.read', 'schedule.write', 'leave.read', 'leave.review', 'product.read', 'product.write', 'resource.read', 'resource.write', 'order.read', 'order.write', 'announcement.read', 'announcement.write', 'report.read', 'trial.read', 'trial.write'],
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

export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

export function passwordMatches(password, encoded) {
  const [salt, stored] = String(encoded || '').split(':')
  if (!salt || !stored) return false
  const actual = scryptSync(password, salt, 64).toString('hex')
  return actual.length === stored.length && timingSafeEqual(Buffer.from(actual), Buffer.from(stored))
}

export function sessionFor(user) {
  const activeRole = normalizeRole(user.currentRole) || ROLE_PRIORITY.find(role => (user.roles || []).includes(role)) || null
  const payload = Buffer.from(JSON.stringify({ id: Number(user.id), activeRole, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url')
  const signature = createHmac('sha256', sessionSecret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function sessionClaims(request) {
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = createHmac('sha256', sessionSecret).update(payload).digest('base64url')
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('登录已失效，请重新登录')
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  if (!Number.isInteger(data.id) || !Number.isInteger(data.exp) || data.exp <= Date.now()) throw new Error('登录已失效，请重新登录')
  return data
}

// 微信登录：配置了 AppID/Secret 时走真实 code2Session；
// 否则仅在开发模式下允许用 devOpenid 直接登录种子账号（微信开发者工具无 Secret 也能联调）。
export async function resolveWechatOpenid(code, devOpenid = null) {
  if (wechatAppId && wechatAppSecret) {
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${wechatAppId}&secret=${wechatAppSecret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
    const response = await fetch(url)
    const body = await response.json()
    if (!body.openid) throw new Error(`微信登录失败：${body.errmsg || body.errcode || '未知错误'}`)
    return body.openid
  }
  if (allowDevAuth) return String(devOpenid || '').trim() || 'devtools-visitor'
  throw new Error('服务端未配置微信 AppID，无法登录')
}

async function loadActiveUser(userId, requestedRole, allowDisabled = false) {
  const user = await db('users').where({ id: userId }).first('id', 'display_name', 'mobile', 'avatar_url', 'status', 'created_at', 'updated_at')
  if (!user || (!allowDisabled && user.status !== 'ACTIVE')) throw new Error('请先登录')
  const storedRoles = (await db('user_roles').where('user_id', userId).orderBy('id')).map(row => normalizeRole(row.role)).filter(Boolean)
  let roles = storedRoles
  let permissions = [...new Set(storedRoles.flatMap(role => DEFAULT_ROLE_PERMISSIONS[role] || []))].sort()
  let roleDetails = storedRoles.map(role => ({ code: roleCode(role), name: roleName(role), status: 'active' }))
  try {
    const roleRows = storedRoles.length ? await db('role_catalog').whereIn('code', storedRoles) : []
    const roleMap = Object.fromEntries(roleRows.map(row => [row.code, row]))
    roles = storedRoles.filter(role => roleMap[role]?.status !== 'DISABLED')
    roleDetails = roles.map(role => ({ code: roleCode(role), name: roleMap[role]?.name || roleName(role), status: 'active' }))
    const rows = roles.length ? await db('role_permissions').whereIn('role_code', roles).join('permission_catalog', 'permission_catalog.code', 'role_permissions.permission_code').where('permission_catalog.status', 'ACTIVE').distinct('role_permissions.permission_code AS code') : []
    if (rows.length) permissions = rows.map(row => row.code).sort()
    const overrides = await db('user_permissions').where('user_id', userId).select('permission_code', 'effect')
    for (const override of overrides) {
      if (override.effect === 'DENY') permissions = permissions.filter(code => code !== override.permission_code)
      if (override.effect === 'ALLOW' && !permissions.includes(override.permission_code)) permissions.push(override.permission_code)
    }
    permissions.sort()
  } catch {
    // 旧数据库没有权限目录时保持默认映射，执行新迁移后自动切换为数据库配置。
  }
  const currentRole = normalizeRole(requestedRole) && roles.includes(normalizeRole(requestedRole)) ? normalizeRole(requestedRole) : ROLE_PRIORITY.find(role => roles.includes(role)) || 'VISITOR'
  return { id: Number(user.id), name: user.display_name, mobile: user.mobile, avatarUrl: user.avatar_url, roles, roleDetails, currentRole, permissions, row: user }
}

// 小程序端统一鉴权：Bearer token 解出用户；开发模式下允许 X-User-Id 头兜底（便于 curl 调试）。
export async function requireUser(request) {
  const claims = sessionClaims(request)
  if (claims) return loadActiveUser(claims.id, claims.activeRole)
  if (allowDevAuth) {
    const devUserId = Number(request.headers['x-user-id'])
    if (Number.isInteger(devUserId) && devUserId > 0) return loadActiveUser(devUserId)
  }
  throw new Error('请先登录')
}

export function assertSelfOrAdmin(user, userId) {
  if (user.id !== Number(userId) && !['ADMIN', 'OPERATOR'].includes(user.currentRole)) throw new Error('无权访问该用户数据')
}

export function hasPermission(user, permission) {
  return Array.isArray(user?.permissions) && user.permissions.includes(String(permission))
}

export function requirePermission(user, permission) {
  if (!hasPermission(user, permission)) throw new Error(`缺少权限：${permission}`)
  return user
}

// Web 管理台走 Bearer token；小程序管理端在开发模式下用 X-Admin-User-Id 头。
// 上线接入微信登录后应统一为 token 并关闭 ALLOW_DEV_AUTH。
export async function requireAdmin(request) {
  const claims = sessionClaims(request)
  if (claims) {
    const user = await loadActiveUser(claims.id, claims.activeRole)
    if (!['ADMIN', 'OPERATOR'].includes(user.currentRole) || !hasPermission(user, 'admin.access')) throw new Error('admin access denied')
    return user
  }
  if (allowDevAuth) {
    const devUserId = Number(request.headers['x-admin-user-id'])
    if (Number.isInteger(devUserId) && devUserId > 0) {
      const user = await loadActiveUser(devUserId, 'ADMIN')
      if (!['ADMIN', 'OPERATOR'].includes(user.currentRole) || !hasPermission(user, 'admin.access')) throw new Error('admin access denied')
      return user
    }
  }
  throw new Error('请先登录后台管理系统')
}

export { loadActiveUser }
