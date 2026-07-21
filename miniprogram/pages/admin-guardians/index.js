const { devContext, adminChildren, createParent, bindGuardian } = require('../../services/api')

Page({
  data: { children: [], selectedChildId: '', parentName: '', mobile: '', relationship: '监护人' },
  onLoad() { this.loadChildren() },
  onInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  selectChild(e) { this.setData({ selectedChildId: e.currentTarget.dataset.id }) },
  async loadChildren() {
    this.context = await devContext()
    this.setData({ children: await adminChildren(this.context.adminUserId) })
  },
  async submit() {
    if (!this.data.selectedChildId || !this.data.parentName.trim()) return wx.showToast({ title: '请选择孩子并填写家长姓名', icon: 'none' })
    try {
      const parent = await createParent(this.context.adminUserId, { displayName: this.data.parentName, mobile: this.data.mobile })
      // Parent creation and the relationship binding are separate audited business operations.
      await bindGuardian(this.context.adminUserId, this.data.selectedChildId, parent.id, this.data.relationship)
      wx.showToast({ title: '监护人已绑定', icon: 'success' })
      this.setData({ parentName: '', mobile: '' })
    } catch (error) { wx.showToast({ title: '绑定失败', icon: 'none' }) }
  }
})
