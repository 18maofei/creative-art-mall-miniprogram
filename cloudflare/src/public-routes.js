import { all, first, run, changedRows, lastInsertId, bodyOf, id, text, ok, requireUser, isoNow, HttpError, serializeCourse, serializeProduct } from './core.js'
import { getAsset, normalizeKey, putAsset, verifyUploadToken } from './storage.js'
import { notifyUsers, trialNotificationRecipients } from './notifications.js'

async function loadProducts(db, limit = null) {
  const sql = `SELECT * FROM products WHERE status = 'ON_SALE' ORDER BY id DESC${limit ? ' LIMIT ?' : ''}`
  const products = await all(db, sql, limit ? [limit] : [])
  if (!products.length) return []
  const skus = await all(db, `SELECT * FROM product_skus WHERE product_id IN (${products.map(() => '?').join(',')}) ORDER BY id`, products.map(product => product.id))
  return products.map(product => serializeProduct(product, skus.filter(sku => Number(sku.product_id) === Number(product.id))))
}

export function serializeArtwork(row) {
  return {
    id: Number(row.id), title: row.title || '学员作品', description: row.description || '',
    kind: row.kind || 'ARTWORK', image_url: row.image_url, student_name: row.student_name,
    created_at: row.created_at, likes_count: Number(row.likes_count || 0),
    comments_count: Number(row.comments_count || 0), liked_by_me: Number(row.liked_by_me || 0) === 1
  }
}

export function serializeArtworkComment(row) {
  return {
    id: Number(row.id), author_name: row.author_name || '用户', content: row.content,
    status: row.status, created_at: row.created_at,
    is_mine: row.is_mine === true || Number(row.is_mine || 0) === 1
  }
}

function serializeTrialAppointment(row) {
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

function publicText(value, name, maxLength) {
  const result = text(value, name)
  if (result.length > maxLength) throw new HttpError(400, `${name} 不能超过 ${maxLength} 个字符`)
  return result
}

function optionalDate(value) {
  const result = String(value ?? '').trim()
  if (!result) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(new Date(`${result}T00:00:00Z`).getTime())) throw new HttpError(400, '预约日期格式不正确')
  return result
}

async function trialAppointmentRow(db, appointmentId) {
  return first(db, `
    SELECT trial_appointments.*, courses.name AS course_title, users.display_name AS handled_by_name
    FROM trial_appointments
    LEFT JOIN courses ON courses.id = trial_appointments.course_id
    LEFT JOIN users ON users.id = trial_appointments.handled_by_user_id
    WHERE trial_appointments.id = ?
  `, [appointmentId])
}

async function loadArtworks(db, limit = null, kind = '', userId = null) {
  const clauses = ['artworks.is_public = 1']
  const params = [Number(userId) || 0]
  if (kind === 'ARTWORK' || kind === 'MOMENT') { clauses.push('artworks.kind = ?'); params.push(kind) }
  const limitSql = limit ? ' LIMIT ?' : ''
  if (limit) params.push(limit)
  const rows = await all(db, `
    SELECT artworks.*, children.name AS student_name,
      (SELECT COUNT(*) FROM artwork_likes WHERE artwork_id = artworks.id) AS likes_count,
      (SELECT COUNT(*) FROM artwork_comments WHERE artwork_id = artworks.id AND status = 'PUBLISHED') AS comments_count,
      EXISTS (SELECT 1 FROM artwork_likes WHERE artwork_id = artworks.id AND user_id = ?) AS liked_by_me
    FROM artworks LEFT JOIN children ON children.id = artworks.child_id
    WHERE ${clauses.join(' AND ')} ORDER BY artworks.id DESC${limitSql}
  `, params)
  return rows.map(serializeArtwork)
}

