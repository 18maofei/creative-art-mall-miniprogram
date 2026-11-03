import { db } from '../knex.js'
import { failWith, id, text } from '../http.js'
import { requireUser } from '../auth.js'
import { serializeCourse, serializeProduct } from '../serialize.js'
import { readObject, verifyUploadToken, writeLocalObject } from '../storage.js'

async function loadProducts(limit) {
  const products = await db('products').where('status', 'ON_SALE').orderBy('id', 'desc').modify(q => { if (limit) q.limit(limit) })
  const skus = products.length ? await db('product_skus').whereIn('product_id', products.map(p => p.id)).orderBy('id') : []
  return products.map(product => serializeProduct(product, skus.filter(sku => Number(sku.product_id) === Number(product.id))))
}

function serializeArtwork(row) {
  return {
    id: Number(row.id),
    title: row.title || '学员作品',
    kind: row.kind || 'ARTWORK',
    image_url: row.image_url,
    student_name: row.student_name,
    created_at: row.created_at
  }
}

function boundedText(value, name, maxLength) {
  const result = text(value, name)
  if (result.length > maxLength) throw new Error(`${name} 不能超过 ${maxLength} 个字符`)
  return result
}

function optionalDate(value) {
  const result = String(value ?? '').trim()
  if (!result) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(new Date(`${result}T00:00:00Z`).getTime())) throw new Error('预约日期格式不正确')
  return result
}

async function trialAppointmentRow(id) {
  if (!id) return null
  return db('trial_appointments')
    .leftJoin('courses', 'courses.id', 'trial_appointments.course_id')
    .leftJoin('users', 'users.id', 'trial_appointments.handled_by_user_id')
    .where('trial_appointments.id', id)
    .first('trial_appointments.*', 'courses.name AS course_title', 'users.display_name AS handled_by_name')
}

function serializeTrialAppointment(row) {
  if (!row) return null
  return {
    id: Number(row.id), user_id: row.user_id ? Number(row.user_id) : null,
    guardian_name: row.guardian_name, mobile: row.mobile, child_name: row.child_name,
    child_age: row.child_age === null || row.child_age === undefined ? null : Number(row.child_age),
    course_id: row.course_id ? Number(row.course_id) : null, course_title: row.course_title || null,
    preferred_date: row.preferred_date || null, preferred_time: row.preferred_time || 'ANY',
    note: row.note || '', status: row.status, handled_note: row.handled_note || '',
    handled_by_name: row.handled_by_name || null, handled_at: row.handled_at || null,
    created_at: row.created_at, updated_at: row.updated_at
  }
}

async function loadArtworks(limit, kind) {
  const rows = await db('artworks')
    .leftJoin('children', 'children.id', 'artworks.child_id')
    .where('artworks.is_public', 1)
    .orderBy('artworks.id', 'desc')
    .modify(q => {
      if (kind === 'ARTWORK' || kind === 'MOMENT') q.where('artworks.kind', kind)
      if (limit) q.limit(limit)
    })
    .select('artworks.*', 'children.name AS student_name')
  return rows.map(serializeArtwork)
}

