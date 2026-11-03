const { adminOrders, updateOrderStatus, refundOrder } = require('../../services/api')
const app = getApp()

Page({
  data: { orders: [], loading: true, loadError: '', shippingOrderId: '', trackingNo: '', canManualPay: app.globalData.paymentMode === 'mock' },
  onLoad() { this.loadOrders() },
  onPullDownRefresh() { this.loadOrders().finally(() => wx.stopPullDownRefresh()) },
  async loadOrders() {
    this.setData({ loading: true, loadError: '' })
    try {
      this.staff = await app.ensureStaff()
      if (!this.staff) throw new Error('当前账号没有后台身份')
      this.setData({ orders: await adminOrders() })
    } catch (error) {
      this.setData({ loadError: error.message || '订单加载失败' })
    } finally { this.setData({ loading: false }) }
  },
  beginShipping(e) {
    const order = e.currentTarget.dataset.order
    if (!order || order.status !== 'PAID' || order.type === 'COURSE') return
    this.setData({ shippingOrderId: order.id, trackingNo: '' })
  },
  onTrackingInput(e) { this.setData({ trackingNo: e.detail.value }) },
  async ship() {
    const orderId = this.data.shippingOrderId
    const trackingNo = String(this.data.trackingNo || '').trim()
    if (!orderId || !trackingNo) return wx.showToast({ title: '请填写真实物流单号', icon: 'none' })
    try {
      await updateOrderStatus(undefined, orderId, 'SHIPPED', trackingNo)
      this.setData({ shippingOrderId: '', trackingNo: '' })
      wx.showToast({ title: '已登记发货', icon: 'success' })
      await this.loadOrders()
    } catch (error) { wx.showToast({ title: error.message || '发货登记失败', icon: 'none' }) }
  },
  async refund(e) {
    const order = e.currentTarget.dataset.order
    if (!order || !order.refundSupported || !['PAID', 'SHIPPED', 'COMPLETED'].includes(order.status) || ['PROCESSING', 'SUCCESS'].includes(order.refund_status)) return
    const confirmed = await new Promise(resolve => wx.showModal({
      title: '申请微信退款',
      content: `确认对订单 ${order.order_no} 发起全额退款？退款结果以微信回调为准。`,
      confirmText: '申请退款',
      success: result => resolve(result.confirm),
      fail: () => resolve(false)
    }))
    if (!confirmed) return
    try {
      const result = await refundOrder(undefined, order.id, '后台审核退款')
      wx.showToast({ title: result.refundStatus === 'SUCCESS' ? '退款已完成' : '退款处理中', icon: 'none' })
      await this.loadOrders()
    } catch (error) { wx.showToast({ title: error.message || '退款申请失败', icon: 'none' }) }
  },
  async nextStatus(e) {
    const order = e.currentTarget.dataset.order
    if (!this.data.canManualPay || order?.status !== 'PENDING_PAYMENT') return
    try {
      await updateOrderStatus(undefined, order.id, 'PAID')
      wx.showToast({ title: '模拟支付已确认', icon: 'success' })
      await this.loadOrders()
    } catch (error) { wx.showToast({ title: error.message || '状态更新失败', icon: 'none' }) }
  }
})
