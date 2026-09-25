// 课时台账：余额 = 该学员最新一条流水的 balance_after。
// 所有写入必须在事务里锁定最新流水后计算，幂等键吸收重试。

export async function balanceOf(db, childId) {
  const latest = await db('lesson_ledger').where('child_id', childId).orderBy('id', 'desc').first('balance_after')
  return Number(latest?.balance_after || 0)
}

export async function applyLedger(trx, { childId, enrollmentId = null, sessionId = null, type, quantity, reason, idempotencyKey = null, operatorUserId = null }) {
  const amount = Number(quantity)
  if (!Number.isFinite(amount) || amount === 0) throw new Error('quantity must be a non-zero number')
  if (idempotencyKey) {
    const existing = await trx('lesson_ledger').where('idempotency_key', idempotencyKey).first('id', 'balance_after')
    if (existing) return { id: Number(existing.id), balance: Number(existing.balance_after), duplicated: true }
  }
  const latest = await trx('lesson_ledger').where('child_id', childId).orderBy('id', 'desc').forUpdate().first('balance_after')
  const balance = Number(latest?.balance_after || 0) + amount
  if (balance < 0) throw new Error('课时余额不足')
  try {
    const [id] = await trx('lesson_ledger').insert({
      child_id: childId,
      enrollment_id: enrollmentId,
      session_id: sessionId,
      type,
      quantity: amount,
      balance_after: balance,
      reason,
      idempotency_key: idempotencyKey,
      operator_user_id: operatorUserId
    })
    return { id: Number(id), balance, duplicated: false }
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY' && idempotencyKey) {
      const existing = await trx('lesson_ledger').where('idempotency_key', idempotencyKey).first('id', 'balance_after')
      if (existing) return { id: Number(existing.id), balance: Number(existing.balance_after), duplicated: true }
    }
    throw error
  }
}
