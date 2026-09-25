import { constantTimeEqual, encodeBase64Url, sign, HttpError } from './core.js'

const ALLOWED_FOLDERS = new Set(['course-covers', 'product-covers', 'artworks', 'avatars', 'resources', 'uploads'])
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const DOCUMENT_TYPES = new Set(['application/pdf'])
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

function extension(name, contentType) {
  const byType = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' })[contentType]
  if (byType) return byType
  const matched = String(name || '').match(/\.([a-zA-Z0-9]{1,10})$/)
  if (matched) return `.${matched[1].toLowerCase()}`
  return ''
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return encodeBase64Url(bytes).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)
}

export function normalizeKey(value) {
  const key = decodeURIComponent(String(value || '')).replace(/^\/+/, '')
  const folder = key.split('/')[0]
  if (!ALLOWED_FOLDERS.has(folder) || key.includes('..') || key.endsWith('/')) throw new HttpError(404, 'asset not found')
  return key
}

function uploadSecret(env) {
  const secret = String(env.UPLOAD_SECRET || env.SESSION_SECRET || '')
  if (!secret) throw new HttpError(500, '服务端未配置上传密钥')
  return secret
}

async function uploadToken(env, key, expiry) {
  return sign(`${key}:${expiry}`, uploadSecret(env))
}

export async function createUploadUrl(env, { name, contentType, folder = 'uploads' }) {
  if (!ALLOWED_FOLDERS.has(folder)) throw new HttpError(400, '上传目录不允许')
  const normalizedType = String(contentType || '').toLowerCase()
  const imageOnly = folder === 'course-covers' || folder === 'product-covers' || folder === 'artworks' || folder === 'avatars'
  if (imageOnly ? !IMAGE_TYPES.has(normalizedType) : !(IMAGE_TYPES.has(normalizedType) || DOCUMENT_TYPES.has(normalizedType))) throw new HttpError(400, '文件类型不支持')
  const key = `${folder}/${Date.now()}-${randomId()}${extension(name, contentType)}`
  const expiry = Date.now() + 15 * 60 * 1000
  const token = await uploadToken(env, key, expiry)
  return { key, uploadUrl: `/api/assets/${key}?exp=${expiry}&token=${encodeURIComponent(token)}`, publicUrl: `/api/assets/${key}` }
}

export async function verifyUploadToken(env, key, expiry, token) {
  const exp = Number(expiry)
  if (!Number.isFinite(exp) || exp < Date.now()) return false
  const expected = await uploadToken(env, key, exp)
  return constantTimeEqual(expected, String(token || ''))
}

export async function getAsset(env, key) {
  if (!env.ASSETS) throw new HttpError(503, 'R2 存储绑定未配置')
  const object = await env.ASSETS.get(key)
  if (!object) throw new HttpError(404, 'asset not found')
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'public, max-age=86400')
  return new Response(object.body, { status: 200, headers })
}

export async function putAsset(env, key, request) {
  if (!env.ASSETS) throw new HttpError(503, 'R2 存储绑定未配置')
  const contentType = request.headers.get('content-type') || 'application/octet-stream'
  const folder = key.split('/')[0]
  const normalizedType = contentType.split(';')[0].trim().toLowerCase()
  const imageOnly = folder === 'course-covers' || folder === 'product-covers' || folder === 'artworks' || folder === 'avatars'
  if (imageOnly ? !IMAGE_TYPES.has(normalizedType) : !(IMAGE_TYPES.has(normalizedType) || DOCUMENT_TYPES.has(normalizedType))) throw new HttpError(400, '文件类型不支持')
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > MAX_UPLOAD_BYTES) throw new HttpError(413, '文件不能超过 10 MB')
  const body = await request.arrayBuffer()
  if (!body.byteLength) throw new HttpError(400, '上传内容为空')
  if (body.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(413, '文件不能超过 10 MB')
  await env.ASSETS.put(key, body, { httpMetadata: { contentType: normalizedType, cacheControl: 'public, max-age=31536000, immutable' } })
  return { key }
}
