const app = getApp()

const routes = { visitor: '/pages/home/index', parent: '/pages/parent/index', teacher: '/pages/teacher/index', student: '/pages/student/index', operator: '/pages/admin/index', admin: '/pages/admin/index' }
const config = {
  parent: { style: 'parent', icon: '家', title: '家长端', desc: '查看孩子课表、课时、请假与订单' },
  teacher: { style: 'teacher', icon: '师', title: '教师端', desc: '处理排课、考勤与课堂反馈' },
  student: { style: 'student', icon: '生', title: '学生端', desc: '查看自己的课程、作品与学习反馈' },
  operator: { style: 'operator', icon: '运', title: '运营端', desc: '管理课程、学员、订单与内容' },
  admin: { style: 'admin', icon: '管', title: '管理端', desc: '配置身份、权限与系统安全策略' }
}

Page({
  data: { current: 'visitor', roles: [], loading: true, loggedIn: false, singleRole: false },
  async onShow() {
    this.setData({ loading: true })
    let user = null
    try { user = await app.refreshUser() } catch { user = null }
    const roles = user ? app.availableRoles().map(item => {
      const code = String(item.code || '').toLowerCase()
      return { id: code, ...config[code], status: item.status || 'active' }
    }).filter(item => item.title) : []
    this.setData({ current: user ? String(user.currentRole || '').toLowerCase() : 'visitor', roles, loggedIn: Boolean(user), singleRole: roles.length === 1, loading: false })
  },
  async select(e) {
    const role = String(e.currentTarget.dataset.role || '').toLowerCase()
    if (role === 'visitor') { app.logout(); wx.reLaunch({ url: routes.visitor }); return }
    wx.showLoading({ title: '验证身份' })
    try {
      await app.switchRole(role)
      wx.reLaunch({ url: routes[role] || routes.parent })
    } catch (error) {
      wx.showToast({ title: error.message || '身份验证失败', icon: 'none' })
    } finally { wx.hideLoading() }
  }
})
