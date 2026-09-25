const app = getApp()
const { courses, createTrialAppointment } = require('../../services/api')

Page({
  data: {
    courses: [], courseOptions: ['不指定课程'], courseIndex: 0,
    guardianName: '', mobile: '', childName: '', childAge: '',
    preferredDate: '', preferredTime: 'ANY', preferredTimeLabel: '时间不限',
    timeOptions: ['时间不限', '上午', '下午', '晚上'], timeIndex: 0,
    note: '', loading: true, submitting: false, today: '', loadError: ''
  },
  onLoad(options = {}) { this.courseId = options.courseId; this.setData({ today: this.localDate() }); this.loadCourses() },
  localDate() { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-') },
  async loadCourses() {
    this.setData({ loading: true, loadError: '' })
    try {
      const list = await courses()
      this.setData({ courseIndex: this.courseId ? Math.max(0, list.findIndex(item => String(item.id) === String(this.courseId)) + 1) : this.data.courseIndex, courses: list || [], courseOptions: ['不指定课程', ...(list || []).map(item => item.name || item.title)], loading: false })
    } catch {
      this.setData({ loading: false, loadError: '课程选项加载失败，可重试或选择不指定课程' })
      wx.showToast({ title: '课程加载失败，可继续预约', icon: 'none' })
    }
  },
  onInput(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [field]: event.detail.value })
  },
  onCourseChange(event) { this.setData({ courseIndex: Number(event.detail.value) }) },
  onTimeChange(event) {
    const index = Number(event.detail.value)
    this.setData({ timeIndex: index, preferredTime: ['ANY', 'MORNING', 'AFTERNOON', 'EVENING'][index], preferredTimeLabel: this.data.timeOptions[index] })
  },
  onDateChange(event) { this.setData({ preferredDate: event.detail.value }) },
  buildIdempotencyKey() {
    const secureId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.floor(Math.random() * 100000)}`
    return `trial-${Date.now()}-${secureId}`
  },
  async submit() {
    if (this.data.submitting) return
    const guardianName = String(this.data.guardianName || '').trim()
    const mobile = String(this.data.mobile || '').trim()
    const childName = String(this.data.childName || '').trim()
    const age = this.data.childAge === '' ? null : Number(this.data.childAge)
    if (!guardianName) return wx.showToast({ title: '请填写联系人姓名', icon: 'none' })
    if (!/^1[3-9]\d{9}$/.test(mobile)) return wx.showToast({ title: '请填写正确的手机号', icon: 'none' })
    if (!childName) return wx.showToast({ title: '请填写孩子姓名', icon: 'none' })
    if (age !== null && (!Number.isInteger(age) || age < 2 || age > 18)) return wx.showToast({ title: '年龄请填写 2-18 岁', icon: 'none' })
    if (this.data.preferredDate && this.data.preferredDate < this.localDate()) return wx.showToast({ title: '请选择今天或以后的日期', icon: 'none' })
    const course = this.data.courses[this.data.courseIndex - 1]
    this.setData({ submitting: true })
    try {
      if (!await app.ensureLogin()) throw new Error('请先登录，预约后可在我的预约查看进度')
      const fingerprint = JSON.stringify([guardianName, mobile, childName, age, course?.id, this.data.preferredDate, this.data.preferredTime, this.data.note])
      if (fingerprint !== this.lastFingerprint) { this.lastFingerprint = fingerprint; this.pendingKey = this.buildIdempotencyKey() }
      const result = await createTrialAppointment({
        guardianName, mobile, childName, childAge: age,
        courseId: course ? course.id : undefined,
        preferredDate: this.data.preferredDate || undefined,
        preferredTime: this.data.preferredTime,
        note: String(this.data.note || '').trim() || undefined,
        idempotencyKey: this.pendingKey
      })
      await new Promise(resolve => wx.showModal({
        title: result.duplicate ? '预约已提交' : '预约成功',
        content: '画室老师会尽快联系您确认试听时间，请保持电话畅通。',
        showCancel: false,
        confirmText: '查看预约',
        success: () => { wx.redirectTo({ url: '/pages/trial-appointments/index' }); resolve() }, fail: resolve
      }))
    } catch (error) {
      wx.showToast({ title: error.message || '提交失败，请稍后重试', icon: 'none' })
    } finally { this.setData({ submitting: false }) }
  }
})
