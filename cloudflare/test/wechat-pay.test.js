import test from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import { verifyWechatNotification } from '../src/wechat-pay.js'

function base64(value) {
  return Buffer.from(value).toString('base64')
}

function signedNotification({ privateKey, publicKey, apiKey, serial, payload, nonce = '9f4sKx7nW2pQ', associatedData = '' }) {
  const nonceBytes = Buffer.from(nonce, 'utf8')
  const aadBytes = Buffer.from(associatedData, 'utf8')
  const cipher = createCipheriv('aes-256-gcm', apiKey, nonceBytes)
  cipher.setAAD(aadBytes)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()])
  const envelope = JSON.stringify({
    id: `EV-${randomBytes(8).toString('hex')}`,
    create_time: '2026-10-31T12:00:00+08:00',
    resource_type: 'encrypt-resource',
    event_type: 'TRANSACTION.SUCCESS',
    resource: { algorithm: 'AEAD_AES_256_GCM', ciphertext: base64(ciphertext), nonce, associated_data: associatedData }
  })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const requestNonce = 'request-nonce'
  const message = `${timestamp}\n${requestNonce}\n${envelope}\n`
  const signature = createSign('RSA-SHA256').update(message).sign(privateKey).toString('base64')
  const request = new Request('https://example.test/api/payments/wechat/notify', {
    method: 'POST',
    headers: {
      'Wechatpay-Timestamp': timestamp,
      'Wechatpay-Nonce': requestNonce,
      'Wechatpay-Signature': signature,
      'Wechatpay-Serial': serial,
      'content-type': 'application/json'
    },
    body: envelope
  })
  return { request, rawBody: envelope, publicKey, apiKey: apiKey.toString('utf8'), serial }
}

test('decrypts the standard WeChat Pay V3 callback resource', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const apiKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8')
  const serial = 'PUB_KEY_ID_TEST'
  const payload = {
    appid: 'wx-test-appid',
    mchid: '1119221647',
    out_trade_no: 'ZX-test-order',
    transaction_id: '42000000000000000000000000000001',
    trade_state: 'SUCCESS',
    amount: { total: 1 }
  }
  const notification = signedNotification({
    privateKey,
    publicKey,
    apiKey,
    serial,
    payload
  })
  const result = await verifyWechatNotification({
    WECHAT_PAY_API_V3_KEY: notification.apiKey,
    WECHAT_PAY_PLATFORM_CERT_SERIAL: serial,
    WECHAT_PAY_PLATFORM_CERT_PEM: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  }, notification.request, notification.rawBody)

  assert.deepEqual(result, payload)
})
