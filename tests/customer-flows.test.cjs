const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.join(__dirname, '../miniprogram')
const tick = () => new Promise(resolve => setImmediate(resolve))
function page(name, api = {}, appOverrides = {}, wxOverrides = {}) {
  let definition
  const modals = [], navigations = [], storage = new Map()
  const app = { ensureLogin: async () => 1, refreshUser: async () => ({ id: 1, name: '客户' }), hasPermission: () => true, globalData: { user: { id: 1 } }, isPaymentEnabled: () => true, payOrder: async () => ({ status: 'PAID' }), ...appOverrides }
  const wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), showToast() {}, pageScrollTo() {}, showModal: options => { modals.push(options); options.success?.({ confirm: true }) }, navigateTo: options => navigations.push(options.url), redirectTo: options => navigations.push(options.url), switchTab: options => navigations.push(options.url), ...wxOverrides }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages', name, 'index.js'), 'utf8'), {
    getApp: () => app, Page: value => { definition = value }, wx,
    require: file => file.includes('favorites') ? { list: () => [] } : { recordEvent() {}, mediaUrl: value => value, ...api }
  })
  const p = { ...definition, data: structuredClone(definition.data), setData(patch) { for (const [key, value] of Object.entries(patch)) { const parts = key.split('.'); let target = this.data; while (parts.length > 1) target = target[parts.shift()]; target[parts[0]] = value } } }
  return { p, app, wx, modals, navigations }
}
const tap = id => ({ currentTarget: { dataset: { id } } })

test('所有注册页面的 WXML 事件都有对应处理函数', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  for (const route of config.pages) {
    const { p } = page(route.split('/')[1])
    const markup = fs.readFileSync(path.join(root, route + '.wxml'), 'utf8')
    for (const match of markup.matchAll(/(?:bind|catch):?[a-z]+="([A-Za-z_$][\w$]*)"/g)) assert.equal(typeof p[match[1]], 'function', route + ': ' + match[1])
  }
})

test('首页不渲染客户概览区；推荐卡进入对应详情', async () => {
  const { p, navigations } = page('home', { bootstrap: async () => ({ courses: [{ id: 8, title: '课程甲' }, { id: 9, title: '课程乙' }] }), announcements: async () => [] })
  await p.loadData(); await p.onShow()
  const markup = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8')
  assert.doesNotMatch(markup, /member-card|quick-grid/)
  p.openCourse(tap(8)); assert.equal(navigations[0], '/pages/course-detail/index?id=8')
})

test('地址编辑使用更新接口，失败保留表单且拦截重复点击', async () => {
  let writes = 0, reject
  const { p } = page('address', { addresses: async () => [], updateAddress: () => { writes++; return new Promise((_, r) => { reject = r }) } })
  await p.loadAddresses()
  p.setData({ editingId: 12, form: { recipientName: '测试', mobile: '13800000000', province: '省', city: '市', district: '区', detail: '测试地址' } })
  const save = p.submit(); await p.submit(); assert.equal(writes, 1)
  reject(new Error('网络失败')); await save
  assert.equal(p.data.form.detail, '测试地址'); assert.equal(p.data.editingId, 12); assert.equal(p.data.submitting, false)
})

test('结算从登录开始加锁，支付取消后保留订单入口而不重复下单', async () => {
  let finishLogin, orders = 0
  const { p, modals } = page('shop', { addresses: async () => [{ id: 1, detail: '测试地址' }], createOrder: async () => { orders++; return { id: 10 } } }, { ensureLogin: () => new Promise(resolve => { finishLogin = resolve }), payOrder: async () => { throw { errMsg: 'requestPayment:fail cancel' } } })
  p.syncCart([{ id: 1, name: '画纸', price: 10, quantity: 1 }])
  const saving = p.checkout(); await p.checkout(); assert.equal(p.data.checking, true)
  finishLogin(1); await saving
  assert.equal(orders, 1); assert.equal(p.data.cart.length, 0); assert.equal(p.data.checking, false)
  assert.ok(modals.some(item => item.title === '订单已创建'))
})

