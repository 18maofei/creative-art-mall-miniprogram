const { mockState } = require('../../services/api')

Page({
  data: { courses: mockState.courses, products: mockState.products },
  goCourse() { wx.navigateTo({ url: '/pages/course/index' }) },
  goShop() { wx.navigateTo({ url: '/pages/shop/index' }) },
  goParent() { wx.navigateTo({ url: '/pages/parent/index' }) },
  goTeacher() { wx.navigateTo({ url: '/pages/teacher/index' }) },
  goProfile() { wx.navigateTo({ url: '/pages/profile/index' }) },
  reserve() { wx.showToast({ title: '已提交试听意向', icon: 'success' }) }
})
