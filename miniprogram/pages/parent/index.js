const { mockState, devContext, parentDashboard } = require('../../services/api')
Page({
  data: { child: mockState.child, lessons: mockState.lessons },
  onLoad() {
    devContext().then(context => parentDashboard(context)).then(data => {
      const lessons = data.sessions.map(item => item.starts_at ? ({ date: item.starts_at.slice(5, 10).replace('-', '/'), week: '', title: `${item.course_name} · 第${item.sequence_no}课`, time: item.starts_at.slice(11, 16) + '-' + item.ends_at.slice(11, 16), place: `${item.campus} ${item.room}`, status: item.status === 'SCHEDULED' ? '已排课' : item.status }) : item)
      this.setData({ child: { name: data.child.name, remainingLessons: data.child.remainingLessons, validUntil: '以课程规则为准' }, lessons })
    }).catch(() => wx.showToast({ title: '课表加载失败', icon: 'none' }))
  },
  renew() { wx.navigateTo({ url: '/pages/course/index' }) },
  leave() { wx.showToast({ title: '请假申请已提交', icon: 'success' }) }
})
