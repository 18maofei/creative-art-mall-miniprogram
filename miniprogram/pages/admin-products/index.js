const { devContext, adminProducts, createProduct, adjustStock } = require('../../services/api')

Page({
  data: { products: [], name: '', selectedSkuId: '', quantity: '', reason: '' },
  onLoad() { this.loadProducts() },
  onInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  selectSku(e) { this.setData({ selectedSkuId: e.currentTarget.dataset.id }) },
  async loadProducts() { this.context = await devContext(); this.setData({ products: await adminProducts(this.context.adminUserId) }) },
  async addProduct() {
    if (!this.data.name.trim()) return wx.showToast({ title: '请填写商品名称', icon: 'none' })
    await createProduct(this.context.adminUserId, { name: this.data.name, status: 'DRAFT' })
    this.setData({ name: '' }); this.loadProducts()
  },
  async changeStock() {
    const quantity = Number(this.data.quantity)
    if (!this.data.selectedSkuId || !Number.isInteger(quantity) || !quantity || !this.data.reason.trim()) return wx.showToast({ title: '请选择 SKU 并填写数量和原因', icon: 'none' })
    // Stock changes are validated server-side so it can never become negative.
    await adjustStock(this.context.adminUserId, this.data.selectedSkuId, { quantity, reason: this.data.reason })
    this.setData({ quantity: '', reason: '' }); this.loadProducts(); wx.showToast({ title: '库存已更新', icon: 'success' })
  }
})
