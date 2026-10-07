const API = '/api'
// localStorage 只用于恢复会话令牌；导航和操作权限永远来自 /api/auth/me。
const state = { page: 'dashboard', token: localStorage.getItem('zhixing-admin-token') || '', adminName: '', user: null, permissions: [], publicPage: '' }
const $ = selector => document.querySelector(selector)
const pageInfo = {
  dashboard: ['运营仪表盘', '全局运营概览与访问趋势'], users: ['用户管理', '管理家长、学生、教师与访客用户'], access: ['身份与权限', '配置用户可用身份和权限覆盖'], children: ['学员管理', '学员档案、监护关系与课时账户'], courses: ['课程管理', '创建、发布和维护课程内容'], schedule: ['排课管理', '班级、课次发布与学员报名'], leaves: ['请假审批', '处理家长提交的请假申请'], trials: ['试听预约', '跟进家长提交的试听预约'], products: ['商品管理', '管理周边商品、库存与上架状态'], artworks: ['作品管理', '上传并发布学员作品与教学花絮'], resources: ['资源中心', '管理课件、宣传素材和业务文档'], orders: ['订单管理', '查看课程报名和商品订单'], reports: ['数据报表', '分析用户增长、访问和转化趋势'], announcements: ['公告管理', '发布面向用户和员工的运营通知'], settings: ['系统设置', '当前管理员账号与登录密码维护']
}
const navItems = [['dashboard', '▦', '仪表盘'], ['users', '♙', '用户管理'], ['access', '♢', '身份与权限'], ['children', '☺', '学员管理'], ['courses', '▣', '课程管理'], ['schedule', '▥', '排课管理'], ['leaves', '✈', '请假审批'], ['trials', '◷', '试听预约'], ['products', '♧', '商品管理'], ['artworks', '◈', '作品管理'], ['resources', '▤', '资源中心'], ['orders', '☷', '订单管理'], ['reports', '◌', '数据报表'], ['announcements', '♢', '公告管理'], ['settings', '⚙', '系统设置']]
const navPermissions = { dashboard: 'dashboard.read', users: 'user.read', access: 'identity.manage', children: 'child.read', courses: 'course.read', schedule: 'schedule.read', leaves: 'leave.read', trials: 'trial.read', products: 'product.read', artworks: 'artwork.read', resources: 'resource.read', orders: 'order.read', reports: 'report.read', announcements: 'announcement.read', settings: 'settings.manage' }

