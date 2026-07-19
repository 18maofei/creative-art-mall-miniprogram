const { mockState } = require('../../services/api')
Page({
  data: { products: mockState.products, cartCount: 0 },
  add(e) { const item = this.data.products[e.currentTarget.dataset.index]; this.setData({ cartCount: this.data.cartCount + 1 }); wx.showToast({ title: `${item.name} 已加入购物车`, icon: 'success' }) },
  checkout() { wx.showModal({ title: '购物车', content: this.data.cartCount ? `共 ${this.data.cartCount} 件商品，支付功能待接入微信支付。` : '购物车暂时为空', showCancel: false }) }
})