test('预约拒绝过去日期；网络重试复用同一请求标识', async () => {
  const keys = []
  const { p } = page('trial-appointment', { createTrialAppointment: async data => { keys.push(data.idempotencyKey); throw new Error('网络失败') } })
  p.setData({ guardianName: '测试', childName: '测试学员', mobile: '13800000000', preferredDate: '2000-01-01' })
  await p.submit(); assert.equal(keys.length, 0)
  p.setData({ preferredDate: p.localDate() }); await p.submit(); await p.submit()
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]); assert.equal(p.data.guardianName, '测试')
})

test('课程网络失败后可重试，筛选条件保持；学习页登录失败结束加载', async () => {
  let fail = true
  const { p } = page('course', { courses: async () => { if (fail) throw new Error('网络失败'); return [{ name: '水彩', category: '绘画' }, { name: '陶艺', category: '手工' }] } })
  p.setData({ selected: '绘画', keyword: '水彩' }); await p.loadData(); assert.equal(p.data.loadError, '网络失败')
  fail = false; await p.loadData(); assert.equal(p.data.courses.length, 1); assert.equal(p.data.loadError, '')
  const leave = page('leave', {}, { ensureLogin: async () => null }).p
  await leave.loadData(); assert.equal(leave.data.loading, false); assert.ok(leave.data.loadError)
})

test('网络错误不会清除会话，明确的 401 才清除', async () => {
  let definition, failure = new Error('离线'), token = 'test-token', removed = 0
  const context = { App: value => { definition = value }, getApp: () => definition, require: file => file === './config.js' ? { apiBaseUrl: 'https://example.test' } : { authMe: async () => { throw failure } }, wx: { getStorageSync: () => token, removeStorageSync: () => { removed++; token = '' } }, setTimeout }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context)
  await assert.rejects(definition.refreshUser()); assert.equal(removed, 0)
  failure = Object.assign(new Error('expired'), { statusCode: 401 })
  await assert.rejects(definition.refreshUser()); assert.ok(removed > 0)
})

test('API 在 App 初始化时加载，之后可正常读取实例与请求', async () => {
  let app
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'services/api.js'), 'utf8'), { module, getApp: () => app, wx: { getStorageSync: () => '', request: options => options.success({ statusCode: 200, data: { data: [] } }) } })
  app = { globalData: { apiBaseUrl: 'https://example.test' } }
  const result = await module.exports.courses(); assert.equal(result.length, 0)
})

test('微信手机号授权凭证随首次登录提交；设置页可补绑手机号', async () => {
  let loginPhoneCode = ''
  const profile = page('profile', {}, {
    refreshUser: async () => null,
    login: async (_openid, phoneCode) => { loginPhoneCode = phoneCode; return { id: 1, name: '客户' } }
  }, { showLoading() {}, hideLoading() {} }).p
  await profile.getPhoneNumber({ detail: { code: 'phone-code' } })
  assert.equal(loginPhoneCode, 'phone-code')

  const settings = page('settings', {}, {
    bindWechatPhone: async code => ({ id: 1, mobile: code === 'phone-code' ? '13800000000' : '' })
  }).p
  settings.setData({ loading: false })
  await settings.bindWechatPhone({ detail: { code: 'phone-code' } })
  assert.equal(settings.data.mobile, '13800000000')
})

test('切换课时账户时慢响应不会覆盖最新学员', async () => {
  const pending = new Map()
  const { p } = page('lesson-ledger', { lessonLedger: (_, id) => new Promise(resolve => pending.set(id, resolve)) })
  p.userId = 1; p.setData({ students: [{ id: 1 }, { id: 2 }] })
  const first = p.onStudentChange({ detail: { value: '0' } }), second = p.onStudentChange({ detail: { value: '1' } })
  pending.get(2)([{ id: 20, quantity: 2 }]); await second
  pending.get(1)([{ id: 10, quantity: 1 }]); await first
  assert.equal(p.data.selectedChildId, 2); assert.equal(p.data.entries[0].id, 20)
})
