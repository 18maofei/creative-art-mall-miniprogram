const { adminCourses, adminClasses, adminUsers, createCourse, createClass, updateClassTeacher, createSession } = require('../../services/api')
const app = getApp()

const toastError = (error, fallback) => wx.showToast({ title: (error && error.message) || fallback, icon: 'none' })

Page({
  data: { courses: [], classes: [], teachers: [], loading: true, loadError: '', savingCourse: false, savingClass: false, savingTeacher: false, savingSession: false, teacherLabels: ['未分配'], selectedTeacherId: '', selectedTeacherIndex: 0, courseName: '', lessonCount: '12', price: '', className: '', selectedCourseId: '', selectedClassId: '', startsAt: '', endsAt: '', sequenceNo: '1' },
  onLoad() { this.loadData() },
  onInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  selectCourse(e) { this.setData({ selectedCourseId: e.currentTarget.dataset.id }) },
  selectClass(e) {
    const selectedClassId = e.currentTarget.dataset.id
    const klass = this.data.classes.find(item => String(item.id) === String(selectedClassId))
    const selectedTeacherIndex = Math.max(0, this.data.teachers.findIndex(item => String(item.id) === String(klass?.teacher_user_id)) + 1)
    this.setData({ selectedClassId, selectedTeacherIndex, selectedTeacherId: selectedTeacherIndex ? this.data.teachers[selectedTeacherIndex - 1]?.id || '' : '' })
  },
  selectTeacher(e) {
    const selectedTeacherIndex = Number(e.detail.value) || 0
    this.setData({ selectedTeacherIndex, selectedTeacherId: selectedTeacherIndex ? this.data.teachers[selectedTeacherIndex - 1]?.id || '' : '' })
  },
  async loadData() {
    this.setData({ loading: true, loadError: '' })
    try {
      this.staff = await app.ensureStaff()
      if (!this.staff) throw new Error('当前账号没有后台身份')
      const [courses, classes, teacherRows] = await Promise.all([adminCourses(), adminClasses(), adminUsers(undefined, 'TEACHER')])
      const teachers = teacherRows.filter(item => item.status === 'ACTIVE')
      this.setData({ courses, classes, teachers, teacherLabels: ['未分配', ...teachers.map(item => item.name || `教师 ${item.id}`)] })
    } catch (error) {
      this.setData({ loadError: error.message || '排课数据加载失败' })
    } finally { this.setData({ loading: false }) }
  },
  async addCourse() {
    if (this.data.savingCourse) return
    if (!this.data.courseName.trim() || !Number(this.data.lessonCount) || !Number(this.data.price)) return wx.showToast({ title: '请填写课程名称、课时和价格', icon: 'none' })
    this.setData({ savingCourse: true })
    try {
      await createCourse(undefined, { name: this.data.courseName, defaultLessonCount: Number(this.data.lessonCount), price: Number(this.data.price), status: 'ON_SALE' })
      this.setData({ courseName: '', price: '' }); await this.loadData()
      wx.showToast({ title: '课程已创建', icon: 'success' })
    } catch (error) { toastError(error, '课程创建失败') }
    finally { this.setData({ savingCourse: false }) }
  },
  async addClass() {
    if (this.data.savingClass) return
    if (!this.data.selectedCourseId || !this.data.className.trim()) return wx.showToast({ title: '请选择课程并填写班级名称', icon: 'none' })
    this.setData({ savingClass: true })
    try {
      await createClass(undefined, { courseId: this.data.selectedCourseId, teacherUserId: this.data.selectedTeacherId || undefined, name: this.data.className, capacity: 20 })
      this.setData({ className: '' }); await this.loadData()
      wx.showToast({ title: '班级已创建', icon: 'success' })
    } catch (error) { toastError(error, '班级创建失败') }
    finally { this.setData({ savingClass: false }) }
  },
  async assignTeacher() {
    if (this.data.savingTeacher) return
    if (!this.data.selectedClassId) return wx.showToast({ title: '请先选择班级', icon: 'none' })
    this.setData({ savingTeacher: true })
    try {
      await updateClassTeacher(undefined, this.data.selectedClassId, this.data.selectedTeacherId)
      await this.loadData()
      wx.showToast({ title: '授课教师已更新', icon: 'success' })
    } catch (error) { toastError(error, '教师分配失败') }
    finally { this.setData({ savingTeacher: false }) }
  },
  async addSession() {
    if (this.data.savingSession) return
    if (!this.data.selectedClassId || !this.data.startsAt || !this.data.endsAt || !Number(this.data.sequenceNo)) return wx.showToast({ title: '请完整填写课次信息', icon: 'none' })
    this.setData({ savingSession: true })
    try {
      // Time strings are passed through so the server validates the lesson time range.
      await createSession(undefined, this.data.selectedClassId, { sequenceNo: Number(this.data.sequenceNo), startsAt: this.data.startsAt, endsAt: this.data.endsAt })
      this.setData({ startsAt: '', endsAt: '', sequenceNo: String(Number(this.data.sequenceNo) + 1) })
      await this.loadData()
      wx.showToast({ title: '课次已添加', icon: 'success' })
    } catch (error) { toastError(error, '课次添加失败') }
    finally { this.setData({ savingSession: false }) }
  }
})
