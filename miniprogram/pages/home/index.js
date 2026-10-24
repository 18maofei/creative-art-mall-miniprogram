const { bootstrap, announcements, recordEvent } = require('../../services/api')
const app = getApp()

Page({
  data: {
    courses: [], artworks: [], notices: [], loading: true, loadError: ''
  },
  onLoad() { this.loadData() },
  async onShow() {
    const user = await app.refreshUser().catch(() => null)
    if (user && typeof app.serverRole === 'function' && app.serverRole(user.currentRole) === 'TEACHER' && typeof app.redirectToRolePage === 'function') {
      await app.redirectToRolePage(user)
      return
    }
    const currentRole = String(user?.currentRole || '').toUpperCase()
    recordEvent('page_view', 'home', currentRole || 'VISITOR')
  },
  async loadData() {
    this.setData({ loading: true, loadError: '' })
    try {
      const [data, notices] = await Promise.all([bootstrap(), announcements().catch(() => [])])
      const courses = (data.courses || []).map(item => ({
        ...item,
        name: item.title,
        age: item.age_range || '适龄学员',
        lessons: item.sessions || 0,
        cover: item.cover_url || ''
      }))
      this.setData({ courses, artworks: data.artworks || [], notices: (notices || []).slice(0, 2), loading: false })
    } catch (error) { this.setData({ loading: false, loadError: error.message || '内容加载失败，请重试' }) }
  },
  goCourse() { wx.switchTab({ url: '/pages/course/index' }) },
  goShop() { wx.switchTab({ url: '/pages/shop/index' }) },
  openCourse(e) { wx.navigateTo({ url: `/pages/course-detail/index?id=${e.currentTarget.dataset.id}` }) },
  goGallery() { wx.navigateTo({ url: '/pages/gallery/index' }) },
  reserve() { wx.navigateTo({ url: '/pages/trial-appointment/index' }) }
})
