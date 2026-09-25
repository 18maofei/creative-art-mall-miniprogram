const { courses, userDashboard, createOrder } = require('../../services/api')
const app = getApp()

Page({
  data: { course: null, paying: false, paymentEnabled: false, loading: true, error: '', detailTab: 'intro' },
  onLoad(q) { this.courseId = q.id; this.loadData() },
  loadData() {
    this.setData({ paymentEnabled: app.isPaymentEnabled(), loading: true, error: '' })
    courses().then(rows => {
      const item = rows.find(row => String(row.id) === String(this.courseId))
      if (!item) throw new Error('课程不存在或已下架')
      this.setData({ course: item, loading: false })
    }).catch(error => this.setData({ loading: false, error: error.message || '课程加载失败' }))
  },
  back() { wx.navigateBack({ delta: 1 }) },
  switchDetailTab(e) { this.setData({ detailTab: e.currentTarget.dataset.tab }) },
  async apply() {
    const course = this.data.course
    if (!course || this.data.paying) return
    if (!app.isPaymentEnabled()) return wx.navigateTo({ url: `/pages/trial-appointment/index?courseId=${course.id}` })
    this.setData({ paying: true })
    try {
    const userId = await app.ensureLogin()
    if (!userId) return wx.showModal({ title: '需要登录', content: '请先登录后再报名。', showCancel: false })
    if (!app.hasPermission('course.enroll')) return wx.showModal({ title: '需要关联学员', content: '请联系画室关联学员档案，也可以先预约试听。', confirmText: '预约试听', success: res => { if (res.confirm) wx.navigateTo({ url: `/pages/trial-appointment/index?courseId=${course.id}` }) } })
    let dashboard
    try {
      dashboard = await userDashboard(userId)
    } catch (error) {
      return wx.showToast({ title: error.message || '学员信息加载失败', icon: 'none' })
    }
    const students = dashboard.students || []
    if (!students.length) return wx.showModal({ title: '请先绑定学员', content: '购买课程前需要先由画室为您的账号绑定孩子。', showCancel: false })
    let childId = students[0].id
    if (students.length > 1) {
      const selected = await new Promise(resolve => wx.showActionSheet({
        itemList: students.slice(0, 6).map(item => `${item.name}（剩余 ${item.remaining_lessons || 0} 次）`),
        success: result => resolve(students[result.tapIndex]?.id || null),
        fail: () => resolve(null)
      }))
      if (!childId || selected === null) return
      childId = selected
    }
    const confirmed = await new Promise(resolve => wx.showModal({
      title: '确认报名',
      content: `《${course.name}》共 ${course.lessons} 次课，合计 ¥${course.price}。`,
      confirmText: '确认支付',
      success: res => resolve(res.confirm), fail: () => resolve(false)
    }))
    if (!confirmed) return
    let createdOrder = null
    try {
      const order = await createOrder(userId, 'COURSE', course.id, { courseChildId: childId, idempotencyKey: `course-${userId}-${course.id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` })
      createdOrder = order
      const paymentResult = await app.payOrder(order.id)
      if (paymentResult?.status !== 'PAID' && paymentResult?.status !== 'SHIPPED' && paymentResult?.status !== 'COMPLETED') {
        await new Promise(resolve => wx.showModal({ title: '支付结果确认中', content: '微信已受理支付，服务端正在确认结果。请稍后到订单页查看状态。', showCancel: false, success: resolve }))
        wx.navigateTo({ url: '/pages/orders/index' })
        return
      }
      await new Promise(resolve => wx.showModal({
        title: '支付成功',
        content: '订单已确认，画室会尽快联系您安排班级和上课时间。',
        showCancel: false,
        success: resolve
      }))
      wx.navigateTo({ url: '/pages/orders/index' })
    } catch (error) {
      const message = error?.errMsg?.includes('cancel') || error?.errCode === -2 ? '已取消支付' : (error.message || '下单失败')
      if (createdOrder) wx.showModal({ title: '订单已创建', content: message + '。可在我的订单继续支付。', confirmText: '查看订单', success: res => { if (res.confirm) wx.navigateTo({ url: '/pages/orders/index' }) } })
      else wx.showToast({ title: message, icon: 'none' })
    }
    } finally {
      this.setData({ paying: false })
    }
  }
})
