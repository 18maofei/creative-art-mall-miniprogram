const { teacherSessions, attendance, confirmAttendance, submitSessionFeedback, announcements, recordEvent } = require('../../services/api')
const app = getApp()

Page({
  data: { students: [], sessions: [], currentSession: null, locked: false, sessionId: null, notices: [], showFeedback: false, feedbackContent: '', feedbackHomework: '' },
  onShow() {
    recordEvent('page_view', 'teacher_dashboard', 'TEACHER')
    this.loadData()
  },
  async loadData() {
    const user = await app.refreshUser().catch(() => null)
    if (!user) return wx.showToast({ title: '请先登录', icon: 'none' })
    if (app.serverRole(user.currentRole) !== 'TEACHER') {
      return app.redirectToRolePage(user)
    }
    const teacherUserId = user.id
    this.teacherUserId = teacherUserId
    try {
      const [sessions, notices] = await Promise.all([
        teacherSessions(teacherUserId),
        announcements('TEACHER').catch(() => [])
      ])
      // 优先取最近一节未结束课程作为当前课次
      const current = sessions.find(item => item.status === 'SCHEDULED') || sessions[0] || null
      const sessionId = current && current.id
      const students = sessionId ? await attendance(sessionId) : []
      this.setData({
        sessions,
        currentSession: current,
        sessionId,
        notices: notices.slice(0, 2),
        students: students.map(item => ({ ...item, initial: String(item.name || '').slice(0, 1) }))
      })
    } catch (error) { wx.showToast({ title: '教师数据加载失败', icon: 'none' }) }
  },
  choose(e) {
    const index = e.currentTarget.dataset.index
    const status = e.currentTarget.dataset.status
    const students = this.data.students.slice()
    students[index].status = status
    this.setData({ students })
  },
  async submit() {
    if (!this.data.sessionId) return wx.showToast({ title: '暂无待考勤课程', icon: 'none' })
    try {
      await confirmAttendance(this.data.sessionId, this.data.students.map(item => ({ studentId: item.student_id, status: item.status })))
      this.setData({ locked: true })
      wx.showToast({ title: '考勤已确认，已扣减出勤课时', icon: 'none' })
      this.loadData()
    } catch (error) { wx.showToast({ title: error.message || '考勤提交失败', icon: 'none' }) }
  },
  openFeedback() {
    if (!this.data.sessionId) return wx.showToast({ title: '暂无课次', icon: 'none' })
    this.setData({ showFeedback: true })
  },
  closeFeedback() { this.setData({ showFeedback: false }) },
  noop() {},
  onFeedbackInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  async sendFeedback() {
    if (!this.data.feedbackContent.trim()) return wx.showToast({ title: '请填写反馈内容', icon: 'none' })
    try {
      await submitSessionFeedback(this.data.sessionId, {
        teacherUserId: this.teacherUserId,
        content: this.data.feedbackContent,
        homework: this.data.feedbackHomework || null
      })
      this.setData({ showFeedback: false, feedbackContent: '', feedbackHomework: '' })
      wx.showToast({ title: '反馈已发布', icon: 'success' })
    } catch (error) { wx.showToast({ title: error.message || '发布失败', icon: 'none' }) }
  },
  goSchedule() { wx.navigateTo({ url: '/pages/class-schedule/index?role=TEACHER' }) },
  goProfile() { wx.switchTab({ url: '/pages/profile/index' }) },
  goShop() { wx.switchTab({ url: '/pages/shop/index' }) },
  goHome() { wx.reLaunch({ url: '/pages/teacher/index' }) }
})
