import { HttpError, constantTimeEqual } from './core.js'

// 微信支付 V3 的签名、下单和回调验签全部在 Worker 内完成。
// 私钥、API v3 密钥和平台证书只从 Worker Secret 读取，绝不下发到小程序。

function required(env, name) {
  const value = String(env[name] || '').trim()
  if (!value || /replace|请填写|your_/i.test(value)) throw new HttpError(503, `微信支付未配置 ${name}`)
  return value
}

function base64Bytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

function pemBytes(pem) {
  const body = String(pem || '').replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '')
  if (!body) throw new HttpError(503, '微信支付证书格式不正确')
  return base64Bytes(body)
}

function derTlv(bytes, offset) {
  if (offset >= bytes.length) throw new HttpError(503, '微信支付证书格式不正确')
  const tag = bytes[offset]
  let length = bytes[offset + 1]
  let cursor = offset + 2
  if (length & 0x80) {
    const count = length & 0x7f
    if (!count || count > 4 || cursor + count > bytes.length) throw new HttpError(503, '微信支付证书格式不正确')
    length = 0
    for (let index = 0; index < count; index += 1) length = length * 256 + bytes[cursor + index]
    cursor += count
  }
  const end = cursor + length
  if (end > bytes.length) throw new HttpError(503, '微信支付证书格式不正确')
  return { tag, start: offset, valueStart: cursor, end, next: end }
}

function certificatePublicKey(bytes) {
  // X.509 Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }。
  // 这里仅提取 tbsCertificate 中的 SubjectPublicKeyInfo，避免把证书私有信息放入运行时。
  const certificate = derTlv(bytes, 0)
  const tbs = derTlv(bytes, certificate.valueStart)
  let cursor = tbs.valueStart
  let part = derTlv(bytes, cursor)
  if (part.tag === 0xa0) { cursor = part.next; part = derTlv(bytes, cursor) }
  // serialNumber, signature, issuer, validity, subject
  for (let index = 0; index < 5; index += 1) { cursor = part.next; part = derTlv(bytes, cursor) }
  const spki = derTlv(bytes, cursor)
  return bytes.slice(spki.start, spki.next)
}

function randomNonce(length = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('').slice(0, length)
}

async function privateSigner(pem) {
  return crypto.subtle.importKey(
    'pkcs8', pemBytes(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  )
}

async function platformVerifier(pem) {
  const bytes = /BEGIN CERTIFICATE/i.test(String(pem)) ? certificatePublicKey(pemBytes(pem)) : pemBytes(pem)
  return crypto.subtle.importKey(
    'spki', bytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify']
  )
}

async function signText(key, value) {
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(value))
  let binary = ''
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function verifyText(key, value, signature) {
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64Bytes(signature), new TextEncoder().encode(value))
}

export function wechatPayEnabled(env) {
  return String(env.PAYMENT_MODE || '').toLowerCase() === 'wechat'
    && String(env.WECHAT_PAY_ENABLED || '').toLowerCase() === 'true'
}

export function wechatPayConfigReady(env) {
  if (!wechatPayEnabled(env)) return false
  for (const name of ['WECHAT_APP_ID', 'WECHAT_PAY_MCH_ID', 'WECHAT_PAY_SERIAL_NO', 'WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_API_V3_KEY', 'WECHAT_PAY_NOTIFY_URL', 'WECHAT_PAY_PLATFORM_CERT_SERIAL', 'WECHAT_PAY_PLATFORM_CERT_PEM']) {
    try { required(env, name) } catch { return false }
  }
  return String(env.WECHAT_PAY_API_V3_KEY || '').length === 32
}

async function signedWechatRequest(env, path, body) {
  const mchid = required(env, 'WECHAT_PAY_MCH_ID')
  const serial = required(env, 'WECHAT_PAY_SERIAL_NO')
  const privateKey = await privateSigner(required(env, 'WECHAT_PAY_PRIVATE_KEY'))
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomNonce()
  const message = `POST\n${path}\n${timestamp}\n${nonce}\n${body}\n`
  const signature = await signText(privateKey, message)
  return fetch(`https://api.mch.weixin.qq.com${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Accept: 'application/json',
      Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serial}",signature="${signature}"`
    },
    body
  })
}

