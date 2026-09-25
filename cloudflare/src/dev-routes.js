import { all, ok, HttpError } from './core.js'

export function registerDevRoutes(router) {
  router.get('/api/dev/context', async ctx => {
    if (String(ctx.env.ALLOW_DEV_AUTH || '').toLowerCase() !== 'true'
      || String(ctx.env.PAYMENT_MODE || 'mock').toLowerCase() !== 'mock') throw new HttpError(404, 'not found')
    const users = await all(ctx.db, "SELECT id, wechat_openid FROM users WHERE wechat_openid IN ('demo-admin-001', 'demo-parent-001', 'demo-teacher-001', 'demo-student-001', 'demo-operator-001')")
    const byOpenid = Object.fromEntries(users.map(user => [user.wechat_openid, Number(user.id)]))
    if (!byOpenid['demo-admin-001']) throw new HttpError(503, '种子数据缺失，请先导入 seed 数据')
    return ok({ adminUserId: byOpenid['demo-admin-001'], operatorUserId: byOpenid['demo-operator-001'], parentUserId: byOpenid['demo-parent-001'], teacherUserId: byOpenid['demo-teacher-001'], studentUserId: byOpenid['demo-student-001'] })
  })
}
