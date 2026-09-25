const app = getApp()
const api = require('../../services/api.js')

Page({
  data: {
    displayName: '微信用户', avatarUrl: '', avatarDraft: '', avatarInitial: '微', nickname: '', avatarPath: '', saving: false,
    loading: true, choosing: false, bindingPhone: false, dirty: false, errorMessage: '', mobile: ''
  },
  // 相册返回也触发 onShow；只在进入页面时初始化，避免旧资料覆盖草稿。
  async onLoad() {
    const user = await app.refreshUser().catch(() => null)
    if (!user) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      setTimeout(() => wx.switchTab({ url: '/pages/profile/index' }), 250)
      return
    }
    const name = user.name || '微信用户'
    const avatarUrl = api.mediaUrl(user.avatarUrl || user.avatar_url || '')
    this.setData({
      displayName: name, avatarUrl, avatarDraft: avatarUrl, avatarInitial: name.slice(0, 1) || '微', nickname: name, avatarPath: '', saving: false,
      loading: false, dirty: false, errorMessage: '', mobile: user.mobile || ''
    })
  },
  async bindWechatPhone(e) {
    const code = String(e.detail?.code || '').trim()
    if (!code) return wx.showToast({ title: '未授权手机号', icon: 'none' })
    if (this.data.loading || this.data.saving || this.data.choosing || this.data.bindingPhone) return
    this.setData({ bindingPhone: true, errorMessage: '' })
    try {
      const user = await app.bindWechatPhone(code)
      this.setData({ mobile: user.mobile || '' })
      wx.showToast({ title: '手机号已绑定', icon: 'success' })
    } catch (error) {
      this.setData({ errorMessage: String(error.message || error.errMsg || '手机号绑定失败，请重试') })
    } finally {
      this.setData({ bindingPhone: false })
    }
  },
  requirePrivacyAuthorize() {
    if (typeof wx.requirePrivacyAuthorize !== 'function') return Promise.resolve()
    return new Promise((resolve, reject) => wx.requirePrivacyAuthorize({ success: resolve, fail: reject }))
  },
  async chooseAvatar() {
    if (this.data.loading || this.data.saving || this.data.choosing) return
    this.setData({ choosing: true, errorMessage: '' })
    try {
      await this.requirePrivacyAuthorize()
      const media = await new Promise((resolve, reject) => {
        if (typeof wx.chooseMedia === 'function') wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'], success: resolve, fail: reject })
        else wx.chooseImage({ count: 1, sourceType: ['album', 'camera'], sizeType: ['compressed'], success: resolve, fail: reject })
      })
      const avatarPath = media?.tempFiles?.[0]?.tempFilePath || media?.tempFilePaths?.[0]
      if (!avatarPath) throw new Error('没有获取到图片文件')
      if (media?.tempFiles?.[0]?.size > 5 * 1024 * 1024) throw new Error('图片超过 5 MB，请选择较小的图片')
      this.setData({ avatarPath, avatarDraft: avatarPath, dirty: true })
    } catch (error) {
      const message = String(error?.errMsg || error?.message || '')
      if (/api scope is not declared|not declared in the privacy agreement/i.test(message)) {
        wx.showModal({ title: '需要完善隐私指引', content: '请管理员在微信公众平台的“用户隐私保护指引”中声明相册和相机用途。', showCancel: false })
      } else if (!/cancel/i.test(message)) this.setData({ errorMessage: message || '选择图片失败，请重试' })
    } finally {
      this.setData({ choosing: false })
    }
  },
  onNicknameInput(e) {
    const nickname = String(e.detail.value || '')
    this.setData({ nickname, dirty: Boolean(this.data.avatarPath) || nickname.trim() !== this.data.displayName, errorMessage: '' })
  },
  async saveProfile() {
    if (this.data.loading || this.data.saving || this.data.choosing) return
    const nickname = String(this.data.nickname || '').trim()
    if (!nickname) return wx.showToast({ title: '请填写昵称', icon: 'none' })
    if (nickname.length > 80) return wx.showToast({ title: '昵称不能超过 80 个字符', icon: 'none' })
    this.setData({ saving: true, errorMessage: '' })
    try {
      const user = this.data.avatarPath
        ? await app.uploadProfileAvatar(this.data.avatarPath, nickname)
        : await app.updateProfile({ nickname })
      const avatarUrl = api.mediaUrl(user.avatarUrl || user.avatar_url || '')
      this.setData({ displayName: user.name || nickname, nickname: user.name || nickname, avatarUrl, avatarDraft: avatarUrl, avatarPath: '', avatarInitial: (user.name || nickname).slice(0, 1) || '微', dirty: false })
      wx.showToast({ title: '资料已保存', icon: 'success' })
    } catch (error) {
      // 保留草稿供重试，并持续显示完整错误，避免 toast 截断失败原因。
      this.setData({ errorMessage: String(error.message || error.errMsg || '保存失败，请稍后重试') })
    } finally {
      this.setData({ saving: false })
    }
  },
  logout() {
    if (this.data.saving || this.data.choosing) return
    wx.showModal({
      title: '退出登录', content: '退出后仍可浏览公开内容。',
      success: result => {
        if (!result.confirm) return
        app.logout()
        wx.switchTab({ url: '/pages/profile/index' })
      }
    })
  }
})
