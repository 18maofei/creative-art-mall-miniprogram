export function statusToApi(status) {
  return status === 'ON_SALE' ? 'PUBLISHED' : status
}

export function statusToDb(status) {
  return status === 'PUBLISHED' ? 'ON_SALE' : status
}

export function serializeCourse(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    title: row.name,
    category: row.category || '艺术课程',
    age_range: row.age_range,
    sessions: Number(row.default_lesson_count || 0),
    price: Number(row.price || 0),
    schedule: row.schedule_text,
    campus: row.campus,
    room: row.room,
    teacher_name: row.teacher_name,
    description: row.description,
    cover_url: row.cover_url,
    status: statusToApi(row.status),
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

export function serializeProduct(row, skus = []) {
  if (!row) return null
  const primary = skus[0] || {}
  return {
    id: Number(row.id),
    title: row.name,
    category: row.category || '画室周边',
    description: row.description,
    cover_url: row.cover_url,
    status: statusToApi(row.status),
    price: Number(primary.price || 0),
    stock: skus.reduce((total, sku) => total + Number(sku.stock_quantity || 0), 0),
    sales: Number(row.sales || 0),
    skus: skus.map(sku => ({
      sku_id: Number(sku.id),
      sku_name: sku.name,
      sku_code: sku.sku_code,
      price: Number(sku.price || 0),
      stock_quantity: Number(sku.stock_quantity || 0)
    })),
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

const ROLE_PRIORITY = ['ADMIN', 'OPERATOR', 'TEACHER', 'PARENT', 'STUDENT']

const ROLE_DEFINITIONS = {
  PARENT: { code: 'parent', name: '家长' },
  TEACHER: { code: 'teacher', name: '教师' },
  STUDENT: { code: 'student', name: '学生' },
  OPERATOR: { code: 'operator', name: '运营人员' },
  ADMIN: { code: 'admin', name: '超级管理员' }
}

function normalizeRole(value) {
  const role = String(value || '').trim().toUpperCase()
  return ROLE_DEFINITIONS[role] ? role : null
}

export function primaryRole(roles) {
  for (const role of ROLE_PRIORITY) if (roles.includes(role)) return role
  return 'VISITOR'
}

export function serializeUser(row, roles = [], options = {}) {
  if (!row) return null
  const codes = roles.map(normalizeRole).filter(Boolean)
  const roleDetails = options.roleDetails || codes.map(role => ({ code: ROLE_DEFINITIONS[role].code, name: ROLE_DEFINITIONS[role].name, status: 'active' }))
  return {
    id: Number(row.id),
    name: row.display_name,
    mobile: row.mobile,
    avatar_url: row.avatar_url,
    avatarUrl: row.avatar_url,
    avatar: row.avatar_url,
    role: primaryRole(codes),
    roleCodes: codes,
    roles: roleDetails,
    currentRole: ROLE_DEFINITIONS[normalizeRole(options.currentRole) || primaryRole(codes)]?.code || 'visitor',
    permissions: options.permissions || [],
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

export function serializeOrder(row, items = []) {
  if (!row) return null
  const first = items[0] || {}
  const type = items.some(item => item.course_id) ? 'COURSE' : 'PRODUCT'
  const title = first.name_snapshot
    ? items.length > 1 ? `${first.name_snapshot} 等 ${items.length} 件` : first.name_snapshot
    : '订单'
  return {
    id: Number(row.id),
    order_no: row.order_no,
    buyer_user_id: Number(row.buyer_user_id),
    buyer_name: row.buyer_name,
    type,
    subject_title: title,
    amount: Number(row.total_amount || 0),
    total_amount: Number(row.total_amount || 0),
    status: row.status,
    paid_at: row.paid_at,
    shipped_at: row.shipped_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at,
    tracking_no: row.tracking_no,
    recipient_name_snapshot: row.recipient_name_snapshot,
    recipient_mobile_snapshot: row.recipient_mobile_snapshot,
    shipping_address_snapshot: row.shipping_address_snapshot,
    created_at: row.created_at,
    items: items.map(item => ({
      id: Number(item.id),
      name: item.name_snapshot,
      unit_price: Number(item.unit_price || 0),
      quantity: Number(item.quantity || 0),
      subtotal: Number(item.subtotal || 0),
      course_id: item.course_id ? Number(item.course_id) : null,
      product_sku_id: item.product_sku_id ? Number(item.product_sku_id) : null
    }))
  }
}

export function serializeAddress(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    recipient_name: row.recipient_name,
    mobile: row.mobile,
    province: row.province,
    city: row.city,
    district: row.district,
    detail: row.detail,
    is_default: Boolean(row.is_default),
    full_address: `${row.province}${row.city}${row.district}${row.detail}`
  }
}