export function registerPublicRoutes(router) {
  router.get('/health', async ctx => {
    await first(ctx.db, 'SELECT 1 AS ok')
    return ok({ ok: true, service: 'art-studio-cloudflare-api', database: 'd1' })
  })

  router.get('/api/public/bootstrap', async ctx => {
    const [courses, artworks, announcements] = await Promise.all([
      all(ctx.db, "SELECT * FROM courses WHERE status = 'ON_SALE' ORDER BY id DESC LIMIT 2"),
      loadArtworks(ctx.db, 2),
      all(ctx.db, "SELECT * FROM announcements WHERE status = 'PUBLISHED' ORDER BY published_at DESC LIMIT 3")
    ])
    return ok({ courses: courses.map(serializeCourse), products: [], artworks, announcements })
  })

  router.get('/api/courses', async ctx => ok((await all(ctx.db, "SELECT * FROM courses WHERE status = 'ON_SALE' ORDER BY id DESC")).map(serializeCourse)))
  router.get('/api/products', async ctx => ok(await loadProducts(ctx.db)))
  router.get('/api/artworks', async ctx => {
    const user = await requireUser(ctx).catch(() => null)
    return ok(await loadArtworks(ctx.db, null, String(ctx.url.searchParams.get('kind') || '').toUpperCase(), user?.id))
  })

  router.get('/api/artworks/:id', async ctx => {
    const artworkId = id(ctx.params.id, 'artworkId')
    const user = await requireUser(ctx).catch(() => null)
    const artwork = await first(ctx.db, `
      SELECT artworks.*, children.name AS student_name,
        (SELECT COUNT(*) FROM artwork_likes WHERE artwork_id = artworks.id) AS likes_count,
        (SELECT COUNT(*) FROM artwork_comments WHERE artwork_id = artworks.id AND status = 'PUBLISHED') AS comments_count,
        EXISTS (SELECT 1 FROM artwork_likes WHERE artwork_id = artworks.id AND user_id = ?) AS liked_by_me
      FROM artworks LEFT JOIN children ON children.id = artworks.child_id
      WHERE artworks.id = ? AND artworks.is_public = 1
    `, [user?.id || 0, artworkId])
    if (!artwork) throw new HttpError(404, '作品不存在或未公开')
    const comments = await all(ctx.db, `
      SELECT artwork_comments.id, artwork_comments.content, artwork_comments.status,
             artwork_comments.created_at, users.display_name AS author_name,
             CASE WHEN artwork_comments.user_id = ? THEN 1 ELSE 0 END AS is_mine
      FROM artwork_comments JOIN users ON users.id = artwork_comments.user_id
      WHERE artwork_comments.artwork_id = ?
        AND (artwork_comments.status = 'PUBLISHED' OR artwork_comments.user_id = ?)
      ORDER BY artwork_comments.id DESC LIMIT 50
    `, [user?.id || 0, artworkId, user?.id || 0])
    return ok({ artwork: serializeArtwork(artwork), comments: comments.map(serializeArtworkComment) })
  })

  router.put('/api/artworks/:id/like', async ctx => {
    const artworkId = id(ctx.params.id, 'artworkId')
    const user = await requireUser(ctx)
    const body = await bodyOf(ctx)
    if (typeof body.liked !== 'boolean') throw new HttpError(400, '点赞状态无效')
    const artwork = await first(ctx.db, 'SELECT id FROM artworks WHERE id = ? AND is_public = 1', [artworkId])
    if (!artwork) throw new HttpError(404, '作品不存在或未公开')
    if (body.liked) {
      await run(ctx.db, 'INSERT OR IGNORE INTO artwork_likes (artwork_id, user_id, created_at) VALUES (?, ?, ?)', [artworkId, user.id, isoNow()])
    } else {
      await run(ctx.db, 'DELETE FROM artwork_likes WHERE artwork_id = ? AND user_id = ?', [artworkId, user.id])
    }
    const likesCount = await first(ctx.db, 'SELECT COUNT(*) AS total FROM artwork_likes WHERE artwork_id = ?', [artworkId])
    return ok({ liked: body.liked, likes_count: Number(likesCount?.total || 0) })
  })

  router.post('/api/artworks/:id/comments', async ctx => {
    const artworkId = id(ctx.params.id, 'artworkId')
    const user = await requireUser(ctx)
    const body = await bodyOf(ctx)
    const content = text(body.content, '评论内容')
    if ([...content].length > 500) throw new HttpError(400, '评论不能超过 500 个字')
    const artwork = await first(ctx.db, 'SELECT id FROM artworks WHERE id = ? AND is_public = 1', [artworkId])
    if (!artwork) throw new HttpError(404, '作品不存在或未公开')
    const now = isoNow()
    const result = await run(ctx.db, `
      INSERT INTO artwork_comments (artwork_id, user_id, content, status, created_at, updated_at)
      VALUES (?, ?, ?, 'PENDING', ?, ?)
    `, [artworkId, user.id, content, now, now])
    const comment = await first(ctx.db, `
      SELECT artwork_comments.id, artwork_comments.content, artwork_comments.status,
             artwork_comments.created_at, users.display_name AS author_name,
             1 AS is_mine
      FROM artwork_comments JOIN users ON users.id = artwork_comments.user_id
      WHERE artwork_comments.id = ?
    `, [lastInsertId(result)])
    return ok(serializeArtworkComment(comment), 201)
  })

  router.delete('/api/artworks/:id/comments/:commentId', async ctx => {
    const artworkId = id(ctx.params.id, 'artworkId')
    const commentId = id(ctx.params.commentId, 'commentId')
    const user = await requireUser(ctx)
    const result = await run(ctx.db, `
      DELETE FROM artwork_comments
      WHERE id = ? AND artwork_id = ? AND user_id = ?
    `, [commentId, artworkId, user.id])
    if (!changedRows(result)) throw new HttpError(404, '评论不存在或无权删除')
    return ok({ id: commentId, deleted: true })
  })

  router.get('/api/announcements', async ctx => {
    const audience = String(ctx.url.searchParams.get('audience') || '').toUpperCase()
    const params = []
    let where = "status = 'PUBLISHED'"
    if (audience === 'PARENT' || audience === 'TEACHER') { where += " AND audience IN ('ALL', ?)"; params.push(audience) }
    return ok(await all(ctx.db, `SELECT * FROM announcements WHERE ${where} ORDER BY published_at DESC`, params))
  })

  // 试听预约允许访客提交；若请求带有有效会话，则把预约关联到当前账号，方便之后查询进度。
  router.post('/api/trial-appointments', async ctx => {
    const body = await bodyOf(ctx)
    const current = await requireUser(ctx).catch(() => null)
    const guardianName = publicText(body.guardianName, 'guardianName', 80)
    const childName = publicText(body.childName, 'childName', 80)
    const mobile = publicText(body.mobile, 'mobile', 20)
    if (!/^1[3-9]\d{9}$/.test(mobile)) throw new HttpError(400, '手机号格式不正确，请输入 11 位手机号')
    const childAge = body.childAge === '' || body.childAge === null || body.childAge === undefined ? null : Number(body.childAge)
    if (childAge !== null && (!Number.isInteger(childAge) || childAge < 2 || childAge > 18)) throw new HttpError(400, '孩子年龄需为 2-18 岁整数')
    const preferredTime = String(body.preferredTime || 'ANY').trim().toUpperCase()
    if (!['ANY', 'MORNING', 'AFTERNOON', 'EVENING'].includes(preferredTime)) throw new HttpError(400, '预约时段不正确')
    const preferredDate = optionalDate(body.preferredDate)
    const note = body.note ? publicText(body.note, 'note', 500) : null
    const courseId = body.courseId ? id(body.courseId, 'courseId') : null
    if (courseId) {
      const course = await first(ctx.db, "SELECT id FROM courses WHERE id = ? AND status = 'ON_SALE'", [courseId])
      if (!course) throw new HttpError(400, '所选课程不存在或已下架')
    }
    const rawKey = String(body.idempotencyKey || ctx.request.headers.get('Idempotency-Key') || '').trim()
    const idempotencyKey = rawKey ? publicText(rawKey, 'idempotencyKey', 120) : null
    if (idempotencyKey) {
      const existing = await first(ctx.db, 'SELECT id FROM trial_appointments WHERE idempotency_key = ?', [idempotencyKey])
      if (existing) {
        const duplicate = await trialAppointmentRow(ctx.db, existing.id)
        return ok({ appointment: serializeTrialAppointment(duplicate), duplicate: true })
      }
    }
    const now = isoNow()
    try {
      const result = await run(ctx.db, `
        INSERT INTO trial_appointments
          (user_id, guardian_name, mobile, child_name, child_age, course_id, preferred_date, preferred_time, note, idempotency_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [current?.id || null, guardianName, mobile, childName, childAge, courseId, preferredDate, preferredTime, note, idempotencyKey, now, now])
      const appointment = await trialAppointmentRow(ctx.db, lastInsertId(result))
      const recipients = await trialNotificationRecipients(ctx.db, courseId)
      await notifyUsers(ctx.db, recipients, {
        type: 'TRIAL_APPOINTMENT_CREATED',
        title: '新的试听预约待处理',
        body: `${guardianName}为${childName}提交了${appointment.course_title ? `“${appointment.course_title}”` : '试听'}预约，请及时审核。`,
        data: { page: 'trial-appointments', appointmentId: Number(appointment.id) },
        relatedType: 'TRIAL_APPOINTMENT', relatedId: appointment.id,
        dedupeKey: `trial-created:${appointment.id}`
      })
      return ok({ appointment: serializeTrialAppointment(appointment), duplicate: false }, 201)
    } catch (error) {
      if (idempotencyKey && /unique|constraint/i.test(String(error?.message || ''))) {
        const existing = await first(ctx.db, 'SELECT id FROM trial_appointments WHERE idempotency_key = ?', [idempotencyKey])
        if (existing) {
          const duplicate = await trialAppointmentRow(ctx.db, existing.id)
          return ok({ appointment: serializeTrialAppointment(duplicate), duplicate: true })
        }
      }
      throw error
    }
  })

  router.post('/api/events', async ctx => {
    const body = await bodyOf(ctx)
    const current = await requireUser(ctx).catch(() => null)
    const eventName = text(body.eventName, 'eventName')
    const page = String(body.page || '').trim()
    if (eventName.length > 80 || page.length > 120) throw new HttpError(400, '埋点字段长度不正确')
    await ctx.db.prepare('INSERT INTO analytics_events (event_name, role, user_id, page) VALUES (?, ?, ?, ?)').bind(eventName, current?.currentRole || 'VISITOR', current?.id || null, page || null).run()
    return ok({ accepted: true }, 201)
  })

  router.get('/api/assets/*', async ctx => getAsset(ctx.env, normalizeKey(ctx.params['*'])))

  router.put('/api/assets/*', async ctx => {
    const key = normalizeKey(ctx.params['*'])
    if (!await verifyUploadToken(ctx.env, key, ctx.url.searchParams.get('exp'), ctx.url.searchParams.get('token'))) throw new HttpError(403, '上传链接无效或已过期')
    return ok(await putAsset(ctx.env, key, ctx.request), 201)
  })
}
