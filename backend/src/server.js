import Fastify from 'fastify'

const app = Fastify({ logger: true })
const state = {
  child: { id: 'child-1', name: '乐乐', remainingLessons: 12, validUntil: '2026-12-31' },
  students: [
    { id: 's1', name: '乐乐', state: '出勤', remaining: 12 },
    { id: 's2', name: '安安', state: '请假', remaining: 8 },
    { id: 's3', name: '小米', state: '出勤', remaining: 6 }
  ],
  ledger: []
}

app.get('/health', async () => ({ ok: true, service: 'art-studio-api' }))
app.get('/api/bootstrap', async () => ({ data: state }))

app.post('/api/attendance/confirm', async (request, reply) => {
  const { students = [] } = request.body || {}
  if (!Array.isArray(students) || !students.length) return reply.code(400).send({ message: 'students is required' })
  // API accepts stable machine codes as well as the Chinese labels used by the prototype UI.
  const attended = students.filter(item => ['出勤', 'PRESENT', 'present'].includes(item.state))
  for (const student of attended) {
    const found = state.students.find(item => item.id === student.id)
    if (!found || found.remaining < 1) continue
    found.state = '出勤'
    found.remaining -= 1
    state.ledger.push({ id: `ledger-${Date.now()}-${found.id}`, studentId: found.id, type: 'DEDUCT', quantity: -1, reason: '教师确认考勤', createdAt: new Date().toISOString() })
  }
  return { data: { deducted: attended.length, ledger: state.ledger.slice(-attended.length) } }
})

app.post('/api/orders', async (request, reply) => {
  const { productId, quantity = 1 } = request.body || {}
  if (!productId) return reply.code(400).send({ message: 'productId is required' })
  return { data: { id: `order-${Date.now()}`, productId, quantity, status: 'PENDING_PAYMENT' } }
})

app.listen({ port: Number(process.env.PORT || 3000), host: process.env.HOST || '0.0.0.0' })
