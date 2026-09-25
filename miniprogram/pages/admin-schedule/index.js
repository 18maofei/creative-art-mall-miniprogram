const { adminCourses, adminClasses, createCourse, createClass, createSession } = require('../../services/api')
const app = getApp()

const toastError = (error, fallback) => wx.showToast({ title: (error && error.message) || fallback, icon: 'none' })

Page({
  data: { courses: [], classes: [], courseName: '', lessonCount: '12', price: '', className: '', selectedCourseId: '', selectedClassId: '', startsAt: '', endsAt: '', sequenceNo: '1' },
  onLoad() { this.loadData() },
  onInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  selectCourse(e) { this.setData({ selectedCourseId: e.currentTarget.dataset.id }) },
  selectClass(e) { this.setData({ selectedClassId: e.currentTarget.dataset.id }) },
  async loadData() {
    try {
      this.staff = await app.ensureStaff()
      if (!this.staff) throw new Error('当前账号没有后台身份')
      const [courses, classes] = await Promise.all([adminCourses(), adminClasses()])
      this.setData({ courses, classes })
    } catch (error) { toastError(error, '数据加载失败') }
  },
  async addCourse() {
    if (!this.data.courseName.trim() || !Number(this.data.lessonCount) || !Number(this.data.price)) return wx.showToast({ title: '请填写课程名称、课时和价格', icon: 'none' })
    try {
      await createCourse(undefined, { name: this.data.courseName, defaultLessonCount: Number(this.data.lessonCount), price: Number(this.data.price), status: 'ON_SALE' })
      this.setData({ courseName: '', price: '' }); this.loadData()
      wx.showToast({ title: '课程已创建', icon: 'success' })
    } catch (error) { toastError(error, '课程创建失败') }
  },
  async addClass() {
    if (!this.data.selectedCourseId || !this.data.className.trim()) return wx.showToast({ title: '请选择课程并填写班级名称', icon: 'none' })
    try {
      await createClass(undefined, { courseId: this.data.selectedCourseId, name: this.data.className, capacity: 20 })
      this.setData({ className: '' }); this.loadData()
      wx.showToast({ title: '班级已创建', icon: 'success' })
    } catch (error) { toastError(error, '班级创建失败') }
  },
  async addSession() {
    if (!this.data.selectedClassId || !this.data.startsAt || !this.data.endsAt || !Number(this.data.sequenceNo)) return wx.showToast({ title: '请完整填写课次信息', icon: 'none' })
    try {
      // Time strings are passed through so the server validates the lesson time range.
      await createSession(undefined, this.data.selectedClassId, { sequenceNo: Number(this.data.sequenceNo), startsAt: this.data.startsAt, endsAt: this.data.endsAt })
      this.setData({ startsAt: '', endsAt: '', sequenceNo: String(Number(this.data.sequenceNo) + 1) })
      this.loadData()
      wx.showToast({ title: '课次已添加', icon: 'success' })
    } catch (error) { toastError(error, '课次添加失败') }
  }
})
