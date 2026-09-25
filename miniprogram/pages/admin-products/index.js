const { adminProducts, createProduct, adjustStock } = require('../../services/api')
const app = getApp()

const toastError = (error, fallback) => wx.showToast({ title: (error && error.message) || fallback, icon: 'none' })

Page({
  data: { products: [], name: '', selectedSkuId: '', quantity: '', reason: '' },
  onLoad() { this.loadProducts() },
  onInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  selectSku(e) { this.setData({ selectedSkuId: e.currentTarget.dataset.id }) },
  async loadProducts() {
    try {
      this.staff = await app.ensureStaff()
      if (!this.staff) throw new Error('当前账号没有后台身份')
      this.setData({ products: await adminProducts() })
    } catch (error) { toastError(error, '商品列表加载失败') }
  },
  async addProduct() {
    if (!this.data.name.trim()) return wx.showToast({ title: '请填写商品名称', icon: 'none' })
    try {
      await createProduct(undefined, { name: this.data.name, status: 'DRAFT' })
      this.setData({ name: '' }); this.loadProducts()
      wx.showToast({ title: '商品已创建', icon: 'success' })
    } catch (error) { toastError(error, '商品创建失败') }
  },
  async changeStock() {
    const quantity = Number(this.data.quantity)
    if (!this.data.selectedSkuId || !Number.isInteger(quantity) || !quantity || !this.data.reason.trim()) return wx.showToast({ title: '请选择 SKU 并填写数量和原因', icon: 'none' })
    try {
      // Stock changes are validated server-side so it can never become negative.
      await adjustStock(undefined, this.data.selectedSkuId, { quantity, reason: this.data.reason })
      this.setData({ quantity: '', reason: '' }); this.loadProducts()
      wx.showToast({ title: '库存已更新', icon: 'success' })
    } catch (error) { toastError(error, '库存更新失败') }
  }
})
