const STORE_PREFIX = 'pureArt.favorites.'
const TYPES = new Set(['COURSE', 'ARTWORK'])

function storageKey(userId) {
  return `${STORE_PREFIX}${Number(userId) || 0}`
}

function normalize(item) {
  const type = String(item?.type || '').toUpperCase()
  const id = Number(item?.id)
  if (!TYPES.has(type) || !Number.isInteger(id) || id < 1) return null
  return {
    key: `${type}-${id}`,
    type,
    id,
    title: String(item?.title || '未命名内容').slice(0, 100),
    subtitle: String(item?.subtitle || '').slice(0, 160),
    imageUrl: String(item?.imageUrl || ''),
    savedAt: Number(item?.savedAt) || Date.now()
  }
}

function list(userId) {
  const raw = wx.getStorageSync(storageKey(userId))
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  return raw
    .map(normalize)
    .filter(item => item && !seen.has(item.key) && seen.add(item.key))
    .sort((left, right) => right.savedAt - left.savedAt)
}

function save(userId, items) {
  wx.setStorageSync(storageKey(userId), items.map(normalize).filter(Boolean))
}

function isFavorite(userId, type, id) {
  const key = `${String(type || '').toUpperCase()}-${Number(id)}`
  return list(userId).some(item => item.key === key)
}

function toggle(userId, item) {
  const normalized = normalize(item)
  if (!normalized) return { added: false, items: list(userId) }
  const items = list(userId)
  const index = items.findIndex(row => row.key === normalized.key)
  if (index >= 0) {
    items.splice(index, 1)
    save(userId, items)
    return { added: false, items }
  }
  items.unshift(normalized)
  save(userId, items)
  return { added: true, items }
}

function remove(userId, type, id) {
  const key = `${String(type || '').toUpperCase()}-${Number(id)}`
  const items = list(userId).filter(item => item.key !== key)
  save(userId, items)
  return items
}

module.exports = { list, isFavorite, toggle, remove }
