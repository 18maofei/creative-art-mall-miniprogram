const { addresses, createAddress, updateAddress, deleteAddress } = require('../../services/api')
const app = getApp()
const emptyForm = () => ({ recipientName: '', mobile: '', province: '', city: '', district: '', detail: '' })
Page({
  data: { addresses: [], form: emptyForm(), region: [], editingId: null, isDefault: true, loading: true, submitting: false, actionBusy: false, loadError: '' },
  onShow() { this.loadAddresses() },
  onInput(e) { this.setData({ ['form.' + e.currentTarget.dataset.field]: e.detail.value }) },
  onRegion(e) { const [province, city, district] = e.detail.value; this.setData({ region: e.detail.value, 'form.province': province, 'form.city': city, 'form.district': district }) },
  toggleDefault(e) { this.setData({ isDefault: e.detail.value }) },
  async loadAddresses() {
    this.setData({ loading: true, loadError: '' })
    try {
      this.userId = await app.ensureLogin()
      if (!this.userId) throw new Error('请登录后管理收货地址')
      this.setData({ addresses: await addresses(this.userId) })
    } catch (error) { this.setData({ loadError: error.message || '地址加载失败' }) }
    finally { this.setData({ loading: false }) }
  },
  edit(e) {
    if (this.data.submitting || this.data.actionBusy) return
    const row = this.data.addresses.find(item => String(item.id) === String(e.currentTarget.dataset.id))
    if (!row) return
    this.setData({ editingId: row.id, form: { recipientName: row.recipient_name, mobile: row.mobile, province: row.province, city: row.city, district: row.district, detail: row.detail }, region: [row.province, row.city, row.district], isDefault: Boolean(row.is_default) })
    wx.pageScrollTo({ selector: '#address-form', duration: 250 })
  },
  cancelEdit() { this.setData({ editingId: null, form: emptyForm(), region: [], isDefault: !this.data.addresses.length }) },
  async submit() {
    if (this.data.submitting || this.data.actionBusy || this.data.loading) return
    if (!this.userId) return wx.showToast({ title: '请先登录', icon: 'none' })
    const form = Object.fromEntries(Object.entries(this.data.form).map(([key, value]) => [key, String(value).trim()]))
    if (Object.values(form).some(value => !value)) return wx.showToast({ title: '请填写完整地址', icon: 'none' })
    if (!/^1[3-9]\d{9}$/.test(form.mobile)) return wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
    this.setData({ submitting: true })
    try {
      if (this.data.editingId) await updateAddress(this.userId, this.data.editingId, { ...form, isDefault: this.data.isDefault })
      else await createAddress({ userId: this.userId, ...form, isDefault: this.data.isDefault })
      this.cancelEdit()
      await this.loadAddresses()
      wx.showToast({ title: '地址已保存', icon: 'success' })
    } catch (error) { wx.showModal({ title: '保存失败', content: error.message || '请稍后重试，已保留填写内容', showCancel: false }) }
    finally { this.setData({ submitting: false }) }
  },
  async makeDefault(e) {
    if (this.data.submitting || this.data.actionBusy) return
    this.setData({ actionBusy: true })
    try { await updateAddress(this.userId, e.currentTarget.dataset.id, { isDefault: true }); await this.loadAddresses() }
    catch (error) { wx.showToast({ title: error.message || '设置失败', icon: 'none' }) }
    finally { this.setData({ actionBusy: false }) }
  },
  async remove(e) {
    if (this.data.submitting || this.data.actionBusy) return
    this.setData({ actionBusy: true })
    try {
      const addressId = e.currentTarget.dataset.id
      const confirmed = await new Promise(resolve => wx.showModal({ title: '删除地址', content: '确定删除该收货地址吗？', success: res => resolve(res.confirm), fail: () => resolve(false) }))
      if (!confirmed) return
      await deleteAddress(this.userId, addressId)
      if (String(this.data.editingId) === String(addressId)) this.cancelEdit()
      await this.loadAddresses()
    } catch (error) { wx.showToast({ title: error.message || '删除失败', icon: 'none' }) }
    finally { this.setData({ actionBusy: false }) }
  }
})
