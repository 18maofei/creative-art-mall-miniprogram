import { db } from '../knex.js'
import { failWith, text } from '../http.js'
import { resolveWechatOpenid, sessionFor, loadActiveUser, requireUser, normalizeRole } from '../auth.js'
import { serializeUser } from '../serialize.js'

export default async function authRoutes(app) {
  const fail = failWith(app)

  app.post('/api/auth/wechat-login', async (request, reply) => {
    try {
      const body = request.body || {}
      const code = text(body.code, 'code')
      const openid = await resolveWechatOpenid(code, body.devOpenid)
      let user = await db('users').where('wechat_openid', openid).first()
      if (!user) {
        const [insertId] = await db('users').insert({
          wechat_openid: openid,
          display_name: String(body.nickname || '').trim() || '微信用户',
          avatar_url: body.avatarUrl || null
        })
        user = await db('users').where('id', insertId).first()
      }
      if (user.status !== 'ACTIVE') throw new Error('账号已被停用，请联系画室')
      const current = await loadActiveUser(user.id)
      return {
        data: {
          token: sessionFor(current),
          user: serializeUser(current.row, current.roles, current)
        }
      }
    } catch (error) { return fail(reply, error) }
  })

  app.get('/api/auth/me', async (request, reply) => {
    try {
      const current = await requireUser(request)
      return { data: { user: serializeUser(current.row, current.roles, current) } }
    } catch (error) { return fail(reply, error, /登录|请先登录/.test(error.message || '') ? 401 : 400) }
  })

  app.post('/api/auth/switch-role', async (request, reply) => {
    try {
      const current = await requireUser(request)
      const requested = normalizeRole(request.body?.role)
      if (!requested || !current.roles.includes(requested)) throw new Error('该账号没有此身份')
      const selected = await loadActiveUser(current.id, requested)
      return { data: { token: sessionFor(selected), user: serializeUser(selected.row, selected.roles, selected) } }
    } catch (error) { return fail(reply, error, /登录|权限|身份/.test(error.message || '') ? 403 : 400) }
  })
}
