const { mockState } = require('../../services/api')
Page({
  data: { courses: mockState.courses, selected: 0 },
  selectCourse(e) { this.setData({ selected: Number(e.currentTarget.dataset.index) }) },
  buy(e) { const course = this.data.courses[e.currentTarget.dataset.index]; wx.showModal({ title: '确认报名', content: `${course.name} · ¥${course.price}（演示）`, confirmText: '加入订单', success: r => r.confirm && wx.showToast({ title: '已加入待支付订单', icon: 'success' }) }) }
})
