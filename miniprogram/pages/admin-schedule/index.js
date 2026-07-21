const { devContext, adminCourses, adminClasses, createCourse, createClass, createSession } = require('../../services/api')

Page({
  data: { courses: [], classes: [], courseName: '', lessonCount: '12', price: '', className: '', selectedCourseId: '', selectedClassId: '', startsAt: '', endsAt: '', sequenceNo: '1' },
  onLoad() { this.loadData() },
  onInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  selectCourse(e) { this.setData({ selectedCourseId: e.currentTarget.dataset.id }) },
  selectClass(e) { this.setData({ selectedClassId: e.currentTarget.dataset.id }) },
  async loadData() {
    this.context = await devContext()
    const [courses, classes] = await Promise.all([adminCourses(this.context.adminUserId), adminClasses(this.context.adminUserId)])
    this.setData({ courses, classes })
  },
  async addCourse() {
    if (!this.data.courseName.trim() || !Number(this.data.lessonCount) || !Number(this.data.price)) return wx.showToast({ title: '请填写课程名称、课时和价格', icon: 'none' })
    await createCourse(this.context.adminUserId, { name: this.data.courseName, defaultLessonCount: Number(this.data.lessonCount), price: Number(this.data.price), status: 'ON_SALE' })
    this.setData({ courseName: '', price: '' }); this.loadData()
  },
  async addClass() {
    if (!this.data.selectedCourseId || !this.data.className.trim()) return wx.showToast({ title: '请选择课程并填写班级名称', icon: 'none' })
    await createClass(this.context.adminUserId, { courseId: this.data.selectedCourseId, name: this.data.className, capacity: 20 })
    this.setData({ className: '' }); this.loadData()
  },
  async addSession() {
    if (!this.data.selectedClassId || !this.data.startsAt || !this.data.endsAt || !Number(this.data.sequenceNo)) return wx.showToast({ title: '请完整填写课次信息', icon: 'none' })
    // Time strings are passed through so the server validates the lesson time range.
    await createSession(this.context.adminUserId, this.data.selectedClassId, { sequenceNo: Number(this.data.sequenceNo), startsAt: this.data.startsAt, endsAt: this.data.endsAt })
    wx.showToast({ title: '课次已添加', icon: 'success' })
  }
})
