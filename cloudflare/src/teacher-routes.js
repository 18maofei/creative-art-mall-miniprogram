import { all, first, run, bodyOf, id, text, ok, assertSelfOrAdmin, requireTeacher, requirePermission, HttpError, isoNow } from './core.js'
import { balanceOf, applyLedger } from './lessons.js'

async function assertSessionOwner(db, user, sessionId) {
  if (user.currentRole === 'ADMIN') return
  const session = await first(db, 'SELECT classes.teacher_user_id FROM class_sessions JOIN classes ON classes.id = class_sessions.class_id WHERE class_sessions.id = ?', [sessionId])
  if (!session || Number(session.teacher_user_id) !== user.id) throw new HttpError(403, '无权操作该课次')
}

export function registerTeacherRoutes(router) {
  router.get('/api/teacher/:userId/sessions', async ctx => {
    const userId = id(ctx.params.userId, 'userId')
    const teacher = await requireTeacher(ctx)
    requirePermission(teacher, 'schedule.read')
    assertSelfOrAdmin(teacher, userId)
    const rows = await all(ctx.db, `
      SELECT class_sessions.*, courses.name AS course_title, classes.name AS class_name
      FROM class_sessions JOIN classes ON classes.id = class_sessions.class_id
      JOIN courses ON courses.id = classes.course_id
      WHERE classes.teacher_user_id = ? ORDER BY class_sessions.starts_at ASC
    `, [userId])
    return ok(rows)
  })

  router.get('/api/sessions/:sessionId/attendance', async ctx => {
    const sessionId = id(ctx.params.sessionId, 'sessionId')
    const teacher = await requireTeacher(ctx)
    requirePermission(teacher, 'attendance.read')
    await assertSessionOwner(ctx.db, teacher, sessionId)
    const session = await first(ctx.db, 'SELECT class_id FROM class_sessions WHERE id = ?', [sessionId])
    if (!session) throw new HttpError(404, '课次不存在')
    const rows = await all(ctx.db, `
      SELECT children.id AS student_id, children.name,
             COALESCE(attendance.status, 'PRESENT') AS status
      FROM children JOIN enrollments ON enrollments.child_id = children.id
      LEFT JOIN attendance ON attendance.child_id = children.id AND attendance.session_id = ?
      WHERE enrollments.class_id = ? AND enrollments.status = 'ACTIVE' ORDER BY children.id
    `, [sessionId, session.class_id])
    const data = []
    for (const row of rows) data.push({ ...row, student_id: Number(row.student_id), remaining_lessons: await balanceOf(ctx.db, row.student_id) })
    return ok(data)
  })

  router.post('/api/sessions/:sessionId/attendance', async ctx => {
    const sessionId = id(ctx.params.sessionId, 'sessionId')
    const teacher = await requireTeacher(ctx)
    requirePermission(teacher, 'attendance.write')
    await assertSessionOwner(ctx.db, teacher, sessionId)
    const body = await bodyOf(ctx)
    const records = Array.isArray(body.records) ? body.records : []
    if (!records.length) throw new HttpError(400, 'records are required')
    const sessionRecord = await first(ctx.db, 'SELECT status FROM class_sessions WHERE id = ?', [sessionId])
    if (!sessionRecord || sessionRecord.status === 'CANCELLED') throw new HttpError(400, '课次不存在或已取消')
    const now = isoNow()
    for (const record of records) {
      const childId = id(record.studentId, 'studentId')
      const status = ['PRESENT', 'LEAVE', 'ABSENT'].includes(record.status) ? record.status : 'PRESENT'
      const enrolled = await first(ctx.db, `SELECT enrollments.id FROM enrollments JOIN class_sessions ON class_sessions.class_id = enrollments.class_id
        WHERE class_sessions.id = ? AND enrollments.child_id = ? AND enrollments.status = 'ACTIVE'`, [sessionId, childId])
      if (!enrolled) throw new HttpError(403, '该学员未报名此班级')
      const previous = await first(ctx.db, 'SELECT status, updated_at FROM attendance WHERE session_id = ? AND child_id = ?', [sessionId, childId])
      const previousStatus = previous?.status || null
      if (previousStatus !== status) {
        const transitionKey = previous?.updated_at || 'initial'
        if (previousStatus === 'PRESENT' && status !== 'PRESENT') {
          await applyLedger(ctx.db, {
            childId, sessionId, type: 'REFUND', quantity: 1,
            reason: `考勤改为${status === 'LEAVE' ? '请假' : '缺勤'}，回补课时`,
            idempotencyKey: `attend-reversal-${sessionId}-${childId}-${transitionKey}`, operatorUserId: teacher.id
          })
        } else if (status === 'PRESENT') {
          await applyLedger(ctx.db, {
            childId, sessionId, type: 'DEDUCT', quantity: -1, reason: '课次考勤扣课',
            idempotencyKey: `attend-present-${sessionId}-${childId}-${transitionKey}`, operatorUserId: teacher.id
          })
        }
      }
      await run(ctx.db, `
        INSERT INTO attendance (session_id, child_id, status, confirmed_by_user_id, confirmed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, child_id) DO UPDATE SET status = excluded.status,
          confirmed_by_user_id = excluded.confirmed_by_user_id, confirmed_at = excluded.confirmed_at, updated_at = excluded.updated_at
      `, [sessionId, childId, status, teacher.id, now, now, now])
    }
    return ok({ confirmed: records.length })
  })

  router.post('/api/sessions/:sessionId/feedback', async ctx => {
    const sessionId = id(ctx.params.sessionId, 'sessionId')
    const teacher = await requireTeacher(ctx)
    requirePermission(teacher, 'feedback.write')
    await assertSessionOwner(ctx.db, teacher, sessionId)
    const body = await bodyOf(ctx)
    if (body.childId) {
      const enrolled = await first(ctx.db, `SELECT enrollments.id FROM enrollments JOIN class_sessions ON class_sessions.class_id = enrollments.class_id
        WHERE class_sessions.id = ? AND enrollments.child_id = ? AND enrollments.status = 'ACTIVE'`, [sessionId, id(body.childId, 'childId')])
      if (!enrolled) throw new HttpError(403, '该学员未报名此班级')
    }
    const result = await run(ctx.db, `INSERT INTO session_feedback (session_id, child_id, teacher_user_id, content, homework, images_json, status) VALUES (?, ?, ?, ?, ?, ?, 'PUBLISHED')`, [sessionId, body.childId ? id(body.childId, 'childId') : null, teacher.id, text(body.content, 'content'), body.homework || null, body.imagesJson ? JSON.stringify(body.imagesJson) : null])
    return ok({ id: Number(result?.meta?.last_row_id || 0) }, 201)
  })
}
