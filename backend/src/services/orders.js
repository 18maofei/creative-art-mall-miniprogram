import { db } from '../knex.js'
import { applyLedger } from './lessons.js'

function orderNo() {
  return `ZX${Date.now()}${Math.floor(Math.random() * 900 + 100)}`
}

const TRANSITIONS = {
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  // 退款必须先调用支付渠道并记录退款流水，不能只改订单状态伪造退款。
  PAID: ['SHIPPED', 'COMPLETED'],
  SHIPPED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: []
}

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to)
}

export async function createOrder({ buyerUserId, type, subjectId, quantity = 1, addressId = null, courseChildId = null, items = null }) {
  // 兼容单件下单，同时允许购物车一次提交多个商品 SKU。
  const requestedItems = Array.isArray(items) && items.length ? items : [{ type, subjectId, quantity }]
  if (requestedItems.length > 50) throw new Error('单笔订单最多包含 50 个商品')
  return db.transaction(async trx => {
    const orderItems = []
    for (const requested of requestedItems) {
      const itemType = requested.type || type
      const itemSubjectId = Number(requested.subjectId ?? subjectId)
      const count = Math.max(1, Math.floor(Number(requested.quantity) || 1))
      if (!Number.isInteger(itemSubjectId) || itemSubjectId < 1) throw new Error('商品或课程 ID 不正确')
      if (itemType === 'COURSE') {
        const course = await trx('courses').where({ id: itemSubjectId, status: 'ON_SALE' }).first()
        if (!course) throw new Error('课程暂不可购买')
        orderItems.push({ name_snapshot: course.name, unit_price: Number(course.price), quantity: count, course_id: course.id, product_sku_id: null, subtotal: Number(course.price) * count })
        continue
      }
      if (itemType !== 'PRODUCT') throw new Error('type must be COURSE or PRODUCT')
      const sku = await trx('product_skus')
        .join('products', 'products.id', 'product_skus.product_id')
        .where('products.status', 'ON_SALE')
        .where(builder => builder.where('product_skus.product_id', itemSubjectId).orWhere('product_skus.id', itemSubjectId))
        .orderBy('product_skus.id')
        .forUpdate()
        .first('product_skus.id AS sku_id', 'product_skus.name AS sku_name', 'product_skus.price', 'product_skus.stock_quantity', 'products.name AS product_name')
      if (!sku) throw new Error('商品暂不可购买')
      if (Number(sku.stock_quantity) < count) throw new Error('商品库存不足')
      await trx('product_skus').where('id', sku.sku_id).decrement('stock_quantity', count)
      orderItems.push({ name_snapshot: sku.sku_name || sku.product_name, unit_price: Number(sku.price), quantity: count, course_id: null, product_sku_id: sku.sku_id, subtotal: Number(sku.price) * count })
    }

    const totalAmount = orderItems.reduce((total, item) => total + item.subtotal, 0)
    let beneficiaryChildId = null
    if (orderItems.some(item => item.course_id)) {
      if (courseChildId) {
        const bound = await trx('parent_children').where({ parent_user_id: buyerUserId, child_id: courseChildId }).first('child_id')
        if (!bound) throw new Error('该学员不在您的监护列表中')
        beneficiaryChildId = bound.child_id
      } else {
        const firstChild = await trx('parent_children').where('parent_user_id', buyerUserId).orderBy('id').first('child_id')
        if (!firstChild) throw new Error('购买课程前需要先关联学员')
        beneficiaryChildId = firstChild.child_id
      }
    }
    const order = {
      order_no: orderNo(),
      buyer_user_id: buyerUserId,
      course_child_id: beneficiaryChildId,
      total_amount: totalAmount,
      status: 'PENDING_PAYMENT'
    }
    if (addressId) {
      const address = await trx('shipping_addresses').where({ id: addressId, user_id: buyerUserId }).first()
      if (address) {
        order.shipping_address_id = address.id
        order.recipient_name_snapshot = address.recipient_name
        order.recipient_mobile_snapshot = address.mobile
        order.shipping_address_snapshot = `${address.province}${address.city}${address.district}${address.detail}`
      }
    }
    const [orderId] = await trx('orders').insert(order)
    await trx('order_items').insert(orderItems.map(item => ({ ...item, order_id: orderId })))
    return { id: Number(orderId), order_no: order.order_no, status: order.status, total_amount: order.total_amount, item_count: orderItems.length }
  })
}

// 真实微信支付回调未来同样调用本函数，业务层无需改动。
export async function payOrder(trx, orderId, transactionId, operatorUserId = null) {
  const order = await trx('orders').where('id', orderId).forUpdate().first()
  if (!order) throw new Error('订单不存在')
  if (order.status !== 'PENDING_PAYMENT') throw new Error(`订单当前状态为 ${order.status}，无法支付`)

  await trx('payment_records').insert({
    order_id: order.id,
    transaction_id: transactionId,
    status: 'SUCCESS',
    amount: order.total_amount,
    raw_payload: JSON.stringify({ channel: 'MOCK', paidAt: new Date().toISOString() })
  })
  await trx('orders').where('id', order.id).update({ status: 'PAID', paid_at: trx.fn.now(), updated_at: trx.fn.now() })

  // 课程订单支付成功后自动发课时；分班由管理端报名操作完成。
  const items = await trx('order_items').where('order_id', order.id).whereNotNull('course_id')
  for (const item of items) {
    const course = await trx('courses').where('id', item.course_id).first('default_lesson_count', 'name')
    const buyer = order.course_child_id
      ? { child_id: order.course_child_id }
      : await trx('parent_children').where('parent_user_id', order.buyer_user_id).orderBy('id').first('child_id')
    if (!course || !buyer) continue
    await applyLedger(trx, {
      childId: buyer.child_id,
      type: 'PURCHASE',
      quantity: Number(course.default_lesson_count) * Number(item.quantity),
      reason: `购买课程「${course.name}」`,
      idempotencyKey: `order-${order.id}-item-${item.id}`,
      operatorUserId
    })
  }
  return { id: Number(order.id), status: 'PAID' }
}
