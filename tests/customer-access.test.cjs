const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function setup() {
  const sql = new DatabaseSync(':memory:')
  const migrationDir = path.join(__dirname, '../cloudflare/migrations')
  for (const file of fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql')).sort()) sql.exec(fs.readFileSync(path.join(migrationDir, file), 'utf8'))
  sql.exec("INSERT INTO users(id, display_name) VALUES (1, '甲'), (2, '乙')")
  const db = {
    prepare(query) {
      let params = []
      return {
        bind(...values) { params = values; return this },
        async all() { return { results: sql.prepare(query).all(...params) } },
        async first() { return sql.prepare(query).get(...params) || null },
        async run() { const r = sql.prepare(query).run(...params); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } } }
      }
    },
    async batch(statements) {
      sql.exec('BEGIN')
      try { const result = []; for (const statement of statements) result.push(await statement.run()); sql.exec('COMMIT'); return result }
      catch (error) { sql.exec('ROLLBACK'); throw error }
    }
  }
  const handlers = new Map(), router = {}
  for (const verb of ['get', 'post', 'patch', 'delete']) router[verb] = (route, handler) => handlers.set(verb + ' ' + route, handler)
  const { registerAccountRoutes } = await import(pathToFileURL(path.join(__dirname, '../cloudflare/src/account-routes.js')))
  registerAccountRoutes(router)
  async function call(verb, route, params = {}, body, user = 1) {
    const request = new Request('https://example.test/api', { headers: user ? { 'x-user-id': String(user) } : {} })
    const response = await handlers.get(verb + ' ' + route)({ request, params, body, db, env: { DB: db, SESSION_SECRET: 'local-test-only', ALLOW_DEV_AUTH: 'true', PAYMENT_MODE: 'mock' }, url: new URL(request.url) })
    return (await response.json()).data
  }
  return { sql, call }
}
test('普通客户无需家长身份即可新增编辑地址、查看自己的订单和预约', async () => {
  const { sql, call } = await setup()
  try {
    const form = { recipientName: '测试', mobile: '13800000000', province: '省', city: '市', district: '区', detail: '地址一', isDefault: true }
    const first = await call('post', '/api/users/:userId/addresses', { userId: 1 }, form)
    const second = await call('post', '/api/users/:userId/addresses', { userId: 1 }, { ...form, detail: '地址二', isDefault: false })
    await call('patch', '/api/users/:userId/addresses/:addressId', { userId: 1, addressId: first.id }, { detail: '已编辑', isDefault: false })
    const rows = await call('get', '/api/users/:userId/addresses', { userId: 1 })
    assert.equal(rows.find(r => r.id === second.id).is_default, true)
    assert.equal(rows.find(r => r.id === first.id).detail, '已编辑')
    assert.deepEqual(await call('get', '/api/users/:userId/orders', { userId: 1 }), [])
    assert.deepEqual(await call('get', '/api/users/:userId/trial-appointments', { userId: 1 }), [])
  } finally { sql.close() }
})
test('客户不能读取、编辑他人的地址/订单/预约；未登录不能访问', async () => {
  const { sql, call } = await setup()
  try {
    for (const route of ['/api/users/:userId/addresses', '/api/users/:userId/orders', '/api/users/:userId/trial-appointments']) {
      await assert.rejects(call('get', route, { userId: 2 }), error => error.status === 403)
      await assert.rejects(call('get', route, { userId: 1 }, undefined, null), error => error.status === 401)
    }
    await assert.rejects(call('patch', '/api/users/:userId/addresses/:addressId', { userId: 2, addressId: 1 }, { detail: '越权修改' }), error => error.status === 403)
    sql.exec("INSERT INTO orders(id, order_no, buyer_user_id, total_amount, status) VALUES (1, 'TEST-1', 2, 10, 'PENDING_PAYMENT')")
    for (const [verb, route] of [['get', '/api/orders/:orderId/status'], ['post', '/api/orders/:orderId/cancel'], ['post', '/api/orders/:orderId/mock-pay'], ['post', '/api/orders/:orderId/confirm-receipt']]) {
      await assert.rejects(call(verb, route, { orderId: 1 }), error => error.status === 404)
    }
    assert.equal(sql.prepare('SELECT status FROM orders WHERE id=1').get().status, 'PENDING_PAYMENT')
  } finally { sql.close() }
})
