const { adminChildren, adminClasses, createEnrollment } = require('../../services/api')
const app = getApp()

Page({
  data: { children: [], classes: [], childId: '', classId: '' },
  onLoad() { this.loadData() },
  selectChild(e) { this.setData({ childId: e.currentTarget.dataset.id }) },
  selectClass(e) { this.setData({ classId: e.currentTarget.dataset.id }) },
  async loadData() {
    this.staff = await app.ensureStaff()
    if (!this.staff) throw new Error('当前账号没有后台身份')
    const [children, classes] = await Promise.all([adminChildren(), adminClasses()])
    this.setData({ children, classes })
  },
  async submit() {
    if (!this.data.childId || !this.data.classId) return wx.showToast({ title: '请选择学生和班级', icon: 'none' })
    try {
      // The server locks class capacity and prevents duplicate active enrollment.
      await createEnrollment(undefined, this.data.childId, this.data.classId)
      wx.showToast({ title: '报名成功', icon: 'success' })
      this.loadData()
    } catch (error) { wx.showToast({ title: '报名失败或班级已满', icon: 'none' }) }
  }
})
