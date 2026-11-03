const { artworks, recordEvent, setArtworkLike } = require('../../services/api')
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
    if (this.data.allItems.length) this.loadData()
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

  filterItems(items) {
    return (items || []).filter(item => (item.kind || 'ARTWORK') === 'ARTWORK')
  },

  openArtwork(e) {
    const artworkId = Number(e.currentTarget.dataset.id)
    if (!this.data.allItems.some(item => Number(item.id) === artworkId)) {
      wx.showToast({ title: '作品不存在', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/artwork-detail/index?id=${encodeURIComponent(artworkId)}` })
  },

  async toggleLike(e) {
    const artworkId = Number(e.currentTarget.dataset.id)
    const artwork = this.data.allItems.find(item => Number(item.id) === artworkId)
    if (!artwork || artwork.likePending) return
    const userId = await app.ensureLogin()
    if (!userId) return wx.showToast({ title: '登录后即可点赞', icon: 'none' })
    const liked = !artwork.liked_by_me
    const allItems = this.data.allItems.map(item => Number(item.id) === artworkId ? {
      ...item,
      liked_by_me: liked,
      likePending: true,
      likes_count: Math.max(0, Number(item.likes_count || 0) + (liked ? 1 : -1))
    } : item)
    this.setData({ allItems, items: allItems })
    try {
      const result = await setArtworkLike(artworkId, liked)
      const updated = this.data.allItems.map(item => Number(item.id) === artworkId ? {
        ...item, liked_by_me: result.liked, likes_count: Number(result.likes_count || 0), likePending: false
      } : item)
      this.setData({ allItems: updated, items: updated })
    } catch (error) {
      const restored = this.data.allItems.map(item => Number(item.id) === artworkId ? {
        ...item, liked_by_me: artwork.liked_by_me, likes_count: Number(artwork.likes_count || 0), likePending: false
      } : item)
      this.setData({ allItems: restored, items: restored })
      wx.showToast({ title: error.message || '点赞失败，请重试', icon: 'none' })
    }
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
