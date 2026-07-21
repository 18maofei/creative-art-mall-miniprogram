const { devContext, adminOrders, updateOrderStatus } = require('../../services/api')

Page({
  data: { orders: [] },
  onLoad() { this.loadOrders() },
  async loadOrders() {
    try {
      this.context = await devContext()
      this.setData({ orders: await adminOrders(this.context.adminUserId) })
    } catch (error) { wx.showToast({ title: '订单加载失败', icon: 'none' }) }
  },
  async nextStatus(e) {
    const order = e.currentTarget.dataset.order
    const status = order.status === 'PENDING_PAYMENT' ? 'PAID' : order.status === 'PAID' ? 'SHIPPED' : order.status === 'SHIPPED' ? 'COMPLETED' : ''
    if (!status) return
    const trackingNo = status === 'SHIPPED' ? `MANUAL-${Date.now()}` : undefined
    try {
      await updateOrderStatus(this.context.adminUserId, order.id, status, trackingNo)
      wx.showToast({ title: '订单状态已更新', icon: 'success' })
      this.loadOrders()
    } catch (error) { wx.showToast({ title: '状态更新失败', icon: 'none' }) }
  }
})
