const { userTrialAppointments } = require('../../services/api')
const app = getApp()

const STATUS_LABELS = { PENDING: '待确认', CONFIRMED: '已确认', COMPLETED: '已完成', CANCELLED: '已取消' }
const TIME_LABELS = { ANY: '时间不限', MORNING: '上午', AFTERNOON: '下午', EVENING: '晚上' }

Page({
  data: { records: [], loading: true, loadError: '' },
  onShow() { this.loadData() },
  async loadData() {
    this.setData({ loading: true, loadError: '' })
    const userId = await app.ensureLogin()
    if (!userId) {
      this.setData({ loading: false, loadError: '请登录后查看预约记录' })
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    try {
      const records = await userTrialAppointments(userId)
      this.setData({ records: (records || []).map(item => ({
        ...item,
        statusLabel: STATUS_LABELS[item.status] || item.status,
        preferredTimeLabel: TIME_LABELS[item.preferred_time] || '时间不限'
      })), loading: false })
    } catch (error) {
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '预约记录加载失败', icon: 'none' })
    }
  },
  goBooking() { wx.navigateTo({ url: '/pages/trial-appointment/index' }) }
})
