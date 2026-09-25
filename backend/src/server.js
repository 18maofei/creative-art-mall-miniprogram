import Fastify from 'fastify'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from './runtime-config.js'
import authRoutes from './routes/auth.js'
import publicRoutes from './routes/public.js'
import accountRoutes from './routes/account.js'
import teacherRoutes from './routes/teacher.js'
import adminRoutes from './routes/admin.js'
import devRoutes from './routes/dev.js'

const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 })

// 兜底解析器：让图片/PDF 等二进制 PUT 以 Buffer 进入 request.body（JSON 仍走内置解析）。
app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => done(null, body))

app.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*')
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-User-Id, X-User-Id')
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
  if (request.method === 'OPTIONS') return reply.code(204).send()
})

await app.register(authRoutes)
await app.register(publicRoutes)
await app.register(accountRoutes)
await app.register(teacherRoutes)
await app.register(adminRoutes)
if (process.env.NODE_ENV !== 'production') await app.register(devRoutes)

async function serveStatic(reply, file, type) {
  const content = await readFile(join(process.cwd(), 'public', 'admin', file), 'utf8')
  return reply.type(type).send(content)
}

app.get('/admin', async (_request, reply) => {
  try { return await serveStatic(reply, 'index.html', 'text/html; charset=utf-8') } catch { return reply.code(404).send({ message: 'not found' }) }
})
app.get('/admin/live.js', async (_request, reply) => {
  try { return await serveStatic(reply, 'live.js', 'application/javascript; charset=utf-8') } catch { return reply.code(404).send({ message: 'not found' }) }
})

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
