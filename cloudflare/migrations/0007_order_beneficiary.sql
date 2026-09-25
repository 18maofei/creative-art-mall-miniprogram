-- 课程订单明确归属哪个孩子，避免多孩子家庭购买后课时发错账户。
ALTER TABLE orders ADD COLUMN course_child_id INTEGER REFERENCES children(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_course_child_id ON orders(course_child_id);
