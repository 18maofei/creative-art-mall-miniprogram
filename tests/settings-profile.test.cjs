const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/settings/index.js'), 'utf8')
function setup() {
  let definition, picker, failures = 0, refreshes = 0
  let saved = { id: 1, name: '小林', avatarUrl: '/api/assets/old.png' }
  const uploads = []
  const app = {
    refreshUser: async () => { refreshes++; return saved },
    uploadProfileAvatar: async (file, nickname) => {
      uploads.push({ file, nickname })
      if (failures-- > 0) throw new Error('头像上传网络失败')
      saved = { ...saved, name: nickname, avatarUrl: '/api/assets/new.png' }
      return saved
    },
    updateProfile: async ({ nickname }) => { saved = { ...saved, name: nickname }; return saved }
  }
  vm.runInNewContext(source, {
    getApp: () => app,
    require: () => ({ mediaUrl: value => value ? `https://example.test${value}` : '' }),
    Page: value => { definition = value },
    wx: { chooseMedia: options => { picker = options }, showToast() {}, showModal() {}, switchTab() {} },
    setTimeout
  })
  const page = () => ({ ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } })
  return {
    page, app, uploads,
    failOnce() { failures = 1 },
    refreshCount: () => refreshes,
    picked(size = 1000) { picker.success({ tempFiles: [{ tempFilePath: 'wxfile://new.jpg', size }] }) },
    cancel() { picker.fail({ errMsg: 'chooseMedia:fail cancel' }) }
  }
}

for (const timing of ['before', 'after']) {
  test(`相册返回 onShow ${timing} 选择回调：头像与昵称保留并持久化`, async () => {
    const h = setup(), p = h.page()
    await p.onLoad()
    p.onNicknameInput({ detail: { value: '新昵称' } })
    const selection = p.chooseAvatar()
    await Promise.resolve()
    if (timing === 'before') await p.onShow?.()
    h.picked()
    await selection
    if (timing === 'after') await p.onShow?.()
    assert.equal(h.refreshCount(), 1)
    assert.equal(p.data.avatarPath, 'wxfile://new.jpg')
    assert.equal(p.data.nickname, '新昵称')
    await p.saveProfile()
    assert.deepEqual(h.uploads, [{ file: 'wxfile://new.jpg', nickname: '新昵称' }])
    assert.equal(p.data.avatarPath, '')
    assert.equal(p.data.dirty, false)
    const reopened = h.page()
    await reopened.onLoad()
    assert.equal(reopened.data.avatarDraft, 'https://example.test/api/assets/new.png')
    assert.equal(reopened.data.nickname, '新昵称')
  })
}

test('上传失败保留草稿，随后重试成功', async () => {
  const h = setup(), p = h.page()
  await p.onLoad()
  const selection = p.chooseAvatar()
  await Promise.resolve()
  h.picked()
  await selection
  h.failOnce()
  await p.saveProfile()
  assert.equal(p.data.avatarPath, 'wxfile://new.jpg')
  assert.equal(p.data.dirty, true)
  assert.equal(p.data.errorMessage, '头像上传网络失败')
  assert.equal(p.data.saving, false)
  await p.saveProfile()
  assert.equal(p.data.errorMessage, '')
  assert.equal(p.data.dirty, false)
})

test('取消选择或图片超限不会破坏现有资料', async () => {
  const h = setup(), p = h.page()
  await p.onLoad()
  for (const cancel of [true, false]) {
    const selection = p.chooseAvatar()
    await Promise.resolve()
    if (cancel) h.cancel()
    else h.picked(6 * 1024 * 1024)
    await selection
    assert.equal(p.data.avatarDraft, 'https://example.test/api/assets/old.png')
    assert.equal(p.data.avatarPath, '')
    assert.equal(p.data.choosing, false)
  }
  assert.match(p.data.errorMessage, /5 MB/)
})

test('仅改昵称不上传头像；保存期间重复点击只提交一次', async () => {
  const h = setup(), p = h.page()
  await p.onLoad()
  p.onNicknameInput({ detail: { value: '新的称呼' } })
  let complete, writes = 0
  h.app.updateProfile = () => { writes++; return new Promise(resolve => { complete = resolve }) }
  const saving = p.saveProfile()
  await p.saveProfile()
  assert.equal(writes, 1)
  assert.equal(h.uploads.length, 0)
  complete({ name: '新的称呼', avatarUrl: '/api/assets/old.png' })
  await saving
  assert.equal(p.data.saving, false)
  assert.equal(p.data.dirty, false)
})
