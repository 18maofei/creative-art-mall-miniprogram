const { adminChildren, createChild, adjustLessons } = require('../../services/api')
const app = getApp()

const toastError = (error, fallback) => wx.showToast({ title: (error && error.message) || fallback, icon: 'none' })

Page({
  data: { children: [], childName: '', selectedChildId: '', quantity: '', reason: '' },
  onLoad() { this.loadChildren() },
  onInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  selectChild(e) { this.setData({ selectedChildId: e.currentTarget.dataset.id }) },
  async loadChildren() {
    try {
      this.staff = await app.ensureStaff()
      if (!this.staff) throw new Error('当前账号没有后台身份')
      this.setData({ children: await adminChildren() })
    } catch (error) { toastError(error, '学员列表加载失败') }
  },
  async addChild() {
    if (!this.data.childName.trim()) return wx.showToast({ title: '请填写学员姓名', icon: 'none' })
    try {
      await createChild(undefined, { name: this.data.childName, gender: 'UNKNOWN' })
      this.setData({ childName: '' }); this.loadChildren()
      wx.showToast({ title: '学员已创建', icon: 'success' })
    } catch (error) { toastError(error, '学员创建失败') }
  },
  async changeLessons() {
    const quantity = Number(this.data.quantity)
    if (!this.data.selectedChildId || !Number.isFinite(quantity) || !quantity || !this.data.reason.trim()) return wx.showToast({ title: '请选择学员并填写课时与原因', icon: 'none' })
    try {
      // A unique key ensures retries cannot create a duplicate ledger record.
      await adjustLessons(undefined, this.data.selectedChildId, { type: 'ADJUST', quantity, reason: this.data.reason, idempotencyKey: `mini-${Date.now()}` })
      this.setData({ quantity: '', reason: '' }); this.loadChildren()
      wx.showToast({ title: '课时已调整', icon: 'success' })
    } catch (error) { toastError(error, '课时调整失败') }
  }
})
