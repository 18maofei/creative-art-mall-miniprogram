const { courses, artworks, recordEvent } = require('../../services/api')
const app = getApp()

Page({
  data: { userName: '同学', courses: [], artworks: [], loading: true },
  async onShow() {
    const user = await app.refreshUser().catch(() => null)
    if (!user) {
      this.setData({ loading: false })
      return wx.showToast({ title: '请先登录', icon: 'none' })
    }
    recordEvent('page_view', 'student_dashboard', app.serverRole(user.currentRole) === 'STUDENT' ? 'STUDENT' : 'CUSTOMER')
    try {
      const [courseRows, artworkRows] = await Promise.all([courses().catch(() => []), artworks().catch(() => [])])
      this.setData({ userName: user.name || '同学', courses: courseRows.slice(0, 3), artworks: artworkRows.slice(0, 4), loading: false })
    } catch {
      this.setData({ loading: false })
      wx.showToast({ title: '学生数据加载失败', icon: 'none' })
    }
  },
  goCourse() { wx.switchTab({ url: '/pages/course/index' }) },
  goGallery() { wx.navigateTo({ url: '/pages/gallery/index' }) },
  goProfile() { wx.switchTab({ url: '/pages/profile/index' }) },
  openCourse(e) { wx.navigateTo({ url: `/pages/course-detail/index?id=${e.currentTarget.dataset.id}` }) }
})
