-- Business dates use DATE; system timestamps use timezone-aware timestamps.
ALTER TABLE orders ALTER COLUMN signed_at TYPE DATE USING NULLIF(signed_at, '')::date;
ALTER TABLE order_steps ALTER COLUMN due_date TYPE DATE USING NULLIF(due_date, '')::date;
ALTER TABLE order_plans ALTER COLUMN due_date TYPE DATE USING NULLIF(due_date, '')::date;
ALTER TABLE order_cash_entries ALTER COLUMN entry_date TYPE DATE USING entry_date::date;
ALTER TABLE order_materials ALTER COLUMN expected_date TYPE DATE USING NULLIF(expected_date, '')::date;
ALTER TABLE order_progress ALTER COLUMN progress_date TYPE DATE USING progress_date::date;
ALTER TABLE order_progress ALTER COLUMN follow_up_date TYPE DATE USING NULLIF(follow_up_date, '')::date;

ALTER TABLE customers ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE customers ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
ALTER TABLE channels ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE channels ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
ALTER TABLE projects ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE projects ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
ALTER TABLE orders ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE orders ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
ALTER TABLE order_steps ALTER COLUMN started_at TYPE TIMESTAMPTZ USING NULLIF(started_at, '')::timestamptz;
ALTER TABLE order_steps ALTER COLUMN completed_at TYPE TIMESTAMPTZ USING NULLIF(completed_at, '')::timestamptz;
ALTER TABLE order_steps ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE order_steps ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
ALTER TABLE order_cash_entries ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE order_cash_entries ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
ALTER TABLE material_files ALTER COLUMN uploaded_at TYPE TIMESTAMPTZ USING uploaded_at::timestamptz;
ALTER TABLE order_progress ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE exchange_rates ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
ALTER TABLE system_settings ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
ALTER TABLE order_search_index ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
ALTER TABLE roles ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE roles ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
ALTER TABLE users ALTER COLUMN locked_until TYPE TIMESTAMPTZ USING NULLIF(locked_until, '')::timestamptz;
ALTER TABLE users ALTER COLUMN last_login_at TYPE TIMESTAMPTZ USING NULLIF(last_login_at, '')::timestamptz;
ALTER TABLE users ALTER COLUMN password_changed_at TYPE TIMESTAMPTZ USING NULLIF(password_changed_at, '')::timestamptz;
ALTER TABLE users ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE users ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
ALTER TABLE users ALTER COLUMN mfa_enabled_at TYPE TIMESTAMPTZ USING NULLIF(mfa_enabled_at, '')::timestamptz;
ALTER TABLE user_sessions ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE user_sessions ALTER COLUMN last_seen_at TYPE TIMESTAMPTZ USING last_seen_at::timestamptz;
ALTER TABLE user_sessions ALTER COLUMN expires_at TYPE TIMESTAMPTZ USING expires_at::timestamptz;
ALTER TABLE user_sessions ALTER COLUMN revoked_at TYPE TIMESTAMPTZ USING NULLIF(revoked_at, '')::timestamptz;
ALTER TABLE audit_logs ALTER COLUMN occurred_at TYPE TIMESTAMPTZ USING occurred_at::timestamptz;
ALTER TABLE material_catalog ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE material_catalog ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
ALTER TABLE auth_rate_limits ALTER COLUMN window_started_at TYPE TIMESTAMPTZ USING window_started_at::timestamptz;
ALTER TABLE auth_rate_limits ALTER COLUMN blocked_until TYPE TIMESTAMPTZ USING NULLIF(blocked_until, '')::timestamptz;
ALTER TABLE auth_rate_limits ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;
ALTER TABLE order_number_counters ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::timestamptz;

-- Preserve a reason for sensitive order-status and required-step overrides.
ALTER TABLE orders ADD COLUMN status_reason TEXT;
ALTER TABLE orders ADD COLUMN status_changed_at TIMESTAMPTZ;
UPDATE orders
SET status_reason = '历史状态，无原因记录'
WHERE status IN ('PAUSED', 'CANCELLED', 'REFUNDED') AND NULLIF(btrim(status_reason), '') IS NULL;
UPDATE orders SET status_changed_at = updated_at WHERE status_changed_at IS NULL;
ALTER TABLE orders ALTER COLUMN status_changed_at SET NOT NULL;
ALTER TABLE orders ALTER COLUMN status_changed_at SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE orders ADD CONSTRAINT orders_sensitive_status_reason_ck
  CHECK (status NOT IN ('PAUSED', 'CANCELLED', 'REFUNDED') OR NULLIF(btrim(status_reason), '') IS NOT NULL);

ALTER TABLE order_steps ADD COLUMN skip_reason TEXT;
UPDATE order_steps SET skip_reason = '历史状态，无原因记录'
WHERE required = 1 AND status = 'SKIPPED' AND NULLIF(btrim(skip_reason), '') IS NULL;
ALTER TABLE order_steps ADD CONSTRAINT order_steps_required_skip_reason_ck
  CHECK (required = 0 OR status <> 'SKIPPED' OR NULLIF(btrim(skip_reason), '') IS NOT NULL);

-- Make workflow invariants true at the database boundary as well as in services.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY order_id ORDER BY sequence, id) AS position
  FROM order_steps
  WHERE status = 'IN_PROGRESS'
)
UPDATE order_steps
SET status = 'PENDING', started_at = NULL, updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT id FROM ranked WHERE position > 1);

WITH first_pending AS (
  SELECT DISTINCT ON (s.order_id) s.id
  FROM order_steps s
  JOIN orders o ON o.id = s.order_id
  WHERE o.status = 'ACTIVE' AND s.status = 'PENDING'
    AND NOT EXISTS (SELECT 1 FROM order_steps active WHERE active.order_id = s.order_id AND active.status = 'IN_PROGRESS')
  ORDER BY s.order_id, s.sequence, s.id
)
UPDATE order_steps
SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT id FROM first_pending);

CREATE UNIQUE INDEX order_steps_one_in_progress_uq
  ON order_steps(order_id) WHERE status = 'IN_PROGRESS';

ALTER TABLE order_steps ADD CONSTRAINT order_steps_order_sequence_uq
  UNIQUE (order_id, sequence) DEFERRABLE INITIALLY DEFERRED;

INSERT INTO role_permissions (role_id, permission)
VALUES ('role_admin', 'orders.override')
ON CONFLICT DO NOTHING;

ALTER TABLE _app_migrations ALTER COLUMN applied_at TYPE TIMESTAMPTZ USING applied_at::timestamptz;
