-- 防止网络重试或重复点击生成重复订单；幂等键由客户端为一次结算尝试生成。
ALTER TABLE orders ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_buyer_idempotency
  ON orders(buyer_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
