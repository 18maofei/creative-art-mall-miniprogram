const APP_CONFIG = require('./config.js')

// 登录流程：wx.login -> /api/auth/wechat-login。
// 角色、当前身份和权限全部来自服务端；本地缓存只保存会话令牌，不能作为授权依据。
// 演示 openid 只从本地配置读取，生产配置不包含这些账号标识。
const DEV_OPENIDS = APP_CONFIG.demoOpenids || {}

function normalizeRole(value) {
  const role = String(value || '').trim().toUpperCase()
  return ['PARENT', 'TEACHER', 'STUDENT', 'OPERATOR', 'ADMIN'].indexOf(role) >= 0 ? role : null
}

function roleCode(value) {
  return normalizeRole(value) ? String(value).trim().toLowerCase() : 'visitor'
}

// 微信 SDK 的失败回调通常返回 errMsg 而不是 Error，统一转换后页面才能显示真实原因。
function wxFailure(error, fallback) {
  if (error instanceof Error) return error
  const message = error && (error.errMsg || error.message || error.errorMessage)
  return new Error(String(message || fallback))
}

function authFailure(statusCode, data, fallback) {
  const message = data && (data.message || data.errmsg || data.error)
  const code = data && (data.errcode || data.code)
  if (message && code) return new Error(`${message}（错误码 ${code}）`)
  if (message) return new Error(String(message))
  return new Error(`${fallback}（HTTP ${statusCode || '未知'}）`)
}

