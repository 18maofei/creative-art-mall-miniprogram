// App.onLaunch 可能先加载此模块；请求发出时再读取实例，不能缓存初始化期间的 undefined。
const app = { get globalData() { return getApp().globalData } }

function apiBaseUrl() {
  const value = String(app.globalData.apiBaseUrl || '').replace(/\/+$/, '')
  if (!value || /REPLACE_WITH_YOUR_WORKER_DOMAIN/i.test(value)) throw new Error('请先在 miniprogram/config.js 填写线上 API 地址')
  if (/^https:\/\//i.test(value)) return value
  if (app.globalData.demoMode && app.globalData.allowInsecureHttp && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(value)) return value
  throw new Error('小程序线上模式只允许 HTTPS API 地址')
}

function request(path, method = 'GET', data, adminUserId) {
  return new Promise((resolve, reject) => {
    let url
    try { url = `${apiBaseUrl()}${path}` } catch (error) { reject(error); return }
    const header = { 'content-type': 'application/json' }
    const token = wx.getStorageSync('zhixingToken')
    if (token) header.Authorization = `Bearer ${token}`
    if (adminUserId) header['X-Admin-User-Id'] = String(adminUserId)
    wx.request({
      url,
      method,
      data,
      header,
      timeout: 15000,
      success: ({ statusCode, data: response }) => {
        if (statusCode >= 200 && statusCode < 300 && response && Object.hasOwn(response, 'data')) return resolve(response.data)
        const error = new Error((response && response.message) || '请求失败，请稍后重试')
        error.statusCode = statusCode
        reject(error)
      },
      fail: error => reject(new Error(/timeout/i.test(error?.errMsg || '') ? '请求超时，请重试' : '网络连接失败，请检查网络后重试'))
    })
  })
}

// wx.uploadFile 用于头像等本地临时文件；响应仍要求使用统一 { data } 包装。
function uploadFile(path, filePath, formData = {}) {
  return new Promise((resolve, reject) => {
    let url
    try { url = `${apiBaseUrl()}${path}` } catch (error) { reject(error); return }
    const header = { Authorization: `Bearer ${wx.getStorageSync('zhixingToken')}` }
    wx.uploadFile({
      url,
      filePath,
      name: 'file',
      formData,
      header,
      timeout: 15000,
      success: ({ statusCode, data: raw }) => {
        let response = raw
        if (typeof raw === 'string') {
          try { response = raw ? JSON.parse(raw) : {} } catch { response = {} }
        }
        if (statusCode >= 200 && statusCode < 300 && response && Object.hasOwn(response, 'data')) return resolve(response.data)
        const message = response && (response.message || response.error || response.errMsg)
        reject(new Error(message || `上传失败（${statusCode || '网络异常'}）`))
      },
      fail: error => reject(new Error(error?.errMsg || error?.message || '头像上传网络失败'))
    })
  })
}

let devContextCache = null
function devContext() {
  if (devContextCache) return Promise.resolve(devContextCache)
  return request('/api/dev/context').then(context => {
    devContextCache = context
    return context
  })
}

function recordEvent(eventName, page, role) {
  const user = app.globalData.user
  return request('/api/events', 'POST', { eventName, page, role, userId: user ? user.id : undefined }).catch(() => undefined)
}

function mediaUrl(value) {
  if (!value) return ''
  if (value.indexOf('/api/assets/') === 0) return `${app.globalData.apiBaseUrl}${value}`
  const legacy = value.match(/r2\.cloudflarestorage\.com\/(.+)$/)
  return legacy ? `${app.globalData.apiBaseUrl}/api/assets/${legacy[1]}` : value
}

function normalizeCourse(item) {
  return {
    ...item,
    name: item.title,
    age: item.age_range || '年龄待定',
    lessons: Number(item.sessions || 0),
    schedule: item.schedule || '时间待定',
    description: item.description || '暂无课程介绍',
    cover_url: mediaUrl(item.cover_url)
  }
}
function normalizeProduct(item) { return { ...item, name: item.title, desc: item.description, cover_url: mediaUrl(item.cover_url) } }
function normalizeArtwork(item) { return { ...item, image_url: mediaUrl(item.image_url) } }

// ---------- 公开 ----------
function bootstrap() { return request('/api/public/bootstrap').then(data => ({ ...data, courses: (data.courses || []).map(normalizeCourse), products: (data.products || []).map(normalizeProduct), artworks: (data.artworks || []).map(normalizeArtwork) })) }
function courses() { return request('/api/courses').then(rows => rows.map(normalizeCourse)) }
function products() { return request('/api/products').then(rows => rows.map(normalizeProduct)) }
function artworks(kind) { return request(`/api/artworks${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`).then(rows => rows.map(normalizeArtwork)) }
function announcements(audience) { return request(`/api/announcements${audience ? `?audience=${audience}` : ''}`) }
function createTrialAppointment(payload) { return request('/api/trial-appointments', 'POST', payload) }

// 身份和权限只从服务端会话快照读取；本地缓存仅用于携带会话令牌。
function authMe() { return request('/api/auth/me') }
function switchRole(role) { return request('/api/auth/switch-role', 'POST', { role }) }
function bindWechatPhone(code) { return request('/api/auth/wechat-phone', 'POST', { code }) }

// ---------- 用户 ----------
function updateProfile(payload) { return request('/api/users/profile', 'PATCH', payload) }
function uploadProfileAvatar(filePath, nickname) { return uploadFile('/api/users/profile/avatar', filePath, nickname ? { nickname } : {}) }
function userDashboard(userId) { return request(`/api/users/${userId}/dashboard`) }
function userOrders(userId) { return request(`/api/users/${userId}/orders`) }
function userTrialAppointments(userId) { return request(`/api/users/${userId}/trial-appointments`) }
function lessonLedger(userId, childId) { return request(`/api/users/${userId}/lesson-ledger${childId ? `?childId=${encodeURIComponent(childId)}` : ''}`) }
function orderStatus(orderId) { return request(`/api/orders/${orderId}/status`) }
function createOrder(buyerUserId, type, subjectId, extra) { return request('/api/orders', 'POST', { buyerUserId, type, subjectId, ...(extra || {}) }) }
function mockPay(orderId, userId) { return request(`/api/orders/${orderId}/mock-pay`, 'POST', { userId }) }
function wechatPay(orderId) { return request(`/api/orders/${orderId}/pay`, 'POST') }
function confirmReceipt(orderId, userId) { return request(`/api/orders/${orderId}/confirm-receipt`, 'POST', { userId }) }
function cancelOrder(orderId, userId) { return request(`/api/orders/${orderId}/cancel`, 'POST', { userId }) }
function addresses(userId) { return request(`/api/users/${userId}/addresses`) }
function createAddress(payload) { return request(`/api/users/${payload.userId}/addresses`, 'POST', payload) }
function updateAddress(userId, addressId, patch) { return request(`/api/users/${userId}/addresses/${addressId}`, 'PATCH', patch) }
function deleteAddress(userId, addressId) { return request(`/api/users/${userId}/addresses/${addressId}`, 'DELETE') }
function leaveRequests(userId) { return request(`/api/users/${userId}/leave-requests`) }
function createLeaveRequest(payload) { return request('/api/leave-requests', 'POST', payload) }
function userFeedback(userId) { return request(`/api/users/${userId}/feedback`) }

// ---------- 教师 ----------
function teacherSessions(userId) { return request(`/api/teacher/${userId}/sessions`) }
function attendance(sessionId) { return request(`/api/sessions/${sessionId}/attendance`) }
function confirmAttendance(sessionId, records) { return request(`/api/sessions/${sessionId}/attendance`, 'POST', { records }) }
function submitSessionFeedback(sessionId, payload) { return request(`/api/sessions/${sessionId}/feedback`, 'POST', payload) }

// ---------- 管理端（开发模式经 X-Admin-User-Id 头登录） ----------
function adminOverview(adminUserId) { return request('/api/admin/overview', 'GET', undefined, adminUserId) }
function adminAnalytics(adminUserId) { return request('/api/admin/analytics', 'GET', undefined, adminUserId) }
function adminCourses(adminUserId) { return request('/api/admin/courses', 'GET', undefined, adminUserId) }
function createCourse(adminUserId, payload) { return request('/api/admin/courses', 'POST', payload, adminUserId) }
function adminProducts(adminUserId) {
  return request('/api/admin/products', 'GET', undefined, adminUserId).then(rows => {
    const flat = []
    for (const product of rows) {
      for (const sku of product.skus || []) {
        flat.push({ ...sku, product_id: product.id, product_name: product.title, product_status: product.status })
      }
    }
    return flat
  })
}
function createProduct(adminUserId, payload) { return request('/api/admin/products', 'POST', payload, adminUserId) }
function adjustStock(adminUserId, skuId, payload) { return request(`/api/admin/skus/${skuId}/stock`, 'POST', payload, adminUserId) }
function adminOrders(adminUserId) { return request('/api/admin/orders', 'GET', undefined, adminUserId) }
function updateOrderStatus(adminUserId, orderId, status, trackingNo) { return request(`/api/admin/orders/${orderId}`, 'PATCH', { status, trackingNo }, adminUserId) }
function adminChildren(adminUserId) { return request('/api/admin/children', 'GET', undefined, adminUserId) }
function createChild(adminUserId, payload) { return request('/api/admin/children', 'POST', payload, adminUserId) }
function adjustLessons(adminUserId, childId, payload) { return request(`/api/admin/children/${childId}/lessons`, 'POST', payload, adminUserId) }
function adminLessonLedger(adminUserId, childId) { return request(`/api/admin/children/${childId}/lesson-ledger`, 'GET', undefined, adminUserId) }
function adminTrialAppointments(adminUserId, status) { return request(`/api/admin/trial-appointments${status ? `?status=${encodeURIComponent(status)}` : ''}`, 'GET', undefined, adminUserId) }
function updateTrialAppointment(adminUserId, appointmentId, payload) { return request(`/api/admin/trial-appointments/${appointmentId}`, 'PATCH', payload, adminUserId) }
function createParent(adminUserId, payload) { return request('/api/admin/parents', 'POST', payload, adminUserId) }
function bindGuardian(adminUserId, childId, parentUserId, relationship) { return request('/api/admin/guardians', 'POST', { childId, parentUserId, relationship }, adminUserId) }
function adminClasses(adminUserId) { return request('/api/admin/classes', 'GET', undefined, adminUserId) }
function createClass(adminUserId, payload) { return request('/api/admin/classes', 'POST', payload, adminUserId) }
function createSession(adminUserId, classId, payload) { return request(`/api/admin/classes/${classId}/sessions`, 'POST', payload, adminUserId) }
function createEnrollment(adminUserId, childId, classId) { return request('/api/admin/enrollments', 'POST', { childId, classId }, adminUserId) }
function adminLeaveRequests(adminUserId, status) { return request(`/api/admin/leave-requests${status ? `?status=${status}` : ''}`, 'GET', undefined, adminUserId) }
function reviewLeaveRequest(adminUserId, requestId, status, reviewNote) { return request(`/api/admin/leave-requests/${requestId}`, 'PATCH', { status, reviewNote }, adminUserId) }
function adminAnnouncements(adminUserId) { return request('/api/admin/announcements', 'GET', undefined, adminUserId) }
function createAnnouncement(adminUserId, payload) { return request('/api/admin/announcements', 'POST', payload, adminUserId) }
function updateAnnouncement(adminUserId, announcementId, patch) { return request(`/api/admin/announcements/${announcementId}`, 'PATCH', patch, adminUserId) }

module.exports = {
  request, devContext, recordEvent, mediaUrl,
  authMe, switchRole, bindWechatPhone,
  updateProfile, uploadProfileAvatar,
  bootstrap, courses, products, artworks, announcements, createTrialAppointment,
  userDashboard, userOrders, userTrialAppointments, lessonLedger, orderStatus, createOrder, mockPay, wechatPay, confirmReceipt, cancelOrder,
  addresses, createAddress, updateAddress, deleteAddress,
  leaveRequests, createLeaveRequest, userFeedback,
  teacherSessions, attendance, confirmAttendance, submitSessionFeedback,
  adminOverview, adminAnalytics,
  adminCourses, createCourse,
  adminProducts, createProduct, adjustStock,
  adminOrders, updateOrderStatus,
  adminChildren, createChild, adjustLessons, adminLessonLedger, adminTrialAppointments, updateTrialAppointment, createParent, bindGuardian,
  adminClasses, createClass, createSession, createEnrollment,
  adminLeaveRequests, reviewLeaveRequest,
  adminAnnouncements, createAnnouncement, updateAnnouncement
}
