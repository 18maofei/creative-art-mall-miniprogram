const { adminLeaveRequests, reviewLeaveRequest } = require('../../services/api')
const app = getApp()

const STATUS_LABELS = { PENDING: '待审批', APPROVED: '已通过', REJECTED: '已驳回', CANCELLED: '已取消' }
const FILTERS = [
  { value: '', label: '全部' },
  { value: 'PENDING', label: '待审批' },
  { value: 'APPROVED', label: '已通过' },
  { value: 'REJECTED', label: '已驳回' }
]

Page({
  data: { filters: FILTERS, selected: '', requests: [], loading: true, processingId: null },
  onLoad() { this.loadData() },
  onPullDownRefresh() { this.loadData(true) },
  async loadData(withRefresh = false) {
    this.setData({ loading: true })
    try {
      this.staff = this.staff || await app.ensureStaff()
      if (!this.staff) throw new Error('当前账号没有后台身份')
      const rows = await adminLeaveRequests(undefined, this.data.selected)
      this.setData({
        requests: rows.map(item => ({
          ...item,
          statusLabel: STATUS_LABELS[item.status] || item.status,
          timeLabel: `${item.starts_at || ''}${item.ends_at ? ` - ${item.ends_at}` : ''}`
        })),
        loading: false
      })
    } catch (error) {
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '请假列表加载失败', icon: 'none' })
    } finally {
      if (withRefresh) wx.stopPullDownRefresh()
    }
  },
  chooseFilter(e) {
    const selected = e.currentTarget.dataset.value || ''
    this.setData({ selected })
    this.loadData()
  },
  review(e) {
    const request = e.currentTarget.dataset.request
    if (!request || request.status !== 'PENDING' || this.data.processingId) return
    wx.showActionSheet({
      itemList: ['通过申请', '驳回申请'],
      success: result => this.confirmReview(request, result.tapIndex === 0 ? 'APPROVED' : 'REJECTED')
    })
  },
  confirmReview(request, status) {
    const approved = status === 'APPROVED'
    wx.showModal({
      title: approved ? '通过请假申请' : '驳回请假申请',
      content: approved ? '通过后该课次会标记为请假，不扣课时。' : '确定驳回这条请假申请吗？',
      confirmText: approved ? '通过' : '驳回',
      confirmColor: approved ? '#16785c' : '#b04b4b',
      success: result => {
        if (result.confirm) this.submitReview(request.id, status)
      }
    })
  },
  async submitReview(requestId, status) {
    this.setData({ processingId: requestId })
    try {
      await reviewLeaveRequest(undefined, requestId, status)
      wx.showToast({ title: status === 'APPROVED' ? '已通过，考勤已标记请假' : '已驳回', icon: 'success' })
      await this.loadData()
    } catch (error) {
      wx.showToast({ title: error.message || '审批失败', icon: 'none' })
    } finally {
      this.setData({ processingId: null })
    }
  }
})
