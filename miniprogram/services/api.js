const app = getApp()

const mockState = {
  child: { name: '乐乐', remainingLessons: 12, validUntil: '2026/12/31' },
  lessons: [
    { date: '07/25', week: '周六', title: '创意美术启蒙班 · 第4课', time: '10:00-11:30', place: 'A校区 201', status: '待上课' },
    { date: '08/01', week: '周六', title: '创意美术启蒙班 · 第5课', time: '10:00-11:30', place: 'A校区 201', status: '已排课' }
  ],
  courses: [
    { id: 'course-art', name: '创意美术启蒙班', age: '6-8岁', lessons: 12, schedule: '每周六 10:00-11:30', price: 1680, color: 'sand', description: '通过色彩、构图和手作创作，帮助孩子建立观察力、表达力与创造力。' },
    { id: 'course-sketch', name: '少儿创作进阶班', age: '8-11岁', lessons: 16, schedule: '每周日 14:00-15:30', price: 2280, color: 'blue', description: '从主题表达、材料探索到作品展示，持续发展孩子的创作能力。' }
  ],
  products: [
    { id: 'goods-kit', name: '儿童创作画材套装', desc: '画笔、颜料与画册组合', price: 99, color: 'pink' },
    { id: 'goods-bag', name: '画室原创帆布袋', desc: '课堂日常与作品收纳', price: 49, color: 'sand' }
  ],
  students: [
    { id: 's1', name: '乐乐', initial: '乐', state: '出勤', remaining: 12 },
    { id: 's2', name: '安安', initial: '安', state: '请假', remaining: 8 },
    { id: 's3', name: '小米', initial: '小', state: '出勤', remaining: 6 }
  ]
}

function request(path, method = 'GET', data) {
  if (app.globalData.demoMode) return Promise.resolve(mockState)
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${app.globalData.apiBaseUrl}${path}`,
      method,
      data,
      success: ({ data: response }) => resolve(response.data || response),
      fail: reject
    })
  })
}

function api(path, method = 'GET', data) {
  return request(path, method, data)
}

function devContext() {
  if (app.globalData.demoMode) return Promise.resolve({ parentUserId: 1, teacherUserId: 2, childId: 1 })
  return api('/api/dev/context')
}

function courses() { return app.globalData.demoMode ? Promise.resolve(mockState.courses) : api('/api/courses') }
function products() { return app.globalData.demoMode ? Promise.resolve(mockState.products) : api('/api/products') }
function parentDashboard(context) {
  if (app.globalData.demoMode) return Promise.resolve({ child: mockState.child, sessions: mockState.lessons })
  return api(`/api/parent/dashboard?parentUserId=${context.parentUserId}&childId=${context.childId}`)
}
function teacherSessions(context) { return app.globalData.demoMode ? Promise.resolve([{ id: 1 }]) : api(`/api/teacher/sessions?teacherUserId=${context.teacherUserId}`) }
function attendance(sessionId) { return app.globalData.demoMode ? Promise.resolve(mockState.students) : api(`/api/sessions/${sessionId}/attendance`) }
function confirmAttendance(sessionId, teacherUserId, records) {
  if (app.globalData.demoMode) return Promise.resolve({ records })
  return api(`/api/sessions/${sessionId}/attendance/confirm`, 'POST', { teacherUserId, records })
}
function createOrder(buyerUserId, items) {
  if (app.globalData.demoMode) return Promise.resolve({ orderNo: `DEMO${Date.now()}`, status: 'PENDING_PAYMENT' })
  return api('/api/orders', 'POST', { buyerUserId, items })
}

module.exports = { mockState, request, devContext, courses, products, parentDashboard, teacherSessions, attendance, confirmAttendance, createOrder }