pageInfo.notifications = ['消息通知', '查看预约和服务提醒']
navItems.splice(1, 0, ['notifications', '•', '消息通知'])
navPermissions.notifications = 'admin.access'
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])) }
function safeUrl(value) { const raw = String(value || '').trim(); return /^(https?:\/\/|\/api\/assets\/)/i.test(raw) ? escapeHtml(raw) : '' }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => el.classList.remove('show'), 2200) }
async function api(path, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  let response
  try {
    response = await fetch(API + path, { ...options, signal: options.signal || controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}`, ...(options.headers || {}) } })
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时，请稍后重试')
    throw new Error('网络连接失败，请检查服务地址')
  } finally { clearTimeout(timeout) }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = body.message || '请求失败'
    if (response.status === 401 || /登录已失效|请先登录/i.test(message)) {
      clearSession()
    }
    throw new Error(message)
  }
  return body.data
}
function can(permission) { return Boolean(state.user && state.permissions.includes(permission)) }
function clearSession() {
  state.token = ''; state.adminName = ''; state.user = null; state.permissions = []
  localStorage.removeItem('zhixing-admin-token'); localStorage.removeItem('zhixing-admin-name')
}
async function refreshIdentity() {
  if (!state.token) return false
  try {
    const result = await api('/auth/me')
    state.user = result.user
    state.adminName = result.user.name || '管理员'
    state.permissions = Array.isArray(result.user.permissions) ? result.user.permissions : []
    return true
  } catch { clearSession(); return false }
}
function requireAdminId() { return Boolean(state.token && state.user) }
function loginView() { return `<section class="panel empty" style="max-width:460px;margin:48px auto;padding:34px;text-align:left"><h2 style="margin:0 0 8px">后台登录</h2><p class="panel-sub">使用已创建的运营管理员账号登录后即可管理实时数据。</p><form id="loginForm"><div class="field"><label>手机号账号</label><input name="name" inputmode="numeric" autocomplete="username" placeholder="请输入手机号" required /></div><div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password" required /></div><div class="form-actions"><button class="primary" style="width:100%">登录管理台</button></div></form><button class="table-action" style="margin-top:14px;padding:0" onclick="openForgotPassword()">忘记密码？</button></section>` }
function bindLogin() { const form = $('#loginForm'); if (!form) return; form.onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(form)); const button = form.querySelector('button[type="submit"], button:not([type])'); if (button) button.disabled = true; try { const response = await fetch(API + '/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || '登录失败'); state.token = body.data.token; localStorage.setItem('zhixing-admin-token', state.token); await refreshIdentity(); if (!state.user) throw new Error('后台身份校验失败'); render() } catch (error) { toast(error.message || '登录失败') } finally { if (button) button.disabled = false } } }
function publicCard(title, copy, form) { return `<section class="panel empty" style="max-width:460px;margin:48px auto;padding:34px;text-align:left"><h2 style="margin:0 0 8px">${title}</h2><p class="panel-sub">${copy}</p>${form}<button class="table-action" style="margin-top:14px;padding:0" onclick="backToLogin()">返回登录</button></section>` }
function forgotPasswordView() { return publicCard('找回密码', '输入已绑定邮箱，我们会发送一次性重置链接。', '<form id="forgotPasswordForm"><div class="field"><label>绑定邮箱</label><input name="email" type="email" autocomplete="email" required /></div><div class="form-actions"><button class="primary" style="width:100%">发送重置链接</button></div></form>') }
function resetPasswordView(token) { return publicCard('设置新密码', '链接仅可使用一次，且将在 30 分钟后失效。', `<form id="resetPasswordForm"><input type="hidden" name="token" value="${escapeHtml(token)}" /><div class="field"><label>新密码</label><input name="newPassword" type="password" minlength="12" autocomplete="new-password" required /></div><div class="field"><label>确认新密码</label><input name="confirmPassword" type="password" minlength="12" autocomplete="new-password" required /></div><div class="form-actions"><button class="primary" style="width:100%">保存新密码</button></div></form>`) }
function verifyEmailView(token) { return publicCard('验证邮箱', '确认后该邮箱将用于找回后台密码。', `<form id="verifyEmailForm"><input type="hidden" name="token" value="${escapeHtml(token)}" /><div class="form-actions"><button class="primary" style="width:100%">确认绑定邮箱</button></div></form>`) }
function openForgotPassword() { state.publicPage = 'forgot'; render() }
function backToLogin() { state.publicPage = ''; history.replaceState({}, '', location.pathname); render() }
function bindPublicForms() {
  const forgot = $('#forgotPasswordForm'); if (forgot) forgot.onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(forgot)); try { await api('/admin/password-reset/request', { method: 'POST', body: JSON.stringify(data) }); toast('若该邮箱已绑定账号，重置链接已发送'); backToLogin() } catch (error) { toast(error.message) } }
  const reset = $('#resetPasswordForm'); if (reset) reset.onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(reset)); if (data.newPassword !== data.confirmPassword) return toast('两次输入的新密码不一致'); try { await api('/admin/password-reset/confirm', { method: 'POST', body: JSON.stringify(data) }); toast('密码已重置，请使用新密码登录'); backToLogin() } catch (error) { toast(error.message) } }
  const verify = $('#verifyEmailForm'); if (verify) verify.onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(verify)); try { await api('/admin/email/confirm', { method: 'POST', body: JSON.stringify(data) }); toast('邮箱绑定成功，请登录后台'); backToLogin() } catch (error) { toast(error.message) } }
}
function tag(value) { const raw = String(value || ''); const cls = /PUBLISHED|ON_SALE|ACTIVE|APPROVED|CONFIRMED|PAID|SHIPPED|COMPLETED/.test(raw) ? 'green' : /DRAFT|PENDING/.test(raw) ? 'orange' : /REJECTED|CANCELLED|REFUNDED|DISABLED|OFF/.test(raw) ? 'red' : ''; return `<span class="tag ${cls}">${escapeHtml(STATUS_CN[raw] || raw)}</span>` }
const STATUS_CN = { PENDING_PAYMENT: '待支付', PAID: '已支付', SHIPPED: '已发货', COMPLETED: '已完成', CANCELLED: '已取消', REFUNDED: '已退款', PENDING: '待确认', CONFIRMED: '已确认', APPROVED: '已通过', REJECTED: '已驳回', PUBLISHED: '已发布', DRAFT: '草稿', ON_SALE: '在售', OFF_SALE: '下架', ACTIVE: '正常', DISABLED: '停用', ARCHIVED: '已归档' }
function money(value) { return `¥${Number(value || 0).toLocaleString('zh-CN')}` }
function fmtTime(value) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
function selectField(label, name, options, selected = '') { return `<div class="field"><label>${escapeHtml(label)}</label><select name="${escapeHtml(name)}">${options.map(([value, text]) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}</select></div>` }
function customModal(title, fieldsHtml, onSubmit) {
  $('#modalTitle').textContent = title
  $('#modalForm').innerHTML = fieldsHtml + '<div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">取消</button><button class="primary">保存</button></div>'
  $('#modalForm').onsubmit = async event => { event.preventDefault(); const formData = new FormData(event.target); const data = Object.fromEntries(formData); try { await onSubmit(data, formData); closeModal(); render() } catch (error) { toast(error.message) } }
  $('#modal').classList.add('show')
}
function renderNav() { $('#sidebarNav').innerHTML = navItems.filter(([id]) => !navPermissions[id] || can(navPermissions[id])).map(([id, icon, label]) => `<button class="${state.page === id ? 'active' : ''}" onclick="setPage('${id}')"><span>${icon}</span>${label}</button>`).join('') }
function setPage(page) { if (navPermissions[page] && !can(navPermissions[page])) return toast('当前账号没有此模块权限'); state.page = page; render() }
function metric(icon, kind, label, value, detail) { return `<article class="metric"><div class="metric-icon ${kind}">${icon}</div><div><small>${label}</small><strong>${value}</strong><em>${detail}</em></div></article>` }
function drawLine(id, values) { requestAnimationFrame(() => { const c = $('#' + id); if (!c) return; const ratio = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight; c.width = w * ratio; c.height = h * ratio; const x = c.getContext('2d'); x.scale(ratio, ratio); const dark = document.body.classList.contains('dark'); const left = 34, right = 14, top = 18, bottom = h - 28; x.strokeStyle = dark ? '#28352f' : '#e7eeea'; for (let i = 0; i < 4; i++) { const y = top + (bottom - top) * i / 3; x.beginPath(); x.moveTo(left, y); x.lineTo(w - right, y); x.stroke() } if (!values.length) return; const max = Math.max(...values.map(v => Number(v.total)), 1); x.beginPath(); values.forEach((v, i) => { const px = left + (w - left - right) * i / Math.max(values.length - 1, 1); const py = bottom - Number(v.total) / max * (bottom - top); i ? x.lineTo(px, py) : x.moveTo(px, py) }); x.strokeStyle = dark ? '#2fae85' : '#16785c'; x.lineWidth = 3; x.stroke(); values.forEach((v, i) => { x.fillStyle = dark ? '#8fa099' : '#72807a'; x.font = '10px system-ui'; x.fillText(String(v.day || '').slice(5), left + (w - left - right) * i / Math.max(values.length - 1, 1) - 8, h - 8) }) }) }
function formField(label, name, value = '', type = 'text') { return `<div class="field"><label>${escapeHtml(label)}</label>${type === 'textarea' ? `<textarea name="${escapeHtml(name)}">${escapeHtml(value)}</textarea>` : `<input name="${escapeHtml(name)}" value="${escapeHtml(value)}" required />`}</div>` }
function coverField(item) { const cover = safeUrl(item?.cover_url); return `<div class="field"><label>封面图片</label><input name="coverFile" type="file" accept="image/png,image/jpeg,image/webp" onchange="previewCover(this)" /><small class="panel-sub">支持 PNG、JPG、WebP；不选择文件时保留现有封面。</small><img id="coverPreview" src="${cover}" style="${cover ? '' : 'display:none;'}width:132px;height:88px;object-fit:cover;margin-top:10px;border-radius:6px;border:1px solid #e2e8e5" /></div>` }
function previewCover(input) { const image = $('#coverPreview'); const file = input.files?.[0]; if (!image || !file) return; image.src = URL.createObjectURL(file); image.style.display = 'block' }
function openModal(type, item = null) {
  const title = item ? '编辑' : '新建'; let fields = ''
  if (type === 'course') fields = formField('课程名称', 'title', item?.title) + formField('课程分类', 'category', item?.category || '艺术启蒙') + formField('课时数', 'sessions', item?.sessions || 12) + formField('价格', 'price', item?.price) + formField('课程描述', 'description', item?.description, 'textarea') + coverField(item) + selectField('状态', 'status', [['PUBLISHED', '已发布'], ['DRAFT', '草稿'], ['OFF_SALE', '已下架']], item?.status || 'DRAFT')
  if (type === 'product') fields = formField('商品名称', 'title', item?.title) + formField('商品分类', 'category', item?.category || '画材工具') + formField('价格', 'price', item?.price) + formField('库存', 'stock', item?.stock || 0) + formField('商品描述', 'description', item?.description, 'textarea') + coverField(item) + selectField('状态', 'status', [['PUBLISHED', '已发布'], ['DRAFT', '草稿'], ['OFF_SALE', '已下架']], item?.status || 'DRAFT')
  if (type === 'user') fields = formField('姓名', 'name', item?.name) + formField('手机号', 'mobile', item?.mobile) + selectField('身份（快速设置）', 'role', [['VISITOR', 'VISITOR 访客'], ['PARENT', 'PARENT 家长'], ['TEACHER', 'TEACHER 教师'], ['STUDENT', 'STUDENT 学生'], ['OPERATOR', 'OPERATOR 运营人员'], ['ADMIN', 'ADMIN 超级管理员']], item?.role || 'VISITOR') + selectField('状态', 'status', [['ACTIVE', '正常'], ['DISABLED', '停用']], item?.status || 'ACTIVE') + '<div class="field"><label>管理台登录密码</label><input name="password" type="password" minlength="12" placeholder="至少 12 位" autocomplete="new-password" /><small class="panel-sub">运营人员和超级管理员可登录 Web 管理台；编辑时留空表示不修改。</small></div>'
  if (type === 'resource') fields = formField('资源名称', 'title') + '<div class="field"><label>类型</label><select name="type"><option>课件</option><option>宣传图</option><option>文档</option></select></div><div class="field"><label>文件</label><input name="file" type="file" required /></div>'
  if (type === 'artwork') fields = selectField('所属学员', 'childId', cachedChildren.map(child => [child.id, child.name]), item?.child_id) + formField('作品标题', 'title', item?.title || '') + selectField('内容类型', 'kind', [['ARTWORK', '课程作品'], ['MOMENT', '教学花絮']], item?.kind || 'ARTWORK') + `<div class="field"><label>作品图片</label><input name="file" type="file" accept="image/png,image/jpeg,image/webp" ${item ? '' : 'required'} /><small class="panel-sub">支持 PNG、JPG、WebP，单个文件不超过 10 MB。</small>${safeUrl(item?.image_url) ? `<img src="${safeUrl(item.image_url)}" style="display:block;width:132px;height:88px;object-fit:cover;margin-top:10px;border-radius:6px;border:1px solid #e2e8e5" />` : ''}</div><label style="display:flex;align-items:center;gap:8px;margin:10px 0"><input name="isPublic" type="checkbox" ${item?.is_public === false ? '' : 'checked'} /> 发布到小程序作品页</label>`
  $('#modalTitle').textContent = `${title}${{ course: '课程', product: '商品', user: '用户', resource: '资源' }[type]}`
  $('#modalForm').innerHTML = fields + '<div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">取消</button><button class="primary">保存</button></div>'
  $('#modalForm').onsubmit = event => save(event, type, item)
  $('#modal').classList.add('show')
}
function closeModal() { $('#modal').classList.remove('show') }
async function save(event, type, item) {
  event.preventDefault(); const form = new FormData(event.target)
  try {
    if (type === 'artwork') {
      const file = form.get('file')
      const data = { childId: Number(form.get('childId')), title: form.get('title'), kind: form.get('kind'), isPublic: form.get('isPublic') === 'on' }
      if (file instanceof File && file.size) {
        if (file.size > 10 * 1024 * 1024) throw new Error('文件不能超过 10 MB')
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('作品图片仅支持 PNG、JPG 或 WebP 格式')
        const signed = await api('/admin/uploads/presign', { method: 'POST', body: JSON.stringify({ name: file.name, contentType: file.type, folder: 'artworks' }) })
        const upload = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
        if (!upload.ok) throw new Error('作品图片上传失败')
        data.imageUrl = signed.publicUrl
      } else if (!item) throw new Error('请选择要上传的作品图片')
      await api(`/admin/artworks${item ? `/${item.id}` : ''}`, { method: item ? 'PATCH' : 'POST', body: JSON.stringify(data) })
    } else if (type === 'resource') { const file = form.get('file'); if (!(file instanceof File) || !file.size) throw new Error('请选择要上传的文件'); if (file.size > 10 * 1024 * 1024) throw new Error('文件不能超过 10 MB'); const signed = await api('/admin/uploads/presign', { method: 'POST', body: JSON.stringify({ name: file.name, contentType: file.type, folder: 'resources' }) }); const upload = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file }); if (!upload.ok) throw new Error('资源上传失败'); await api('/admin/resources', { method: 'POST', body: JSON.stringify({ title: form.get('title'), type: form.get('type'), url: signed.publicUrl, sizeBytes: file.size }) }) }
    else {
      const data = Object.fromEntries(form); const coverFile = form.get('coverFile'); delete data.coverFile
      if ((type === 'course' || type === 'product') && coverFile instanceof File && coverFile.size) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(coverFile.type)) throw new Error('封面图片仅支持 PNG、JPG 或 WebP 格式')
        const signed = await api('/admin/uploads/presign', { method: 'POST', body: JSON.stringify({ name: coverFile.name, contentType: coverFile.type, folder: `${type}-covers` }) })
        const upload = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': coverFile.type }, body: coverFile })
        if (!upload.ok) throw new Error('封面图片上传失败')
        data.coverUrl = signed.publicUrl
      }
      ['price', 'sessions', 'stock'].forEach(key => { if (data[key]) data[key] = Number(data[key]) }); if (type === 'user' && !data.password) delete data.password; const endpoint = type === 'user' ? 'users' : `${type}s`; await api(`/admin/${endpoint}${item ? `/${item.id}` : ''}`, { method: item ? 'PATCH' : 'POST', body: JSON.stringify(data) })
    }
    closeModal(); toast('保存成功，数据已同步到小程序'); render()
  } catch (error) { toast(error.message) }
}
async function dashboard() { const [overview, analytics] = await Promise.all([api('/admin/overview'), api('/admin/analytics')]); setTimeout(() => drawLine('visitChart', analytics.daily), 0); return `<div class="page-head"><div><h2>欢迎回来，${escapeHtml(state.adminName || '运营管理员')}</h2><p>全部指标由实时业务数据计算。</p></div><button class="secondary" onclick="render()">↻ 刷新数据</button></div><div class="stats">${metric('◉','green','小程序用户',overview.users,`今日访问 ${overview.visits}`)}${metric('♙','blue','在读学生',overview.students,'已建立学生档案')}${metric('▣','purple','活跃教师',overview.teachers,'当前在职教师')}${metric('▰','orange','待支付订单',overview.pendingOrders,'订单实时更新')}</div><section class="dashboard-grid"><article class="panel"><div class="chart-head"><div><h3>近 7 日访问趋势</h3><p class="panel-sub">小程序访问事件实时统计</p></div><div class="range"><button class="active">7 天</button></div></div><canvas class="chart-canvas" id="visitChart"></canvas></article><article class="panel"><div class="chart-head"><div><h3>用户身份访问分布</h3><p class="panel-sub">按访问事件记录汇总</p></div></div><div class="role-list">${analytics.roles.map((row, index) => `<div class="role-row"><i class="dot" style="background:${['#16785c','#427ee9','#8465e9','#db8429'][index % 4]}"></i><span>${escapeHtml(row.role)}</span><b>${Number(row.total) || 0}</b></div>`).join('') || '<div class="empty">暂无访问数据</div>'}</div></article></section><section class="panel quick"><h3>快捷操作</h3><div class="quick-grid"><button onclick="openModal('course')"><i>▣</i><b>发布课程</b><small>创建并发布新课程</small></button><button onclick="openModal('product')"><i>♧</i><b>发布商品</b><small>新增周边商品</small></button><button onclick="openModal('resource')"><i>▤</i><b>上传资源</b><small>上传课件和图片</small></button><button onclick="setPage('reports')"><i>◌</i><b>查看报表</b><small>分析访问和转化</small></button></div></section>` }
async function users() { const list = await api('/admin/users'); return `<div class="page-head"><div><h2>用户管理</h2><p>管理家长、教师和访客真实账户。</p></div><button class="primary" onclick="openModal('user')">+ 新增用户</button></div><div class="toolbar"><input class="search" placeholder="搜索姓名、手机号" oninput="filterRows(this.value)" /><button class="secondary" onclick="exportUsers()">⇩ 导出</button></div><section class="panel table-panel"><table><thead><tr><th>用户</th><th>身份</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead><tbody id="rows">${list.map(user => `<tr><td><div class="person"><div class="mini-avatar">${escapeHtml(String(user.name || '').slice(0,1))}</div><div><b>${escapeHtml(user.name)}</b><small>${escapeHtml(user.mobile || '未绑定手机号')}</small></div></div></td><td>${roleTags(user)}</td><td>${tag(user.status)}</td><td>${escapeHtml(user.created_at)}</td><td><button class="table-action" data-id="${Number(user.id)}" onclick="editUser(this)">编辑</button></td></tr>`).join('')}</tbody></table></section>` }
function roleText(user) { return escapeHtml((user.roles || []).map(item => item.name || item.code || item).join('、') || '访客') }
function roleTags(user) { return (user.roles || []).map(item => `<span class="tag blue">${escapeHtml(item.name || item.code || item)}</span>`).join(' ') || tag('VISITOR') }
async function accessPage() {
  const [users, roles, permissions] = await Promise.all([api('/admin/users'), api('/admin/roles'), api('/admin/permissions')])
  cachedUsers = users; cachedAccessRoles = roles; cachedPermissions = permissions
  return `<div class="page-head"><div><h2>身份与权限</h2><p>角色由后台配置，用户只能使用服务端返回的身份；单用户覆盖权限用于特殊授权。</p></div><button class="secondary" onclick="render()">↻ 刷新</button></div><section class="panel table-panel"><table><thead><tr><th>用户</th><th>已授权身份</th><th>当前权限数</th><th>状态</th><th>操作</th></tr></thead><tbody>${users.map(user => `<tr><td><div class="person"><div class="mini-avatar">${escapeHtml(String(user.name || '').slice(0,1))}</div><div><b>${escapeHtml(user.name)}</b><small>ID ${Number(user.id)}</small></div></div></td><td>${roleText(user)}</td><td>${(user.permissions || []).length}</td><td>${tag(user.status)}</td><td><button class="table-action" onclick="openAccessModal(${Number(user.id)})">配置身份</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">暂无用户</td></tr>'}</tbody></table></section>`
}
async function openAccessModal(userId) {
  try {
    const access = await api(`/admin/users/${userId}/access`)
    const currentRoles = new Set((access.user.roles || []).map(item => String(item.code || '').toUpperCase()))
    const overrides = Object.fromEntries((access.overrides || []).map(item => [item.code, item.effect]))
    const roleFields = cachedAccessRoles.map(role => { const code = String(role.code || '').toUpperCase(); return `<label style="display:flex;align-items:center;gap:8px;margin:8px 0"><input type="checkbox" name="role" value="${escapeHtml(code)}" ${currentRoles.has(code) ? 'checked' : ''} /> <span>${escapeHtml(role.name)} <small class="panel-sub">${escapeHtml(code)}</small></span></label>` }).join('')
    const permissionFields = cachedPermissions.map((permission, index) => { const value = overrides[permission.code] || ''; return `<div class="field"><label>${escapeHtml(permission.name || permission.code)}<small class="panel-sub">${escapeHtml(permission.code)}</small></label><select name="permission_${index}"><option value="">继承角色默认权限</option><option value="${escapeHtml(permission.code)}|ALLOW" ${value === 'ALLOW' ? 'selected' : ''}>额外允许</option><option value="${escapeHtml(permission.code)}|DENY" ${value === 'DENY' ? 'selected' : ''}>明确禁止</option></select></div>` }).join('')
    customModal(`配置身份 · ${access.user.name || ''}`, `<div class="field"><label>角色（可多选）</label>${roleFields || '<p class="panel-sub">暂无可用角色</p>'}</div><div class="field"><label>权限覆盖</label><p class="panel-sub">默认权限来自角色；这里只保存例外允许或禁止。</p></div>${permissionFields}`, async (_data, formData) => {
      const roles = formData.getAll('role')
      const overrides = []
      cachedPermissions.forEach((permission, index) => { const value = formData.get(`permission_${index}`); if (value) { const [code, effect] = String(value).split('|'); overrides.push({ code, effect }) } })
      await api(`/admin/users/${userId}/access`, { method: 'PATCH', body: JSON.stringify({ roles, overrides }) })
      toast('身份和权限已保存')
    })
  } catch (error) { toast(error.message) }
}
async function contentList(kind) { const data = await api(`/admin/${kind}`); const title = { courses: '课程', products: '商品', resources: '资源' }[kind]; if (kind === 'resources') return `<div class="page-head"><div><h2>资源中心</h2><p>资源上传后托管于对象存储，URL 保存至数据库。</p></div><button class="primary" onclick="openModal('resource')">+ 上传资源</button></div><section class="panel table-panel"><table><thead><tr><th>资源名称</th><th>类型</th><th>文件地址</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${data.map(item => `<tr><td>${escapeHtml(item.title)}</td><td>${tag(item.type)}</td><td>${safeUrl(item.url) ? `<a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">预览</a>` : '—'}</td><td>${escapeHtml(item.created_at)}</td><td><button class="table-action" style="color:#d65762" onclick="deleteResource(${Number(item.id)})">删除</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">暂无资源</td></tr>'}</tbody></table></section>`
  return `<div class="page-head"><div><h2>${escapeHtml(title)}管理</h2><p>发布状态会实时同步至小程序。</p></div><button class="primary" onclick="openModal('${kind.slice(0,-1)}')">+ 新建${escapeHtml(title)}</button></div><section class="panel table-panel"><table><thead><tr><th>${escapeHtml(title)}名称</th><th>分类</th><th>${kind === 'courses' ? '课时 / 价格' : '价格 / 库存'}</th><th>状态</th><th>操作</th></tr></thead><tbody>${data.map(item => `<tr><td><b>${escapeHtml(item.title)}</b><small style="display:block;color:#75827c">${escapeHtml(item.description || '')}</small></td><td>${escapeHtml(item.category || '—')}</td><td>${kind === 'courses' ? `${Number(item.sessions) || 0} 次 · ${money(item.price)}` : `${money(item.price)} · ${Number(item.stock) || 0} 件`}</td><td>${tag(item.status)}</td><td><button class="table-action" data-id="${Number(item.id)}" onclick="editContent('${kind}',this)">编辑</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">暂无数据</td></tr>'}</tbody></table></section>` }
let cachedUsers = [], cachedContent = {}, cachedAnalytics = null, cachedAccessRoles = [], cachedPermissions = []
function downloadCsv(filename, rows) {
  const csv = '﻿' + rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url)
}
function exportUsers() {
  if (!cachedUsers.length) return toast('暂无可导出的用户')
  downloadCsv('用户列表.csv', [['ID', '姓名', '手机号', '身份', '状态', '注册时间'], ...cachedUsers.map(user => [user.id, user.name, user.mobile || '', user.role, user.status, user.created_at])])
  toast(`已导出 ${cachedUsers.length} 个用户`)
}
function exportReport() {
  if (!cachedAnalytics) return toast('暂无可导出的数据')
  downloadCsv('访问报表.csv', [['日期', '访问量'], ...cachedAnalytics.daily.map(row => [row.day, row.total]), [''], ['身份', '访问量'], ...cachedAnalytics.roles.map(row => [row.role, row.total])])
  toast('报表已导出')
}
async function deleteResource(resourceId) {
  if (!confirm('确定删除该资源记录吗？')) return
  try { await api(`/admin/resources/${resourceId}`, { method: 'DELETE' }); toast('资源已删除'); render() } catch (error) { toast(error.message) }
}
async function artworksPage() {
  const [list, children] = await Promise.all([api('/admin/artworks'), api('/admin/children')])
  cachedContent.artworks = list; cachedChildren = children
  return `<div class="page-head"><div><h2>作品管理</h2><p>上传到 R2 后绑定学员，发布状态会同步到小程序的课程作品和教学花絮。</p></div><button class="primary" onclick="openModal('artwork')">+ 上传作品</button></div><section class="panel table-panel"><table><thead><tr><th>预览</th><th>标题</th><th>学员</th><th>类型</th><th>公开</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${list.map(item => `<tr><td>${safeUrl(item.image_url) ? `<img src="${safeUrl(item.image_url)}" alt="" style="width:64px;height:44px;object-fit:cover;border-radius:5px" />` : '—'}</td><td>${escapeHtml(item.title || '未命名作品')}</td><td>${escapeHtml(item.child_name || '—')}</td><td>${item.kind === 'MOMENT' ? '教学花絮' : '课程作品'}</td><td>${item.is_public ? '是' : '否'}</td><td>${tag(item.status)}</td><td>${escapeHtml(item.created_at || '—')}</td><td><button class="table-action" data-id="${Number(item.id)}" onclick="editContent('artworks',this)">编辑</button><button class="table-action" style="color:#d65762" onclick="deleteArtwork(${Number(item.id)})">删除</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">暂无作品，先上传一张作品图片</td></tr>'}</tbody></table></section>`
}
async function deleteArtwork(artworkId) {
  if (!confirm('确定删除这条作品记录吗？')) return
  try { await api(`/admin/artworks/${artworkId}`, { method: 'DELETE' }); toast('作品已删除'); render() } catch (error) { toast(error.message) }
}
function orderActions(order) {
  const buttons = []
  if (order.refund_status === 'PROCESSING') return '<span class="tag orange">退款处理中</span>'
  if (order.refund_status === 'SUCCESS' || order.status === 'REFUNDED') return '<span class="tag green">退款成功</span>'
  if (order.status === 'PENDING_PAYMENT') { buttons.push(`<button class="table-action" onclick="patchOrder(${order.id},'PAID')">标记已支付</button>`); buttons.push(`<button class="table-action" style="color:#d65762" onclick="patchOrder(${order.id},'CANCELLED')">取消</button>`) }
  if (order.status === 'PAID') { buttons.push(`<button class="table-action" onclick="shipOrder(${order.id})">发货</button>`); buttons.push(`<button class="table-action" onclick="patchOrder(${order.id},'COMPLETED')">直接完成</button>`) }
  if (order.status === 'SHIPPED') buttons.push(`<button class="table-action" onclick="patchOrder(${order.id},'COMPLETED')">标记完成</button>`)
  if (['PAID', 'SHIPPED', 'COMPLETED'].includes(order.status)) buttons.push(`<button class="table-action" style="color:#d65762" onclick="refundOrder(${order.id})">申请退款</button>`)
  return buttons.join('') || '—'
}
async function patchOrder(orderId, status) { try { await api(`/admin/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ status }) }); toast('订单状态已更新'); render() } catch (error) { toast(error.message) } }
function shipOrder(orderId) { customModal('订单发货', formField('运单号', 'trackingNo'), data => api(`/admin/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ status: 'SHIPPED', trackingNo: data.trackingNo }) }).then(() => toast('已发货'))) }
function refundOrder(orderId) { customModal('申请退款', '<div class="field"><label>退款原因</label><textarea name="reason" maxlength="80" placeholder="例如：用户申请退款"></textarea></div>', data => api(`/admin/orders/${orderId}/refund`, { method: 'POST', body: JSON.stringify({ reason: data.reason || '后台审核退款' }) }).then(() => toast('退款申请已提交，等待微信支付处理'))) }
async function orders() { const list = await api('/admin/orders'); return `<div class="page-head"><div><h2>订单管理</h2><p>课程与商品订单状态实时同步，支持支付确认、发货与完成操作。</p></div><button class="secondary" onclick="render()">↻ 刷新</button></div><section class="panel table-panel"><table><thead><tr><th>订单号</th><th>用户</th><th>内容</th><th>金额</th><th>状态</th><th>物流</th><th>操作</th></tr></thead><tbody>${list.map(order => `<tr><td>${escapeHtml(order.order_no)}</td><td>${escapeHtml(order.buyer_name)}</td><td>${escapeHtml((order.items || []).map(item => `${item.name} ×${item.quantity}`).join('、') || order.subject_title || '—')}</td><td>${money(order.total_amount ?? order.amount)}</td><td>${tag(order.status)}</td><td>${escapeHtml(order.tracking_no || '—')}</td><td>${orderActions(order)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">暂无订单</td></tr>'}</tbody></table></section>` }

// ---------- 学员管理 ----------
let cachedChildren = [], cachedClasses = [], cachedCourseOptions = [], cachedTeachers = []
async function childrenPage() {
  cachedChildren = await api('/admin/children')
  return `<div class="page-head"><div><h2>学员管理</h2><p>学员档案、监护关系与课时账户。</p></div><button class="primary" onclick="openChildModal()">+ 新增学员</button></div><section class="panel table-panel"><table><thead><tr><th>学员</th><th>监护人</th><th>在读班级</th><th>剩余课时</th><th>操作</th></tr></thead><tbody>${cachedChildren.map(child => `<tr><td><div class="person"><div class="mini-avatar">${escapeHtml(String(child.name || '').slice(0, 1))}</div><div><b>${escapeHtml(child.name)}</b><small>${escapeHtml(child.remark || '')}</small></div></div></td><td>${escapeHtml(child.guardians || '未绑定')}</td><td>${escapeHtml((child.class_names || []).join('、') || '未报班')}</td><td><b>${Number(child.remaining_lessons) || 0}</b> 次</td><td><button class="table-action" onclick="openLessonModal(${Number(child.id)})">调整课时</button><button class="table-action" onclick="showLessonHistory(${Number(child.id)})">查看流水</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">暂无学员档案</td></tr>'}</tbody></table></section>`
}
function openChildModal() { customModal('新增学员', formField('姓名', 'name') + selectField('性别', 'gender', [['UNKNOWN', '未填写'], ['MALE', '男'], ['FEMALE', '女']]) + '<div class="field"><label>生日</label><input name="birthday" type="date" /></div><div class="field"><label>备注</label><textarea name="remark"></textarea></div>', data => api('/admin/children', { method: 'POST', body: JSON.stringify(data) }).then(() => toast('学员已创建'))) }
function openLessonModal(childId) {
  const child = cachedChildren.find(item => item.id === childId)
  customModal(`调整课时 · ${child ? child.name : childId}`, selectField('类型', 'type', [['PURCHASE', '购课充值'], ['GIFT', '赠送课时'], ['ADJUST', '手动调整'], ['DEDUCT', '扣减课时'], ['REFUND', '退款回收']]) + '<div class="field"><label>数量（正数增加、负数减少）</label><input name="quantity" type="number" required /></div>' + formField('原因', 'reason'),
    data => api(`/admin/children/${childId}/lessons`, { method: 'POST', body: JSON.stringify({ type: data.type, quantity: Number(data.quantity), reason: data.reason }) }).then(result => toast(`已调整，当前剩余 ${result.remaining_lessons} 次`)))
}
async function showLessonHistory(childId) {
  try {
    const child = cachedChildren.find(item => Number(item.id) === Number(childId))
    const rows = await api(`/admin/children/${childId}/lesson-ledger`)
    const typeNames = { PURCHASE: '购课充值', GIFT: '赠送课时', DEDUCT: '上课扣减', REFUND: '退款回收', ADJUST: '手动调整', FREEZE: '冻结课时', UNFREEZE: '解冻课时' }
    $('#modalTitle').textContent = `课时流水 · ${child ? child.name : childId}`
    $('#modalForm').innerHTML = rows.length ? `<div style="max-height:420px;overflow:auto">${rows.map(row => `<div style="display:flex;justify-content:space-between;gap:16px;padding:13px 0;border-bottom:1px solid #e8eeeb"><div><b>${escapeHtml(typeNames[row.type] || row.type)}</b><small style="display:block;color:#75827c;margin-top:4px">${escapeHtml(row.reason || '—')} · ${escapeHtml(fmtTime(row.created_at))}</small></div><div style="text-align:right"><b style="color:${Number(row.quantity) >= 0 ? '#16785c' : '#b85b4d'}">${Number(row.quantity) > 0 ? '+' : ''}${Number(row.quantity)}</b><small style="display:block;color:#75827c;margin-top:4px">余额 ${Number(row.balance_after)} 次</small></div></div>`).join('')}</div>` : '<div class="empty">暂无课时流水</div>'
    $('#modalForm').innerHTML += '<div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">关闭</button></div>'
    $('#modalForm').onsubmit = event => event.preventDefault()
    $('#modal').classList.add('show')
  } catch (error) { toast(error.message) }
}

// ---------- 试听预约 ----------
async function trialsPage() {
  const list = await api('/admin/trial-appointments')
  const timeNames = { ANY: '时间不限', MORNING: '上午', AFTERNOON: '下午', EVENING: '晚上' }
  return `<div class="page-head"><div><h2>试听预约</h2><p>跟进家长提交的预约，确认时间后同步处理状态。</p></div><button class="secondary" onclick="render()">↻ 刷新</button></div><section class="panel table-panel"><table><thead><tr><th>孩子 / 联系人</th><th>意向课程</th><th>期望时间</th><th>备注</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead><tbody>${list.map(item => `<tr><td><b>${escapeHtml(item.child_name)}</b><small style="display:block;color:#75827c">${escapeHtml(item.guardian_name)} · ${escapeHtml(item.mobile)}</small></td><td>${escapeHtml(item.course_title || '由老师推荐')}</td><td>${escapeHtml(item.preferred_date || '日期待定')} · ${escapeHtml(timeNames[item.preferred_time] || '时间不限')}</td><td style="max-width:220px">${escapeHtml(item.note || '—')}</td><td>${tag(item.status)}${item.handled_note ? `<small style="display:block;color:#75827c;margin-top:4px">${escapeHtml(item.handled_note)}</small>` : ''}</td><td>${fmtTime(item.created_at)}</td><td><button class="table-action" onclick="reviewTrial(${Number(item.id)})">处理</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">暂无试听预约</td></tr>'}</tbody></table></section>`
}
function reviewTrial(appointmentId) {
  customModal('处理试听预约', selectField('状态', 'status', [['PENDING', '待确认'], ['CONFIRMED', '已确认'], ['COMPLETED', '已完成'], ['CANCELLED', '已取消']]) + '<div class="field"><label>处理备注（选填）</label><textarea name="handledNote" maxlength="500" placeholder="例如：已电话确认周六 10:00 到店"></textarea></div>', data => api(`/admin/trial-appointments/${appointmentId}`, { method: 'PATCH', body: JSON.stringify({ status: data.status, handledNote: data.handledNote || null }) }).then(() => toast('试听预约已更新')))
}

// ---------- 排课管理 ----------
async function schedulePage() {
  const [classes, courses, users] = await Promise.all([api('/admin/classes'), api('/admin/courses'), api('/admin/users')])
  cachedClasses = classes
  cachedCourseOptions = courses.map(course => [course.id, course.title || course.name])
  cachedTeachers = users.filter(user => (user.roles || []).some(role => String(role.code || role).toUpperCase() === 'TEACHER')).map(user => [user.id, user.name])
  return `<div class="page-head"><div><h2>排课管理</h2><p>创建班级、发布课次并为学员办理报名。</p></div><button class="primary" onclick="openClassModal()">+ 新建班级</button></div><section class="panel table-panel"><table><thead><tr><th>班级</th><th>课程</th><th>授课教师</th><th>校区 / 教室</th><th>报名 / 容量</th><th>状态</th><th>操作</th></tr></thead><tbody>${classes.map(klass => `<tr><td><b>${escapeHtml(klass.name)}</b></td><td>${escapeHtml(klass.course_name)}</td><td>${escapeHtml(klass.teacher_name || '待指定')}</td><td>${escapeHtml(`${klass.campus || '—'} ${klass.room || ''}`.trim())}</td><td>${Number(klass.enrolled_count) || 0} / ${Number(klass.capacity) || 0}</td><td>${tag(klass.status)}</td><td><button class="table-action" onclick="openSessionModal(${Number(klass.id)})">排课</button><button class="table-action" onclick="openEnrollModal(${Number(klass.id)})">报名</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">暂无班级</td></tr>'}</tbody></table></section>`
}
function openClassModal() { customModal('新建班级', selectField('所属课程', 'courseId', cachedCourseOptions) + selectField('授课教师', 'teacherUserId', [['', '待指定'], ...cachedTeachers]) + formField('班级名称', 'name') + formField('校区', 'campus', '徐汇校区') + formField('教室', 'room', 'A1 教室') + formField('容量', 'capacity', 20), data => api('/admin/classes', { method: 'POST', body: JSON.stringify({ courseId: Number(data.courseId), teacherUserId: data.teacherUserId ? Number(data.teacherUserId) : null, name: data.name, campus: data.campus, room: data.room, capacity: Number(data.capacity) }) }).then(() => toast('班级已创建'))) }
function openSessionModal(classId) {
  const klass = cachedClasses.find(item => item.id === classId)
  customModal(`发布课次 · ${klass ? klass.name : classId}`, '<div class="field"><label>节次序号</label><input name="sequenceNo" type="number" value="1" required /></div><div class="field"><label>开始时间</label><input name="startsAt" type="datetime-local" required /></div><div class="field"><label>结束时间</label><input name="endsAt" type="datetime-local" required /></div>',
    data => api(`/admin/classes/${classId}/sessions`, { method: 'POST', body: JSON.stringify({ sequenceNo: Number(data.sequenceNo), startsAt: data.startsAt, endsAt: data.endsAt }) }).then(() => toast('课次已发布')))
}
async function openEnrollModal(classId) {
  if (!cachedChildren.length) cachedChildren = await api('/admin/children')
  const klass = cachedClasses.find(item => item.id === classId)
  customModal(`学员报名 · ${klass ? klass.name : classId}`, selectField('选择学员', 'childId', cachedChildren.map(child => [child.id, `${child.name}（剩余 ${child.remaining_lessons} 次）`])),
    data => api('/admin/enrollments', { method: 'POST', body: JSON.stringify({ childId: Number(data.childId), classId }) }).then(() => toast('报名成功')))
}

// ---------- 请假审批 ----------
async function leavesPage() {
  const list = await api('/admin/leave-requests')
  return `<div class="page-head"><div><h2>请假审批</h2><p>批准后系统自动写入 LEAVE 考勤，确认考勤时不扣课时。</p></div><button class="secondary" onclick="render()">↻ 刷新</button></div><section class="panel table-panel"><table><thead><tr><th>学员</th><th>课程 / 课次</th><th>上课时间</th><th>申请理由</th><th>申请人</th><th>状态</th><th>操作</th></tr></thead><tbody>${list.map(row => `<tr><td><b>${escapeHtml(row.child_name)}</b></td><td>${escapeHtml(row.course_title)}<small style="display:block;color:#75827c">${escapeHtml(row.class_name)}</small></td><td>${fmtTime(row.starts_at)}</td><td>${escapeHtml(row.reason || '—')}</td><td>${escapeHtml(row.requested_by_name)}</td><td>${tag(row.status)}</td><td>${row.status === 'PENDING' ? `<button class="table-action" onclick="reviewLeave(${Number(row.id)},'APPROVED')">通过</button><button class="table-action" style="color:#d65762" onclick="reviewLeave(${Number(row.id)},'REJECTED')">驳回</button>` : escapeHtml(row.review_note || '—')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">暂无请假申请</td></tr>'}</tbody></table></section>`
}
function reviewLeave(requestId, status) { customModal(status === 'APPROVED' ? '通过请假申请' : '驳回请假申请', '<div class="field"><label>审批备注（选填）</label><textarea name="reviewNote"></textarea></div>', data => api(`/admin/leave-requests/${requestId}`, { method: 'PATCH', body: JSON.stringify({ status, reviewNote: data.reviewNote || null }) }).then(() => toast(status === 'APPROVED' ? '已通过，考勤已标记请假' : '已驳回'))) }

// ---------- 公告管理 ----------
async function announcementsPage() {
  const list = await api('/admin/announcements')
  return `<div class="page-head"><div><h2>公告管理</h2><p>发布后立即同步到小程序对应端。</p></div><button class="primary" onclick="openAnnouncementModal()">+ 发布公告</button></div><section class="panel table-panel"><table><thead><tr><th>标题</th><th>内容</th><th>面向</th><th>状态</th><th>发布时间</th><th>操作</th></tr></thead><tbody>${list.map(item => `<tr><td><b>${escapeHtml(item.title)}</b></td><td style="max-width:320px">${escapeHtml(item.content)}</td><td>${escapeHtml({ ALL: '全部用户', PARENT: '家长端', TEACHER: '教师端' }[item.audience] || item.audience)}</td><td>${tag(item.status)}</td><td>${fmtTime(item.published_at)}</td><td><button class="table-action" onclick="toggleAnnouncement(${Number(item.id)},'${item.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED'}')">${item.status === 'PUBLISHED' ? '下线' : '发布'}</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">暂无公告</td></tr>'}</tbody></table></section>`
}
function openAnnouncementModal() { customModal('发布公告', formField('标题', 'title') + '<div class="field"><label>内容</label><textarea name="content" required></textarea></div>' + selectField('面向人群', 'audience', [['ALL', '全部用户'], ['PARENT', '家长端'], ['TEACHER', '教师端']]) + selectField('状态', 'status', [['PUBLISHED', '立即发布'], ['DRAFT', '存为草稿']]), data => api('/admin/announcements', { method: 'POST', body: JSON.stringify(data) }).then(() => toast('公告已保存'))) }
async function toggleAnnouncement(announcementId, status) { try { await api(`/admin/announcements/${announcementId}`, { method: 'PATCH', body: JSON.stringify({ status }) }); toast(status === 'PUBLISHED' ? '公告已发布' : '公告已下线'); render() } catch (error) { toast(error.message) } }
async function reports() { const data = await api('/admin/analytics'); cachedAnalytics = data; setTimeout(() => drawLine('growthChart', data.daily), 0); return `<div class="page-head"><div><h2>数据报表</h2><p>按访问事件实时统计用户增长与访问趋势。</p></div><button class="secondary" onclick="exportReport()">⇩ 导出报表</button></div><section class="dashboard-grid"><article class="panel"><div class="chart-head"><div><h3>用户访问趋势</h3><p class="panel-sub">近 7 日每日访问量</p></div></div><canvas class="chart-canvas" id="growthChart"></canvas></article><article class="panel"><h3>身份访问分布</h3><div class="role-list">${data.roles.map((row, index) => `<div class="role-row"><i class="dot" style="background:${['#16785c','#427ee9','#8465e9','#db8429'][index % 4]}"></i><span>${escapeHtml(row.role)}</span><b>${Number(row.total) || 0}</b></div>`).join('') || '<div class="empty">暂无数据</div>'}</div></article></section>` }
function placeholder(label) { return `<div class="page-head"><div><h2>${escapeHtml(label)}</h2><p>该模块已保留为实时后台扩展入口。</p></div></div><section class="panel empty"><b>模块准备中</b><br>请通过上方课程、商品、资源和数据报表模块管理实时业务数据。</section>` }
function settings() { const email = state.user?.email || ''; return `<div class="page-head"><div><h2>系统设置</h2><p>管理当前后台管理员账号与安全设置。</p></div></div><section class="panel" style="max-width:620px"><h3>绑定找回邮箱</h3><p class="panel-sub">${email ? `当前已绑定：${escapeHtml(email)}` : '绑定后可通过邮件找回后台密码。'}</p><form id="emailForm"><div class="field"><label>邮箱地址</label><input name="email" type="email" value="${escapeHtml(email)}" autocomplete="email" required /></div><div class="form-actions"><button class="secondary">发送验证邮件</button></div></form></section><section class="panel" style="max-width:620px;margin-top:18px"><h3>修改登录密码</h3><p class="panel-sub">修改后立即生效，原密码将不能继续登录。</p><form id="passwordForm"><div class="field"><label>当前密码</label><input name="currentPassword" type="password" autocomplete="current-password" required /></div><div class="field"><label>新密码</label><input name="newPassword" type="password" minlength="12" autocomplete="new-password" required /></div><div class="field"><label>确认新密码</label><input name="confirmPassword" type="password" minlength="12" autocomplete="new-password" required /></div><div class="form-actions"><button class="primary">保存新密码</button></div></form></section>` }
function bindPasswordForm() { const form = $('#passwordForm'); if (form) form.onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(form)); if (data.newPassword !== data.confirmPassword) return toast('两次输入的新密码不一致'); try { await api('/admin/password', { method: 'POST', body: JSON.stringify(data) }); form.reset(); toast('密码已修改，请妥善保管新密码') } catch (error) { toast(error.message) } }; const emailForm = $('#emailForm'); if (emailForm) emailForm.onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(emailForm)); try { await api('/admin/email/begin', { method: 'POST', body: JSON.stringify(data) }); toast('验证邮件已发送，请到邮箱确认') } catch (error) { toast(error.message) } } }
function filterRows(value) { document.querySelectorAll('#rows tr').forEach(row => { row.hidden = !row.innerText.includes(value) }) }
function editUser(button) { openModal('user', cachedUsers.find(item => String(item.id) === button.dataset.id)) }
function editContent(kind, button) { openModal(kind.slice(0, -1), (cachedContent[kind] || []).find(item => String(item.id) === button.dataset.id)) }
function syncHeader() {
  const name = state.token ? (state.adminName || state.user?.name || '管理员') : '未登录'
  $('#headerAdminName').textContent = name
  const avatar = String(state.user?.avatarUrl || state.user?.avatar_url || '').trim()
  const avatarEl = $('#headerAvatar')
  const avatarUrl = /^(https?:\/\/|\/api\/assets\/)/i.test(avatar) ? avatar : ''
  avatarEl.innerHTML = avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="管理员头像" />` : escapeHtml(name.slice(0, 1))
  $('#logoutBtn').style.display = state.token ? '' : 'none'
}
function logout() {
  clearSession()
  toast('已退出登录')
  render()
}
async function openAdminNotification(notificationId, relatedId) {
  api(`/admin/notifications/${Number(notificationId)}/read`, { method: 'POST' }).catch(() => undefined)
  if (!Number(relatedId)) return
  state.page = 'trials'
  await render()
  reviewTrial(Number(relatedId))
}
async function adminNotifications() {
  const result = await api('/admin/notifications')
  return `<div class="page-head"><div><h2>消息通知</h2><p>新试听预约和审核结果会在这里提醒。</p></div><button class="secondary" onclick="render()">↻ 刷新</button></div><section class="panel table-panel"><table><thead><tr><th>状态</th><th>消息</th><th>时间</th></tr></thead><tbody>${(result.items || []).map(item => `<tr class="notification-row" title="点击查看关联预约" onclick="openAdminNotification(${Number(item.id)}, ${Number(item.relatedId || 0)})"><td>${item.read ? '<span class="tag">已读</span>' : '<span class="tag orange">未读</span>'}</td><td><b>${escapeHtml(item.title)}</b><small style="display:block;color:#75827c;margin-top:4px">${escapeHtml(item.body)}</small></td><td>${fmtTime(item.createdAt)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">暂无消息</td></tr>'}</tbody></table></section>`
}
async function render() {
  if (state.token && !state.user) await refreshIdentity()
  syncHeader()
  if (!requireAdminId()) {
    const query = new URLSearchParams(location.search)
    const resetToken = query.get('reset'), verifyToken = query.get('verifyEmail')
    if (resetToken) $('#content').innerHTML = resetPasswordView(resetToken)
    else if (verifyToken) $('#content').innerHTML = verifyEmailView(verifyToken)
    else if (state.publicPage === 'forgot') $('#content').innerHTML = forgotPasswordView()
    else { $('#content').innerHTML = loginView(); bindLogin(); return }
    bindPublicForms(); return
  }
  if (navPermissions[state.page] && !can(navPermissions[state.page])) state.page = 'dashboard'
  const page = pageInfo[state.page]; $('#headerTitle').textContent = page[0]; $('#headerDesc').textContent = page[1]; renderNav()
  try {
    if (state.page === 'dashboard') $('#content').innerHTML = await dashboard()
    else if (state.page === 'notifications') $('#content').innerHTML = await adminNotifications()
    else if (state.page === 'users') { cachedUsers = await api('/admin/users'); $('#content').innerHTML = await users() }
    else if (state.page === 'access') $('#content').innerHTML = await accessPage()
    else if (['courses', 'products', 'resources'].includes(state.page)) { cachedContent[state.page] = await api(`/admin/${state.page}`); $('#content').innerHTML = await contentList(state.page) }
    else if (state.page === 'artworks') $('#content').innerHTML = await artworksPage()
    else if (state.page === 'orders') $('#content').innerHTML = await orders()
    else if (state.page === 'children') $('#content').innerHTML = await childrenPage()
    else if (state.page === 'schedule') $('#content').innerHTML = await schedulePage()
    else if (state.page === 'leaves') $('#content').innerHTML = await leavesPage()
    else if (state.page === 'trials') $('#content').innerHTML = await trialsPage()
    else if (state.page === 'announcements') $('#content').innerHTML = await announcementsPage()
    else if (state.page === 'reports') $('#content').innerHTML = await reports()
    else if (state.page === 'settings') { $('#content').innerHTML = settings(); bindPasswordForm() }
    else $('#content').innerHTML = placeholder(page[0])
  } catch (error) {
    if (!state.token) { syncHeader(); $('#content').innerHTML = loginView(); bindLogin(); return }
    $('#content').innerHTML = `<section class="panel empty"><b>无法加载实时数据</b><br>${escapeHtml(error.message)}<br><small>请检查后端服务与数据库连接后重试。</small></section>`
  }
}
function applyDark(on) {
  document.body.classList.toggle('dark', on)
  const icon = $('#darkIcon'), label = $('#darkLabel')
  if (icon) icon.textContent = on ? '◑' : '◐'
  if (label) label.textContent = on ? '浅色模式' : '深色模式'
}
function toggleDark() {
  const on = !document.body.classList.contains('dark')
  localStorage.setItem('zhixing-admin-dark', on ? '1' : '')
  applyDark(on)
  if (state.page === 'dashboard' || state.page === 'reports') render()
}
function applyCollapsed(on) {
  document.body.classList.toggle('nav-collapsed', on)
  const icon = $('#collapseIcon'), label = $('#collapseLabel')
  if (icon) icon.textContent = on ? '»' : '«'
  if (label) label.textContent = on ? '展开菜单' : '收起菜单'
}
function toggleCollapse() {
  const on = !document.body.classList.contains('nav-collapsed')
  localStorage.setItem('zhixing-admin-nav', on ? '1' : '')
  applyCollapsed(on)
  if (state.page === 'dashboard' || state.page === 'reports') render()
}
applyDark(Boolean(localStorage.getItem('zhixing-admin-dark')))
applyCollapsed(Boolean(localStorage.getItem('zhixing-admin-nav')))
$('#modal').addEventListener('click', event => { if (event.target === event.currentTarget) closeModal() })
window.addEventListener('resize', () => { if (state.page === 'dashboard' || state.page === 'reports') render() })
render()
