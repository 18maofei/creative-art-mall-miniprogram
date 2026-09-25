import { all, first, bodyOf, text, ok, sessionFor, resolveWechatOpenid, resolveWechatMobile, serializeUser, HttpError, lastInsertId, loadActiveUser, requireUser, normalizeRole } from './core.js'

export function registerAuthRoutes(router) {
  router.post('/api/auth/wechat-login', async ctx => {
    const body = await bodyOf(ctx)
    const code = text(body.code, 'code')
    if (code.length > 512) throw new HttpError(400, '登录凭证格式不正确')
    const openid = await resolveWechatOpenid(ctx, code, body.devOpenid)
    const phoneCode = String(body.phoneCode || '').trim()
    const mobile = phoneCode ? await resolveWechatMobile(ctx, phoneCode) : null
    let user = await first(ctx.db, 'SELECT * FROM users WHERE wechat_openid = ?', [openid])
    if (!user) {
      // 登录只建立 openid 与账号关系；昵称和头像必须由用户在资料页主动填写。
      const result = await ctx.db.prepare("INSERT INTO users (wechat_openid, display_name, avatar_url) VALUES (?, '微信用户', NULL)").bind(openid).run()
      user = await first(ctx.db, 'SELECT * FROM users WHERE id = ?', [lastInsertId(result)])
    }
    if (user.status === 'DISABLED') throw new HttpError(403, '账号已被停用，请联系画室')
    if (mobile && mobile !== user.mobile) {
      await ctx.db.prepare('UPDATE users SET mobile = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(mobile, user.id).run()
    }
    const current = await loadActiveUser(ctx.db, user.id)
    return ok({
      token: await sessionFor(current.row, String(ctx.env.SESSION_SECRET || ''), current.currentRole),
      user: serializeUser(current.row, current.roles, current)
    })
  })

  // 每次进入小程序都以服务端重新计算的用户快照为准，缓存数据不能赋予权限。
  router.get('/api/auth/me', async ctx => {
    const current = await requireUser(ctx)
    return ok({ user: serializeUser(current.row, current.roles, current) })
  })

  router.post('/api/auth/wechat-phone', async ctx => {
    const current = await requireUser(ctx)
    const body = await bodyOf(ctx)
    const mobile = await resolveWechatMobile(ctx, body.code)
    await ctx.db.prepare('UPDATE users SET mobile = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(mobile, current.id).run()
    const updated = await loadActiveUser(ctx.db, current.id, current.currentRole)
    return ok({ user: serializeUser(updated.row, updated.roles, updated) })
  })

  // 角色切换必须由服务端验证用户确实拥有该身份，并签发绑定 activeRole 的新令牌。
  router.post('/api/auth/switch-role', async ctx => {
    const current = await requireUser(ctx)
    const body = await bodyOf(ctx)
    const requested = normalizeRole(body.role)
    if (!requested || !current.roles.includes(requested)) throw new HttpError(403, '该账号没有此身份')
    const selected = await loadActiveUser(ctx.db, current.id, requested)
    return ok({
      token: await sessionFor(selected.row, String(ctx.env.SESSION_SECRET || ''), selected.currentRole),
      user: serializeUser(selected.row, selected.roles, selected)
    })
  })
}
