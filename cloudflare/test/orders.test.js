import test from 'node:test'
import assert from 'node:assert/strict'
import { canTransition, paymentChannelOf } from '../src/orders.js'

test('refund eligibility distinguishes successful WeChat and mock payment payloads', () => {
  assert.equal(paymentChannelOf('{"channel":"WECHAT"}'), 'WECHAT')
  assert.equal(paymentChannelOf('{"channel":"MOCK"}'), 'MOCK')
  assert.equal(paymentChannelOf('{bad json'), null)
  assert.equal(paymentChannelOf(null), null)
})

test('order transitions do not allow admin-side refund or repeated completion', () => {
  assert.equal(canTransition('PENDING_PAYMENT', 'PAID'), true)
  assert.equal(canTransition('PAID', 'SHIPPED'), true)
  assert.equal(canTransition('SHIPPED', 'COMPLETED'), true)
  assert.equal(canTransition('PAID', 'REFUNDED'), false)
  assert.equal(canTransition('COMPLETED', 'SHIPPED'), false)
})
