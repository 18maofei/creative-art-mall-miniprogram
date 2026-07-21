const app = getApp()

const mockState = {
  addresses: [],
  orders: [],
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
  if (app.globalData.demoMode) return Promise.resolve({ parentUserId: 1, teacherUserId: 2, adminUserId: 3, childId: 1 })
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
function createOrder(buyerUserId, items, shippingAddressId) {
  if (app.globalData.demoMode) { const orderNo = `DEMO${Date.now()}`; mockState.orders.unshift({ id: Date.now(), order_no: orderNo, total_amount: items.reduce((sum, item) => sum + item.quantity, 0), status: 'PENDING_PAYMENT', shipping_address_snapshot: mockState.addresses[0]?.detail || '' }); return Promise.resolve({ orderNo, status: 'PENDING_PAYMENT' }) }
  return api('/api/orders', 'POST', { buyerUserId, items, shippingAddressId })
}

function addresses(userId) {
  if (app.globalData.demoMode) return Promise.resolve(mockState.addresses)
  return api(`/api/addresses?userId=${userId}`)
}
function createAddress(data) {
  if (app.globalData.demoMode) { const id = Date.now(); mockState.addresses = [{ id, recipient_name: data.recipientName, mobile: data.mobile, province: data.province, city: data.city, district: data.district, detail: data.detail, is_default: true }]; return Promise.resolve({ id, isDefault: true }) }
  return api('/api/addresses', 'POST', data)
}
function userOrders(buyerUserId) {
  if (app.globalData.demoMode) return Promise.resolve(mockState.orders)
  return api(`/api/orders?buyerUserId=${buyerUserId}`)
}
function createChild(adminUserId, data) {
  if (app.globalData.demoMode) return Promise.resolve({ id: Date.now() })
  return api('/api/admin/children', 'POST', { adminUserId, ...data })
}
function adjustLessons(adminUserId, childId, data) {
  if (app.globalData.demoMode) return Promise.resolve({ id: Date.now(), balanceAfter: 12, duplicate: false })
  return api(`/api/admin/children/${childId}/lesson-adjustments`, 'POST', { adminUserId, ...data })
}
function adminOrders(adminUserId) {
  if (app.globalData.demoMode) return Promise.resolve([])
  return api(`/api/admin/orders?adminUserId=${adminUserId}`)
}
function updateOrderStatus(adminUserId, orderId, status, trackingNo) {
  if (app.globalData.demoMode) return Promise.resolve({ id: orderId, status })
  return api(`/api/admin/orders/${orderId}/status`, 'PATCH', { adminUserId, status, trackingNo })
}
function adminCourses(adminUserId) {
  if (app.globalData.demoMode) return Promise.resolve(mockState.courses.map((course, index) => ({ id: index + 1, name: course.name, age_range: course.age, default_lesson_count: course.lessons, price: course.price, status: 'ON_SALE' })))
  return api(`/api/admin/courses?adminUserId=${adminUserId}`)
}
function createCourse(adminUserId, data) {
  if (app.globalData.demoMode) return Promise.resolve({ id: Date.now() })
  return api('/api/admin/courses', 'POST', { adminUserId, ...data })
}
function createClass(adminUserId, data) {
  if (app.globalData.demoMode) return Promise.resolve({ id: Date.now() })
  return api('/api/admin/classes', 'POST', { adminUserId, ...data })
}
function createSession(adminUserId, classId, data) {
  if (app.globalData.demoMode) return Promise.resolve({ id: Date.now() })
  return api(`/api/admin/classes/${classId}/sessions`, 'POST', { adminUserId, ...data })
}
function createParent(adminUserId, data) {
  if (app.globalData.demoMode) return Promise.resolve({ id: Date.now() })
  return api('/api/admin/parents', 'POST', { adminUserId, ...data })
}
function bindGuardian(adminUserId, childId, parentUserId, relationship) {
  if (app.globalData.demoMode) return Promise.resolve({ childId, parentUserId })
  return api(`/api/admin/children/${childId}/guardians`, 'POST', { adminUserId, parentUserId, relationship })
}
function adminProducts(adminUserId) {
  if (app.globalData.demoMode) return Promise.resolve([])
  return api(`/api/admin/products?adminUserId=${adminUserId}`)
}
function createProduct(adminUserId, data) {
  if (app.globalData.demoMode) return Promise.resolve({ id: Date.now() })
  return api('/api/admin/products', 'POST', { adminUserId, ...data })
}
function adjustStock(adminUserId, skuId, data) {
  if (app.globalData.demoMode) return Promise.resolve({ id: skuId, stockQuantity: 100 })
  return api(`/api/admin/skus/${skuId}/stock`, 'PATCH', { adminUserId, ...data })
}
function createEnrollment(adminUserId, childId, classId) {
  if (app.globalData.demoMode) return Promise.resolve({ childId, classId, status: 'ACTIVE' })
  return api('/api/admin/enrollments', 'POST', { adminUserId, childId, classId })
}

function adminOverview(adminUserId) {
  if (app.globalData.demoMode) return Promise.resolve({ children: 3, activeClasses: 1, scheduledSessions: 2, pendingOrders: 0 })
  return api(`/api/admin/overview?adminUserId=${adminUserId}`)
}
function adminChildren(adminUserId) {
  if (app.globalData.demoMode) return Promise.resolve(mockState.students.map((student, index) => ({ id: index + 1, name: student.name, remaining_lessons: student.remaining, active_enrollments: 1 })))
  return api(`/api/admin/children?adminUserId=${adminUserId}`)
}
function adminClasses(adminUserId) {
  if (app.globalData.demoMode) return Promise.resolve([{ id: 1, name: '创意美术启蒙班 · 周六班', course_name: '创意美术启蒙班', teacher_name: '王老师', enrolled_count: 3, capacity: 12, campus: 'A校区', room: '201' }])
  return api(`/api/admin/classes?adminUserId=${adminUserId}`)
}

module.exports = { mockState, request, devContext, courses, products, parentDashboard, teacherSessions, attendance, confirmAttendance, createOrder, addresses, createAddress, userOrders, createChild, adjustLessons, adminOrders, updateOrderStatus, adminCourses, createCourse, createClass, createSession, createParent, bindGuardian, adminProducts, createProduct, adjustStock, createEnrollment, adminOverview, adminChildren, adminClasses }
