import { all, first, run, isoNow, wechatAccessToken } from './core.js'

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

export async function sendTrialWechatNotification(ctx, appointmentId, status, note) {
  const templateId = String(ctx.env.WECHAT_TRIAL_TEMPLATE_ID || '').trim()
  if (!templateId) return { sent: false, skipped: 'template_not_configured' }
  const subscription = await first(ctx.db, `
    SELECT ws.id, u.wechat_openid, ta.guardian_name, ta.child_name,
           ta.preferred_date, ta.preferred_time, c.name AS course_title
    FROM wechat_subscriptions ws
    JOIN users u ON u.id = ws.user_id
    JOIN trial_appointments ta ON ta.id = ws.appointment_id
    LEFT JOIN courses c ON c.id = ta.course_id
    WHERE ws.appointment_id = ? AND ws.template_id = ? AND ws.status = 'ACCEPTED'
    ORDER BY ws.id DESC LIMIT 1
  `, [appointmentId, templateId])
  if (!subscription || !subscription.wechat_openid) return { sent: false, skipped: 'no_accepted_subscription' }
  const label = status === 'CONFIRMED' ? '预约成功' : status === 'CANCELLED' ? '预约取消' : status === 'COMPLETED' ? '已完成' : '待审核'
  const time = subscription.preferred_date
    ? `${subscription.preferred_date}${subscription.preferred_time && subscription.preferred_time !== 'ANY' ? ` ${subscription.preferred_time}` : ''}`
    : '时间待定'
  const token = await wechatAccessToken(ctx)
  const response = await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      touser: subscription.wechat_openid, template_id: templateId, page: 'pages/trial-appointments/index',
      data: {
        thing1: { value: String(subscription.course_title || '试听预约').slice(0, 20) },
        date2: { value: time.slice(0, 20) },
        name3: { value: String(subscription.guardian_name || subscription.child_name || '用户').slice(0, 10) },
        thing4: { value: label.slice(0, 20) }, thing5: { value: String(note || '请打开小程序查看详情').slice(0, 20) }
      }
    })
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || Number(result.errcode || 0) !== 0) {
    await run(ctx.db, 'UPDATE wechat_subscriptions SET last_error = ? WHERE id = ?', [String(result.errmsg || result.errcode || '微信通知发送失败').slice(0, 500), subscription.id])
    console.error('wechat trial notification failed', result)
    return { sent: false, error: result.errmsg || result.errcode || 'send_failed' }
  }
  await run(ctx.db, "UPDATE wechat_subscriptions SET status = 'SENT', sent_at = ?, last_error = NULL WHERE id = ?", [isoNow(), subscription.id])
  return { sent: true }
}