App({
  globalData: {
    apiBaseUrl: String(APP_CONFIG.apiBaseUrl || '').replace(/\/+$/, ''),
    institutionName: APP_CONFIG.institutionName || '纯粹艺术文化',
    demoMode: APP_CONFIG.demoMode === true,
    allowInsecureHttp: APP_CONFIG.allowInsecureHttp === true,
    paymentMode: String(APP_CONFIG.paymentMode || 'disabled').toLowerCase(),
    currentRole: 'VISITOR',
    devContext: null,
    user: null,
    sessionRefreshing: false,
    sessionRefreshPromise: null,
    loginPromise: null,
    configErrorShown: false
  },
  onLaunch() {
    // 不把缓存用户直接当成已授权用户；有令牌时立即向后端刷新会话快照。
    this.globalData.user = null
    this.globalData.currentRole = 'VISITOR'
    if (!this.isApiConfigured()) {
      setTimeout(() => this.showConfigError(), 0)
      return
    }
    if (this.globalData.demoMode) this.loadDevContext().catch(() => undefined)
    // refreshUser 只会在仍使用同一枚旧 token 时清理会话；这里不能在 catch
    // 中无条件 logout，否则旧请求可能覆盖用户刚完成的新登录。
    if (wx.getStorageSync('zhixingToken')) this.refreshUser().catch(() => undefined)
  },
  isApiConfigured() {
    const url = String(this.globalData.apiBaseUrl || '')
    if (!url || /REPLACE_WITH_YOUR_WORKER_DOMAIN/i.test(url)) return false
    if (/^https:\/\//i.test(url)) return true
    return this.globalData.demoMode && this.globalData.allowInsecureHttp && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url)
  },
  showConfigError() {
    if (this.globalData.configErrorShown) return
    this.globalData.configErrorShown = true
    wx.showModal({
      title: '服务地址未配置',
      content: '请在 miniprogram/config.js 填写线上 HTTPS API 地址后重新编译。',
      showCancel: false
    })
  },
  canUseMockPayment() {
    return this.globalData.demoMode && this.globalData.paymentMode === 'mock'
  },
  canUseWechatPayment() {
    return !this.globalData.demoMode && this.globalData.paymentMode === 'wechat'
  },
  isPaymentEnabled() {
    return this.canUseMockPayment() || this.canUseWechatPayment()
  },
  async payOrder(orderId) {
    const api = require('./services/api.js')
    if (this.canUseMockPayment()) return api.mockPay(orderId)
    if (!this.canUseWechatPayment()) {
      this.showPaymentUnavailable()
      throw new Error('支付通道尚未开通')
    }
    const payment = await api.wechatPay(orderId)
    await new Promise((resolve, reject) => {
      wx.requestPayment({
        timeStamp: String(payment.timeStamp),
        nonceStr: payment.nonceStr,
        package: payment.package,
        signType: payment.signType || 'RSA',
        paySign: payment.paySign,
        success: resolve,
        fail: reject
      })
    })
    // 客户端支付成功只代表支付组件受理，最终状态以服务端验签回调为准。
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const latest = await api.orderStatus(orderId).catch(() => null)
      if (latest?.status === 'PAID' || latest?.status === 'SHIPPED' || latest?.status === 'COMPLETED') return latest
      if (latest?.status && latest.status !== 'PENDING_PAYMENT') throw new Error(`订单当前状态为 ${latest.status}`)
      await new Promise(resolve => setTimeout(resolve, 800))
    }
    return { status: 'PENDING_PAYMENT', pending: true }
  },
  showPaymentUnavailable() {
    wx.showModal({
      title: '支付通道待开通',
      content: '当前已切换线上模式，微信支付商户配置完成后才能报名或购买。请联系画室管理员。',
      showCancel: false
    })
  },
  loadDevContext() {
    if (!this.globalData.demoMode) return Promise.reject(new Error('开发登录已关闭'))
    if (this.globalData.devContext) return Promise.resolve(this.globalData.devContext)
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${this.globalData.apiBaseUrl}/api/dev/context`,
        timeout: 15000,
        success: ({ statusCode, data }) => {
          if (statusCode >= 200 && statusCode < 300 && data && data.data) {
            this.globalData.devContext = data.data
            resolve(data.data)
          } else reject(new Error('dev context unavailable'))
        },
        fail: reject
      })
    })
  },
  wxLoginCode() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: res => (res.code ? resolve(res.code) : reject(new Error('wx.login 未返回 code'))),
        fail: error => reject(wxFailure(error, '微信登录接口调用失败'))
      })
    })
  },
  async login(devOpenid, phoneCode) {
    if (!this.isApiConfigured()) {
      this.showConfigError()
      throw new Error('线上 API 地址未配置')
    }
    if (this.globalData.loginPromise) return this.globalData.loginPromise

    const loginTask = (async () => {
      // wx.login 返回的 code 只能使用一次，避免快速连续点击造成前一个 code 被抢先消费。
      const code = await this.wxLoginCode()
      const payload = { code }
      if (this.globalData.demoMode && devOpenid) payload.devOpenid = devOpenid
      if (phoneCode) payload.phoneCode = phoneCode
      const result = await new Promise((resolve, reject) => {
        wx.request({
          url: `${this.globalData.apiBaseUrl}/api/auth/wechat-login`,
          method: 'POST',
          header: { 'content-type': 'application/json' },
          data: payload,
          timeout: 15000,
          success: ({ statusCode, data }) => {
            if (statusCode >= 200 && statusCode < 300 && data && data.data) resolve(data.data)
            else reject(authFailure(statusCode, data, '登录失败'))
          },
          fail: error => reject(wxFailure(error, '登录请求失败'))
        })
      })
      this.applySession(result)
      return result.user
    })()

    this.globalData.loginPromise = loginTask
    try {
      return await loginTask
    } finally {
      if (this.globalData.loginPromise === loginTask) this.globalData.loginPromise = null
    }
  },
  applySession(result) {
    if (!result || !result.user) throw new Error('服务端未返回有效用户会话')
    wx.setStorageSync('zhixingToken', result.token)
    wx.setStorageSync('zhixingUserId', result.user.id)
    // 仅作为离线展示缓存，页面显示权限前仍必须调用 refreshUser。
    wx.setStorageSync('zhixingUser', result.user)
    this.globalData.user = result.user
    this.globalData.currentRole = this.serverRole(result.user.currentRole)
  },
  // 资料保存后使用服务端返回的新快照，避免页面只改本地显示而未真正落库。
  async updateProfile(payload) {
    const api = require('./services/api.js')
    const result = await api.updateProfile(payload)
    this.applySession({ token: wx.getStorageSync('zhixingToken'), user: result.user })
    return result.user
  },
  async bindWechatPhone(phoneCode) {
    if (!phoneCode) throw new Error('微信手机号授权凭证无效，请重新授权')
    const api = require('./services/api.js')
    const result = await api.bindWechatPhone(phoneCode)
    this.applySession({ token: wx.getStorageSync('zhixingToken'), user: result.user })
    return result.user
  },
  async uploadProfileAvatar(filePath, nickname) {
    const api = require('./services/api.js')
    const result = await api.uploadProfileAvatar(filePath, nickname)
    const user = result && result.user ? { ...result.user } : null
    if (!user) throw new Error('头像上传成功，但服务端没有返回用户资料')
    const avatarUrl = result.avatarUrl || user.avatarUrl || user.avatar_url || user.avatar || ''
    if (avatarUrl) {
      user.avatarUrl = avatarUrl
      user.avatar_url = avatarUrl
      user.avatar = avatarUrl
    }
    this.applySession({ token: wx.getStorageSync('zhixingToken'), user })
    return user
  },
  serverRole(value) {
    const role = normalizeRole(value)
    return role || 'VISITOR'
  },
  // 客户端只保留教师工作台；普通用户直接使用首页和底部业务页面。
  roleLandingPage(user = this.globalData.user) {
    const role = this.serverRole(user?.currentRole)
    if (role === 'TEACHER') return '/pages/teacher/index'
    return '/pages/home/index'
  },
  redirectToRolePage(user = this.globalData.user) {
    return new Promise(resolve => {
      wx.reLaunch({ url: this.roleLandingPage(user), complete: resolve })
    })
  },
  logout() {
    wx.removeStorageSync('zhixingToken')
    wx.removeStorageSync('zhixingUserId')
    wx.removeStorageSync('zhixingUser')
    wx.removeStorageSync('zhixingRole')
    this.globalData.user = null
    this.globalData.currentRole = 'VISITOR'
  },
  async refreshUser() {
    const token = wx.getStorageSync('zhixingToken')
    if (!token) {
      this.globalData.user = null
      this.globalData.currentRole = 'VISITOR'
      return null
    }

    const pending = this.globalData.sessionRefreshPromise
    if (pending && pending.token === token) return pending.promise

    this.globalData.sessionRefreshing = true
    const refreshTask = (async () => {
      // 延迟加载，避免 app.js 初始化阶段与 services/api.js 的 getApp() 形成循环。
      const api = require('./services/api.js')
      try {
        const result = await api.authMe()
        // 登录期间 token 若已更新，旧请求不能覆盖新会话。
        if (wx.getStorageSync('zhixingToken') !== token) return this.globalData.user
        this.applySession({ token, user: result.user })
        return result.user
      } catch (error) {
        // 只清理本次请求验证的 token，避免旧 token 失效时误删新登录会话。
        if (wx.getStorageSync('zhixingToken') === token && error.statusCode === 401) this.logout()
        throw error
      }
    })()

    const entry = { token, promise: refreshTask }
    this.globalData.sessionRefreshPromise = entry
    try {
      return await refreshTask
    } finally {
      if (this.globalData.sessionRefreshPromise === entry) {
        this.globalData.sessionRefreshPromise = null
        this.globalData.sessionRefreshing = false
      }
    }
  },
  availableRoles() {
    const roles = this.globalData.user && Array.isArray(this.globalData.user.roles) ? this.globalData.user.roles : []
    return roles.filter(item => item && item.status !== 'disabled' && item.status !== 'DISABLED')
  },
  hasRole(role) {
    const target = roleCode(role)
    return this.availableRoles().some(item => String(item.code || '').toLowerCase() === target || normalizeRole(item.code) === normalizeRole(role))
  },
  hasPermission(permission) {
    return Boolean(this.globalData.user && Array.isArray(this.globalData.user.permissions) && this.globalData.user.permissions.indexOf(permission) >= 0)
  },
  // 只允许切换当前账号已经拥有的身份，成功后使用后端新签发的令牌。
  async switchRole(role) {
    const target = normalizeRole(role)
    if (!target) throw new Error('无效身份')
    if (!wx.getStorageSync('zhixingToken')) await this.login()
    if (!this.hasRole(target)) throw new Error('该账号没有此身份')
    const api = require('./services/api.js')
    const result = await api.switchRole(roleCode(target))
    this.applySession(result)
    return result.user
  },
  // 只要求已登录，不要求特定角色（下单、地址等场景）。
  async ensureLogin() {
    if (!this.isApiConfigured()) {
      this.showConfigError()
      return null
    }
    try {
      const user = await this.refreshUser()
      if (user) return user.id
      const loggedIn = await this.login()
      return loggedIn.id
    } catch (error) { return null }
  },
  // 要求具备指定角色；已登录时不会靠前端缓存切换身份。
  async ensureUser(role) {
    const target = normalizeRole(role)
    if (!target) { this.logout(); return null }
    try {
      let user = await this.refreshUser().catch(() => null)
      if (!user) {
        const devMode = this.globalData.demoMode && await this.loadDevContext().then(() => true).catch(() => false)
        user = await this.login(devMode ? DEV_OPENIDS[target] : undefined)
      }
      if (!this.hasRole(target)) return null
      if (this.serverRole(user.currentRole) !== target) user = await this.switchRole(target)
      return user.id
    } catch (error) { return null }
  },
  // 管理页面只请求后台工作身份，具体是运营人员还是超级管理员由服务端角色列表决定。
  async ensureStaff() {
    try {
      let user = await this.refreshUser().catch(() => null)
      if (!user) {
        const devMode = this.globalData.demoMode && await this.loadDevContext().then(() => true).catch(() => false)
        user = await this.login(devMode ? DEV_OPENIDS.ADMIN : undefined)
      }
      const target = this.hasRole('ADMIN') ? 'ADMIN' : this.hasRole('OPERATOR') ? 'OPERATOR' : null
      if (!target) return null
      if (this.serverRole(user.currentRole) !== target) user = await this.switchRole(target)
      return user
    } catch (error) { return null }
  },
  // 兼容旧页面调用；实际操作仍然走服务端切换接口。
  async setRole(role) {
    if (String(role).toUpperCase() === 'VISITOR') { this.logout(); return null }
    return this.switchRole(role)
  }
})
