const { userDashboard, recordEvent } = require('../../services/api')
const app = getApp()
Page({
  data: { roleLabel: '学习日历', pageTitle: '我的课表', canBuy: true, sessions: [], loading: true, loadError: '' },
  onShow() { recordEvent('page_view', 'class_schedule', 'CUSTOMER'); this.loadData() },
  async loadData() {
    this.setData({ loading: true, loadError: '' })
    try {
      const userId = await app.ensureLogin()
      if (!userId) throw new Error('请登录后查看课表')
      const sessions = app.hasPermission('child.read') ? (await userDashboard(userId)).sessions || [] : []
      this.setData({ sessions })
    } catch (error) { this.setData({ loadError: error.message || '课表加载失败' }) }
    finally { this.setData({ loading: false }) }
  },
  goCourse() { wx.switchTab({ url: '/pages/course/index' }) }
})
