const { artworkDetail, recordEvent, setArtworkLike, submitArtworkComment, deleteArtworkComment } = require('../../services/api')
const app = getApp()

function displayTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function presentComment(comment) {
  return { ...comment, display_time: displayTime(comment.created_at) }
}

Page({
  data: {
    artworkId: '',
    artwork: null,
    comments: [],
    draft: '',
    loading: true,
    error: '',
    submitting: false,
    likePending: false,
    deletingCommentId: 0,
    draftLength: 0
  },

  onLoad(options) {
    this.setData({ artworkId: String(options.id || '') })
    recordEvent('page_view', 'artwork_detail', 'VISITOR')
    this.loadData()
  },

  async loadData() {
    if (!this.data.artworkId) return this.setData({ loading: false, error: '作品不存在' })
    this.setData({ loading: true, error: '' })
    try {
      const result = await artworkDetail(this.data.artworkId)
      this.setData({
        artwork: { ...result.artwork, display_date: displayTime(result.artwork.created_at) },
        comments: result.comments.map(presentComment),
        loading: false,
        error: ''
      })
    } catch (error) {
      this.setData({ loading: false, error: error.message || '作品加载失败' })
    }
  },

  previewArtwork() {
    const image = this.data.artwork?.image_url
    if (image) wx.previewImage({ current: image, urls: [image] })
  },

  async toggleLike() {
    const artwork = this.data.artwork
    if (!artwork || this.data.likePending) return
    const userId = await app.ensureLogin()
    if (!userId) return wx.showToast({ title: '登录后即可点赞', icon: 'none' })
    const liked = !artwork.liked_by_me
    this.setData({
      likePending: true,
      artwork: {
        ...artwork,
        liked_by_me: liked,
        likes_count: Math.max(0, Number(artwork.likes_count || 0) + (liked ? 1 : -1))
      }
    })
    try {
      const result = await setArtworkLike(artwork.id, liked)
      this.setData({
        likePending: false,
        artwork: { ...this.data.artwork, liked_by_me: result.liked, likes_count: Number(result.likes_count || 0) }
      })
    } catch (error) {
      this.setData({ likePending: false, artwork })
      wx.showToast({ title: error.message || '点赞失败，请重试', icon: 'none' })
    }
  },

  onDraftInput(event) {
    const draft = event.detail.value || ''
    this.setData({ draft, draftLength: [...draft].length })
  },

  async submitComment() {
    const content = String(this.data.draft || '').trim()
    if (!content) return wx.showToast({ title: '先写下你的评论', icon: 'none' })
    if ([...content].length > 500) return wx.showToast({ title: '评论不能超过 500 个字', icon: 'none' })
    if (this.data.submitting) return
    const userId = await app.ensureLogin()
    if (!userId) return wx.showToast({ title: '登录后即可发表评论', icon: 'none' })
    this.setData({ submitting: true })
    try {
      const comment = await submitArtworkComment(this.data.artworkId, content)
      this.setData({
        submitting: false,
        draft: '',
        draftLength: 0,
        comments: [presentComment({ ...comment, is_mine: true }), ...this.data.comments]
      })
      wx.showToast({ title: '评论已提交，审核通过后展示', icon: 'none' })
    } catch (error) {
      this.setData({ submitting: false })
      wx.showToast({ title: error.message || '评论提交失败，请重试', icon: 'none' })
    }
  },

  async deleteComment(event) {
    const commentId = Number(event.currentTarget.dataset.id)
    const comment = this.data.comments.find(item => Number(item.id) === commentId)
    if (!comment || !comment.is_mine || this.data.deletingCommentId) return
    const userId = await app.ensureLogin()
    if (!userId) return wx.showToast({ title: '登录状态已失效，请重新登录', icon: 'none' })
    const confirmed = await new Promise(resolve => wx.showModal({
      title: '删除评论',
      content: '删除后无法恢复，确定删除这条评论吗？',
      confirmText: '删除',
      confirmColor: '#bd565d',
      success: result => resolve(result.confirm),
      fail: () => resolve(false)
    }))
    if (!confirmed) return

    this.setData({ deletingCommentId: commentId })
    try {
      await deleteArtworkComment(this.data.artworkId, commentId)
      const isPublished = comment.status === 'PUBLISHED'
      this.setData({
        comments: this.data.comments.filter(item => Number(item.id) !== commentId),
        artwork: {
          ...this.data.artwork,
          comments_count: Math.max(0, Number(this.data.artwork.comments_count || 0) - (isPublished ? 1 : 0))
        }
      })
      wx.showToast({ title: '评论已删除', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error.message || '删除失败，请重试', icon: 'none' })
    } finally {
      this.setData({ deletingCommentId: 0 })
    }
  }
})
