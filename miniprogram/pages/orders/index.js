const { devContext, userOrders } = require('../../services/api')

Page({
  data: { orders: [] },
  onLoad() { this.loadOrders() },
  async loadOrders() {
    try {
      const context = await devContext()
      const orders = await userOrders(context.parentUserId)
      this.setData({ orders })
    } catch (error) {
      wx.showToast({ title: '订单加载失败', icon: 'none' })
    }
  }
})
