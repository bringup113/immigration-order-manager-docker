ALTER TABLE order_cash_entries
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by TEXT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE order_cash_entries DROP CONSTRAINT IF EXISTS order_cash_entries_status_check;
ALTER TABLE order_cash_entries ADD CONSTRAINT order_cash_entries_status_check CHECK (status IN ('ACTIVE','VOIDED'));
ALTER TABLE order_cash_entries DROP CONSTRAINT IF EXISTS order_cash_entries_void_fields_check;
ALTER TABLE order_cash_entries ADD CONSTRAINT order_cash_entries_void_fields_check CHECK (
  (status='ACTIVE' AND void_reason IS NULL AND voided_at IS NULL AND voided_by IS NULL)
  OR (status='VOIDED' AND btrim(void_reason)<>'' AND voided_at IS NOT NULL AND voided_by IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS order_cash_entries_active_order_idx ON order_cash_entries(order_id,entry_date DESC) WHERE status='ACTIVE';
CREATE INDEX IF NOT EXISTS order_cash_entries_status_idx ON order_cash_entries(order_id,status,entry_date DESC);

INSERT INTO role_permissions (role_id,permission)
VALUES ('role_admin','finance.restore')
ON CONFLICT(role_id,permission) DO NOTHING;
