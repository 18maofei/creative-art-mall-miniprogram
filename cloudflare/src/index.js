import { Router, json, fail, withCors } from './core.js'
import { registerPublicRoutes } from './public-routes.js'
import { registerAuthRoutes } from './auth-routes.js'
import { registerAccountRoutes } from './account-routes.js'
import { registerTeacherRoutes } from './teacher-routes.js'
import { registerAdminRoutes } from './admin-routes.js'
import { registerDevRoutes } from './dev-routes.js'
import { expirePendingOrders } from './orders.js'

const router = new Router()
registerPublicRoutes(router)
registerAuthRoutes(router)
registerAccountRoutes(router)
registerTeacherRoutes(router)
registerAdminRoutes(router)
registerDevRoutes(router)

async function serveAdminAsset(request, env) {
  if (!env.ASSETS_STATIC) return null
  const url = new URL(request.url)
  if (url.pathname === '/admin' || url.pathname === '/admin/') url.pathname = '/admin/index.html'
  if (!url.pathname.startsWith('/admin/')) return null
  return env.ASSETS_STATIC.fetch(new Request(url, request))
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), env)
      const requestUrl = new URL(request.url)
      if (request.method === 'GET' && requestUrl.pathname === '/') return withCors(Response.redirect(new URL('/admin/', request.url), 302), env)
      const assetResponse = await serveAdminAsset(request, env)
      if (assetResponse) return withCors(assetResponse, env)
      return withCors(await router.dispatch(request, env), env)
    } catch (error) {
      return withCors(fail(error), env)
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(expirePendingOrders(env.DB, 30, env).catch(error => console.error('pending order expiry failed', error)))
  }
}
