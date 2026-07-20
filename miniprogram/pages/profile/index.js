Page({
  data: { services: ['我的订单', '预约试听', '孩子管理', '画室管理', '联系客服'] },
  tapService(e) {
    const name = e.currentTarget.dataset.name
    if (name === '画室管理') return wx.navigateTo({ url: '/pages/admin/index' })
    wx.showToast({ title: `${name}开发中`, icon: 'none' })
  }
})
