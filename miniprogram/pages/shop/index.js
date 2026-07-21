const { mockState, products, devContext, addresses, createOrder } = require('../../services/api')

Page({
  data: { products: mockState.products, cartCount: 0, cart: [], context: null, selectedAddress: null },
  async onLoad() {
    try {
      const [rows, context] = await Promise.all([products(), devContext()])
      const addressList = await addresses(context.parentUserId)
      const mapped = rows.map(item => item.sku_id ? ({ id: item.product_id, skuId: item.sku_id, name: item.name, desc: item.description, price: Number(item.price), color: 'pink' }) : item)
      this.setData({ products: mapped, context, selectedAddress: addressList.find(item => item.is_default) || addressList[0] || null })
    } catch (error) { wx.showToast({ title: '商城加载失败', icon: 'none' }) }
  },
  add(e) {
    const item = this.data.products[e.currentTarget.dataset.index]
    this.setData({ cart: [...this.data.cart, item], cartCount: this.data.cartCount + 1 })
    wx.showToast({ title: '已加入购物车', icon: 'success' })
  },
  async checkout() {
    if (!this.data.cart.length) return wx.showToast({ title: '购物车为空', icon: 'none' })
    if (!this.data.selectedAddress) return wx.showModal({ title: '需要收货地址', content: '请先到个人中心填写收货地址。', showCancel: false })
    const grouped = this.data.cart.reduce((acc, item) => { const key = item.skuId || item.id; acc[key] = (acc[key] || 0) + 1; return acc }, {})
    const items = Object.keys(grouped).map(skuId => ({ skuId: Number(skuId), quantity: grouped[skuId] }))
    try {
      // The address id lets the backend save an immutable delivery snapshot on the order.
      const order = await createOrder(this.data.context.parentUserId, items, this.data.selectedAddress.id)
      this.setData({ cart: [], cartCount: 0 })
      wx.showModal({ title: '订单已创建', content: `订单号：${order.orderNo}`, showCancel: false })
    } catch (error) { wx.showToast({ title: '创建订单失败', icon: 'none' }) }
  }
})
