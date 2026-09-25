const { userOrders, confirmReceipt, cancelOrder } = require('../../services/api')
const app = getApp()
const LABELS = { PENDING_PAYMENT: '待支付', PAID: '待发货', SHIPPED: '已发货', COMPLETED: '已完成', CANCELLED: '已取消', REFUNDED: '已退款' }
Page({
  data: { orders: [], loading: true, paymentEnabled: false, loadError: '', busyId: null },
  onShow() { this.setData({ paymentEnabled: app.isPaymentEnabled() }); this.loadData() },
  async loadData() {
    this.setData({ loading: true, loadError: '' })
    try {
      this.userId = await app.ensureLogin()
      if (!this.userId) throw new Error('请登录后查看订单')
      const rows = await userOrders(this.userId)
      this.setData({ orders: rows.map(item => ({
        ...item,
        statusLabel: item.status === 'PAID' && (item.type === 'COURSE' || (item.items || []).some(row => row.course_id || row.type === 'COURSE')) ? '报名成功' : LABELS[item.status] || item.status,
        itemNames: (item.items || []).map(row => row.name || row.name_snapshot).join('、')
      })) })
    } catch (error) { this.setData({ loadError: error.message || '订单加载失败' }) }
    finally { this.setData({ loading: false }) }
  },
  async perform(e, action) {
    if (this.data.busyId) return
    const orderId = e.currentTarget.dataset.id
    this.setData({ busyId: orderId })
    try {
      if (action === 'pay') {
        if (!app.isPaymentEnabled()) return app.showPaymentUnavailable()
        const result = await app.payOrder(orderId)
        wx.showToast({ title: result?.status === 'PENDING_PAYMENT' ? '支付结果确认中' : '支付成功', icon: 'none' })
      } else {
        const confirmed = await new Promise(resolve => wx.showModal({
          title: action === 'cancel' ? '取消订单' : '确认收货',
          content: action === 'cancel' ? '确定取消这笔待支付订单吗？' : '确认已经收到商品吗？',
          success: result => resolve(result.confirm), fail: () => resolve(false)
        }))
        if (!confirmed) return
        if (action === 'cancel') await cancelOrder(orderId, this.userId)
        else await confirmReceipt(orderId, this.userId)
        wx.showToast({ title: action === 'cancel' ? '订单已取消' : '已确认收货', icon: 'success' })
      }
      await this.loadData()
    } catch (error) { wx.showToast({ title: /cancel/i.test(error.errMsg || '') ? '已取消支付' : error.message || '操作失败', icon: 'none' }) }
    finally { this.setData({ busyId: null }) }
  },
  pay(e) { return this.perform(e, 'pay') },
  cancel(e) { return this.perform(e, 'cancel') },
  receive(e) { return this.perform(e, 'receive') },
  copyTracking(e) { wx.setClipboardData({ data: String(e.currentTarget.dataset.tracking) }) },
  goShop() { wx.switchTab({ url: '/pages/shop/index' }) }
})
