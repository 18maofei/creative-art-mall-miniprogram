const { adminOverview, adminChildren, adminClasses } = require('../../services/api')
const app = getApp()

Page({
  data: {
    overview: { children: 0, activeClasses: 0, scheduledSessions: 0, pendingOrders: 0 },
    children: [],
    classes: [],
    loading: true
  },
  onLoad() {
    this.loadData()
  },
  onPullDownRefresh() {
    this.loadData(true)
  },
  async loadData(withRefresh) {
    this.setData({ loading: true })
    try {
      const staff = await app.ensureStaff()
      if (!staff) throw new Error('当前账号没有后台身份')
      const [overview, children, classes] = await Promise.all([
        adminOverview(),
        adminChildren(),
        adminClasses()
      ])
      this.setData({
        overview,
        children: children.map(item => ({ ...item, initial: String(item.name || '').slice(0, 1) })),
        classes: classes.map(item => ({ ...item, teacherLabel: item.teacher_name || '待分配老师', campusLabel: `${item.campus || '未设置校区'} ${item.room || ''}`.trim() })),
        loading: false
      })
    } catch (error) {
      this.setData({ loading: false })
      wx.showToast({ title: '加载管理数据失败', icon: 'none' })
    } finally {
      if (withRefresh) wx.stopPullDownRefresh()
    }
  },
  openStudent(e) {
    const student = e.currentTarget.dataset.student
    wx.showModal({ title: student.name, content: `剩余 ${student.remaining_lessons} 次课时`, showCancel: false })
  },
  openLeaves() {
    wx.navigateTo({ url: '/pages/admin-leaves/index' })
  }
})
