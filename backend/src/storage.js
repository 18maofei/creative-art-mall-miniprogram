import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { config } from './runtime-config.js'

const uploadSecret = process.env.SESSION_SECRET || randomBytes(32).toString('hex')
const localRoot = join(process.cwd(), 'uploads')

const snowflakeEpoch = 1735689600000n // 2025-01-01T00:00:00.000Z
const workerId = BigInt(randomBytes(2).readUInt16BE(0) & 0x03ff)
let lastMillisecond = 0
let sequence = 0

function storageEnabled() {
  return Boolean(config.r2.accountId && config.r2.accessKeyId && config.r2.secretAccessKey)
}

function client() {
  if (!storageEnabled()) throw new Error('R2 storage environment variables are not configured')
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey }
  })
}

function snowflake() {
  let current = Date.now()
  if (current === lastMillisecond && sequence === 0x0fff) {
    do current = Date.now()
    while (current === lastMillisecond)
  }
  if (current === lastMillisecond) sequence += 1
  else { lastMillisecond = current; sequence = 0 }
  return ((BigInt(current) - snowflakeEpoch) << 22n | workerId << 12n | BigInt(sequence)).toString()
}

function extension(name, contentType) {
  const matched = String(name || '').match(/\.([a-zA-Z0-9]{1,10})$/)
  if (matched) return `.${matched[1].toLowerCase()}`
  return ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' })[contentType] || ''
}

export function assetPath(key) {
  return `/api/assets/${key.split('/').map(encodeURIComponent).join('/')}`
}

function uploadSignature(key, exp) {
  return createHmac('sha256', uploadSecret).update(`${key}:${exp}`).digest('base64url')
}

export function verifyUploadToken(key, exp, token) {
  const expiry = Number(exp)
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false
  const expected = uploadSignature(key, expiry)
  const actual = String(token || '')
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

export async function writeLocalObject(key, body) {
  const file = join(localRoot, key)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, body)
}

export async function writeObject(key, body, contentType) {
  if (!storageEnabled()) return writeLocalObject(key, body)
  await client().send(new PutObjectCommand({
    Bucket: config.r2.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable'
  }))
}

const localContentTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf' }

// 未配置 R2 时退化为本地磁盘存储：presign 返回带 HMAC 令牌的本地 PUT 地址，文件落在 backend/uploads/。
export async function createUploadUrl({ name, contentType, folder = 'uploads' }) {
  const key = `${folder}/${snowflake()}${extension(name, contentType)}`
  if (!storageEnabled()) {
    const exp = Date.now() + 900 * 1000
    return { key, uploadUrl: `${assetPath(key)}?exp=${exp}&token=${uploadSignature(key, exp)}`, publicUrl: assetPath(key) }
  }
  const uploadUrl = await getSignedUrl(client(), new PutObjectCommand({ Bucket: config.r2.bucket, Key: key, ContentType: contentType || 'application/octet-stream' }), { expiresIn: 900 })
  return { key, uploadUrl, publicUrl: assetPath(key) }
}

export async function readObject(key) {
  if (!storageEnabled()) {
    const body = await readFile(join(localRoot, key))
    const ext = (key.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase()
    return { body, contentType: localContentTypes[ext] || 'application/octet-stream' }
  }
  const result = await client().send(new GetObjectCommand({ Bucket: config.r2.bucket, Key: key }))
  return { body: Buffer.from(await result.Body.transformToByteArray()), contentType: result.ContentType || 'application/octet-stream' }
}
