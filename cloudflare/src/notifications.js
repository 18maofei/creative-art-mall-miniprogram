import { all, run, isoNow } from './core.js'

export async function notifyUsers(db, userIds, notification) {
  const recipients = [...new Set((userIds || []).map(Number).filter(id => Number.isInteger(id) && id > 0))]
  if (!recipients.length) return 0
  const now = isoNow()
  for (const userId of recipients) {
    await run(db, `INSERT OR IGNORE INTO notifications
      (recipient_user_id, type, title, body, data_json, related_type, related_id, dedupe_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      userId,
      String(notification.type || 'SYSTEM'),
      String(notification.title || '新通知'),
      String(notification.body || ''),
      notification.data ? JSON.stringify(notification.data) : null,
      notification.relatedType || null,
      notification.relatedId ? Number(notification.relatedId) : null,
      notification.dedupeKey ? `${notification.dedupeKey}:${userId}` : null,
      now
    ])
  }
  return recipients.length
}

export async function trialNotificationRecipients(db, courseId) {
  const params = []
  let teacherClause = ''
  if (courseId) {
    teacherClause = `OR (ur.role = 'TEACHER' AND EXISTS (
      SELECT 1 FROM classes c WHERE c.course_id = ? AND c.teacher_user_id = u.id AND c.status = 'ACTIVE'
    ))`
    params.push(Number(courseId))
  }
  const rows = await all(db, `
    SELECT DISTINCT u.id
    FROM users u JOIN user_roles ur ON ur.user_id = u.id
    WHERE u.status = 'ACTIVE' AND (ur.role IN ('ADMIN', 'OPERATOR') ${teacherClause})
  `, params)
  return rows.map(row => Number(row.id))
}
