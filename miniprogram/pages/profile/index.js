Page({
  data: {
    services: [
      { name: '我的订单', url: '/pages/orders/index' },
      { name: '收货地址', url: '/pages/address/index' },
      { name: '画室管理', url: '/pages/admin/index' },
      { name: '管理操作', url: '/pages/admin-ops/index' },
      { name: '订单处理', url: '/pages/admin-orders/index' }
    ]
  },
  openService(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url })
  }
})
