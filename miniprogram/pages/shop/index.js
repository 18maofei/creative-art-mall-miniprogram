const { products, createOrder, addresses, recordEvent } = require('../../services/api')
const app = getApp()
const CART_KEY = 'artStudioCart'

Page({
  data: { products: [], allProducts: [], keyword: '', cartCount: 0, cartTotal: 0, cart: [], cartVisible: false, checking: false, paymentEnabled: false, loading: true, loadError: '' },
  onLoad() {
    this.setData({ paymentEnabled: app.isPaymentEnabled() })
    this.loadData()
  },
  onShow() {
    if (!this.data.loading) this.restoreCart()
    this.setData({ paymentEnabled: app.isPaymentEnabled() })
    recordEvent('page_view', 'shop', app.globalData.currentRole || 'VISITOR')
  },
  toggleCart() {
    this.setData({ cartVisible: !this.data.cartVisible })
  },
  closeCart() {
    this.setData({ cartVisible: false })
  },
  stopCartTap() {},
  async loadData() {
    this.setData({ loading: true, loadError: '' })
    try {
      const list = await products()
      this.setData({ products: list, allProducts: list, loading: false })
      this.restoreCart(list)
      this.search({ detail: { value: this.data.keyword } })
    } catch (error) { this.setData({ loading: false, loadError: error.message || '商城加载失败' }) }
  },
  restoreCart(productList = (this.data.allProducts.length ? this.data.allProducts : this.data.products)) {
    const stored = wx.getStorageSync(CART_KEY)
    if (!Array.isArray(stored)) return this.syncCart([])
    const cart = stored.map(item => {
      const product = (productList || []).find(row => String(row.id) === String(item.id))
      if (!product) return null
      return { ...product, quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)) }
    }).filter(Boolean)
    this.syncCart(cart, false)
  },
  syncCart(cart, persist = true) {
    const normalized = (cart || []).map(item => ({ ...item, quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)) }))
    if (persist) wx.setStorageSync(CART_KEY, normalized.map(item => ({ id: item.id, name: item.name, price: item.price, quantity: item.quantity })))
    const cartCount = normalized.reduce((sum, item) => sum + item.quantity, 0)
    const cartTotal = normalized.reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0)
    this.setData({ cart: normalized, cartCount, cartTotal: cartTotal.toFixed(2) })
  },
  search(e) {
    const keyword = String(e.detail.value || '')
    const query = keyword.trim().toLowerCase()
    const products = this.data.allProducts.filter(item => {
      const searchable = [item.name, item.title, item.category, item.desc, item.description].map(value => String(value || '').toLowerCase()).join(' ')
      return !query || searchable.includes(query)
    })
    this.setData({ keyword, products })
  },
  add(e) {
    if (this.data.checking) return
    const item = this.data.products[e.currentTarget.dataset.index]
    if (!item) return
    const cart = this.data.cart.map(row => ({ ...row }))
    const existing = cart.find(row => String(row.id) === String(item.id))
    if (existing) existing.quantity += 1
    else cart.push({ ...item, quantity: 1 })
    this.syncCart(cart)
    wx.showToast({ title: '已加入购物车', icon: 'success' })
  },
  changeQuantity(e) {
    if (this.data.checking) return
    const index = Number(e.currentTarget.dataset.index)
    const delta = Number(e.currentTarget.dataset.delta)
    const cart = this.data.cart.map(row => ({ ...row }))
    if (!cart[index]) return
    cart[index].quantity += delta
    if (cart[index].quantity <= 0) cart.splice(index, 1)
    this.syncCart(cart)
  },
  async checkout() {
    if (this.data.checking) return
    if (!this.data.cart.length) return wx.showToast({ title: '购物车为空', icon: 'none' })
    if (!app.isPaymentEnabled()) return app.showPaymentUnavailable()
    this.setData({ checking: true })
    let createdOrder = null
    try {
      const buyerUserId = await app.ensureLogin()
      if (!buyerUserId) throw new Error('请登录后再下单')
      const list = await addresses(buyerUserId)
      const defaultAddress = list.find(row => row.is_default) || list[0]
      if (!defaultAddress) {
        return wx.showModal({
          title: '缺少收货地址',
          content: '请先添加收货地址后再下单。',
          confirmText: '去添加',
          success: res => { if (res.confirm) wx.navigateTo({ url: '/pages/address/index' }) }
        })
      }
      const confirmed = await new Promise(resolve => wx.showModal({
        title: '确认下单',
        content: `${this.data.cart.map(item => `${item.name} × ${item.quantity}`).join('\n')}\n合计 ¥${this.data.cartTotal}\n寄送至：${defaultAddress.full_address || defaultAddress.detail}`,
        confirmText: '确认付款',
        success: res => resolve(res.confirm), fail: () => resolve(false)
      }))
      if (!confirmed) return
      this.setData({ checking: true })
      const order = await createOrder(buyerUserId, 'PRODUCT', this.data.cart[0].id, {
        addressId: defaultAddress.id,
        idempotencyKey: `shop-${buyerUserId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        items: this.data.cart.map(item => ({ type: 'PRODUCT', subjectId: item.id, quantity: item.quantity }))
      })
      createdOrder = order
      this.syncCart([])
      this.setData({ cartVisible: false })
      const paymentResult = await app.payOrder(order.id)
      wx.showModal({ title: paymentResult?.status === 'PAID' || paymentResult?.status === 'SHIPPED' || paymentResult?.status === 'COMPLETED' ? '支付成功' : '支付结果确认中', content: paymentResult?.status === 'PAID' || paymentResult?.status === 'SHIPPED' || paymentResult?.status === 'COMPLETED' ? '订单已支付，画室发货后可在「我的订单」查看物流并确认收货。' : '微信已受理支付，服务端正在确认结果。请稍后到订单页查看状态。', showCancel: false, confirmText: '查看订单', success: () => this.goOrders() })
    } catch (error) {
      const message = error?.errMsg?.includes('cancel') || error?.errCode === -2 ? '已取消支付' : (error.message || '创建订单失败')
      if (createdOrder) wx.showModal({ title: '订单已创建', content: message + '。可以在我的订单继续支付，请勿重复下单。', confirmText: '查看订单', success: res => { if (res.confirm) this.goOrders() } })
      else wx.showToast({ title: message, icon: 'none' })
    } finally {
      this.setData({ checking: false })
    }
  },
  goOrders() { wx.navigateTo({ url: '/pages/orders/index' }) }
})
