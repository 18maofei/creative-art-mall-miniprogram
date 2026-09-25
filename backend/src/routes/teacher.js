import { db } from '../knex.js'
import { failWith, id, text } from '../http.js'
import { assertSelfOrAdmin, requireUser, requirePermission } from '../auth.js'
import { balanceOf, applyLedger } from '../services/lessons.js'

async function requireTeacher(request) {
  const user = await requireUser(request)
  if (!['TEACHER', 'ADMIN'].includes(user.currentRole)) throw new Error('需要教师身份')
  return user
}

// 非管理员教师只能操作自己班级的课次。
async function assertSessionOwner(user, sessionId) {
  if (user.currentRole === 'ADMIN') return
  const session = await db('class_sessions').join('classes', 'classes.id', 'class_sessions.class_id').where('class_sessions.id', sessionId).first('classes.teacher_user_id')
  if (!session || Number(session.teacher_user_id) !== user.id) throw new Error('无权操作该课次')
}

export default async function teacherRoutes(app) {
  const fail = failWith(app)

  app.get('/api/teacher/:userId/sessions', async (request, reply) => {
    try {
      const userId = id(request.params.userId, 'userId')
      const teacher = await requireTeacher(request)
      requirePermission(teacher, 'schedule.read')
      assertSelfOrAdmin(teacher, userId)
      const rows = await db('class_sessions')
        .join('classes', 'classes.id', 'class_sessions.class_id')
        .join('courses', 'courses.id', 'classes.course_id')
        .where('classes.teacher_user_id', userId)
        .orderBy('class_sessions.starts_at', 'asc')
        .select('class_sessions.*', 'courses.name AS course_title', 'classes.name AS class_name')
      return { data: rows }
    } catch (error) { return fail(reply, error) }
  })

  app.get('/api/sessions/:sessionId/attendance', async (request, reply) => {
    try {
      const sessionId = id(request.params.sessionId, 'sessionId')
      const teacher = await requireTeacher(request)
      requirePermission(teacher, 'attendance.read')
      const session = await db('class_sessions').where('id', sessionId).first('class_id')
      if (!session) throw new Error('课次不存在')
      await assertSessionOwner(teacher, sessionId)
      const rows = await db('children')
        .join('enrollments', 'enrollments.child_id', 'children.id')
        .leftJoin('attendance', builder => builder.on('attendance.child_id', 'children.id').andOnVal('attendance.session_id', sessionId))
        .where('enrollments.class_id', session.class_id)
        .where('enrollments.status', 'ACTIVE')
        .orderBy('children.id')
        .select('children.id AS student_id', 'children.name', db.raw("COALESCE(attendance.status, 'PRESENT') AS status"))
      const data = []
      for (const row of rows) {
        data.push({ ...row, student_id: Number(row.student_id), remaining_lessons: await balanceOf(db, row.student_id) })
      }
      return { data }
    } catch (error) { return fail(reply, error) }
  })

  app.post('/api/sessions/:sessionId/attendance', async (request, reply) => {
    try {
      const sessionId = id(request.params.sessionId, 'sessionId')
      const teacher = await requireTeacher(request)
      requirePermission(teacher, 'attendance.write')
      await assertSessionOwner(teacher, sessionId)
      const body = request.body || {}
      const records = Array.isArray(body.records) ? body.records : []
      if (!records.length) throw new Error('records are required')
      const sessionRecord = await db('class_sessions').where('id', sessionId).first('status')
      if (!sessionRecord || sessionRecord.status === 'CANCELLED') throw new Error('课次不存在或已取消')
      await db.transaction(async trx => {
        for (const record of records) {
          const childId = id(record.studentId, 'studentId')
          const status = ['PRESENT', 'LEAVE', 'ABSENT'].includes(record.status) ? record.status : 'PRESENT'
          const enrolled = await trx('enrollments').join('class_sessions', 'class_sessions.class_id', 'enrollments.class_id').where('class_sessions.id', sessionId).where('enrollments.child_id', childId).where('enrollments.status', 'ACTIVE').first('enrollments.id')
          if (!enrolled) throw new Error('该学员未报名此班级')
          const previous = await trx('attendance').where({ session_id: sessionId, child_id: childId }).first('status', 'updated_at')
          const previousStatus = previous?.status || null
          if (previousStatus !== status) {
            const transitionKey = previous?.updated_at || 'initial'
            if (previousStatus === 'PRESENT' && status !== 'PRESENT') {
              await applyLedger(trx, {
                childId, sessionId, type: 'REFUND', quantity: 1,
                reason: `考勤改为${status === 'LEAVE' ? '请假' : '缺勤'}，回补课时`,
                idempotencyKey: `attend-reversal-${sessionId}-${childId}-${transitionKey}`,
                operatorUserId: teacher.id
              })
            } else if (status === 'PRESENT') {
              await applyLedger(trx, {
                childId, sessionId, type: 'DEDUCT', quantity: -1, reason: '课次考勤扣课',
                idempotencyKey: `attend-present-${sessionId}-${childId}-${transitionKey}`,
                operatorUserId: teacher.id
              })
            }
          }
          await trx('attendance')
            .insert({ session_id: sessionId, child_id: childId, status, confirmed_at: trx.fn.now() })
            .onConflict(['session_id', 'child_id'])
            .merge({ status, confirmed_at: trx.fn.now(), updated_at: trx.fn.now() })
        }
      })
      return { data: { confirmed: records.length } }
    } catch (error) { return fail(reply, error) }
  })

  app.post('/api/sessions/:sessionId/feedback', async (request, reply) => {
    try {
      const sessionId = id(request.params.sessionId, 'sessionId')
      const teacher = await requireTeacher(request)
      requirePermission(teacher, 'feedback.write')
      await assertSessionOwner(teacher, sessionId)
      const body = request.body || {}
      if (body.childId) {
        const enrolled = await db('enrollments').join('class_sessions', 'class_sessions.class_id', 'enrollments.class_id').where('class_sessions.id', sessionId).where('enrollments.child_id', id(body.childId, 'childId')).where('enrollments.status', 'ACTIVE').first('enrollments.id')
        if (!enrolled) throw new Error('该学员未报名此班级')
      }
      const [insertId] = await db('session_feedback').insert({
        session_id: sessionId,
        child_id: body.childId ? id(body.childId, 'childId') : null,
        teacher_user_id: teacher.id,
        content: text(body.content, 'content'),
        homework: body.homework || null,
        status: 'PUBLISHED'
      })
      return reply.code(201).send({ data: { id: Number(insertId) } })
    } catch (error) { return fail(reply, error) }
  })
}
