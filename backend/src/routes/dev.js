import { db } from '../knex.js'
import { failWith } from '../http.js'

// 仅开发环境注册：返回种子账号 ID，供小程序在未接入微信登录前使用。
export default async function devRoutes(app) {
  const fail = failWith(app)

  app.get('/api/dev/context', async (_request, reply) => {
    try {
      const users = await db('users').whereIn('wechat_openid', ['demo-admin-001', 'demo-operator-001', 'demo-parent-001', 'demo-teacher-001', 'demo-student-001']).select('id', 'wechat_openid')
      const byOpenid = Object.fromEntries(users.map(user => [user.wechat_openid, Number(user.id)]))
      if (!byOpenid['demo-admin-001']) throw new Error('种子数据缺失，请先运行 npm run db:seed')
      return {
        data: {
          adminUserId: byOpenid['demo-admin-001'],
          operatorUserId: byOpenid['demo-operator-001'],
          parentUserId: byOpenid['demo-parent-001'],
          teacherUserId: byOpenid['demo-teacher-001'],
          studentUserId: byOpenid['demo-student-001']
        }
      }
    } catch (error) { return fail(reply, error) }
  })
}
