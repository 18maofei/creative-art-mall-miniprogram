const app = getApp()
const api = require('../../services/api.js')

Page({
  data: { items: [], unreadCount: 0, loading: true, loadError: '', marking: false },
  onShow() { this.loadData() },
  async loadData() {
    this.setData({ loading: true, loadError: '' })
    const userId = await app.ensureLogin()
    if (!userId) {
      this.setData({ loading: false, loadError: '请登录后查看消息' })
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    try {
      const result = await api.notifications(100)
      this.setData({ items: (result.items || []).map(item => ({ ...item, createdLabel: this.formatTime(item.createdAt) })), unreadCount: Number(result.unreadCount || 0), loading: false })
    } catch (error) {
      this.setData({ loading: false, loadError: error.message || '消息加载失败' })
    }
  },
  formatTime(value) {
    const date = new Date(String(value || '').replace(' ', 'T'))
    if (Number.isNaN(date.getTime())) return value || ''
    return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  },
  async markRead(event) {
    const id = Number(event.currentTarget.dataset.id)
    const item = this.data.items.find(row => row.id === id)
    if (!id || !item || item.read || this.data.marking) return
    this.setData({ marking: true })
    try {
      await api.markNotificationRead(id)
      this.setData({ items: this.data.items.map(row => row.id === id ? { ...row, read: true } : row), unreadCount: Math.max(0, this.data.unreadCount - 1) })
    } catch (error) {
      wx.showToast({ title: error.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ marking: false })
    }
  },
  async markAllRead() {
    if (!this.data.unreadCount || this.data.marking) return
    this.setData({ marking: true })
    try {
      await api.markAllNotificationsRead()
      this.setData({ items: this.data.items.map(row => ({ ...row, read: true })), unreadCount: 0 })
      wx.showToast({ title: '已全部读完', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message || '操作失败', icon: 'none' })
    } finally {
      this.setData({ marking: false })
    }
  },
  retry() { this.loadData() }
})
