const { courses, recordEvent } = require('../../services/api')
const app = getApp()
const favorites = require('../../services/favorites.js')

Page({
  data: { allCourses: [], courses: [], categories: [{ value: 'ALL', label: '全部课程' }], selected: 'ALL', keyword: '', loading: true, loadError: '' },
  onLoad() { this.loadData() },
  onShow() {
    recordEvent('page_view', 'course_list', 'VISITOR')
    if (this.data.allCourses.length) this.refreshFavorites()
  },
  async loadData() {
    this.setData({ loading: true, loadError: '' })
    try {
      const [list, user] = await Promise.all([courses(), app.refreshUser().catch(() => null)])
      const allCourses = this.decorateFavorites(list, user?.id)
      const categoryMap = new Map()
      allCourses.forEach(item => { if (item.category) categoryMap.set(item.category, item.category) })
      const categories = [{ value: 'ALL', label: '全部课程' }, ...[...categoryMap.values()].map(value => ({ value, label: value }))]
      this.setData({ allCourses, courses: this.filterFrom(allCourses, this.data.selected, this.data.keyword), categories, loading: false })
    } catch (error) { this.setData({ loading: false, loadError: error.message || '课程加载失败' }) }
  },
  decorateFavorites(rows, userId) {
    const ids = new Set((userId ? favorites.list(userId) : []).filter(item => item.type === 'COURSE').map(item => Number(item.id)))
    return (rows || []).map(item => ({ ...item, isFavorite: ids.has(Number(item.id)) }))
  },
  async refreshFavorites() {
    const user = await app.refreshUser().catch(() => null)
    const allCourses = this.decorateFavorites(this.data.allCourses, user?.id)
    this.setData({ allCourses, courses: this.filterFrom(allCourses, this.data.selected, this.data.keyword) })
  },
  filterFrom(rows, selected, keyword = '') {
    const query = String(keyword || '').trim().toLowerCase()
    return (rows || []).filter(item => {
      const matchesCategory = selected === 'ALL' || item.category === selected
      const searchable = [item.name, item.title, item.category, item.description].map(value => String(value || '').toLowerCase()).join(' ')
      return matchesCategory && (!query || searchable.includes(query))
    })
  },
  filteredCourses(selected, keyword = this.data.keyword) {
    return this.filterFrom(this.data.allCourses, selected, keyword)
  },
  search(e) {
    const keyword = e.detail.value || ''
    this.setData({ keyword, courses: this.filteredCourses(this.data.selected, keyword) })
  },
  filter(e) {
    const selected = e.currentTarget.dataset.type
    this.setData({ selected, courses: this.filteredCourses(selected) })
  },
  open(e) { wx.navigateTo({ url: `/pages/course-detail/index?id=${e.currentTarget.dataset.id}` }) },
  async toggleFavorite(e) {
    const courseId = Number(e.currentTarget.dataset.id)
    const userId = await app.ensureLogin()
    if (!userId) return wx.showToast({ title: '请先登录', icon: 'none' })
    const course = this.data.allCourses.find(item => Number(item.id) === courseId)
    if (!course) return
    const result = favorites.toggle(userId, {
      type: 'COURSE', id: course.id, title: course.name || course.title,
      subtitle: `${course.lessons || 0} 次课 · ${course.age || course.category || '艺术课程'}`,
      imageUrl: course.cover_url
    })
    const allCourses = this.data.allCourses.map(item => Number(item.id) === courseId ? { ...item, isFavorite: result.added } : item)
    this.setData({ allCourses, courses: this.filterFrom(allCourses, this.data.selected, this.data.keyword) })
    wx.showToast({ title: result.added ? '已加入收藏' : '已取消收藏', icon: 'none' })
  }
})
