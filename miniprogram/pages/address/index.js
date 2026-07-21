const { devContext, addresses, createAddress } = require('../../services/api')

Page({
  data: { addresses: [], form: { recipientName: '', mobile: '', province: '', city: '', district: '', detail: '' } },
  onLoad() { this.loadAddresses() },
  onInput(e) { this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value }) },
  async loadAddresses() {
    const context = await devContext()
    this.context = context
    this.setData({ addresses: await addresses(context.parentUserId) })
  },
  async submit() {
    const form = this.data.form
    if (Object.values(form).some(value => !String(value).trim())) return wx.showToast({ title: '请填写完整地址', icon: 'none' })
    try {
      await createAddress({ userId: this.context.parentUserId, ...form, isDefault: true })
      wx.showToast({ title: '地址已保存', icon: 'success' })
      this.loadAddresses()
    } catch (error) { wx.showToast({ title: '保存失败', icon: 'none' }) }
  }
})
