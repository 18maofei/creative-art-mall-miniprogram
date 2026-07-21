const { devContext, adminChildren, createChild, adjustLessons } = require('../../services/api')

Page({
  data: { children: [], childName: '', selectedChildId: '', quantity: '', reason: '' },
  onLoad() { this.loadChildren() },
  onInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  selectChild(e) { this.setData({ selectedChildId: e.currentTarget.dataset.id }) },
  async loadChildren() {
    this.context = await devContext()
    this.setData({ children: await adminChildren(this.context.adminUserId) })
  },
  async addChild() {
    if (!this.data.childName.trim()) return wx.showToast({ title: '请填写学员姓名', icon: 'none' })
    await createChild(this.context.adminUserId, { name: this.data.childName, gender: 'UNKNOWN' })
    this.setData({ childName: '' }); this.loadChildren()
  },
  async changeLessons() {
    const quantity = Number(this.data.quantity)
    if (!this.data.selectedChildId || !Number.isFinite(quantity) || !quantity || !this.data.reason.trim()) return wx.showToast({ title: '请选择学员并填写课时与原因', icon: 'none' })
    // A unique key ensures retries cannot create a duplicate ledger record.
    await adjustLessons(this.context.adminUserId, this.data.selectedChildId, { type: 'ADJUST', quantity, reason: this.data.reason, idempotencyKey: `mini-${Date.now()}` })
    this.setData({ quantity: '', reason: '' }); this.loadChildren(); wx.showToast({ title: '课时已调整', icon: 'success' })
  }
})
