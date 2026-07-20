const { mockState, courses } = require('../../services/api')
Page({
  data: { courses: mockState.courses, selected: 0 },
  onLoad() {
    courses().then(rows => {
      const mapped = rows.map(item => item.default_lesson_count ? ({ id: item.id, name: item.name, age: item.age_range, lessons: item.default_lesson_count, schedule: '请向画室咨询排课', price: Number(item.price), color: 'sand', description: item.description }) : item)
      this.setData({ courses: mapped })
    }).catch(() => wx.showToast({ title: '课程加载失败', icon: 'none' }))
  },
  selectCourse(e) { this.setData({ selected: Number(e.currentTarget.dataset.index) }) },
  buy(e) { const course = this.data.courses[e.currentTarget.dataset.index]; wx.showModal({ title: '确认报名', content: `${course.name} · ¥${course.price}（演示）`, confirmText: '加入订单', success: r => r.confirm && wx.showToast({ title: '已加入待支付订单', icon: 'success' }) }) }
})
