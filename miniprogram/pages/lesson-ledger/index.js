const { userDashboard, lessonLedger } = require('../../services/api')
const app = getApp()

const TYPE_LABELS = { PURCHASE: '购课充值', GIFT: '赠送课时', DEDUCT: '上课扣减', REFUND: '退款回收', ADJUST: '手动调整', FREEZE: '冻结课时', UNFREEZE: '解冻课时' }

Page({
  data: { students: [], studentOptions: [], selectedIndex: 0, selectedChildId: null, entries: [], loading: true, loadError: '' },
  onShow() { this.loadData() },
  async loadData() {
    this.setData({ loading: true, loadError: '' })
    this.setData({ loading: true })
    const userId = await app.ensureLogin()
    if (!userId) {
      this.setData({ loading: false, loadError: '请登录后查看课时记录' })
      return
    }
    this.userId = userId
    if (!app.hasPermission('child.read')) return this.setData({ loading: false, students: [], entries: [], selectedChildId: null })
    try {
      const dashboard = await userDashboard(userId)
      const students = (dashboard.students || []).map(item => ({ ...item, remainingLessons: item.remaining_lessons }))
      const selectedIndex = Math.min(this.data.selectedIndex, Math.max(students.length - 1, 0))
      const selectedChildId = students[selectedIndex]?.id || null
      const entries = selectedChildId ? await lessonLedger(userId, selectedChildId) : []
      this.setData({ students, studentOptions: students.map(item => item.name), selectedIndex, selectedChildId, entries: this.decorate(entries), loading: false })
    } catch (error) {
      this.setData({ loading: false, loadError: error.message || '课时流水加载失败' })
    }
  },
  decorate(entries) {
    return (entries || []).map(item => ({
      ...item,
      typeLabel: TYPE_LABELS[item.type] || item.type,
      quantityText: Number(item.quantity) > 0 ? `+${item.quantity}` : String(item.quantity),
      quantityClass: Number(item.quantity) >= 0 ? 'positive' : 'negative'
    }))
  },
  async onStudentChange(event) {
    const selectedIndex = Number(event.detail.value)
    const student = this.data.students[selectedIndex]
    if (!student) return
    const requestId = this.entryRequestId = (this.entryRequestId || 0) + 1
    this.setData({ selectedIndex, selectedChildId: student.id, entries: [], loading: true, loadError: '' })
    try {
      const entries = await lessonLedger(this.userId, student.id)
      if (requestId === this.entryRequestId) this.setData({ entries: this.decorate(entries), loading: false })
    } catch (error) { if (requestId === this.entryRequestId) this.setData({ loading: false, loadError: error.message || '课时流水加载失败' }) }
  }
})
