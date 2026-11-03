const { userDashboard, teacherSessions, recordEvent } = require('../../services/api')
const app = getApp()
Page({
  data: { roleLabel: '学习日历', pageTitle: '我的课表', canBuy: true, emptyText: '暂无课程安排，报名并关联学员后可在这里查看', sessions: [], loading: true, loadError: '' },
  onShow() { recordEvent('page_view', 'class_schedule', app.globalData.currentRole || 'CUSTOMER'); this.loadData() },
  async loadData() {
    this.setData({ loading: true, loadError: '' })
    try {
      const userId = await app.ensureLogin()
      if (!userId) throw new Error('请登录后查看课表')
      const user = app.globalData.user || await app.refreshUser()
      const role = app.serverRole(user?.currentRole)
      if (role === 'TEACHER') {
        const sessions = await teacherSessions(userId)
        this.setData({ sessions, roleLabel: '教师排课', pageTitle: '我的排课', canBuy: false, emptyText: '暂无分配给您的课程' })
      } else if (app.hasPermission('child.read')) {
        const sessions = (await userDashboard(userId)).sessions || []
        this.setData({ sessions, roleLabel: '学习日历', pageTitle: '我的课表', canBuy: true, emptyText: '暂无课程安排，报名并关联学员后可在这里查看' })
      } else {
        this.setData({ sessions: [], roleLabel: '学习日历', pageTitle: '我的课表', canBuy: true, emptyText: '关联学员后可查看课程安排' })
      }
    } catch (error) { this.setData({ loadError: error.message || '课表加载失败' }) }
    finally { this.setData({ loading: false }) }
  },
  goCourse() { wx.switchTab({ url: '/pages/course/index' }) }
})
