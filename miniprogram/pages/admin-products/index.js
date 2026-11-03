const { adminProducts, adminProductCatalog, createProduct, updateProductDetailImages, uploadProductDetailImage, mediaUrl, adjustStock } = require('../../services/api')
const app = getApp()

const toastError = (error, fallback) => wx.showToast({ title: (error && error.message) || fallback, icon: 'none' })

Page({
  data: { products: [], catalogProducts: [], selectedProduct: null, selectedProductIndex: 0, uploadingDetailImages: false, savingDetailImages: false, name: '', selectedSkuId: '', quantity: '', reason: '' },
  onLoad() { this.loadProducts() },
  onInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  selectSku(e) { this.setData({ selectedSkuId: e.currentTarget.dataset.id }) },
  async loadProducts(preferredProductId) {
    try {
      this.staff = await app.ensureStaff()
      if (!this.staff) throw new Error('当前账号没有后台身份')
      const [products, catalogProducts] = await Promise.all([adminProducts(), adminProductCatalog()])
      const requestedId = preferredProductId || this.data.selectedProduct?.id
      const matchedIndex = catalogProducts.findIndex(item => String(item.id) === String(requestedId))
      const selectedProductIndex = matchedIndex >= 0 ? matchedIndex : 0
      this.setData({
        products,
        catalogProducts,
        selectedProductIndex,
        selectedProduct: catalogProducts[selectedProductIndex] || null
      })
    } catch (error) { toastError(error, '商品列表加载失败') }
  },
  chooseProduct(e) {
    const selectedProductIndex = Number(e.detail.value)
    this.setData({ selectedProductIndex, selectedProduct: this.data.catalogProducts[selectedProductIndex] || null })
  },
  async addProduct() {
    if (!this.data.name.trim()) return wx.showToast({ title: '请填写商品名称', icon: 'none' })
    try {
      const created = await createProduct(undefined, { name: this.data.name, status: 'DRAFT' })
      this.setData({ name: '' }); await this.loadProducts(created.id)
      wx.showToast({ title: '商品已创建', icon: 'success' })
    } catch (error) { toastError(error, '商品创建失败') }
  },
  requirePrivacyAuthorize() {
    if (typeof wx.requirePrivacyAuthorize !== 'function') return Promise.resolve()
    return new Promise((resolve, reject) => wx.requirePrivacyAuthorize({ success: resolve, fail: reject }))
  },
  async uploadDetailImages() {
    const product = this.data.selectedProduct
    if (!product) return wx.showToast({ title: '请先选择商品', icon: 'none' })
    if (this.data.uploadingDetailImages || this.data.savingDetailImages) return
    const remaining = 10 - (product.detail_images || []).length
    if (remaining <= 0) return wx.showToast({ title: '每个商品最多 10 张详情图', icon: 'none' })
    this.setData({ uploadingDetailImages: true })
    let uploadedCount = 0
    try {
      await this.requirePrivacyAuthorize()
      const media = await new Promise((resolve, reject) => {
        if (typeof wx.chooseMedia === 'function') {
          wx.chooseMedia({ count: Math.min(9, remaining), mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'], success: resolve, fail: reject })
        } else {
          wx.chooseImage({ count: Math.min(9, remaining), sizeType: ['compressed'], sourceType: ['album', 'camera'], success: resolve, fail: reject })
        }
      })
      const files = media.tempFiles || (media.tempFilePaths || []).map(path => ({ tempFilePath: path }))
      for (const file of files) {
        const filePath = file.tempFilePath || file.path
        if (!filePath) continue
        if (Number(file.size) > 10 * 1024 * 1024) throw new Error('单张图片不能超过 10 MB')
        const result = await uploadProductDetailImage(this.staff.id, product.id, filePath)
        this.replaceSelectedProductImages(result.detail_images || [])
        uploadedCount += 1
      }
      if (uploadedCount) wx.showToast({ title: `已上传 ${uploadedCount} 张`, icon: 'success' })
    } catch (error) {
      const message = String(error?.errMsg || error?.message || '')
      if (/api scope is not declared|not declared in the privacy agreement/i.test(message)) {
        wx.showModal({ title: '需要完善隐私指引', content: '请管理员在微信公众平台的“用户隐私保护指引”中声明相册和相机用途。', showCancel: false })
      } else if (!/cancel/i.test(message)) {
        wx.showToast({ title: uploadedCount ? `已上传 ${uploadedCount} 张，其余失败` : (message || '图片上传失败'), icon: 'none', duration: 3000 })
      }
    } finally {
      this.setData({ uploadingDetailImages: false })
    }
  },
  replaceSelectedProductImages(images) {
    const selectedProduct = { ...this.data.selectedProduct, detail_images: images.map(mediaUrl) }
    const catalogProducts = this.data.catalogProducts.map(item => String(item.id) === String(selectedProduct.id) ? selectedProduct : item)
    this.setData({ selectedProduct, catalogProducts })
  },
  async saveDetailImages(images) {
    const product = this.data.selectedProduct
    if (!product || this.data.savingDetailImages || this.data.uploadingDetailImages) return
    this.setData({ savingDetailImages: true })
    try {
      const result = await updateProductDetailImages(this.staff.id, product.id, images)
      this.replaceSelectedProductImages(result.detail_images || [])
      wx.showToast({ title: '详情图已更新', icon: 'success' })
    } catch (error) { toastError(error, '详情图更新失败') }
    finally { this.setData({ savingDetailImages: false }) }
  },
  removeDetailImage(e) {
    const images = (this.data.selectedProduct?.detail_images || []).slice()
    images.splice(Number(e.currentTarget.dataset.index), 1)
    this.saveDetailImages(images)
  },
  moveDetailImage(e) {
    const images = (this.data.selectedProduct?.detail_images || []).slice()
    const index = Number(e.currentTarget.dataset.index)
    const target = index + Number(e.currentTarget.dataset.delta)
    if (target < 0 || target >= images.length) return
    ;[images[index], images[target]] = [images[target], images[index]]
    this.saveDetailImages(images)
  },
  previewDetailImage(e) {
    const images = this.data.selectedProduct?.detail_images || []
    const current = images[Number(e.currentTarget.dataset.index)]
    if (current) wx.previewImage({ current, urls: images })
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
