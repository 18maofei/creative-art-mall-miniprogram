const { userDashboard, userFeedback, announcements, recordEvent } = require('../../services/api')
const app = getApp()

Page({
  data: { students: [], child: null, lessons: [], nextSession: null, feedback: [], notices: [], loading: true, loadError: '' },
  onShow() {
    recordEvent('page_view', 'parent_dashboard', 'PARENT')
    this.loadData()
  },
  async loadData() {
    this.setData({ loading: true, loadError: '' })
    const userId = await app.ensureLogin()
    if (!userId) {
      this.setData({ loading: false, loadError: '请登录后查看学习记录' })
      return
    }
    if (!app.hasPermission('child.read')) return this.setData({ students: [], child: null, lessons: [], nextSession: null, feedback: [], notices: [], loading: false })
    try {
      const [data, feedback, notices] = await Promise.all([
        userDashboard(userId),
        userFeedback(userId).catch(() => []),
        announcements('PARENT').catch(() => [])
      ])
      const students = (data.students || []).map(item => ({ ...item, remainingLessons: item.remaining_lessons }))
      const lessons = data.sessions || []
      this.setData({
        students,
        child: students[0] || null,
        lessons,
        nextSession: lessons[0] || null,
        feedback: feedback.slice(0, 3),
        notices: notices.slice(0, 2),
        loading: false
      })
    } catch (error) { this.setData({ loading: false, loadError: error.message || '学习数据加载失败' }) }
  },
  goSchedule() { wx.navigateTo({ url: '/pages/class-schedule/index?role=PARENT' }) },
  goCourse() { wx.switchTab({ url: '/pages/course/index' }) },
  goShop() { wx.switchTab({ url: '/pages/shop/index' }) },
  goGallery() { wx.navigateTo({ url: '/pages/gallery/index' }) },
  goLeave() { wx.navigateTo({ url: '/pages/leave/index' }) },
  goAddress() { wx.navigateTo({ url: '/pages/address/index' }) },
  goLedger() { wx.navigateTo({ url: '/pages/lesson-ledger/index' }) },
  goProfile() { wx.switchTab({ url: '/pages/profile/index' }) },
  goHome() { wx.switchTab({ url: '/pages/home/index' }) }
})
