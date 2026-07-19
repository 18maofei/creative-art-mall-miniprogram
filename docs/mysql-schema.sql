CREATE TABLE lesson_ledger (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  child_id BIGINT NOT NULL,
  type ENUM('PURCHASE','GIFT','DEDUCT','REFUND','ADJUST') NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  balance_after DECIMAL(10,2) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  related_lesson_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_child_created_at (child_id, created_at)
);

-- 上线前应增加 users、children、courses、class_sessions、attendance、products、orders 等表。
