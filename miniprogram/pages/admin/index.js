const { adminOverview, adminChildren, adminClasses } = require('../../services/api')
const app = getApp()

Page({
  data: {
    overview: { children: 0, activeClasses: 0, scheduledSessions: 0, pendingOrders: 0 },
    children: [],
    classes: [],
    loadError: '',
    managementActions: [
      { title: '课程排班', description: '课程、班级、教师与课次', url: '/pages/admin-schedule/index' },
      { title: '订单处理', description: '发货、退款与订单状态', url: '/pages/admin-orders/index' },
      { title: '学员与课时', description: '新建学员与调整课时', url: '/pages/admin-ops/index' },
      { title: '班级报名', description: '为学员安排班级', url: '/pages/admin-enrollments/index' },
      { title: '监护人绑定', description: '关联家长与学员', url: '/pages/admin-guardians/index' },
      { title: '商品与库存', description: '管理商品和 SKU 库存', url: '/pages/admin-products/index' },
      { title: '请假审批', description: '处理家长请假申请', url: '/pages/admin-leaves/index' }
    ],
    loading: true
  },
  onLoad() {
    this.loadData()
  },
  onPullDownRefresh() {
    this.loadData(true)
  },
  async loadData(withRefresh) {
    this.setData({ loading: true, loadError: '' })
    try {
      const staff = await app.ensureStaff()
      if (!staff) throw new Error('当前账号没有后台身份')
      const [overview, children, classes] = await Promise.all([
        adminOverview(),
        adminChildren(),
        adminClasses()
      ])
      this.setData({
        overview,
        children: children.map(item => ({ ...item, initial: String(item.name || '').slice(0, 1) })),
        classes: classes.map(item => ({ ...item, teacherLabel: item.teacher_name || '待分配老师', campusLabel: `${item.campus || '未设置校区'} ${item.room || ''}`.trim() })),
        loading: false
      })
    } catch (error) {
      this.setData({ loading: false, loadError: error.message || '管理数据加载失败' })
      wx.showToast({ title: '加载管理数据失败', icon: 'none' })
    } finally {
      if (withRefresh) wx.stopPullDownRefresh()
    }
  },
  openStudent(e) {
    const student = e.currentTarget.dataset.student
    wx.showModal({ title: student.name, content: `剩余 ${student.remaining_lessons} 次课时`, showCancel: false })
  },
  openLeaves() {
    wx.navigateTo({ url: '/pages/admin-leaves/index' })
  },
  openManagementPage(e) {
    const url = String(e.currentTarget.dataset.url || '')
    if (!this.data.managementActions.some(item => item.url === url)) return
    wx.navigateTo({ url })
  }
})
