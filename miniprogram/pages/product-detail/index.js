const { products, recordEvent } = require('../../services/api')
const CART_KEY = 'artStudioCart'

Page({
  data: { product: null, loading: true, error: '', hasDetailImages: false, hasMultipleDetailImages: false, detailImageIndex: 0, detailImageNumber: 1 },
  onLoad(options) {
    this.productId = String(options.id || '')
    recordEvent('page_view', 'product_detail', 'VISITOR')
    this.loadData()
  },
  async loadData() {
    this.setData({ loading: true, error: '' })
    try {
      const list = await products()
      const product = list.find(item => String(item.id) === this.productId)
      if (!product) throw new Error('商品不存在或已下架')
      const detailImages = Array.isArray(product.detail_images) ? product.detail_images : []
      this.setData({
        product,
        hasDetailImages: detailImages.length > 0,
        hasMultipleDetailImages: detailImages.length > 1,
        detailImageIndex: 0,
        detailImageNumber: 1,
        loading: false
      })
    } catch (error) {
      this.setData({ loading: false, error: error.message || '商品加载失败' })
    }
  },
  addToCart() {
    const product = this.data.product
    if (!product) return
    const cart = wx.getStorageSync(CART_KEY)
    const items = Array.isArray(cart) ? cart.map(item => ({ ...item })) : []
    const existing = items.find(item => String(item.id) === String(product.id))
    if (existing) existing.quantity = Math.max(1, Math.floor(Number(existing.quantity) || 1)) + 1
    else items.push({ id: product.id, name: product.name, price: product.price, quantity: 1 })
    wx.setStorageSync(CART_KEY, items)
    wx.showToast({ title: '已加入购物车', icon: 'success' })
  },
  onDetailImageChange(e) {
    const index = Number(e.detail.current) || 0
    this.setData({ detailImageIndex: index, detailImageNumber: index + 1 })
  },
  previewDetailImage(e) {
    const images = this.data.product?.detail_images || []
    const current = images[Number(e.currentTarget.dataset.index)]
    if (current) wx.previewImage({ current, urls: images })
  }
})