export default async function publicRoutes(app) {
  const fail = failWith(app)

  app.get('/health', async (_request, reply) => {
    try { await db.raw('SELECT 1'); return { ok: true, service: 'zhixing-api', database: 'mysql' } } catch (error) { return fail(reply, error, 503) }
  })

  app.get('/api/public/bootstrap', async (_request, reply) => {
    try {
      const [courses, artworks, announcements] = await Promise.all([
        db('courses').where('status', 'ON_SALE').orderBy('id', 'desc').limit(2),
        loadArtworks(2),
        db('announcements').where('status', 'PUBLISHED').orderBy('published_at', 'desc').limit(3)
      ])
      return { data: { courses: courses.map(serializeCourse), products: [], artworks, announcements } }
    } catch (error) { return fail(reply, error, 503) }
  })

  app.get('/api/courses', async (_request, reply) => {
    try { return { data: (await db('courses').where('status', 'ON_SALE').orderBy('id', 'desc')).map(serializeCourse) } } catch (error) { return fail(reply, error, 503) }
  })

  app.get('/api/products', async (_request, reply) => {
    try { return { data: await loadProducts() } } catch (error) { return fail(reply, error, 503) }
  })

  app.get('/api/artworks', async (request, reply) => {
    try {
      const kind = String(request.query?.kind || '').toUpperCase()
      return { data: await loadArtworks(undefined, kind) }
    } catch (error) { return fail(reply, error, 503) }
  })

  app.get('/api/announcements', async (request, reply) => {
    try {
      const audience = String(request.query?.audience || '').toUpperCase()
      const rows = await db('announcements')
        .where('status', 'PUBLISHED')
        .modify(q => { if (audience === 'PARENT' || audience === 'TEACHER') q.whereIn('audience', ['ALL', audience]) })
        .orderBy('published_at', 'desc')
      return { data: rows }
    } catch (error) { return fail(reply, error) }
  })

  // 访客可以提交试听预约；带有效登录会话时关联用户，便于家长查看处理进度。
  app.post('/api/trial-appointments', async (request, reply) => {
    try {
      const body = request.body || {}
      const current = await requireUser(request).catch(() => null)
      const guardianName = boundedText(body.guardianName, 'guardianName', 80)
      const childName = boundedText(body.childName, 'childName', 80)
      const mobile = boundedText(body.mobile, 'mobile', 20)
      if (!/^1[3-9]\d{9}$/.test(mobile)) throw new Error('手机号格式不正确，请输入 11 位手机号')
      const childAge = body.childAge === '' || body.childAge === null || body.childAge === undefined ? null : Number(body.childAge)
      if (childAge !== null && (!Number.isInteger(childAge) || childAge < 2 || childAge > 18)) throw new Error('孩子年龄需为 2-18 岁整数')
      const preferredTime = String(body.preferredTime || 'ANY').trim().toUpperCase()
      if (!['ANY', 'MORNING', 'AFTERNOON', 'EVENING'].includes(preferredTime)) throw new Error('预约时段不正确')
      const preferredDate = optionalDate(body.preferredDate)
      const note = body.note ? boundedText(body.note, 'note', 500) : null
      const courseId = body.courseId ? id(body.courseId, 'courseId') : null
      if (courseId && !await db('courses').where({ id: courseId, status: 'ON_SALE' }).first('id')) throw new Error('所选课程不存在或已下架')
      const rawKey = String(body.idempotencyKey || request.headers['idempotency-key'] || '').trim()
      const idempotencyKey = rawKey ? boundedText(rawKey, 'idempotencyKey', 120) : null
      if (idempotencyKey) {
        const existing = await db('trial_appointments').where('idempotency_key', idempotencyKey).first('id')
        if (existing) return { data: { appointment: serializeTrialAppointment(await trialAppointmentRow(existing.id)), duplicate: true } }
      }
      let insertId
      try {
        [insertId] = await db('trial_appointments').insert({
          user_id: current?.id || null, guardian_name: guardianName, mobile, child_name: childName,
          child_age: childAge, course_id: courseId, preferred_date: preferredDate,
          preferred_time: preferredTime, note, idempotency_key: idempotencyKey
        })
      } catch (error) {
        if (!(idempotencyKey && error.code === 'ER_DUP_ENTRY')) throw error
        const existing = await db('trial_appointments').where('idempotency_key', idempotencyKey).first('id')
        if (existing) return { data: { appointment: serializeTrialAppointment(await trialAppointmentRow(existing.id)), duplicate: true } }
        throw error
      }
      return reply.code(201).send({ data: { appointment: serializeTrialAppointment(await trialAppointmentRow(insertId)), duplicate: false } })
    } catch (error) { return fail(reply, error) }
  })

  app.post('/api/events', async (request, reply) => {
    try {
      const body = request.body || {}
      const current = await requireUser(request).catch(() => null)
      await db('analytics_events').insert({
        event_name: text(body.eventName, 'eventName'),
        role: current?.currentRole || 'VISITOR',
        user_id: current?.id || null,
        page: body.page || null
      })
      return reply.code(201).send({ data: { accepted: true } })
    } catch (error) { return fail(reply, error) }
  })

  app.get('/api/assets/*', async (request, reply) => {
    try {
      const key = decodeURIComponent(String(request.params['*'] || ''))
      if (!/^(course-covers|product-covers|artworks|avatars|resources|uploads)\//.test(key) || key.includes('..')) throw new Error('asset not found')
      const asset = await readObject(key)
      reply.header('Cache-Control', 'public, max-age=86400')
      return reply.type(asset.contentType).send(asset.body)
    } catch (error) { return fail(reply, error, 404) }
  })

  // 本地存储模式的上传端点：presign 返回的 uploadUrl 指向这里，靠 HMAC 令牌授权。
  app.put('/api/assets/*', async (request, reply) => {
    try {
      const key = decodeURIComponent(String(request.params['*'] || ''))
      if (!/^(course-covers|product-covers|artworks|avatars|resources|uploads)\//.test(key) || key.includes('..')) throw new Error('asset not found')
      if (!verifyUploadToken(key, request.query?.exp, request.query?.token)) return fail(reply, new Error('上传链接无效或已过期'), 403)
      if (!Buffer.isBuffer(request.body) || !request.body.length) throw new Error('上传内容为空')
      await writeLocalObject(key, request.body)
      return reply.code(201).send({ data: { key } })
    } catch (error) { return fail(reply, error) }
  })
}
