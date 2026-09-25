const { artworks, recordEvent } = require('../../services/api')
const app = getApp()
const favorites = require('../../services/favorites.js')

Page({
  data: {
    allItems: [],
    items: [],
    loading: true,
    error: ''
  },

  onLoad() {
    this.loadData()
  },

  onShow() {
    recordEvent('page_view', 'gallery', 'VISITOR')
    if (this.data.allItems.length) this.refreshFavorites()
  },

  async loadData() {
    this.setData({ loading: true, error: '' })
    try {
      const [rows, user] = await Promise.all([
        artworks('ARTWORK'),
        app.refreshUser().catch(() => null)
      ])
      const allItems = this.filterItems(this.decorateFavorites(rows, user?.id))
      this.setData({
        allItems,
        items: allItems,
        loading: false,
        error: ''
      })
    } catch (error) {
      this.setData({ loading: false, error: '请检查网络后重试' })
    }
  },

  decorateFavorites(rows, userId) {
    const ids = new Set(
      (userId ? favorites.list(userId) : [])
        .filter(item => item.type === 'ARTWORK')
        .map(item => Number(item.id))
    )
    return (rows || []).map(item => ({
      ...item,
      isFavorite: ids.has(Number(item.id)),
      imageError: false
    }))
  },

  async refreshFavorites() {
    const user = await app.refreshUser().catch(() => null)
    const allItems = this.filterItems(this.decorateFavorites(this.data.allItems, user?.id))
    this.setData({
      allItems,
      items: allItems
    })
  },

  filterItems(items) {
    return (items || []).filter(item => (item.kind || 'ARTWORK') === 'ARTWORK')
  },

  openArtwork(e) {
    const artworkId = Number(e.currentTarget.dataset.id)
    const artwork = this.data.allItems.find(item => Number(item.id) === artworkId)
    if (!artwork || !artwork.image_url || artwork.imageError) {
      wx.showToast({ title: '暂无可预览的作品', icon: 'none' })
      return
    }
    wx.previewImage({ current: artwork.image_url, urls: [artwork.image_url] })
  },

  handleImageError(e) {
    const artworkId = Number(e.currentTarget.dataset.id)
    const allItems = this.data.allItems.map(item => (
      Number(item.id) === artworkId ? { ...item, imageError: true } : item
    ))
    this.setData({ allItems, items: allItems })
  },

  async toggleFavorite(e) {
    const artworkId = Number(e.currentTarget.dataset.id)
    const userId = await app.ensureLogin()
    if (!userId) return wx.showToast({ title: '请先登录', icon: 'none' })
    const artwork = this.data.allItems.find(item => Number(item.id) === artworkId)
    if (!artwork) return

    const result = favorites.toggle(userId, {
      type: 'ARTWORK',
      id: artwork.id,
      title: artwork.title || '未命名作品',
      subtitle: artwork.student_name || '课程作品',
      imageUrl: artwork.image_url
    })
    const allItems = this.data.allItems.map(item => (
      Number(item.id) === artworkId ? { ...item, isFavorite: result.added } : item
    ))
    this.setData({
      allItems,
      items: allItems
    })
    wx.showToast({ title: result.added ? '已加入收藏' : '已取消收藏', icon: 'none' })
  }
})
