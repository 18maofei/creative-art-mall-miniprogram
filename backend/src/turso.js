import { createClient } from '@libsql/client'
import { requireTursoConfig } from './runtime-config.js'

let client

const transientError = error => /fetch failed|timeout|ECONNRESET|ECONNREFUSED|socket/i.test(String(error?.message || error))
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

export function db() {
  if (!client) client = createClient(requireTursoConfig())
  return client
}

async function withRetry(operation) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!transientError(error) || attempt === 2) throw error
      client = undefined
      await delay(300 * (attempt + 1))
    }
  }
  throw lastError
}

export async function run(sql, args = []) {
  return withRetry(() => db().execute({ sql, args }))
}

export async function rows(sql, args = []) {
  const result = await run(sql, args)
  return result.rows
}

export async function first(sql, args = []) {
  return (await rows(sql, args))[0] || null
}

export async function transaction(statements) {
  const tx = await db().transaction('write')
  try {
    const result = []
    for (const statement of statements) result.push(await tx.execute(statement))
    await tx.commit()
    return result
  } catch (error) {
    await tx.rollback()
    throw error
  }
}
