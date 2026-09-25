import { all, first, run, changedRows, batch, HttpError, isoNow } from './core.js'
import { applyLedger } from './lessons.js'

function orderNo() {
  return `ZX${Date.now()}${Math.floor(Math.random() * 900 + 100)}`
}

function numericId() {
  // 显式分配 ID，让订单、明细和库存扣减可以放进同一个 D1 batch。
  return Number(`${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`)
}

const TRANSITIONS = {
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  // 退款必须先调用微信退款接口并记录退款流水，不能只改订单状态伪造退款。
  PAID: ['SHIPPED', 'COMPLETED'],
  SHIPPED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: []
}

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to)
}

function quantityOf(value) {
  const quantity = Math.max(1, Math.floor(Number(value) || 1))
  if (quantity > 999) throw new HttpError(400, '单件商品数量不能超过 999')
  return quantity
}

export async function createOrder(db, { buyerUserId, type, subjectId, quantity = 1, addressId = null, courseChildId = null, items = null, idempotencyKey = null }) {
  const requestKey = idempotencyKey == null ? null : String(idempotencyKey).trim()
  if (requestKey && (requestKey.length < 8 || requestKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(requestKey))) throw new HttpError(400, '订单幂等键格式不正确')
  if (requestKey) {
    const existing = await first(db, 'SELECT * FROM orders WHERE buyer_user_id = ? AND idempotency_key = ?', [buyerUserId, requestKey])
    if (existing) {
      const existingItems = await all(db, 'SELECT id FROM order_items WHERE order_id = ?', [existing.id])
      return { id: Number(existing.id), order_no: existing.order_no, status: existing.status, total_amount: Number(existing.total_amount), item_count: existingItems.length, duplicate: true }
    }
  }
  const requestedItems = Array.isArray(items) && items.length ? items : [{ type, subjectId, quantity }]
  if (requestedItems.length > 50) throw new HttpError(400, '单笔订单最多包含 50 个商品')
  const orderItems = []
  const stockUpdates = []

  for (const requested of requestedItems) {
    const itemType = String(requested.type || type || '').toUpperCase()
    const itemSubjectId = Number(requested.subjectId ?? subjectId)
    const count = quantityOf(requested.quantity)
    if (!Number.isInteger(itemSubjectId) || itemSubjectId < 1) throw new HttpError(400, '商品或课程 ID 不正确')

    if (itemType === 'COURSE') {
      const course = await first(db, "SELECT * FROM courses WHERE id = ? AND status = 'ON_SALE'", [itemSubjectId])
      if (!course) throw new HttpError(400, '课程暂不可购买')
      orderItems.push({ name_snapshot: course.name, unit_price: Number(course.price || 0), quantity: count, course_id: Number(course.id), product_sku_id: null, subtotal: Number((Number(course.price || 0) * count).toFixed(2)) })
      continue
    }

    if (itemType !== 'PRODUCT') throw new HttpError(400, 'type must be COURSE or PRODUCT')
    const sku = await first(db, `
      SELECT product_skus.id AS sku_id, product_skus.name AS sku_name, product_skus.price,
             product_skus.stock_quantity, products.name AS product_name
      FROM product_skus JOIN products ON products.id = product_skus.product_id
      WHERE products.status = 'ON_SALE' AND (product_skus.product_id = ? OR product_skus.id = ?)
      ORDER BY product_skus.id LIMIT 1
    `, [itemSubjectId, itemSubjectId])
    if (!sku) throw new HttpError(400, '商品暂不可购买')
    if (Number(sku.stock_quantity) < count) throw new HttpError(400, '商品库存不足')
    stockUpdates.push({ skuId: Number(sku.sku_id), quantity: count })
    const price = Number(sku.price || 0)
    orderItems.push({ name_snapshot: sku.sku_name || sku.product_name, unit_price: price, quantity: count, course_id: null, product_sku_id: Number(sku.sku_id), subtotal: Number((price * count).toFixed(2)) })
  }

  const totalAmount = Number(orderItems.reduce((total, item) => total + item.subtotal, 0).toFixed(2))
  const courseItems = orderItems.filter(item => item.course_id)
  let beneficiaryChildId = courseChildId ? Number(courseChildId) : null
  if (courseItems.length) {
    if (beneficiaryChildId) {
      const bound = await first(db, 'SELECT child_id FROM parent_children WHERE parent_user_id = ? AND child_id = ?', [buyerUserId, beneficiaryChildId])
      if (!bound) throw new HttpError(403, '该学员不在您的监护列表中')
    } else {
      const fallback = await first(db, 'SELECT child_id FROM parent_children WHERE parent_user_id = ? ORDER BY id LIMIT 1', [buyerUserId])
      if (!fallback) throw new HttpError(400, '请先绑定学员再购买课程')
      beneficiaryChildId = Number(fallback.child_id)
    }
  }
  const orderId = numericId()
  const orderNoValue = orderNo()
  const now = isoNow()
  const order = { id: orderId, order_no: orderNoValue, buyer_user_id: buyerUserId, total_amount: totalAmount, status: 'PENDING_PAYMENT', idempotency_key: requestKey, course_child_id: beneficiaryChildId, shipping_address_id: null, recipient_name_snapshot: null, recipient_mobile_snapshot: null, shipping_address_snapshot: null }
  if (addressId) {
    const address = await first(db, 'SELECT * FROM shipping_addresses WHERE id = ? AND user_id = ?', [addressId, buyerUserId])
    if (address) {
      order.shipping_address_id = Number(address.id)
      order.recipient_name_snapshot = address.recipient_name
      order.recipient_mobile_snapshot = address.mobile
      order.shipping_address_snapshot = `${address.province}${address.city}${address.district}${address.detail}`
    }
  }

  const decremented = []
  try {
    // 条件扣减库存；若并发请求抢完库存，changes 为 0，立即恢复本次已扣减的 SKU。
    for (const update of stockUpdates) {
      const result = await run(db, 'UPDATE product_skus SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ? AND stock_quantity >= ?', [update.quantity, now, update.skuId, update.quantity])
      if (!changedRows(result)) throw new HttpError(400, '商品库存不足')
      decremented.push(update)
    }

    const statements = [
      { sql: `INSERT INTO orders (id, order_no, buyer_user_id, total_amount, status, idempotency_key, course_child_id, shipping_address_id, recipient_name_snapshot, recipient_mobile_snapshot, shipping_address_snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params: [order.id, order.order_no, order.buyer_user_id, order.total_amount, order.status, order.idempotency_key, order.course_child_id, order.shipping_address_id, order.recipient_name_snapshot, order.recipient_mobile_snapshot, order.shipping_address_snapshot, now, now] },
      ...orderItems.map(item => ({ sql: `INSERT INTO order_items (order_id, product_sku_id, course_id, name_snapshot, unit_price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)`, params: [order.id, item.product_sku_id, item.course_id, item.name_snapshot, item.unit_price, item.quantity, item.subtotal] }))
    ]
    await batch(db, statements)
  } catch (error) {
    for (const update of decremented) await run(db, 'UPDATE product_skus SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?', [update.quantity, isoNow(), update.skuId]).catch(() => undefined)
    if (requestKey && /unique|constraint/i.test(String(error?.message || ''))) {
      const existing = await first(db, 'SELECT * FROM orders WHERE buyer_user_id = ? AND idempotency_key = ?', [buyerUserId, requestKey])
      if (existing) {
        const existingItems = await all(db, 'SELECT id FROM order_items WHERE order_id = ?', [existing.id])
        return { id: Number(existing.id), order_no: existing.order_no, status: existing.status, total_amount: Number(existing.total_amount), item_count: existingItems.length, duplicate: true }
      }
    }
    throw error
  }

  return { id: order.id, order_no: order.order_no, status: order.status, total_amount: order.total_amount, item_count: orderItems.length }
}

async function settleCourseCredits(db, order, operatorUserId) {
  // 课程订单支付后，把课时充值到买家最早绑定的孩子。
  // 流水使用订单明细幂等键，支付回调重试不会重复增加课时。
  const courseItems = await all(db, 'SELECT order_items.*, courses.default_lesson_count, courses.name AS course_name FROM order_items JOIN courses ON courses.id = order_items.course_id WHERE order_items.order_id = ? AND order_items.course_id IS NOT NULL', [order.id])
  const buyerChild = order.course_child_id
    ? { child_id: order.course_child_id }
    : await first(db, 'SELECT child_id FROM parent_children WHERE parent_user_id = ? ORDER BY id LIMIT 1', [order.buyer_user_id])
  if (!buyerChild) return
  for (const item of courseItems) {
    await applyLedger(db, {
      childId: Number(buyerChild.child_id), type: 'PURCHASE', quantity: Number(item.default_lesson_count) * Number(item.quantity),
      reason: `购买课程「${item.course_name}」`, idempotencyKey: `order-${order.id}-item-${item.id}`, operatorUserId
    })
  }
}

export async function payOrder(db, orderId, transactionId, operatorUserId = null, channel = 'MOCK', rawPayload = null) {
  const order = await first(db, 'SELECT * FROM orders WHERE id = ?', [orderId])
  if (!order) throw new HttpError(404, '订单不存在')
  if (order.status === 'PAID') {
    await settleCourseCredits(db, order, operatorUserId)
    return { id: Number(order.id), status: 'PAID' }
  }
  if (order.status !== 'PENDING_PAYMENT') throw new HttpError(400, `订单当前状态为 ${order.status}，无法支付`)
  const now = isoNow()
  const payload = rawPayload || { channel, paidAt: now }
  // 同一个 batch 内先条件更新订单，再按订单状态写入支付记录。
  // 这样支付按钮连点、微信回调重试都只能完成一次状态迁移和一次支付记录。
  const results = await batch(db, [
    { sql: `UPDATE orders SET status = 'PAID', paid_at = ?, updated_at = ? WHERE id = ? AND status = 'PENDING_PAYMENT'`, params: [now, now, order.id] },
    { sql: `INSERT INTO payment_records (order_id, transaction_id, status, amount, raw_payload, created_at, updated_at)
            SELECT ?, ?, 'SUCCESS', ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'PAID')
              AND NOT EXISTS (SELECT 1 FROM payment_records WHERE order_id = ? AND status = 'SUCCESS')`, params: [order.id, transactionId, Number(order.total_amount), JSON.stringify(payload), now, now, order.id, order.id] }
  ])
  if (!changedRows(results[0])) {
    const latest = await first(db, 'SELECT * FROM orders WHERE id = ?', [order.id])
    if (latest?.status === 'PAID') {
      await settleCourseCredits(db, latest, operatorUserId)
      return { id: Number(latest.id), status: 'PAID' }
    }
    throw new HttpError(409, '订单状态已变化，请刷新后重试')
  }
  await settleCourseCredits(db, order, operatorUserId)
  return { id: Number(order.id), status: 'PAID' }
}

export async function restoreOrderStock(db, orderId) {
  const items = await all(db, 'SELECT product_sku_id, quantity FROM order_items WHERE order_id = ? AND product_sku_id IS NOT NULL', [orderId])
  for (const item of items) await run(db, 'UPDATE product_skus SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?', [Number(item.quantity), isoNow(), Number(item.product_sku_id)])
}

export async function cancelOrder(db, orderId) {
  const order = await first(db, 'SELECT id, status FROM orders WHERE id = ?', [orderId])
  if (!order) throw new HttpError(404, '订单不存在')
  if (order.status === 'CANCELLED') return { id: Number(order.id), status: 'CANCELLED' }
  if (order.status !== 'PENDING_PAYMENT') throw new HttpError(400, '仅待支付订单可以取消')
  const items = await all(db, 'SELECT product_sku_id, quantity FROM order_items WHERE order_id = ? AND product_sku_id IS NOT NULL', [orderId])
  const now = isoNow()
  // 库存恢复语句限定订单仍为待支付，并与状态迁移放在同一批次，避免并发取消重复返还库存。
  const statements = items.map(item => ({
    sql: `UPDATE product_skus SET stock_quantity = stock_quantity + ?, updated_at = ?
          WHERE id = ? AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = 'PENDING_PAYMENT')`,
    params: [Number(item.quantity), now, Number(item.product_sku_id), orderId]
  }))
  statements.push({ sql: "UPDATE orders SET status = 'CANCELLED', cancelled_at = ?, updated_at = ? WHERE id = ? AND status = 'PENDING_PAYMENT'", params: [now, now, orderId] })
  const results = await batch(db, statements)
  const statusResult = results[results.length - 1]
  if (!changedRows(statusResult)) {
    const latest = await first(db, 'SELECT status FROM orders WHERE id = ?', [orderId])
    if (latest?.status === 'CANCELLED') return { id: Number(orderId), status: 'CANCELLED' }
    throw new HttpError(409, '订单状态已变化，请刷新后重试')
  }
  return { id: Number(orderId), status: 'CANCELLED' }
}

// 定时释放无人支付的库存，仍复用取消订单的条件更新，避免和支付/用户取消并发时重复回补。
export async function expirePendingOrders(db, ageMinutes = 30) {
  const cutoff = new Date(Date.now() - Math.max(1, Number(ageMinutes) || 30) * 60 * 1000).toISOString()
  const pending = await all(db, "SELECT id FROM orders WHERE status = 'PENDING_PAYMENT' AND julianday(created_at) < julianday(?) ORDER BY id LIMIT 200", [cutoff])
  let expired = 0
  for (const order of pending) {
    try {
      const result = await cancelOrder(db, Number(order.id))
      if (result.status === 'CANCELLED') expired += 1
    } catch (error) {
      // 单笔订单状态可能已被支付回调改变，不能阻塞同一批次其他订单的释放。
      console.warn('expire pending order failed', order.id, error)
    }
  }
  return expired
}
