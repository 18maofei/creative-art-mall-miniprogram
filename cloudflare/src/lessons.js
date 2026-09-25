import { all, first, run, changedRows, lastInsertId, HttpError, isoNow } from './core.js'

// D1 写入采用单条 INSERT ... SELECT：SQLite 会在写入时串行执行，避免先读余额再写入造成竞态。
export async function balanceOf(db, childId) {
  const latest = await first(db, 'SELECT balance_after FROM lesson_ledger WHERE child_id = ? ORDER BY id DESC LIMIT 1', [childId])
  return Number(latest?.balance_after || 0)
}

export async function applyLedger(db, { childId, enrollmentId = null, sessionId = null, type, quantity, reason, idempotencyKey = null, operatorUserId = null }) {
  const amount = Number(quantity)
  if (!Number.isFinite(amount) || amount === 0) throw new HttpError(400, 'quantity must be a non-zero number')
  if (idempotencyKey) {
    const duplicate = await first(db, 'SELECT id, balance_after FROM lesson_ledger WHERE idempotency_key = ?', [idempotencyKey])
    if (duplicate) return { id: Number(duplicate.id), balance: Number(duplicate.balance_after), duplicated: true }
  }

  const now = isoNow()
  const statement = `
    INSERT INTO lesson_ledger
      (child_id, enrollment_id, session_id, type, quantity, balance_after, reason, idempotency_key, operator_user_id, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?,
      COALESCE((SELECT balance_after FROM lesson_ledger WHERE child_id = ? ORDER BY id DESC LIMIT 1), 0) + ?,
      ?, ?, ?, ?, ?
    WHERE COALESCE((SELECT balance_after FROM lesson_ledger WHERE child_id = ? ORDER BY id DESC LIMIT 1), 0) + ? >= 0
  `
  const result = await run(db, statement, [
    childId, enrollmentId, sessionId, type, amount, childId, amount, reason,
    idempotencyKey, operatorUserId, now, now, childId, amount
  ])

  if (!changedRows(result)) {
    const current = await balanceOf(db, childId)
    if (current + amount < 0) throw new HttpError(400, '课时余额不足')
    if (idempotencyKey) {
      const duplicate = await first(db, 'SELECT id, balance_after FROM lesson_ledger WHERE idempotency_key = ?', [idempotencyKey])
      if (duplicate) return { id: Number(duplicate.id), balance: Number(duplicate.balance_after), duplicated: true }
    }
    throw new HttpError(409, '课时流水写入失败，请重试')
  }
  const id = lastInsertId(result)
  const inserted = await first(db, 'SELECT id, balance_after FROM lesson_ledger WHERE id = ?', [id])
  return { id: Number(inserted?.id || id), balance: Number(inserted?.balance_after || 0), duplicated: false }
}

export async function childrenBalances(db, childIds) {
  const result = []
  for (const childId of childIds) result.push({ childId, remainingLessons: await balanceOf(db, childId) })
  return result
}

export async function ledgerRows(db, childId) {
  return all(db, 'SELECT * FROM lesson_ledger WHERE child_id = ? ORDER BY id DESC', [childId])
}
