const { mockState } = require('../../services/api')
Page({
  data: { child: mockState.child, lessons: mockState.lessons },
  renew() { wx.navigateTo({ url: '/pages/course/index' }) },
  leave() { wx.showToast({ title: '请假申请已提交', icon: 'success' }) }
})
