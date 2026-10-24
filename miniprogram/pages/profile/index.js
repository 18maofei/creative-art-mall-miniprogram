const app = getApp()
const api = require('../../services/api.js')
const favorites = require('../../services/favorites.js')

const GUEST_SHORTCUTS = [
  { key: 'study', icon: '▱', label: '我的学习', copy: '登录后查看' },
  { key: 'appointment', icon: '▦', label: '我的预约', copy: '登录后查看' },
  { key: 'artwork', icon: '✦', label: '创作展廊', copy: '登录后查看' }
]

const MEMBER_ACTIONS = [
  { key: 'study', icon: '▱', title: '我的学习', copy: '课程、预约、学习记录' },
  { key: 'appointment', icon: '◷', title: '我的预约', copy: '查看试听安排与确认进度' },
  { key: 'notifications', icon: '•', title: '消息通知', copy: '查看预约审核和服务提醒' },
  { key: 'favorite', icon: '★', title: '我的收藏', copy: '课程与作品收藏' },
  { key: 'order', icon: '▣', title: '我的订单', copy: '查看订单状态与物流' },
  { key: 'address', icon: '⌖', title: '收货地址', copy: '管理收货地址信息' },
  { key: 'settings', icon: '⚙', title: '设置', copy: '个人资料与账号管理' }
]

function confirmLogin() {
  return new Promise(resolve => {
    wx.showModal({
      title: '登录后查看',
      content: '登录后可保存学习记录、收藏内容和订单信息。',
      confirmText: '微信登录',
      success: result => resolve(Boolean(result.confirm)),
      fail: () => resolve(false)
    })
  })
}

Page({
  data: {
    brandName: '纯粹艺术文化',
    loggedIn: false,
    loggingIn: false,
    displayName: '艺术好朋友',
    avatarUrl: '',
    avatarInitial: '艺',
    roleLabel: '艺术爱好者',
    courseCount: 0,
    favoriteCount: 0,
    notificationCount: 0,
    guestShortcuts: GUEST_SHORTCUTS,
    memberActions: MEMBER_ACTIONS
  },
  onShow() { this.loadProfile() },
  async loadProfile(preloadedUser) {
    const user = preloadedUser || await app.refreshUser().catch(() => null)
    if (!user) {
      if (this.data.loggingIn) return
      this.setData({
        loggedIn: false, displayName: '艺术好朋友', avatarUrl: '', avatarInitial: '艺', roleLabel: '艺术爱好者',
        courseCount: 0, favoriteCount: 0, notificationCount: 0
      })
      return
    }
    const name = user.name || '微信用户'
    const courseCount = await this.learnedCourseCount(user)
    let notificationCount = 0
    try { notificationCount = Number((await api.notifications(1)).unreadCount || 0) } catch {}
    this.setData({
      loggedIn: true,
      displayName: name,
      avatarUrl: api.mediaUrl(user.avatarUrl || user.avatar_url || ''),
      avatarInitial: name.slice(0, 1) || '微',
      roleLabel: this.roleLabel(),
      courseCount,
      favoriteCount: favorites.list(user.id).length,
      notificationCount
    })
  },
  roleLabel() { return '艺术爱好者' },
  async learnedCourseCount(user) {
    if (!app.hasRole('PARENT')) return 0
    try {
      const dashboard = await api.userDashboard(user.id)
      return new Set((dashboard.sessions || []).map(item => String(item.course_title || item.class_id || item.id))).size
    } catch {
      return 0
    }
  },
  async ensureLoggedIn(askFirst, phoneCode) {
    if (this.data.loggingIn) return null
    if (askFirst && !await confirmLogin()) return null
    this.setData({ loggingIn: true })
    wx.showLoading({ title: '登录中' })
    try {
      const existing = await app.refreshUser().catch(() => null)
      if (existing) {
        await this.loadProfile(existing)
        if (typeof app.redirectToRolePage === 'function') await app.redirectToRolePage(existing)
        return existing
      }
      const user = await app.login(undefined, phoneCode)
      // 登录接口已经返回完整用户资料，避免紧接着刷新失败把成功状态覆盖掉。
      await this.loadProfile(user)
      if (typeof app.redirectToRolePage === 'function') await app.redirectToRolePage(user)
      return user
    } catch (error) {
      wx.showModal({ title: '登录失败', content: String(error?.message || error?.errMsg || '登录失败'), showCancel: false })
      return null
    } finally {
      wx.hideLoading()
      this.setData({ loggingIn: false })
    }
  },
  async login() { await this.ensureLoggedIn(false) },
  async getPhoneNumber(e) {
    const phoneCode = String(e.detail?.code || '').trim()
    if (!phoneCode) {
      wx.showToast({ title: '未授权手机号，可选择暂不授权登录', icon: 'none' })
      return
    }
    await this.ensureLoggedIn(false, phoneCode)
  },
  async openGuestShortcut(e) {
    const user = await this.ensureLoggedIn(true)
    if (user) this.openAction(e.currentTarget.dataset.key)
  },
  openMemberAction(e) { this.openAction(e.currentTarget.dataset.key) },
  openSettings() { wx.navigateTo({ url: '/pages/settings/index' }) },
  openAction(key) {
    if (key === 'study') return this.goLearning()
    if (key === 'appointment') return this.goAppointments()
    if (key === 'notifications') return wx.navigateTo({ url: '/pages/notifications/index' })
    if (key === 'artwork') return wx.navigateTo({ url: '/pages/gallery/index' })
    if (key === 'favorite') return wx.navigateTo({ url: '/pages/favorites/index' })
    if (key === 'order') return wx.navigateTo({ url: '/pages/orders/index' })
    if (key === 'address') return wx.navigateTo({ url: '/pages/address/index' })
    if (key === 'settings') return this.openSettings()
  },
  goLearning() { wx.switchTab({ url: '/pages/home/index' }) },
  goAppointments() { wx.navigateTo({ url: '/pages/trial-appointments/index' }) }
})
