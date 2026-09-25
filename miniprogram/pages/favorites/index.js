const app = getApp()
const favorites = require('../../services/favorites.js')

function typeLabel(type) {
  return type === 'COURSE' ? '课程' : '作品'
}

Page({
  data: { items: [], loading: true, loadError: '' },
  onShow() { this.loadData() },
  async loadData() {
    this.setData({ loading: true, loadError: '' })
    const userId = await app.ensureLogin()
    if (!userId) {
      this.setData({ items: [], loading: false, loadError: '请登录后查看收藏' })
      return
    }
    this.userId = userId
    const items = favorites.list(userId).map(item => ({ ...item, typeLabel: typeLabel(item.type) }))
    this.setData({ items, loading: false })
  },
  open(e) {
    const item = e.currentTarget.dataset.item
    if (!item) return
    if (item.type === 'COURSE') wx.navigateTo({ url: `/pages/course-detail/index?id=${item.id}` })
    else if (item.imageUrl) wx.previewImage({ current: item.imageUrl, urls: [item.imageUrl] })
    else wx.navigateTo({ url: '/pages/gallery/index' })
  },
  remove(e) {
    const item = e.currentTarget.dataset.item
    if (!item || !this.userId) return
    favorites.remove(this.userId, item.type, item.id)
    this.setData({ items: this.data.items.filter(row => row.key !== item.key) })
    wx.showToast({ title: '已取消收藏', icon: 'none' })
  }
})