export async function createJsapiPayment(env, { order, openid }) {
  if (!wechatPayConfigReady(env)) throw new HttpError(503, '微信支付尚未完成配置')
  const appId = required(env, 'WECHAT_APP_ID')
  const mchid = required(env, 'WECHAT_PAY_MCH_ID')
  const payerOpenid = String(openid || '').trim()
  if (!payerOpenid) throw new HttpError(400, '当前用户缺少微信身份，无法发起支付')
  const total = Math.round(Number(order.total_amount || 0) * 100)
  if (!Number.isInteger(total) || total <= 0) throw new HttpError(400, '订单金额不正确')
  const description = String(order.subject_title || (order.type === 'COURSE' ? '课程报名' : '纯粹艺术文化商品')).slice(0, 80)
  const requestBody = JSON.stringify({
    appid: appId,
    mchid,
    description,
    out_trade_no: String(order.order_no),
    notify_url: required(env, 'WECHAT_PAY_NOTIFY_URL'),
    amount: { total, currency: 'CNY' },
    payer: { openid: payerOpenid }
  })
  const response = await signedWechatRequest(env, '/v3/pay/transactions/jsapi', requestBody)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.prepay_id) {
    console.error('wechat jsapi order failed', response.status, payload)
    throw new HttpError(502, '微信支付下单失败，请稍后重试')
  }

  const timeStamp = String(Math.floor(Date.now() / 1000))
  const nonceStr = randomNonce()
  const packageValue = `prepay_id=${payload.prepay_id}`
  const payMessage = `${appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`
  const paySign = await signText(await privateSigner(required(env, 'WECHAT_PAY_PRIVATE_KEY')), payMessage)
  return { appId, timeStamp, nonceStr, package: packageValue, signType: 'RSA', paySign }
}

export async function verifyWechatNotification(env, request, rawBody) {
  const timestamp = String(request.headers.get('Wechatpay-Timestamp') || '')
  const nonce = String(request.headers.get('Wechatpay-Nonce') || '')
  const signature = String(request.headers.get('Wechatpay-Signature') || '')
  const serial = String(request.headers.get('Wechatpay-Serial') || '')
  const timestampNumber = Number(timestamp)
  if (!timestamp || !nonce || !signature || !serial || !Number.isInteger(timestampNumber) || Math.abs(Date.now() / 1000 - timestampNumber) > 300) {
    throw new HttpError(400, '微信支付回调签名已过期或缺少必要字段')
  }
  const configuredSerial = String(env.WECHAT_PAY_PLATFORM_CERT_SERIAL || '').trim()
  if (configuredSerial && !constantTimeEqual(configuredSerial, serial)) throw new HttpError(400, '微信支付平台证书序列号不匹配')
  const signedMessage = `${timestamp}\n${nonce}\n${rawBody}\n`
  const verified = await verifyText(await platformVerifier(required(env, 'WECHAT_PAY_PLATFORM_CERT_PEM')), signedMessage, signature)
  if (!verified) throw new HttpError(400, '微信支付回调签名校验失败')
  let envelope
  try { envelope = JSON.parse(rawBody) } catch { throw new HttpError(400, '微信支付回调不是有效 JSON') }
  const resource = envelope?.resource
  if (!resource?.ciphertext || !resource?.nonce || !resource?.associated_data) throw new HttpError(400, '微信支付回调缺少加密资源')
  const apiKey = required(env, 'WECHAT_PAY_API_V3_KEY')
  if (apiKey.length !== 32) throw new HttpError(503, 'WECHAT_PAY_API_V3_KEY 必须为 32 位')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(apiKey), 'AES-GCM', false, ['decrypt'])
  const ciphertext = base64Bytes(resource.ciphertext)
  const tag = base64Bytes(resource.tag)
  const combined = new Uint8Array(ciphertext.length + tag.length)
  combined.set(ciphertext)
  combined.set(tag, ciphertext.length)
  let plaintext
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64Bytes(resource.nonce), additionalData: new TextEncoder().encode(resource.associated_data) }, key, combined)
  } catch {
    throw new HttpError(400, '微信支付回调解密失败')
  }
  try { return JSON.parse(new TextDecoder().decode(plaintext)) } catch { throw new HttpError(400, '微信支付回调内容无效') }
}
