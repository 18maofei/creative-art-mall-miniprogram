const { mockState, products, devContext, createOrder } = require('../../services/api')
Page({
  data: { products: mockState.products, cartCount: 0, cart: [], context: null },
  onLoad() {
    Promise.all([products(), devContext()]).then(([rows, context]) => {
      const mapped = rows.map(item => item.sku_id ? ({ id: item.product_id, skuId: item.sku_id, name: item.name, desc: item.description, price: Number(item.price), color: 'pink' }) : item)
      this.setData({ products: mapped, context })
    }).catch(() => wx.showToast({ title: '商城加载失败', icon: 'none' }))
  },
  add(e) { const item = this.data.products[e.currentTarget.dataset.index]; this.setData({ cart: [...this.data.cart, item], cartCount: this.data.cartCount + 1 }); wx.showToast({ title: `${item.name} 已加入购物车`, icon: 'success' }) },
  checkout() {
    if (!this.data.cart.length) return wx.showModal({ title: '购物车', content: '购物车暂时为空', showCancel: false })
    const grouped = this.data.cart.reduce((acc, item) => { const key = item.skuId || item.id; acc[key] = (acc[key] || 0) + 1; return acc }, {})
    const items = Object.keys(grouped).map(skuId => ({ skuId: Number(skuId), quantity: grouped[skuId] }))
    createOrder(this.data.context.parentUserId, items).then(order => {
      this.setData({ cart: [], cartCount: 0 })
      wx.showModal({ title: '订单已创建', content: `订单号：${order.orderNo}\n请接入微信支付后完成付款。`, showCancel: false })
    }).catch(() => wx.showToast({ title: '创建订单失败', icon: 'none' }))
  }
})
