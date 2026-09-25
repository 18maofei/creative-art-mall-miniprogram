export function id(value, name = 'id') {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`)
  return parsed
}

export function text(value, name) {
  const result = String(value || '').trim()
  if (!result) throw new Error(`${name} is required`)
  return result
}

export function failWith(app) {
  return function fail(reply, error, status = 400) {
    app.log.error(error)
    return reply.code(status).send({ message: error.message || 'Request failed' })
  }
}
