Page({
  data: { services: ['我的订单', '预约试听', '孩子管理', '联系客服'] },
  tapService(e) { wx.showToast({ title: `${e.currentTarget.dataset.name}开发中`, icon: 'none' }) }
})
