const { userDashboard, leaveRequests, createLeaveRequest } = require('../../services/api')
const app = getApp()

const STATUS_LABELS = { PENDING: '待审批', APPROVED: '已通过', REJECTED: '已驳回', CANCELLED: '已取消' }

Page({
  data: { students: [], sessions: [], requests: [], childId: '', sessionId: '', reason: '', submitting: false, loading: true, loadError: '' },
  onShow() { this.loadData() },
  async loadData() {
    this.setData({ loading: true, loadError: '' })
    const userId = await app.ensureLogin()
    this.userId = userId
    if (!userId) return this.setData({ loading: false, loadError: '请登录后提交请假申请' })
    if (!app.hasPermission('leave.create')) return this.setData({ loading: false, students: [], sessions: [], requests: [], loadError: '尚未关联学习档案，请联系画室绑定学员后再申请请假' })
    try {
      const [dashboard, requests] = await Promise.all([userDashboard(userId), leaveRequests(userId)])
      const allSessions = (dashboard.sessions || []).filter(item => new Date(item.starts_at) > new Date() && !requests.some(row => Number(row.session_id) === Number(item.id) && row.status !== 'CANCELLED')).map(item => ({ ...item, label: `${item.course_title} · ${item.starts_at}`, childIds: String(item.child_ids || '').split(',').filter(Boolean) }))
      const students = dashboard.students || []
      const childId = this.data.childId || students[0]?.id || ''
      this.setData({
        students,
        allSessions,
        childId,
        sessions: allSessions.filter(item => !childId || item.childIds.includes(String(childId))),
        requests: requests.map(item => ({ ...item, statusLabel: STATUS_LABELS[item.status] || item.status })),
        loading: false
      })
    } catch (error) { this.setData({ loading: false, loadError: error.message || '数据加载失败' }) }
  },
  selectChild(e) {
    const childId = e.currentTarget.dataset.id
    const allSessions = this.data.allSessions || []
    this.setData({ childId, sessionId: '', sessions: allSessions.filter(item => !childId || item.childIds.includes(String(childId))) })
  },
  selectSession(e) { this.setData({ sessionId: e.currentTarget.dataset.id }) },
  onReason(e) { this.setData({ reason: e.detail.value }) },
  async submit() {
    if (this.data.submitting || this.data.loading || this.data.loadError) return
    if (!this.data.childId || !this.data.sessionId || !this.data.reason.trim()) {
      return wx.showToast({ title: '请选择学员、课次并填写事由', icon: 'none' })
    }
    this.setData({ submitting: true })
    try {
      await createLeaveRequest({ userId: this.userId, childId: this.data.childId, sessionId: this.data.sessionId, reason: this.data.reason })
      wx.showToast({ title: '请假申请已提交', icon: 'success' })
      this.setData({ childId: '', sessionId: '', reason: '' })
      this.loadData()
    } catch (error) {
      wx.showToast({ title: error.message || '提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
