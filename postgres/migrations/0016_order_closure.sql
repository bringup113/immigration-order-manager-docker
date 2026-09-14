ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS closed_on DATE,
  ADD COLUMN IF NOT EXISTS closure_result TEXT,
  ADD COLUMN IF NOT EXISTS closure_notes TEXT,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by TEXT REFERENCES users(id) ON DELETE SET NULL;

UPDATE orders
SET closed_on = COALESCE(signed_at, CURRENT_DATE),
    closure_result = '历史结案',
    closure_notes = '迁移前已经完成的订单',
    closed_at = updated_at,
    closed_by = owner_user_id
WHERE status = 'COMPLETED' AND closed_at IS NULL;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_completed_closure_check;
ALTER TABLE orders ADD CONSTRAINT orders_completed_closure_check CHECK (
  status <> 'COMPLETED'
  OR (closed_on IS NOT NULL AND NULLIF(btrim(closure_result), '') IS NOT NULL AND closed_at IS NOT NULL AND closed_by IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS order_closure_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('CLOSE','REOPEN')),
  closed_on DATE,
  result TEXT,
  notes TEXT,
  reason TEXT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (
    (action='CLOSE' AND closed_on IS NOT NULL AND NULLIF(btrim(result), '') IS NOT NULL)
    OR (action='REOPEN' AND NULLIF(btrim(reason), '') IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS order_closure_events_order_idx ON order_closure_events(order_id,created_at DESC);
